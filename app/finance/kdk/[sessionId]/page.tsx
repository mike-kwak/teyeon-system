'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import {
    FinancePageHeader,
    KpiCard,
    StatusBadge,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import {
    loadKdkSession,
    loadKdkPenaltyContext,
    markPenaltyPaid,
    markPenaltyUnpaid,
    markPenaltiesPaidBulk,
    registerUnregisteredPenalties,
    type KdkArchiveSession,
    type KdkPenaltyContext,
    type KdkPenaltyRow,
} from '@/lib/finance/kdkSettlementService';
import {
    deriveKdkPrize,
    fetchPrizePayout,
    createPrizePayout,
    markPrizePaid,
    markPrizeUnpaid,
    updatePrizePayout,
    type KdkPrizeDerivation,
    type KdkPrizePayout,
} from '@/lib/finance/kdkPrizeService';
import { listKdkNotices, deactivateKdkNotice, deleteKdkNotice, type KdkNoticeListRow } from '@/lib/finance/kdkNoticesService';
import KdkNoticeCreateModal from '@/components/finance/KdkNoticeCreateModal';

const NAVY = '#0F172A';

export default function KdkSettlementPage() {
    const params = useParams<{ sessionId: string }>();
    const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : Array.isArray(params?.sessionId) ? params!.sessionId[0] : '';
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    const [session, setSession] = React.useState<KdkArchiveSession | null>(null);
    const [notFound, setNotFound] = React.useState(false);
    const [ctx, setCtx] = React.useState<KdkPenaltyContext | null>(null);
    const [prizeDerivation, setPrizeDerivation] = React.useState<KdkPrizeDerivation | null>(null);
    const [payout, setPayout] = React.useState<KdkPrizePayout | null>(null);
    const [notices, setNotices] = React.useState<KdkNoticeListRow[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [selected, setSelected] = React.useState<Set<string>>(new Set());
    const [showNoticeModal, setShowNoticeModal] = React.useState(false);

    const year = React.useMemo(() => {
        const m = String(session?.date || '').match(/^(\d{4})/);
        return m ? Number(m[1]) : new Date().getFullYear();
    }, [session?.date]);

    const load = React.useCallback(async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const s = await loadKdkSession(sessionId);
            if (!s) { setNotFound(true); setLoading(false); return; }
            setSession(s);
            const [context, pay, noticeList] = await Promise.all([
                loadKdkPenaltyContext(sessionId, s.settlementData),
                fetchPrizePayout(sessionId),
                listKdkNotices(sessionId),
            ]);
            setCtx(context);
            setPrizeDerivation(deriveKdkPrize(s.settlementData, s.settlementMeta, context.members));
            setPayout(pay);
            setNotices(noticeList);
            setSelected(new Set());
        } catch (e: any) {
            alert(e?.message || '불러오기에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    }, [sessionId]);

    React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

    if (!isLoading && !isAdmin) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>운영자만 접근할 수 있는 페이지입니다.</p>
                    <Link href="/finance" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>← Finance</Link>
                </div>
            </main>
        );
    }

    const canRegister = !!session && session.isOfficial && !session.isTest;

    // 액션 핸들러 ──────────────────────────────────────────────────────────────
    const withBusy = async (fn: () => Promise<void>) => {
        setBusy(true);
        try { await fn(); await load(); }
        catch (e: any) { alert(e?.message || '처리 중 오류가 발생했습니다.'); }
        finally { setBusy(false); }
    };

    const handlePaid = (row: KdkPenaltyRow) => withBusy(() => markPenaltyPaid(row, user?.id));
    const handleUnpaid = (row: KdkPenaltyRow) => withBusy(async () => {
        if (!row.receivableId || !ctx) return;
        await markPenaltyUnpaid(row.receivableId, ctx.payments, user?.id);
    });
    const handleBulkPaid = () => {
        if (!ctx) return;
        const targets = ctx.rows.filter((r) => selected.has(rowKey(r)) && r.receivableId && r.status !== 'paid');
        if (targets.length === 0) return;
        if (!window.confirm(`${targets.length}명을 납부 완료 처리하시겠습니까?`)) return;
        withBusy(async () => { await markPenaltiesPaidBulk(targets, user?.id); });
    };
    const handleRegisterMissing = () => {
        if (!ctx || !session) return;
        const n = ctx.rows.filter((r) => r.status === 'unregistered').length;
        if (n === 0) return;
        if (!window.confirm(`회원 매칭된 미등록 벌금 ${n}건을 Finance에 등록하시겠습니까?`)) return;
        withBusy(async () => { await registerUnregisteredPenalties(sessionId, session.date, ctx.rows, user?.id); });
    };

    // 상금 액션 ────────────────────────────────────────────────────────────────
    const handleCreatePrize = () => {
        if (!prizeDerivation || prizeDerivation.recipient.status !== 'eligible' || !prizeDerivation.recipient.memberId) return;
        const r = prizeDerivation.recipient;
        const input = window.prompt('상금 금액을 입력하세요.', String(prizeDerivation.defaultAmount || 10000));
        if (input == null) return;
        const amount = Number(input.replace(/[^0-9]/g, ''));
        if (!(amount >= 0)) { alert('금액이 올바르지 않습니다.'); return; }
        withBusy(async () => {
            await createPrizePayout({
                sessionId, archiveId: sessionId,
                recipientMemberId: r.memberId as string,
                recipientName: r.name || '회원',
                recipientOverallRank: r.overallRank,
                amount, createdBy: user?.id,
            });
        });
    };
    const handlePrizePaid = () => {
        if (!payout) return;
        withBusy(() => markPrizePaid(payout.id, new Date().toISOString(), user?.id).then(() => {}));
    };
    const handlePrizeUnpaid = () => {
        if (!payout) return;
        withBusy(() => markPrizeUnpaid(payout.id).then(() => {}));
    };
    const handlePrizeAmount = () => {
        if (!payout) return;
        const input = window.prompt('상금 금액 수정', String(payout.amount));
        if (input == null) return;
        const amount = Number(input.replace(/[^0-9]/g, ''));
        if (!(amount >= 0)) { alert('금액이 올바르지 않습니다.'); return; }
        withBusy(() => updatePrizePayout(payout.id, { amount }).then(() => {}));
    };
    const handlePrizePaidAt = () => {
        if (!payout) return;
        const cur = payout.paid_at ? toLocalInput(payout.paid_at) : toLocalInput(new Date().toISOString());
        const input = window.prompt('지급일시 수정 (YYYY-MM-DDTHH:mm)', cur);
        if (input == null) return;
        const iso = localInputToISO(input);
        if (!iso) { alert('날짜 형식이 올바르지 않습니다.'); return; }
        withBusy(() => updatePrizePayout(payout.id, { paid_at: iso, status: 'paid' }).then(() => {}));
    };

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE · KDK"
                    title="KDK 벌금·상금 정산"
                    subtitle={session ? (session.title || 'KDK 세션') : '세션 정산'}
                    backHref="/finance"
                />

                {loading && <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', marginTop: 30 }}>불러오는 중...</p>}

                {!loading && notFound && (
                    <section style={FINANCE_CARD_STYLE}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: NAVY }}>세션을 찾을 수 없습니다.</p>
                    </section>
                )}

                {!loading && session && (
                    <>
                        {/* 세션 요약 */}
                        <section style={FINANCE_CARD_STYLE}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                <Chip>{session.date || '날짜 미상'}</Chip>
                                <Chip tone={canRegister ? 'teal' : 'amber'}>
                                    {session.isOfficial ? (session.isTest ? '테스트' : '공식 기록') : '미확정'}
                                </Chip>
                                {ctx && <Chip>벌금 대상 {ctx.summary.targetCount}명</Chip>}
                            </div>
                            {!canRegister && (
                                <p style={{ margin: '10px 0 0', fontSize: 11.5, fontWeight: 700, color: '#B7791F', wordBreak: 'keep-all' }}>
                                    공식 기록으로 확정된 KDK만 Finance에 반영할 수 있습니다.
                                </p>
                            )}
                            <Link
                                href={`/archive?session=${encodeURIComponent(sessionId)}`}
                                style={{ display: 'inline-block', marginTop: 10, fontSize: 11.5, fontWeight: 800, color: '#0E7C76', textDecoration: 'none' }}
                            >
                                전체 KDK 순위 보기 →
                            </Link>
                        </section>

                        {/* ── 벌금 정산 ── */}
                        {ctx && (
                            <>
                                <SectionHeader title="벌금 정산" />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <KpiCard label="대상" value={`${ctx.summary.targetCount}명`} />
                                    <KpiCard label="납부 완료" value={`${ctx.summary.paidCount}명`} accent="teal" />
                                    <KpiCard label="미납" value={`${ctx.summary.unpaidCount + ctx.summary.unregisteredCount + ctx.summary.needsLinkCount}명`} accent="red" />
                                    <KpiCard label="총 벌금" value={formatWon(ctx.summary.totalPenalty)} />
                                    <KpiCard label="납부 완료 금액" value={formatWon(ctx.summary.totalPaid)} accent="teal" />
                                    <KpiCard label="미납 금액" value={formatWon(ctx.summary.totalUnpaid)} accent="red" />
                                </div>

                                {ctx.summary.unregisteredCount > 0 && canRegister && (
                                    <button type="button" onClick={handleRegisterMissing} disabled={busy} style={primaryBtn(busy)}>
                                        미등록 벌금 {ctx.summary.unregisteredCount}건 Finance 등록
                                    </button>
                                )}

                                {/* 일괄 납부 */}
                                {selectedPayableCount(ctx.rows, selected) > 0 && (
                                    <button type="button" onClick={handleBulkPaid} disabled={busy} style={tealBtn(busy)}>
                                        선택 {selectedPayableCount(ctx.rows, selected)}명 납부 완료 처리
                                    </button>
                                )}

                                <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                        {ctx.rows.length === 0 && (
                                            <li style={{ padding: 16, fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>벌금 대상이 없습니다.</li>
                                        )}
                                        {ctx.rows.map((r, idx) => {
                                            const key = rowKey(r);
                                            const payable = !!r.receivableId && r.status !== 'paid';
                                            return (
                                                <li key={key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderTop: idx === 0 ? 'none' : '1px solid #EEF2F6' }}>
                                                    <input
                                                        type="checkbox"
                                                        disabled={!payable || busy}
                                                        checked={selected.has(key)}
                                                        onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                                                        style={{ width: 16, height: 16, accentColor: '#0F9F98', flexShrink: 0, cursor: payable ? 'pointer' : 'not-allowed' }}
                                                    />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {r.memberName || r.playerName}{r.isGuest && <GuestTag />}
                                                        </p>
                                                        <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                                            {formatWon(r.amount)}{r.paidAt ? ` · ${r.paidAt} 납부` : ''}
                                                            {r.memberId && <> · <Link href={`/finance/members/${encodeURIComponent(r.memberId)}?year=${year}`} style={{ color: '#0E7C76', textDecoration: 'none', fontWeight: 800 }}>Finance 상세</Link></>}
                                                        </p>
                                                    </div>
                                                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <PenaltyStatusBadge status={r.status} />
                                                        {payable && (
                                                            <button type="button" disabled={busy} onClick={() => handlePaid(r)} style={miniBtn('#0F9F98')}>납부 완료</button>
                                                        )}
                                                        {r.status === 'paid' && (
                                                            <button type="button" disabled={busy} onClick={() => handleUnpaid(r)} style={miniBtn('#94A3B8')}>미납으로</button>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            </>
                        )}

                        {/* ── 1등 상금 ── */}
                        {prizeDerivation && (
                            <>
                                <SectionHeader title="KDK 1등 상금" />
                                <PrizeSection
                                    derivation={prizeDerivation}
                                    payout={payout}
                                    busy={busy}
                                    year={year}
                                    onCreate={handleCreatePrize}
                                    onPaid={handlePrizePaid}
                                    onUnpaid={handlePrizeUnpaid}
                                    onEditAmount={handlePrizeAmount}
                                    onEditPaidAt={handlePrizePaidAt}
                                />
                            </>
                        )}

                        {/* ── 공지 ── */}
                        <SectionHeader title="벌금·상금 현황 공지" />
                        <button type="button" disabled={!canRegister} onClick={() => setShowNoticeModal(true)} style={primaryBtn(!canRegister)}>
                            벌금 현황 공지 만들기
                        </button>
                        <section style={{ ...FINANCE_CARD_STYLE, padding: notices.length ? 0 : 14, overflow: 'hidden' }}>
                            {notices.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 11.5, color: '#94A3B8', textAlign: 'center' }}>생성된 공지가 없습니다.</p>
                            ) : (
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {notices.map((n, idx) => (
                                        <NoticeRow key={n.id} notice={n} first={idx === 0}
                                            onChanged={load} busy={busy} setBusy={setBusy} />
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}
            </div>

            {showNoticeModal && session && ctx && prizeDerivation && (
                <KdkNoticeCreateModal
                    sessionId={sessionId}
                    kdkDate={session.date}
                    sessionTitle={session.title}
                    penaltyRows={ctx.rows}
                    prizeDerivation={prizeDerivation}
                    prizePayout={payout}
                    onClose={() => setShowNoticeModal(false)}
                    onCreated={() => { setShowNoticeModal(false); load(); }}
                />
            )}
        </main>
    );
}

// ── 상금 섹션 ───────────────────────────────────────────────────────────────
function PrizeSection({ derivation, payout, busy, year, onCreate, onPaid, onUnpaid, onEditAmount, onEditPaidAt }: {
    derivation: KdkPrizeDerivation; payout: KdkPrizePayout | null; busy: boolean; year: number;
    onCreate: () => void; onPaid: () => void; onUnpaid: () => void; onEditAmount: () => void; onEditPaidAt: () => void;
}) {
    const { overallWinner, recipient } = derivation;
    return (
        <section style={FINANCE_CARD_STYLE}>
            {/* 실제 최종 1위 */}
            <div>
                <p style={labelStyle}>최종 1위</p>
                <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 900, color: NAVY }}>
                    {overallWinner ? overallWinner.name : '순위 정보 없음'}
                    {overallWinner?.isGuest && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: '#B7791F' }}>· 게스트 상금 제외</span>}
                </p>
            </div>

            <div style={{ height: 1, background: '#EEF2F6', margin: '12px 0' }} />

            {/* 상금 지급 대상 */}
            <p style={labelStyle}>상금 지급 대상</p>
            {!derivation.hasRanking ? (
                <p style={emptyNote}>공식 순위 스냅샷이 없어 상금 대상을 생성할 수 없습니다.</p>
            ) : recipient.status === 'none' ? (
                <p style={emptyNote}>상금 지급 대상 없음 (참가자 전원 게스트)</p>
            ) : recipient.status === 'needs_review' && !payout ? (
                <p style={{ ...emptyNote, color: '#B7791F' }}>
                    {recipient.name} · 전체 {recipient.overallRank}위 — 회원 확인 필요 (자동 확정하지 않음)
                </p>
            ) : (
                <>
                    <p style={{ margin: '2px 0 0', fontSize: 14, fontWeight: 900, color: NAVY }}>
                        {payout ? payout.recipient_name : recipient.name}
                        <span style={{ marginLeft: 6, fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>
                            · 전체 {(payout ? payout.recipient_overall_rank : recipient.overallRank) ?? '?'}위
                        </span>
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 900, color: NAVY }}>{formatWon(payout ? payout.amount : derivation.defaultAmount)}</span>
                        {payout
                            ? <StatusBadge tone={payout.status === 'paid' ? 'paid' : 'pending'}>{payout.status === 'paid' ? '지급 완료' : '미지급'}</StatusBadge>
                            : <StatusBadge tone="pending">미등록</StatusBadge>}
                    </div>
                    {payout?.status === 'paid' && payout.paid_at && (
                        <p style={{ margin: '6px 0 0', fontSize: 11, fontWeight: 700, color: '#0E7C76' }}>{formatDateTimeKo(payout.paid_at)} 지급</p>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                        {!payout && recipient.status === 'eligible' && (
                            <button type="button" disabled={busy} onClick={onCreate} style={miniBtn('#0F9F98')}>상금 등록</button>
                        )}
                        {payout && payout.status !== 'paid' && (
                            <button type="button" disabled={busy} onClick={onPaid} style={miniBtn('#0F9F98')}>지급 완료 처리</button>
                        )}
                        {payout && payout.status === 'paid' && (
                            <button type="button" disabled={busy} onClick={onUnpaid} style={miniBtn('#94A3B8')}>미지급으로</button>
                        )}
                        {payout && (
                            <>
                                <button type="button" disabled={busy} onClick={onEditAmount} style={miniBtn('#475569')}>금액 수정</button>
                                <button type="button" disabled={busy} onClick={onEditPaidAt} style={miniBtn('#475569')}>지급일시 수정</button>
                                {payout.prize_recipient_member_id && (
                                    <Link href={`/finance/members/${encodeURIComponent(payout.prize_recipient_member_id)}?year=${year}`} style={{ ...miniBtnLink('#0E7C76') }}>Finance 상세</Link>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}

// ── 공지 row ────────────────────────────────────────────────────────────────
function NoticeRow({ notice, first, onChanged, busy, setBusy }: {
    notice: KdkNoticeListRow; first: boolean; onChanged: () => void; busy: boolean; setBusy: (b: boolean) => void;
}) {
    const [copied, setCopied] = React.useState(false);
    const url = typeof window !== 'undefined' ? `${window.location.origin}/finance/public/kdk/${notice.token}` : '';
    const copy = async () => {
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
    };
    const deactivate = async () => {
        if (!window.confirm('이 공지를 비활성화하시겠습니까? 공개 링크가 즉시 차단됩니다.')) return;
        setBusy(true);
        try { await deactivateKdkNotice(notice.id); onChanged(); } catch (e: any) { alert(e?.message); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!window.confirm('이 공지를 완전히 삭제하시겠습니까?')) return;
        setBusy(true);
        try { await deleteKdkNotice(notice.id); onChanged(); } catch (e: any) { alert(e?.message); } finally { setBusy(false); }
    };
    return (
        <li style={{ padding: '12px 13px', borderTop: first ? 'none' : '1px solid #EEF2F6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: NAVY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notice.title}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                        {formatDateTimeKo(notice.reference_at)} 기준 · 대상 {notice.target_count} · 미납 {notice.unpaid_count}
                    </p>
                </div>
                {notice.is_active
                    ? <StatusBadge tone="paid">공개중</StatusBadge>
                    : <StatusBadge tone="not_target">비활성</StatusBadge>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {notice.is_active && <button type="button" onClick={copy} style={miniBtn(copied ? '#0E7C76' : '#0F9F98')}>{copied ? '복사됨' : '링크 복사'}</button>}
                {notice.is_active && <button type="button" disabled={busy} onClick={deactivate} style={miniBtn('#B7791F')}>비활성화</button>}
                <button type="button" disabled={busy} onClick={remove} style={miniBtn('#B91C1C')}>삭제</button>
            </div>
        </li>
    );
}

// ── 작은 헬퍼/스타일 ─────────────────────────────────────────────────────────
function rowKey(r: KdkPenaltyRow) { return `${r.memberId ?? 'noid'}__${r.playerName}`; }
function selectedPayableCount(rows: KdkPenaltyRow[], selected: Set<string>) {
    return rows.filter((r) => selected.has(rowKey(r)) && r.receivableId && r.status !== 'paid').length;
}

function PenaltyStatusBadge({ status }: { status: KdkPenaltyRow['status'] }) {
    if (status === 'paid') return <StatusBadge tone="paid">납부 완료</StatusBadge>;
    if (status === 'partial') return <StatusBadge tone="partial">일부 납부</StatusBadge>;
    if (status === 'pending') return <StatusBadge tone="pending">미납</StatusBadge>;
    if (status === 'unregistered') return <StatusBadge tone="not_target">미등록</StatusBadge>;
    return <StatusBadge tone="not_target">회원 연결 필요</StatusBadge>;
}

function SectionHeader({ title }: { title: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ width: 4, height: 15, background: '#0F9F98', borderRadius: 2 }} />
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: NAVY }}>{title}</h2>
        </div>
    );
}

function Chip({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'teal' | 'amber' }) {
    const p = { blue: ['#EEF5FB', '#1F5FB5'], teal: ['#E0F5EB', '#16A085'], amber: ['#FFF4DE', '#B7791F'] }[tone];
    return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999, background: p[0], color: p[1], fontSize: 11, fontWeight: 800 }}>{children}</span>;
}
function GuestTag() {
    return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13, borderRadius: '50%', marginLeft: 5, background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F', fontSize: 8, fontWeight: 900, verticalAlign: 'middle' }}>G</span>;
}

const labelStyle: React.CSSProperties = { margin: 0, fontSize: 10.5, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.04em' };
const emptyNote: React.CSSProperties = { margin: '4px 0 0', fontSize: 12, fontWeight: 700, color: '#64748B', wordBreak: 'keep-all' };

function primaryBtn(disabled: boolean): React.CSSProperties {
    return { width: '100%', height: 42, borderRadius: 10, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#CBD5E1' : 'linear-gradient(90deg,#0F9F98,#16A085)', color: '#FFFFFF', fontSize: 12.5, fontWeight: 800 };
}
function tealBtn(disabled: boolean): React.CSSProperties {
    return { width: '100%', height: 40, borderRadius: 10, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: disabled ? '#CBD5E1' : '#0F9F98', color: '#FFFFFF', fontSize: 12.5, fontWeight: 800 };
}
function miniBtn(color: string): React.CSSProperties {
    return { padding: '6px 10px', borderRadius: 8, border: `1px solid ${color}`, background: '#FFFFFF', color, fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' };
}
function miniBtnLink(color: string): React.CSSProperties {
    return { ...miniBtn(color), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' };
}

// datetime-local <-> ISO
function toLocalInput(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localInputToISO(v: string): string | null {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function formatDateTimeKo(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
