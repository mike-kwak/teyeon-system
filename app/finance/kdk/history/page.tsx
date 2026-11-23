'use client';

export const dynamic = 'force-dynamic';

// Finance → KDK 벌금 관리 → 누적 벌금 현황(조회 전용).
//   권한: 기존 Finance 관리자(canManageFinance)만 조회 요청. DB 는 기존 RLS 가 다시 막는다.
//   데이터: 세션 정산 화면과 같은 판정 함수(buildKdkPenaltyRows)로 세션별 행을 만든 뒤 누적한다.
//   납부 처리·취소·금액 수정 없음 — 각 세션 정산은 기존 /finance/kdk/[sessionId] 로 이동해서 한다.

import React, { Suspense } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    FinancePageHeader,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import {
    aggregateMembers,
    groupGuestsByName,
    inPeriod,
    matchesSearch,
    summarizeRecords,
    type GuestNameGroup,
    type MemberPenaltyAggregate,
    type OrphanReceivable,
    type PenaltyHistory,
    type PenaltyHistoryRecord,
    type PenaltySessionSummary,
    type PeriodRange,
} from '@/lib/finance/kdkPenaltyHistoryModel';
import {
    BlockedView,
    EmptyCard,
    ErrorCard,
    GuestBadge,
    LoadingCard,
    NAVY,
    NameLine,
    PenaltyBucketBadge,
    PenaltySummaryCards,
    PeriodFilter,
    RefreshButton,
    SectionTitle,
    ShowMoreButton,
    TEAL_DARK,
    dotDate,
    historyQueryString,
    reviewReason,
    useHistoryQuery,
    useIncremental,
    usePeriodResolution,
    type HistoryQuery,
    type HistoryTab,
} from '@/components/finance/KdkPenaltyHistoryUI';
import { formatLoadedAt, usePenaltyHistory } from '@/components/finance/usePenaltyHistory';
import { KdkPenaltyShareActions } from '@/components/finance/KdkPenaltyShareActions';
import { buildPenaltyShareContent, STATS_NOTES, type ShareStatsInput } from '@/lib/finance/kdkPenaltyHistoryShare';
import {
    aggregateMemberStats,
    buildStatsOverview,
    formatPenaltyRate,
    memberRowsForView,
    participationsInPeriod,
    STATS_VIEW_LABEL,
    STATS_VIEWS,
    type MemberStatsRow,
    type StatsOverview,
    type StatsView,
} from '@/lib/finance/kdkPenaltyStatsModel';

const CONTAINER: React.CSSProperties = { ...FINANCE_CONTAINER_STYLE };

export default function KdkPenaltyHistoryPage() {
    return (
        <Suspense fallback={<main style={FINANCE_PAGE_STYLE}><div style={CONTAINER}><LoadingCard /></div></main>}>
            <HistoryView />
        </Suspense>
    );
}

function HistoryView() {
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);
    const [query, update] = useHistoryQuery();
    const resolution = usePeriodResolution(query);
    const { state, reload } = usePenaltyHistory(user?.id, !isLoading && !!user && isAdmin);
    // 공유 텍스트: 조회 완료(새로고침 중 아님) + 유효 기간일 때만. 로딩·오류·이전 기간 데이터는 복사하지 않는다.
    const shareHistory = state.kind === 'ready' && !state.refreshing ? state.history : null;
    const shareRecords = shareHistory ? shareHistory.records : null;
    const shareRange = resolution.ok ? resolution.range : null;
    // V6: 화면에서 고른 표시 방식 그대로 이미지·텍스트를 만든다(게스트 탭은 V5 금액 그대로).
    const shareStats = React.useMemo<ShareStatsInput | null>(
        () => (shareHistory?.participations ? {
            view: query.view,
            participations: shareHistory.participations,
            sessions: shareHistory.sessions.map((s) => ({ date: s.date, hasSnapshot: s.hasSnapshot })),
        } : null),
        [shareHistory, query.view],
    );
    const getShareContent = React.useMemo(
        () => (shareRecords && shareRange ? () => buildPenaltyShareContent(shareRecords, shareRange, query.tab, new Date(), shareStats) : null),
        [shareRecords, shareRange, query.tab, shareStats],
    );

    if (isLoading) {
        return <main style={FINANCE_PAGE_STYLE}><div style={CONTAINER}><LoadingCard /></div></main>;
    }
    if (!user || !isAdmin) {
        return <main style={FINANCE_PAGE_STYLE}><div style={CONTAINER}><BlockedView loggedIn={!!user} /></div></main>;
    }

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div className="kdk-history-container" style={CONTAINER}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE · KDK"
                    title="KDK 누적 벌금 현황"
                    subtitle="회원과 게스트의 벌금·납부 기록을 확인합니다."
                    backHref="/finance/kdk"
                    rightSlot={<RefreshButton onClick={reload} busy={state.kind === 'loading' || (state.kind === 'ready' && state.refreshing)} />}
                />
                <Breadcrumb />

                <TabBar tab={query.tab} onChange={(tab) => update({ tab, q: '' })} />
                {query.tab !== 'guest' && <ViewBar view={query.view} onChange={(view) => update({ view })} />}
                <PeriodFilter query={query} onChange={update} resolution={resolution} />
                <KdkPenaltyShareActions getContent={state.kind === 'error' ? null : getShareContent} />

                {state.kind === 'loading' || state.kind === 'idle' ? <LoadingCard /> : null}
                {state.kind === 'error' && <ErrorCard message={state.message} onRetry={reload} />}
                {state.kind === 'ready' && (
                    !resolution.ok ? (
                        <EmptyCard>
                            {query.from || query.to ? resolution.error : '시작일과 종료일을 선택한 뒤 조회해 주세요.'}
                        </EmptyCard>
                    ) : (
                        <ReadyContent
                            history={state.history}
                            query={query}
                            update={update}
                            range={resolution.range}
                            periodLabel={resolution.label}
                            loadedAt={state.loadedAt}
                        />
                    )
                )}
            </div>
        </main>
    );
}

function Breadcrumb() {
    const link: React.CSSProperties = { color: '#64748B', textDecoration: 'none' };
    return (
        <nav aria-label="경로" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#94A3B8', marginTop: -4, flexWrap: 'wrap' }}>
            <Link href="/finance" style={link}>Finance</Link>
            <ChevronRight size={11} />
            <Link href="/finance/kdk" style={link}>KDK 벌금 관리</Link>
            <ChevronRight size={11} />
            <span style={{ color: TEAL_DARK }}>누적 현황</span>
        </nav>
    );
}

const TAB_LABEL: Record<HistoryTab, string> = { all: '전체', member: '회원', guest: '게스트' };

function TabBar({ tab, onChange }: { tab: HistoryTab; onChange: (t: HistoryTab) => void }) {
    return (
        <div role="tablist" aria-label="조회 구분" style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 4, padding: 4,
            borderRadius: 12, background: '#E7ECF2',
        }}>
            {(['all', 'member', 'guest'] as HistoryTab[]).map((t) => {
                const active = t === tab;
                return (
                    <button key={t} type="button" role="tab" aria-selected={active} onClick={() => onChange(t)} style={{
                        height: 34, minWidth: 0, borderRadius: 9, border: 'none', cursor: 'pointer',
                        background: active ? '#FFFFFF' : 'transparent',
                        boxShadow: active ? '0 1px 3px rgba(15,23,42,0.10)' : 'none',
                        color: active ? NAVY : '#64748B', fontSize: 12.5, fontWeight: active ? 900 : 700,
                    }}>{TAB_LABEL[t]}</button>
                );
            })}
        </div>
    );
}

function ReadyContent({ history, query, update, range, periodLabel, loadedAt }: {
    history: PenaltyHistory;
    query: HistoryQuery;
    update: (p: Partial<HistoryQuery>) => void;
    range: PeriodRange;
    periodLabel: string;
    loadedAt: number;
}) {
    const periodRecords = React.useMemo(
        () => history.records.filter((r) => inPeriod(r.sessionDate, range)),
        [history.records, range],
    );
    const tabRecords = React.useMemo(
        () => query.tab === 'all' ? periodRecords : periodRecords.filter((r) => r.side === query.tab),
        [periodRecords, query.tab],
    );
    const summary = React.useMemo(() => summarizeRecords(tabRecords), [tabRecords]);
    const periodSessions = React.useMemo(
        () => history.sessions.filter((s) => inPeriod(s.date, range)),
        [history.sessions, range],
    );
    // V6: 참가 기록도 금액과 같은 기간(KDK 개최일 기준)으로 거른다.
    const periodParticipations = React.useMemo(
        () => participationsInPeriod(history.participations ?? [], range),
        [history.participations, range],
    );
    const statsOn = query.view !== 'amount' && !!history.participations;
    const memberStats = React.useMemo(
        () => (statsOn ? aggregateMemberStats(periodRecords.filter((r) => r.side === 'member'), periodParticipations) : null),
        [statsOn, periodRecords, periodParticipations],
    );
    const overview = React.useMemo(
        () => (memberStats ? buildStatsOverview(memberStats, periodParticipations, periodSessions) : null),
        [memberStats, periodParticipations, periodSessions],
    );

    return (
        <>
            <p style={{ margin: '2px 2px 0', fontSize: 11, fontWeight: 700, color: '#64748B', display: 'flex', flexWrap: 'wrap', columnGap: 6 }}>
                <span><b style={{ color: NAVY }}>{periodLabel}</b> · KDK 개최일 기준</span>
                <span>· 세션 {periodSessions.length}개</span>
                <span style={{ color: '#94A3B8' }}>· {formatLoadedAt(loadedAt)}</span>
            </p>
            <PenaltySummaryCards summary={summary} />

            {overview && query.tab !== 'guest' && <StatsOverviewCard overview={overview} />}

            {query.tab === 'all' && (
                <>
                    <SessionSection sessions={periodSessions} />
                    <ExceptionsSection history={history} range={range} isAllPeriod={!range.from && !range.to} />
                </>
            )}
            {query.tab === 'member' && (
                memberStats
                    ? <MemberStatsSection rows={memberStats} view={query.view} records={tabRecords} query={query} update={update} />
                    : <MemberSection records={tabRecords} query={query} update={update} />
            )}
            {query.tab === 'guest' && (
                <GuestSection records={tabRecords} query={query} update={update} guestAvailable={history.exceptions.guestAvailable} />
            )}
        </>
    );
}

// ── 검색 입력(URL q 와 동기화, 입력 중 디바운스) ─────────────────────────────
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (q: string) => void; placeholder: string }) {
    const [draft, setDraft] = React.useState(value);
    React.useEffect(() => { setDraft(value); }, [value]);
    React.useEffect(() => {
        if (draft === value) return;
        const t = setTimeout(() => onChange(draft.trim()), 250);
        return () => clearTimeout(t);
    }, [draft, value, onChange]);
    return (
        <label style={{
            ...FINANCE_CARD_STYLE, padding: '0 10px', height: 40,
            display: 'flex', alignItems: 'center', gap: 8,
        }}>
            <Search size={15} color="#94A3B8" style={{ flexShrink: 0 }} />
            <input
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                enterKeyHint="search"
                aria-label={placeholder}
                style={{
                    flex: 1, minWidth: 0, height: 36, border: 'none', outline: 'none', background: 'transparent',
                    fontSize: 16, // iOS 입력 시 자동 확대 방지(16px 미만이면 확대됨).
                    fontWeight: 700, color: NAVY, fontFamily: 'inherit',
                }}
            />
            {draft && (
                <button type="button" aria-label="검색어 지우기" onClick={() => { setDraft(''); onChange(''); }} style={{
                    border: 'none', background: 'transparent', color: '#94A3B8', cursor: 'pointer', padding: 2, display: 'flex',
                }}><X size={15} /></button>
            )}
        </label>
    );
}

// ── 전체: 세션별 ─────────────────────────────────────────────────────────────
function SessionSection({ sessions }: { sessions: PenaltySessionSummary[] }) {
    const inc = useIncremental(sessions.length, 30, sessions);
    return (
        <>
            <SectionTitle title="세션별 벌금" right={<span style={{ fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>누르면 세션 정산으로 이동</span>} />
            {sessions.length === 0 ? (
                <EmptyCard>선택한 기간에 공식 KDK 세션이 없습니다.</EmptyCard>
            ) : (
                <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {sessions.slice(0, inc.limit).map((s, i) => <SessionRow key={s.sessionId} s={s} first={i === 0} />)}
                    </ul>
                </section>
            )}
            {inc.more && <ShowMoreButton remaining={sessions.length - inc.limit} onClick={inc.showMore} />}
        </>
    );
}

function SessionRow({ s, first }: { s: PenaltySessionSummary; first: boolean }) {
    return (
        <li style={{ borderTop: first ? 'none' : '1px solid #EEF2F6' }}>
            <Link href={`/finance/kdk/${encodeURIComponent(s.sessionId)}`} style={rowLink}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap', paddingLeft: 1 }}>{dotDate(s.date)}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                    </p>
                    {s.hasSnapshot ? (
                        <p style={subLine}>
                            <span style={nowrap}>대상 {s.recordCount}명</span>
                            {s.memberGross > 0 && <span style={nowrap}>회원 {formatWon(s.memberGross)}</span>}
                            {s.guestGross > 0 && <span style={nowrap}>게스트 {formatWon(s.guestGross)}</span>}
                            {s.excludedAmount > 0 && <span style={nowrap}>비대상 {formatWon(s.excludedAmount)}</span>}
                        </p>
                    ) : (
                        <p style={{ ...subLine, color: '#92400E' }}>정산 스냅샷 없음 · 벌금 기록 확인 필요</p>
                    )}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    {s.hasSnapshot && s.recordCount > 0 ? (
                        <>
                            <span style={{ fontSize: 12.5, fontWeight: 900, color: TEAL_DARK, whiteSpace: 'nowrap' }}>{formatWon(s.paidAmount)}</span>
                            <span style={{ fontSize: 10.5, fontWeight: 800, whiteSpace: 'nowrap', color: s.unpaidAmount > 0 ? '#B91C1C' : '#94A3B8' }}>
                                미납 {formatWon(s.unpaidAmount)}
                            </span>
                            {s.reviewCount > 0 && <PenaltyBucketBadge bucket="review" />}
                        </>
                    ) : s.hasSnapshot ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', whiteSpace: 'nowrap' }}>벌금 없음</span>
                    ) : (
                        <PenaltyBucketBadge bucket="review" />
                    )}
                </div>
                <ChevronRight size={15} color="#CBD5E1" style={{ flexShrink: 0 }} />
            </Link>
        </li>
    );
}

// ── 회원 ─────────────────────────────────────────────────────────────────────
function MemberSection({ records, query, update }: {
    records: PenaltyHistoryRecord[];
    query: HistoryQuery;
    update: (p: Partial<HistoryQuery>) => void;
}) {
    const all = React.useMemo(() => aggregateMembers(records), [records]);
    const list = React.useMemo(() => all.filter((m) => matchesSearch(m.name, query.q)), [all, query.q]);
    const unlinked = React.useMemo(() => records.filter((r) => !r.memberId), [records]);
    const inc = useIncremental(list.length, 50, `${query.q}|${list.length}`);
    const onSearch = React.useCallback((q: string) => update({ q }), [update]);

    return (
        <>
            <SectionTitle title="회원별 누적 벌금" right={<span style={{ fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>청구액 많은 순</span>} />
            <SearchBox value={query.q} onChange={onSearch} placeholder="회원 이름 검색" />
            <p style={{ margin: '0 2px', fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                {query.q ? <>검색 결과 <b style={{ color: NAVY }}>{list.length}</b>명 / 전체 {all.length}명</> : <>벌금 기록 회원 <b style={{ color: NAVY }}>{all.length}</b>명</>}
            </p>
            <p data-record-count-note style={{ margin: '-4px 2px 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                ‘벌금 기록’은 비대상·확인 필요를 포함한 횟수입니다. 유효 부과 기준 ‘벌금 발생’ 횟수는 종합·벌금 횟수 모드에서 볼 수 있습니다.
            </p>
            {list.length === 0 ? (
                <EmptyCard>{query.q ? '검색된 회원이 없습니다.' : '선택한 기간에 회원 벌금 기록이 없습니다.'}</EmptyCard>
            ) : (
                <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {list.slice(0, inc.limit).map((m, i) => <MemberRow key={m.memberId} m={m} first={i === 0} query={query} />)}
                    </ul>
                </section>
            )}
            {inc.more && <ShowMoreButton remaining={list.length - inc.limit} onClick={inc.showMore} />}
            {unlinked.length > 0 && <UnlinkedParticipants records={unlinked} />}
        </>
    );
}

function MemberRow({ m, first, query }: { m: MemberPenaltyAggregate; first: boolean; query: HistoryQuery }) {
    const href = `/finance/kdk/history/members/${encodeURIComponent(m.memberId)}${historyQueryString({ ...query, tab: 'member' })}`;
    return (
        <li style={{ borderTop: first ? 'none' : '1px solid #EEF2F6' }}>
            <Link href={href} style={rowLink}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <NameLine name={m.name} />
                    <p style={subLine}>
                        <span style={nowrap} title={RECORD_COUNT_HINT}>벌금 기록 {m.sessionCount}회</span>
                        <span style={{ ...nowrap, color: TEAL_DARK }}>납부 {formatWon(m.paidAmount)}</span>
                        {m.unpaidAmount > 0 && <span style={{ ...nowrap, color: '#B91C1C' }}>미납 {formatWon(m.unpaidAmount)}</span>}
                        {m.excludedAmount > 0 && <span style={nowrap}>비대상 {formatWon(m.excludedAmount)}</span>}
                        {m.reviewAmount > 0 && <span style={{ ...nowrap, color: '#92400E' }}>확인 필요 {formatWon(m.reviewAmount)}</span>}
                    </p>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{formatWon(m.billableAmount)}</span>
                    <PenaltyBucketBadge bucket={m.bucket} />
                </div>
                <ChevronRight size={15} color="#CBD5E1" style={{ flexShrink: 0 }} />
            </Link>
        </li>
    );
}

/** 회원으로 연결되지 않은 비게스트 참가자(회원 연결 필요). 누적 회원 목록에 합치지 않는다. */
function UnlinkedParticipants({ records }: { records: PenaltyHistoryRecord[] }) {
    return (
        <details style={{ ...FINANCE_CARD_STYLE, padding: '10px 12px', borderColor: 'rgba(245,158,11,0.28)', background: '#FFFBF2' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#92400E' }}>
                회원 연결 필요 {records.length}건 · {formatWon(records.reduce((a, r) => a + r.amount, 0))}
            </summary>
            <p style={{ margin: '6px 0 4px', fontSize: 11, fontWeight: 600, color: '#92400E', wordBreak: 'keep-all' }}>
                공식 기록의 참가자가 회원과 연결되지 않아 회원별 합계에 포함하지 않았습니다. 세션 정산 화면에서 확인해 주세요.
            </p>
            <RecordList records={records} />
        </details>
    );
}

// ── V6: 표시 방식 · 참가/벌금 발생 통계 ─────────────────────────────────────────
//   금액(누적 벌금 · 납부 · 미납)은 V5 와 같은 값(aggregateMembers)을 그대로 보여준다. 횟수만 추가.

function ViewBar({ view, onChange }: { view: StatsView; onChange: (v: StatsView) => void }) {
    return (
        <div role="group" aria-label="표시 방식" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, color: '#64748B', paddingLeft: 2 }}>표시</span>
            <div style={{
                flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 2, padding: 3,
                borderRadius: 10, background: '#E7ECF2',
            }}>
                {STATS_VIEWS.map((v) => {
                    const active = v === view;
                    return (
                        <button key={v} type="button" aria-pressed={active} onClick={() => onChange(v)} style={{
                            height: 30, minWidth: 0, padding: '0 2px', borderRadius: 7, border: 'none', cursor: 'pointer',
                            background: active ? '#FFFFFF' : 'transparent', boxShadow: active ? '0 1px 2px rgba(15,23,42,0.10)' : 'none',
                            color: active ? TEAL_DARK : '#64748B', fontSize: 12, fontWeight: active ? 900 : 700,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'inherit',
                        }}>{STATS_VIEW_LABEL[v]}</button>
                    );
                })}
            </div>
        </div>
    );
}

function StatsOverviewCard({ overview: o }: { overview: StatsOverview }) {
    const cell = (label: string, value: string, accent = false) => (
        <div style={{ minWidth: 0, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
            <p style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 900, color: accent ? TEAL_DARK : NAVY, whiteSpace: 'nowrap' }}>{value}</p>
        </div>
    );
    const warn: string[] = [];
    if (o.noSnapshotSessions > 0) warn.push(`정산 스냅샷 없는 공식 세션 ${o.noSnapshotSessions}개는 참가·벌금 모두 집계에서 제외`);
    if (o.unlinkedParticipations > 0) warn.push(`회원 연결 필요 참가 ${o.unlinkedParticipations}건은 회원별 참가에 미포함`);
    if (o.inconsistentMembers > 0) warn.push(`벌금 발생이 참가보다 많은 회원 ${o.inconsistentMembers}명 — 데이터 확인 필요`);
    return (
        <section aria-label="회원 참가 · 벌금 발생" data-stats-overview style={{ ...FINANCE_CARD_STYLE, padding: '10px 10px 9px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 4 }}>
                {cell('공식 세션', `${o.sessionCount.toLocaleString('ko-KR')}회`)}
                {cell('회원 참가', `${o.memberParticipations.toLocaleString('ko-KR')}회`)}
                {cell('벌금 발생', `${o.memberPenalties.toLocaleString('ko-KR')}회`)}
                {cell('발생률', formatPenaltyRate(o.memberPenaltyRate), true)}
            </div>
            <p style={{ margin: '7px 2px 0', fontSize: 10, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                회원 참가·벌금 발생은 연인원(회원 × 세션) 기준 · {STATS_NOTES.join(' · ')}
            </p>
            {warn.length > 0 && (
                <p style={{ margin: '4px 2px 0', fontSize: 10.5, fontWeight: 700, color: '#92400E', lineHeight: 1.5, wordBreak: 'keep-all' }}>{warn.join(' · ')}</p>
            )}
        </section>
    );
}

const SORT_LABEL: Record<StatsView, string> = {
    summary: '누적 벌금 많은 순', amount: '청구액 많은 순', participation: '참가 많은 순', penalty: '벌금 발생 많은 순',
};
const SECTION_LABEL: Record<StatsView, string> = {
    summary: '회원별 종합 현황', amount: '회원별 누적 벌금', participation: '회원별 KDK 참가 횟수', penalty: '회원별 벌금 발생 횟수',
};

function MemberStatsSection({ rows, view, records, query, update }: {
    rows: MemberStatsRow[];
    view: StatsView;
    records: PenaltyHistoryRecord[];
    query: HistoryQuery;
    update: (p: Partial<HistoryQuery>) => void;
}) {
    const all = React.useMemo(() => memberRowsForView(rows, view), [rows, view]);
    const list = React.useMemo(() => all.filter((m) => matchesSearch(m.name, query.q)), [all, query.q]);
    const unlinked = React.useMemo(() => records.filter((r) => !r.memberId), [records]);
    const inc = useIncremental(list.length, 50, `${query.q}|${view}|${list.length}`);
    const onSearch = React.useCallback((q: string) => update({ q }), [update]);

    return (
        <>
            <SectionTitle title={SECTION_LABEL[view]} right={<span style={{ fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>{SORT_LABEL[view]}</span>} />
            <SearchBox value={query.q} onChange={onSearch} placeholder="회원 이름 검색" />
            <p style={{ margin: '0 2px', fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                {query.q ? <>검색 결과 <b style={{ color: NAVY }}>{list.length}</b>명 / 전체 {all.length}명</> : <>참가·벌금 기록 회원 <b style={{ color: NAVY }}>{all.length}</b>명</>}
            </p>
            {list.length === 0 ? (
                <EmptyCard>{query.q ? '검색된 회원이 없습니다.' : '선택한 기간에 회원 참가·벌금 기록이 없습니다.'}</EmptyCard>
            ) : (
                <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {list.slice(0, inc.limit).map((m, i) => <MemberStatsItem key={m.memberId} m={m} view={view} first={i === 0} query={query} />)}
                    </ul>
                </section>
            )}
            {inc.more && <ShowMoreButton remaining={list.length - inc.limit} onClick={inc.showMore} />}
            {unlinked.length > 0 && <UnlinkedParticipants records={unlinked} />}
        </>
    );
}

function MemberStatsItem({ m, view, first, query }: { m: MemberStatsRow; view: StatsView; first: boolean; query: HistoryQuery }) {
    const href = `/finance/kdk/history/members/${encodeURIComponent(m.memberId)}${historyQueryString({ ...query, tab: 'member' })}`;
    const strong = (k: 'participation' | 'penalty') => (view === k ? { color: NAVY, fontWeight: 900 } : undefined);
    const big = view === 'participation' ? { value: `${m.participationCount.toLocaleString('ko-KR')}회`, label: '참가' }
        : view === 'penalty' ? { value: `${m.penaltyCount.toLocaleString('ko-KR')}회`, label: '벌금 발생' }
            : { value: formatWon(m.billableAmount), label: '누적 벌금' };
    return (
        <li style={{ borderTop: first ? 'none' : '1px solid #EEF2F6' }} data-member-stats-row>
            <Link href={href} style={rowLink}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <NameLine name={m.name} />
                    <p style={subLine} data-stats-line>
                        <span style={{ ...nowrap, ...strong('participation') }}>참가 {m.participationCount}회</span>
                        <span style={{ ...nowrap, ...strong('penalty') }}>벌금 발생 {m.penaltyCount}회</span>
                        <span style={nowrap}>발생률 {formatPenaltyRate(m.penaltyRate)}</span>
                        {m.inconsistent && <span style={{ ...nowrap, color: '#B91C1C' }}>정합성 확인 필요</span>}
                    </p>
                    <p style={subLine}>
                        {view !== 'summary' && <span style={{ ...nowrap, color: NAVY }}>누적 {formatWon(m.billableAmount)}</span>}
                        <span style={{ ...nowrap, color: TEAL_DARK }}>납부 {formatWon(m.paidAmount)}</span>
                        {m.unpaidAmount > 0 && <span style={{ ...nowrap, color: '#B91C1C' }}>미납 {formatWon(m.unpaidAmount)}</span>}
                        {m.excludedAmount > 0 && <span style={nowrap}>비대상 {formatWon(m.excludedAmount)}</span>}
                        {m.reviewAmount > 0 && <span style={{ ...nowrap, color: '#92400E' }}>확인 필요 {formatWon(m.reviewAmount)}</span>}
                    </p>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{big.value}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94A3B8', whiteSpace: 'nowrap' }}>{big.label}</span>
                    {m.sessionCount > 0 && <PenaltyBucketBadge bucket={m.bucket} />}
                </div>
                <ChevronRight size={15} color="#CBD5E1" style={{ flexShrink: 0 }} />
            </Link>
        </li>
    );
}

// ── 게스트 ───────────────────────────────────────────────────────────────────
//   기본: 동일 이름 묶음(화면 표시용). ⚠ 동일 이름 ≠ 동일 인물 — 금액은 "동일 이름 기준 합계".
//   원본 기록은 세션별 그대로이며, '기록별' 보기로 기존 세션별 목록도 볼 수 있다.
function GuestSection({ records, query, update, guestAvailable }: {
    records: PenaltyHistoryRecord[];
    query: HistoryQuery;
    update: (p: Partial<HistoryQuery>) => void;
    guestAvailable: boolean;
}) {
    // 검색은 개별 기록 이름에 먼저 적용한 뒤 묶는다 → 그룹·기록 모두에 같은 검색이 적용된다.
    const list = React.useMemo(() => records.filter((r) => matchesSearch(r.displayName, query.q)), [records, query.q]);
    const groups = React.useMemo(() => groupGuestsByName(list), [list]);
    const searchedTotal = React.useMemo(() => list.reduce((a, r) => a + r.amount, 0), [list]);
    const onSearch = React.useCallback((q: string) => update({ q }), [update]);
    const byName = query.gview !== 'records';

    return (
        <>
            <SectionTitle title="게스트 벌금 기록" right={<GuestViewToggle byName={byName} onChange={(gview) => update({ gview })} />} />
            <p style={{
                ...FINANCE_CARD_STYLE, margin: 0, padding: '9px 12px', fontSize: 11, fontWeight: 700, color: '#475569',
                lineHeight: 1.5, wordBreak: 'keep-all', background: '#F8FAFC',
            }}>
                {byName
                    ? <>이름이 같은 게스트 기록을 묶어 보여줍니다. 같은 이름이 같은 사람이라는 뜻은 아니며, 금액은 <b style={{ color: NAVY }}>동일 이름 기준 합계</b>입니다(공식 개인별 누적 아님).</>
                    : <>게스트 기록은 세션별 참가자 정보를 기준으로 표시됩니다.</>}
            </p>
            <p data-guest-stats-note style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                게스트는 세션을 넘는 고유 식별자가 없어 KDK 참가 횟수·벌금 발생률을 집계하지 않습니다(이름이 같아도 합치지 않음).
            </p>
            {!guestAvailable && (
                <p style={{ ...FINANCE_CARD_STYLE, margin: 0, padding: '9px 12px', fontSize: 11, fontWeight: 700, color: '#92400E', background: '#FFFBF2', wordBreak: 'keep-all' }}>
                    게스트 벌금 납부 저장소가 적용되지 않아 게스트 납부 상태를 확인할 수 없습니다(확인 필요로 표시).
                </p>
            )}
            <SearchBox value={query.q} onChange={onSearch} placeholder="게스트 이름 검색" />
            <p style={{ margin: '0 2px', fontSize: 11, fontWeight: 700, color: '#64748B', wordBreak: 'keep-all' }}>
                {query.q ? '검색된 ' : '게스트 '}
                {byName && <>이름 <b style={{ color: NAVY }}>{groups.length}</b>개 · </>}
                기록 <b style={{ color: NAVY }}>{list.length}</b>건 · 벌금 {formatWon(searchedTotal)}
            </p>
            {list.length === 0 ? (
                <EmptyCard>{query.q ? '검색된 게스트 기록이 없습니다.' : '선택한 기간에 게스트 벌금 기록이 없습니다.'}</EmptyCard>
            ) : byName ? (
                <GuestGroupList groups={groups} resetKey={query.q} />
            ) : (
                <RecordList records={list} card resetKey={query.q} />
            )}
        </>
    );
}

function GuestViewToggle({ byName, onChange }: { byName: boolean; onChange: (v: 'name' | 'records') => void }) {
    const btn = (active: boolean): React.CSSProperties => ({
        height: 26, padding: '0 9px', border: 'none', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
        background: active ? '#FFFFFF' : 'transparent', boxShadow: active ? '0 1px 2px rgba(15,23,42,0.10)' : 'none',
        color: active ? NAVY : '#64748B', fontSize: 11, fontWeight: active ? 900 : 700,
    });
    return (
        <div role="group" aria-label="게스트 보기 방식" style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, background: '#E7ECF2', flexShrink: 0 }}>
            <button type="button" aria-pressed={byName} onClick={() => onChange('name')} style={btn(byName)}>이름별</button>
            <button type="button" aria-pressed={!byName} onClick={() => onChange('records')} style={btn(!byName)}>기록별</button>
        </div>
    );
}

function GuestGroupList({ groups, resetKey }: { groups: GuestNameGroup[]; resetKey: unknown }) {
    const inc = useIncremental(groups.length, 50, `${String(resetKey)}|${groups.length}`);
    const [open, setOpen] = React.useState<Set<string>>(new Set());
    // 검색 결과가 이름 1개면 자동으로 펼친다.
    React.useEffect(() => {
        setOpen(groups.length === 1 ? new Set([groups[0].key]) : new Set());
    }, [resetKey, groups]);
    const toggle = (key: string) => setOpen((prev) => {
        const n = new Set(prev);
        if (n.has(key)) n.delete(key); else n.add(key);
        return n;
    });
    return (
        <>
            <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {groups.slice(0, inc.limit).map((g, i) => (
                        <GuestGroupRow key={g.key} g={g} first={i === 0} expanded={open.has(g.key)} onToggle={() => toggle(g.key)} />
                    ))}
                </ul>
            </section>
            {inc.more && <ShowMoreButton remaining={groups.length - inc.limit} onClick={inc.showMore} />}
        </>
    );
}

function GuestGroupRow({ g, first, expanded, onToggle }: { g: GuestNameGroup; first: boolean; expanded: boolean; onToggle: () => void }) {
    const s = g.summary;
    const panelId = `guest-group-${shortId(g.key)}`;
    return (
        <li style={{ borderTop: first ? 'none' : '1px solid #EEF2F6' }}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                aria-controls={panelId}
                style={{
                    ...rowLink, width: '100%', border: 'none', background: expanded ? '#F8FAFC' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', font: 'inherit',
                }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>
                    {g.unknown
                        ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 13, fontWeight: 800, color: '#92400E', paddingLeft: 1 }}>이름 확인 불가</span><GuestBadge /></span>
                        : <NameLine name={g.name} isGuest />}
                    <p style={subLine}>
                        <span style={nowrap} title={RECORD_COUNT_HINT}>벌금 기록 {g.count}건</span>
                        <span style={{ ...nowrap, color: TEAL_DARK }}>납부 {formatWon(s.paidAmount)}</span>
                        <span style={{ ...nowrap, color: s.unpaidAmount > 0 ? '#B91C1C' : '#94A3B8' }}>미납 {formatWon(s.unpaidAmount)}</span>
                        {s.reviewAmount > 0 && <span style={{ ...nowrap, color: '#92400E' }}>확인 필요 {formatWon(s.reviewAmount)}</span>}
                    </p>
                </div>
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{formatWon(s.grossAmount)}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94A3B8', whiteSpace: 'nowrap' }}>{g.unknown ? '기록 합계' : '동일 이름 기준'}</span>
                    <PenaltyBucketBadge bucket={g.bucket} />
                </div>
                <ChevronDown size={15} color="#94A3B8" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {expanded && (
                <div id={panelId} style={{ background: '#F8FAFC', borderTop: '1px solid #EEF2F6', padding: '2px 0 4px 14px' }}>
                    {g.unknown && (
                        <p style={{ margin: '6px 12px 2px 0', fontSize: 10.5, fontWeight: 600, color: '#92400E', wordBreak: 'keep-all' }}>
                            공식 기록에 이름이 없거나 내부 식별값만 있는 기록입니다. 서로 다른 사람일 수 있습니다.
                        </p>
                    )}
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {g.records.map((r, i) => {
                            const reason = reviewReason(r.status, r.isGuest);
                            return (
                                <li key={r.key} style={{ borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                                    <Link href={`/finance/kdk/${encodeURIComponent(r.sessionId)}`} style={{ ...rowLink, padding: '9px 10px 9px 0' }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                                                <span style={{ fontSize: 12, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap', paddingLeft: 1 }}>{dotDate(r.sessionDate)}</span>
                                                <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94A3B8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sessionTitle}</span>
                                            </p>
                                            {(reason || (r.paidAt && r.bucket === 'paid')) && (
                                                <p style={subLine}>
                                                    {r.paidAt && r.bucket === 'paid' && <span style={nowrap}>{dotDate(String(r.paidAt).slice(0, 10))} 납부</span>}
                                                    {reason && <span style={{ ...nowrap, color: '#92400E' }}>{reason}</span>}
                                                </p>
                                            )}
                                        </div>
                                        <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{formatWon(r.amount)}</span>
                                        <span style={{ flexShrink: 0 }}><PenaltyBucketBadge bucket={r.bucket} status={r.status} /></span>
                                        <ChevronRight size={14} color="#CBD5E1" style={{ flexShrink: 0 }} />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </li>
    );
}

/** DOM id 용 — 키(한글 포함)를 짧은 해시로. */
function shortId(key: string): string {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/** 세션별 기록 목록(게스트 · 회원 연결 필요 공용). 행 → 세션 정산. */
function RecordList({ records, card = false, resetKey = null }: { records: PenaltyHistoryRecord[]; card?: boolean; resetKey?: unknown }) {
    const inc = useIncremental(records.length, 50, `${String(resetKey)}|${records.length}`);
    const list = (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {records.slice(0, inc.limit).map((r, i) => {
                const reason = reviewReason(r.status, r.isGuest);
                return (
                    <li key={r.key} style={{ borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                        <Link href={`/finance/kdk/${encodeURIComponent(r.sessionId)}`} style={rowLink}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <NameLine name={r.displayName} isGuest={r.isGuest} />
                                <p style={subLine}>
                                    <span style={nowrap}>{dotDate(r.sessionDate)}</span>
                                    {r.paidAt && r.bucket === 'paid' && <span style={nowrap}>{dotDate(String(r.paidAt).slice(0, 10))} 납부</span>}
                                    {reason && <span style={{ ...nowrap, color: '#92400E' }}>{reason}</span>}
                                </p>
                            </div>
                            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                <span style={{ fontSize: 13, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{formatWon(r.amount)}</span>
                                <PenaltyBucketBadge bucket={r.bucket} status={r.status} />
                            </div>
                            <ChevronRight size={15} color="#CBD5E1" style={{ flexShrink: 0 }} />
                        </Link>
                    </li>
                );
            })}
        </ul>
    );
    return (
        <>
            {card ? <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>{list}</section> : list}
            {inc.more && <ShowMoreButton remaining={records.length - inc.limit} onClick={inc.showMore} />}
        </>
    );
}

// ── 예외(합계 미포함) ────────────────────────────────────────────────────────
const ORPHAN_REASON: Record<OrphanReceivable['reason'], string> = {
    no_session_link: 'KDK 세션 미연결',
    session_not_official: '공식 세션 아님',
    no_snapshot: '정산 스냅샷 없음',
    not_in_settlement: '공식 벌금 대상 아님',
    duplicate: '같은 세션 중복 청구',
};
const STORED_STATUS: Record<string, string> = {
    pending: '미납', partial: '일부 납부', paid: '납부 완료', exempt: '면제', not_target: '비대상', prepaid: '선납', needs_review: '확인 필요',
};

function ExceptionsSection({ history, range, isAllPeriod }: { history: PenaltyHistory; range: PeriodRange; isAllPeriod: boolean }) {
    const ex = history.exceptions;
    // 세션 날짜가 있으면 기간으로 거른다. 세션 날짜가 없는 항목(세션 미연결 등)은 기간과 무관하게 항상 표시.
    const keep = (date: string | null) => !date || inPeriod(date, range);
    const noSnap = ex.noSnapshotSessions.filter((s) => keep(s.date));
    const orphans = ex.orphanReceivables.filter((o) => keep(o.sessionDate));
    const orphanGuests = ex.orphanGuestPayments.filter((g) => keep(g.sessionDate));
    const unlinked = ex.unlinkedPayments;
    const overpaid = ex.overpaidRecords.filter((r) => keep(r.sessionDate));
    const total = noSnap.length + orphans.length + orphanGuests.length + unlinked.length + overpaid.length;

    return (
        <>
            <SectionTitle title="확인이 필요한 기록" right={<span style={{ fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>합계 미포함</span>} />
            {total === 0 ? (
                <EmptyCard>선택한 기간에 별도 확인이 필요한 기록이 없습니다.</EmptyCard>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {noSnap.length > 0 && (
                        <ExceptionGroup title={`정산 스냅샷 없는 세션 ${noSnap.length}개`} note="공식 기록에 정산 스냅샷이 없어 벌금 대상을 알 수 없습니다. 0원으로 집계하지 않았습니다.">
                            {noSnap.map((s) => (
                                <ExceptionLine key={s.id} href={`/finance/kdk/${encodeURIComponent(s.id)}`} left={`${dotDate(s.date)} · ${s.title}`} right="확인 필요" />
                            ))}
                        </ExceptionGroup>
                    )}
                    {overpaid.length > 0 && (
                        <ExceptionGroup title={`벌금보다 많이 납부된 기록 ${overpaid.length}건`} note="유효 납부액이 벌금보다 큽니다(중복 납부 의심). 납부 완료 금액은 세션 정산 화면과 같이 유효 납부 전액으로 집계됩니다.">
                            {overpaid.map((r) => (
                                <ExceptionLine key={r.key} href={`/finance/kdk/${encodeURIComponent(r.sessionId)}`}
                                    left={`${r.displayName} · ${dotDate(r.sessionDate)}`}
                                    sub={`벌금 ${formatWon(r.amount)} · 유효 납부 ${formatWon(r.amountPaid)}`}
                                    right={`+${formatWon(r.amountPaid - r.amount)}`} />
                            ))}
                        </ExceptionGroup>
                    )}
                    {orphans.length > 0 && (
                        <ExceptionGroup
                            title={`세션 벌금 대상과 연결되지 않은 회원 청구 ${orphans.length}건`}
                            note="공식 벌금 대상 행에 매칭되지 않는 청구입니다(예: 동명 오매칭 정정으로 비대상 처리된 청구). 기록은 그대로 보존되며 누적 합계에는 포함하지 않았습니다."
                        >
                            {orphans.map((o) => (
                                <ExceptionLine
                                    key={o.receivableId}
                                    href={o.sessionId && o.reason !== 'session_not_official' ? `/finance/kdk/${encodeURIComponent(o.sessionId)}` : `/finance/members/${encodeURIComponent(o.memberId)}`}
                                    left={`${o.memberName} · ${o.sessionDate ? dotDate(o.sessionDate) : ORPHAN_REASON[o.reason]}`}
                                    sub={`${ORPHAN_REASON[o.reason]} · 저장 상태 ${STORED_STATUS[o.storedStatus] || o.storedStatus} · 유효 납부 ${formatWon(o.validPaid)}`}
                                    right={formatWon(o.amountDue)}
                                />
                            ))}
                        </ExceptionGroup>
                    )}
                    {orphanGuests.length > 0 && (
                        <ExceptionGroup title={`세션 벌금 대상과 연결되지 않은 게스트 납부 ${orphanGuests.length}건`} note="게스트 납부 기록이 해당 세션의 공식 벌금 대상과 맞지 않습니다. 합계에는 포함하지 않았습니다.">
                            {orphanGuests.map((g, i) => (
                                <ExceptionLine key={`${g.sessionId}-${i}`} href={`/finance/kdk/${encodeURIComponent(g.sessionId)}`}
                                    left={`${g.sessionDate ? dotDate(g.sessionDate) : '세션 확인 필요'} · 게스트 납부`}
                                    sub={g.reason === 'session_not_official' ? '공식 세션 아님' : g.reason === 'no_snapshot' ? '정산 스냅샷 없음' : '공식 벌금 대상 아님'}
                                    right={formatWon(g.amount)} />
                            ))}
                        </ExceptionGroup>
                    )}
                    {unlinked.length > 0 && (
                        <ExceptionGroup title={`청구에 연결되지 않은 벌금 납부 ${unlinked.length}건`} note="전체 기간 기준입니다. 세션에 귀속할 수 없어 누적 합계에는 포함하지 않았습니다.">
                            {unlinked.map((p) => (
                                <ExceptionLine key={p.paymentId} href={`/finance/members/${encodeURIComponent(p.memberId)}`}
                                    left={p.memberName} sub={p.paidAt ? `${dotDate(String(p.paidAt).slice(0, 10))} 납부` : '납부일 없음'} right={formatWon(p.amount)} />
                            ))}
                        </ExceptionGroup>
                    )}
                </div>
            )}
            <p style={{ margin: '0 2px', fontSize: 10.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.55, wordBreak: 'keep-all' }}>
                취소된 납부(회원 {ex.voidedMemberPaymentCount}건 · 게스트 {ex.cancelledGuestPaymentCount}건, 전체 기간)는 유효 납부에서 제외됩니다.
                {!isAllPeriod && ex.undatedSessionCount > 0 && ` 개최일 정보가 없는 세션 ${ex.undatedSessionCount}개는 '전체' 기간에서만 보입니다.`}
            </p>
        </>
    );
}

function ExceptionGroup({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
    return (
        <details style={{ ...FINANCE_CARD_STYLE, padding: '10px 12px', borderColor: 'rgba(245,158,11,0.28)', background: '#FFFBF2' }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#92400E', wordBreak: 'keep-all' }}>{title}</summary>
            <p style={{ margin: '6px 0 4px', fontSize: 11, fontWeight: 600, color: '#92400E', lineHeight: 1.5, wordBreak: 'keep-all' }}>{note}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{children}</ul>
        </details>
    );
}

function ExceptionLine({ href, left, sub, right }: { href: string; left: string; sub?: string; right: string }) {
    return (
        <li style={{ borderTop: '1px solid rgba(146,64,14,0.10)' }}>
            <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 1 }}>{left}</p>
                    {sub && <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#64748B', wordBreak: 'keep-all' }}>{sub}</p>}
                </div>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 900, color: '#92400E', whiteSpace: 'nowrap' }}>{right}</span>
            </Link>
        </li>
    );
}

/** V5 기록 횟수(비대상·확인 필요 포함)와 V6 '벌금 발생'(유효 부과만)을 구분하는 설명. 계산은 바꾸지 않는다. */
const RECORD_COUNT_HINT = '벌금 기록 = 비대상·면제·확인 필요를 포함한 벌금 기록 수. 유효 부과 기준 횟수는 종합·벌금 횟수 모드의 ‘벌금 발생’입니다.';

const rowLink: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, padding: '11px 10px 11px 13px',
    textDecoration: 'none', color: 'inherit', minWidth: 0,
};
const subLine: React.CSSProperties = {
    margin: '3px 0 0', fontSize: 10.5, fontWeight: 700, color: '#64748B',
    display: 'flex', flexWrap: 'wrap', columnGap: 7, rowGap: 1,
};
const nowrap: React.CSSProperties = { whiteSpace: 'nowrap' };
