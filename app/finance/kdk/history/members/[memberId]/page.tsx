'use client';

export const dynamic = 'force-dynamic';

// 누적 벌금 현황 → 회원 상세(조회 전용). 납부 상태 변경 없음 — 행을 누르면 기존 세션 정산 화면으로 이동.
//   회원 식별: stable member id(members.id). 이름으로 다른 회원·게스트와 합치지 않는다.

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    FinancePageHeader,
    KpiCard,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import { inPeriod, summarizeRecords, type PenaltyHistory, type PeriodRange } from '@/lib/finance/kdkPenaltyHistoryModel';
import {
    BlockedView,
    EmptyCard,
    ErrorCard,
    LoadingCard,
    NAVY,
    PenaltyBucketBadge,
    PeriodFilter,
    RefreshButton,
    SectionTitle,
    TEAL_DARK,
    dotDate,
    historyQueryString,
    reviewReason,
    useHistoryQuery,
    usePeriodResolution,
} from '@/components/finance/KdkPenaltyHistoryUI';
import { formatLoadedAt, usePenaltyHistory } from '@/components/finance/usePenaltyHistory';

export default function MemberPenaltyHistoryPage() {
    return (
        <Suspense fallback={<main style={FINANCE_PAGE_STYLE}><div style={FINANCE_CONTAINER_STYLE}><LoadingCard /></div></main>}>
            <MemberView />
        </Suspense>
    );
}

function MemberView() {
    const params = useParams<{ memberId: string }>();
    const memberId = typeof params?.memberId === 'string' ? decodeURIComponent(params.memberId) : '';
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);
    const [query, update] = useHistoryQuery();
    const resolution = usePeriodResolution(query);
    const { state, reload } = usePenaltyHistory(user?.id, !isLoading && !!user && isAdmin);
    const backHref = `/finance/kdk/history${historyQueryString({ ...query, tab: 'member' })}`;

    if (isLoading) {
        return <main style={FINANCE_PAGE_STYLE}><div style={FINANCE_CONTAINER_STYLE}><LoadingCard /></div></main>;
    }
    if (!user || !isAdmin) {
        return <main style={FINANCE_PAGE_STYLE}><div style={FINANCE_CONTAINER_STYLE}><BlockedView loggedIn={!!user} /></div></main>;
    }

    const name = state.kind === 'ready'
        ? (state.history.records.find((r) => r.memberId === memberId)?.displayName
            || state.history.exceptions.orphanReceivables.find((o) => o.memberId === memberId)?.memberName
            || null)
        : null;

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div className="kdk-history-container" style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE · KDK 벌금"
                    title={name || (state.kind === 'ready' ? '회원 벌금 기록' : '불러오는 중')}
                    subtitle={resolution.ok ? `${resolution.label} KDK 벌금 기록` : 'KDK 벌금 기록'}
                    backHref={backHref}
                    rightSlot={<RefreshButton onClick={reload} busy={state.kind === 'loading' || (state.kind === 'ready' && state.refreshing)} />}
                />
                <PeriodFilter query={query} onChange={update} resolution={resolution} />

                {(state.kind === 'loading' || state.kind === 'idle') && <LoadingCard />}
                {state.kind === 'error' && <ErrorCard message={state.message} onRetry={reload} />}
                {state.kind === 'ready' && (
                    !resolution.ok ? (
                        <EmptyCard>{query.from || query.to ? resolution.error : '시작일과 종료일을 선택한 뒤 조회해 주세요.'}</EmptyCard>
                    ) : !name ? (
                        <EmptyCard>이 회원의 KDK 벌금 기록이 없습니다.</EmptyCard>
                    ) : (
                        <MemberContent history={state.history} memberId={memberId} range={resolution.range} loadedAt={state.loadedAt} />
                    )
                )}
            </div>
        </main>
    );
}

function MemberContent({ history, memberId, range, loadedAt }: { history: PenaltyHistory; memberId: string; range: PeriodRange; loadedAt: number }) {
    const records = React.useMemo(
        () => history.records.filter((r) => r.memberId === memberId && r.side === 'member' && inPeriod(r.sessionDate, range)),
        [history.records, memberId, range],
    );
    const summary = React.useMemo(() => summarizeRecords(records), [records]);
    const sessionCount = React.useMemo(() => new Set(records.map((r) => r.sessionId)).size, [records]);
    const orphans = React.useMemo(
        () => history.exceptions.orphanReceivables.filter((o) => o.memberId === memberId && (!o.sessionDate || inPeriod(o.sessionDate, range))),
        [history.exceptions.orphanReceivables, memberId, range],
    );
    const year = (range.from || range.to || new Date().toISOString()).slice(0, 4);

    return (
        <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <KpiCard label="벌금 기록" value={`${sessionCount}회`} sub="비대상·확인 필요 포함" />
                <KpiCard label="총 청구" value={formatWon(summary.billableAmount)} />
                <KpiCard label="납부 완료" value={formatWon(summary.paidAmount)} accent="teal" />
                <KpiCard label="미납" value={formatWon(summary.unpaidAmount)} accent={summary.unpaidAmount > 0 ? 'red' : 'default'} />
            </div>
            {(summary.excludedAmount > 0 || summary.reviewAmount > 0) && (
                <p style={{ ...FINANCE_CARD_STYLE, margin: 0, padding: '9px 12px', fontSize: 11, fontWeight: 700, color: '#64748B', display: 'flex', flexWrap: 'wrap', columnGap: 12 }}>
                    {summary.excludedAmount > 0 && <span>비대상 {formatWon(summary.excludedAmount)} ({summary.excludedCount}건)</span>}
                    {summary.reviewAmount > 0 && <span style={{ color: '#92400E' }}>확인 필요 {formatWon(summary.reviewAmount)} ({summary.reviewCount}건)</span>}
                </p>
            )}

            <SectionTitle title="날짜별 기록" right={<span style={{ fontSize: 10.5, fontWeight: 700, color: '#94A3B8' }}>{formatLoadedAt(loadedAt)}</span>} />
            {records.length === 0 ? (
                <EmptyCard>선택한 기간에 벌금 기록이 없습니다.</EmptyCard>
            ) : (
                <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {records.map((r, i) => {
                            const reason = reviewReason(r.status, r.isGuest);
                            return (
                                <li key={r.key} style={{ borderTop: i === 0 ? 'none' : '1px solid #EEF2F6' }}>
                                    <Link href={`/finance/kdk/${encodeURIComponent(r.sessionId)}`} style={recordRow}>
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap', paddingLeft: 1 }}>{dotDate(r.sessionDate)}</span>
                                            <span style={{ display: 'block', marginTop: 2, fontSize: 10.5, fontWeight: 600, color: reason ? '#92400E' : '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {reason || r.sessionTitle}
                                            </span>
                                        </span>
                                        <span style={{ flexShrink: 0, textAlign: 'right' }}>
                                            <span style={{ display: 'block', fontSize: 12.5, fontWeight: 900, color: NAVY, whiteSpace: 'nowrap' }}>{formatWon(r.amount)}</span>
                                            <span style={{ display: 'block', marginTop: 2, fontSize: 10.5, fontWeight: 700, color: r.amountPaid > 0 ? TEAL_DARK : '#94A3B8', whiteSpace: 'nowrap' }}>납부 {formatWon(r.amountPaid)}</span>
                                        </span>
                                        <span style={{ flexShrink: 0, width: 56, display: 'flex', justifyContent: 'flex-end' }}>
                                            <PenaltyBucketBadge bucket={r.bucket} status={r.status} />
                                        </span>
                                        <ChevronRight size={14} color="#CBD5E1" style={{ flexShrink: 0 }} />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {orphans.length > 0 && (
                <details style={{ ...FINANCE_CARD_STYLE, padding: '10px 12px', borderColor: 'rgba(245,158,11,0.28)', background: '#FFFBF2' }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: '#92400E' }}>참고 기록 {orphans.length}건 (합계 미포함)</summary>
                    <p style={{ margin: '6px 0 4px', fontSize: 11, fontWeight: 600, color: '#92400E', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                        공식 벌금 대상과 연결되지 않은 청구입니다(예: 동명 오매칭 정정으로 비대상 처리). 기록은 보존되어 있습니다.
                    </p>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {orphans.map((o) => (
                            <li key={o.receivableId} style={{ display: 'flex', gap: 8, padding: '7px 0', borderTop: '1px solid rgba(146,64,14,0.10)', fontSize: 11.5, fontWeight: 700, color: NAVY }}>
                                <span style={{ flex: 1, minWidth: 0 }}>{o.sessionDate ? dotDate(o.sessionDate) : '세션 미확인'} · 유효 납부 {formatWon(o.validPaid)}</span>
                                <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{formatWon(o.amountDue)}</span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            <Link href={`/finance/members/${encodeURIComponent(memberId)}?year=${year}`} style={{
                ...FINANCE_CARD_STYLE, padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 8,
                textDecoration: 'none', color: TEAL_DARK, fontSize: 12, fontWeight: 800,
            }}>
                <span style={{ flex: 1 }}>Finance 회원 상세(회비·납부 전체) 보기</span>
                <ChevronRight size={15} />
            </Link>
        </>
    );
}

const recordRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 13px',
    textDecoration: 'none', color: 'inherit', minWidth: 0,
};
