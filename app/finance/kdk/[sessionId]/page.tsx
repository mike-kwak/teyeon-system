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
    describePenaltyPayResult,
    registerUnregisteredPenalties,
    type KdkArchiveSession,
    type KdkPenaltyContext,
    type KdkPenaltyRow,
} from '@/lib/finance/kdkSettlementService';
import { markGuestPenaltyPaid, revertGuestPenaltyPaid } from '@/lib/finance/kdkGuestPenaltyService';
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
import { cleanPenaltyDisplayName } from '@/lib/finance/kdkPenaltyHistoryModel';

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
    // 일괄 납부 재진입 방지(렌더 전 연속 클릭 · 확인창 직후 중복 실행 차단 — busy state 보다 먼저 동기적으로 잠근다).
    const bulkRunningRef = React.useRef(false);
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

    // 미납 잔액만 기록 — DB RPC 가 청구 잠금 후 잔액을 확정(화면 금액 미사용). 기록이 없었으면 사유 안내.
    //   실패(예외)는 withBusy 가 안내하고, 성공/실패 모두 load() 로 DB 실제 상태를 다시 읽는다.
    const handlePaid = (row: KdkPenaltyRow) => withBusy(async () => {
        const result = await markPenaltyPaid(row, user?.id);
        const note = describePenaltyPayResult(result);
        if (note) alert(note);
    });
    const handleUnpaid = (row: KdkPenaltyRow) => withBusy(async () => {
        if (!row.receivableId || !ctx) return;
        await markPenaltyUnpaid(row.receivableId, ctx.payments, user?.id);
    });
    // 게스트 벌금(비회원) — SECURITY DEFINER RPC 로 납부/되돌리기(sessionId+participantId 만 전달).
    //   금액/이름/식별자는 서버가 공식 Archive 에서 확정. withBusy 가 load()로 실제 DB 상태 재조회.
    const handleGuestPaid = (row: KdkPenaltyRow) => withBusy(async () => {
        if (!row.playerId) return;
        await markGuestPenaltyPaid({ sessionId, participantId: row.playerId });
    });
    const handleGuestUnpaid = (row: KdkPenaltyRow) => withBusy(async () => {
        if (!row.playerId) return;
        await revertGuestPenaltyPaid({ sessionId, participantId: row.playerId });
    });
    // 세션 일괄 납부 — 선택된 미납 회원(원자 RPC pay_kdk_member_penalty) + 미납 게스트(원자 RPC mark_kdk_guest_penalty_paid).
    //   이미 완납 · 면제 · 비대상은 대상에서 제외(서버도 재검증). 금액은 서버가 확정(화면 금액은 안내용).
    //   중단(오류) · 성공 모두 DB 실제 상태를 다시 읽고(선택 초기화) 그 뒤에 결과를 안내한다(부분 처리 확인).
    //   재실행 안전: 다시 불러온 화면에서 이미 처리된 건은 미납 대상에서 빠지고, 서버도 회원은 already_paid 로 건너뛰며
    //   게스트는 (세션 · 참가자) 1행 upsert 라 중복 납부 행이 생기지 않는다.
    const handleBulkPaid = async () => {
        if (!ctx || busy || bulkRunningRef.current) return;
        const memberTargets = ctx.rows.filter((r) => selected.has(rowKey(r)) && isMemberPayable(r));
        const guestTargets = canRegister ? ctx.rows.filter((r) => selected.has(rowKey(r)) && isGuestPayableRow(r)) : [];
        const total = memberTargets.length + guestTargets.length;
        if (total === 0) return;
        const expected = memberTargets.reduce((a, r) => a + Math.max(0, r.amount - (r.amountPaid || 0)), 0)
            + guestTargets.reduce((a, r) => a + Math.max(0, r.amount), 0);
        if (!window.confirm(
            `미납 ${total}건(회원 ${memberTargets.length} · 게스트 ${guestTargets.length})을 납부 완료 처리합니다.\n` +
            `예상 금액 ${formatWon(expected)} (실제 금액은 서버가 공식 기록 기준으로 확정)\n\n진행하시겠습니까?`,
        )) return;
        if (bulkRunningRef.current) return;
        bulkRunningRef.current = true;
        setBusy(true);
        let message = '';
        try {
            const r = memberTargets.length ? await markPenaltiesPaidBulk(memberTargets, user?.id)
                : { paid: 0, insertedTotal: 0, alreadyPaid: 0, stale: 0, notPayable: 0 };
            let guestPaid = 0;
            let guestAmount = 0;
            for (const g of guestTargets) {
                if (!g.playerId) continue;
                try {
                    await markGuestPenaltyPaid({ sessionId, participantId: g.playerId });
                    guestPaid += 1;
                    guestAmount += Math.max(0, g.amount);
                } catch (e: unknown) {
                    throw new Error(
                        `${(e instanceof Error && e.message) || '게스트 납부 처리 중 오류가 발생했습니다.'}\n` +
                        `(중단 전 회원 ${r.paid}명 · 게스트 ${guestPaid}명은 이미 처리되었습니다.)`,
                    );
                }
            }
            const skipped = r.alreadyPaid + r.stale + r.notPayable;
            message = `납부 처리 완료 — 회원 ${r.paid}명(${formatWon(r.insertedTotal)}) · 게스트 ${guestPaid}명(${formatWon(guestAmount)}).` +
                (skipped > 0 ? `\n처리하지 않음 ${skipped}명 — 이미 완납 ${r.alreadyPaid} · 정보 변경됨 ${r.stale} · 면제/비대상 등 ${r.notPayable}` : '');
        } catch (e: unknown) {
            message = `${(e instanceof Error && e.message) || '일괄 납부 처리 중 오류가 발생했습니다.'}\n\n` +
                '화면을 최신 상태로 다시 불러왔습니다. 남은 미납만 다시 선택해 실행하면 됩니다(이미 처리된 건은 자동 제외).';
        } finally {
            await load(); // 성공 · 중단 모두 DB 실제 상태 재조회(선택 초기화). load 는 자체 오류 안내.
            setBusy(false);
            bulkRunningRef.current = false;
        }
        alert(message);
    };
    // 미납 전체 선택/해제 — 회원 미납·일부 + (공식 세션이면) 미납 게스트.
    const allUnpaidKeys = ctx ? ctx.rows.filter((r) => isMemberPayable(r) || (canRegister && isGuestPayableRow(r))).map(rowKey) : [];
    const allUnpaidSelected = allUnpaidKeys.length > 0 && allUnpaidKeys.every((k) => selected.has(k));
    const toggleSelectAllUnpaid = () => setSelected(allUnpaidSelected ? new Set() : new Set(allUnpaidKeys));
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
                    backHref="/finance/kdk"
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

                                {/* 일괄 납부 — 미납 전체 선택 + 선택 건 처리(회원 · 게스트) */}
                                {allUnpaidKeys.length > 0 && (
                                    <button type="button" onClick={toggleSelectAllUnpaid} disabled={busy} style={{
                                        alignSelf: 'flex-start', height: 32, padding: '0 12px', borderRadius: 9, cursor: busy ? 'default' : 'pointer',
                                        border: '1px solid rgba(15,23,42,0.12)', background: '#FFFFFF', color: NAVY, fontSize: 12, fontWeight: 800, fontFamily: 'inherit',
                                    }}>
                                        {allUnpaidSelected ? '선택 해제' : `미납 전체 선택 (${allUnpaidKeys.length}건)`}
                                    </button>
                                )}
                                {selectedPayableCount(ctx.rows, selected, canRegister) > 0 && (
                                    <button type="button" onClick={handleBulkPaid} disabled={busy} style={tealBtn(busy)}>
                                        선택 {selectedPayableCount(ctx.rows, selected, canRegister)}건 납부 완료 처리
                                    </button>
                                )}

                                <section style={{ ...FINANCE_CARD_STYLE, padding: 0, overflow: 'hidden' }}>
                                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                        {ctx.rows.length === 0 && (
                                            <li style={{ padding: 16, fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>벌금 대상이 없습니다.</li>
                                        )}
                                        {ctx.rows.map((r, idx) => {
                                            const key = rowKey(r);
                                            const payable = isMemberPayable(r); // 회원(체크박스/일괄 대상) — 미납/일부만. 면제·비대상 제외.
                                            // 게스트 전용 벌금 납부(회원 receivable 없음). 공식 확정 세션에서만 신규 납부 가능.
                                            const guestPayable = !r.receivableId && r.isGuestPayable === true && r.status !== 'paid' && canRegister;
                                            const memberPaidRevert = r.status === 'paid' && !!r.receivableId;
                                            const guestPaidRevert = r.status === 'paid' && !r.receivableId && r.isGuestPayable === true;
                                            return (
                                                <li key={key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderTop: idx === 0 ? 'none' : '1px solid #EEF2F6' }}>
                                                    <input
                                                        type="checkbox"
                                                        disabled={!(payable || guestPayable) || busy}
                                                        checked={selected.has(key)}
                                                        onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })}
                                                        style={{ width: 16, height: 16, accentColor: '#0F9F98', flexShrink: 0, cursor: (payable || guestPayable) ? 'pointer' : 'not-allowed' }}
                                                    />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        {/* 이름만 말줄임 — G 배지는 별도 요소라 긴 이름에도 사라지지 않는다(표시 전용 수정). */}
                                                        <p style={{ margin: 0, display: 'flex', alignItems: 'center', minWidth: 0, fontSize: 12.5, fontWeight: 800, color: NAVY }}>
                                                            <span title={r.memberName || r.playerName} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 1 }}>
                                                                {r.memberName || (r.isGuest ? cleanPenaltyDisplayName(r.playerName, true) : r.playerName)}
                                                            </span>
                                                            {r.isGuest && <GuestTag />}
                                                        </p>
                                                        <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: '#94A3B8' }}>
                                                            {formatWon(r.amount)}{r.paidAt ? ` · ${r.paidAt} 납부` : ''}
                                                            {r.memberId && <> · <Link href={`/finance/members/${encodeURIComponent(r.memberId)}?year=${year}`} style={{ color: '#0E7C76', textDecoration: 'none', fontWeight: 800 }}>Finance 상세</Link></>}
                                                        </p>
                                                    </div>
                                                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <PenaltyStatusBadge status={r.status} isGuest={r.isGuest} />
                                                        {payable && (
                                                            <button type="button" disabled={busy} onClick={() => handlePaid(r)} style={miniBtn('#0F9F98')}>납부 완료</button>
                                                        )}
                                                        {guestPayable && (
                                                            <button type="button" disabled={busy} onClick={() => handleGuestPaid(r)} style={miniBtn('#0F9F98')}>납부 완료</button>
                                                        )}
                                                        {memberPaidRevert && (
                                                            <button type="button" disabled={busy} onClick={() => handleUnpaid(r)} style={miniBtn('#94A3B8')}>미납으로</button>
                                                        )}
                                                        {guestPaidRevert && (
                                                            <button type="button" disabled={busy} onClick={() => handleGuestUnpaid(r)} style={miniBtn('#94A3B8')}>미납으로</button>
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
function rowKey(r: KdkPenaltyRow) {
    // 회원=member id, 게스트=participant id(동명이인 구분), 둘 다 없으면 이름.
    if (r.memberId) return `m:${r.memberId}`;
    if (r.playerId) return `g:${r.playerId}`;
    return `n:${r.playerName}`;
}
function selectedPayableCount(rows: KdkPenaltyRow[], selected: Set<string>, includeGuests = false) {
    return rows.filter((r) => selected.has(rowKey(r)) && (isMemberPayable(r) || (includeGuests && isGuestPayableRow(r)))).length;
}
/** 게스트 벌금 납부 처리 대상: 회원 청구 없음 + 게스트 납부 가능 + 미납(공식 세션 여부는 호출부 canRegister 가 판정). */
function isGuestPayableRow(r: KdkPenaltyRow) {
    return !r.receivableId && r.isGuestPayable === true && r.status !== 'paid' && !!r.playerId;
}
/** 회원 벌금 납부 처리 대상: 등록된 receivable + 미납/일부 납부. (완납·면제·비대상 제외) */
function isMemberPayable(r: KdkPenaltyRow) {
    return !!r.receivableId && (r.status === 'pending' || r.status === 'partial');
}

function PenaltyStatusBadge({ status, isGuest }: { status: KdkPenaltyRow['status']; isGuest?: boolean }) {
    if (status === 'paid') return <StatusBadge tone="paid">납부 완료</StatusBadge>;
    if (status === 'partial') return <StatusBadge tone="partial">일부 납부</StatusBadge>;
    if (status === 'pending') return <StatusBadge tone="pending">미납</StatusBadge>;
    if (status === 'unregistered') return <StatusBadge tone="not_target">미등록</StatusBadge>;
    if (status === 'exempt') return <StatusBadge tone="exempt">면제</StatusBadge>;
    if (status === 'not_target') return <StatusBadge tone="not_target">비대상</StatusBadge>;
    // needs_link — 게스트는 회원 연결이 아니라 안정 식별값(공식 기록) 확인 문제.
    return <StatusBadge tone="not_target">{isGuest ? '게스트 식별값 확인 필요' : '회원 연결 필요'}</StatusBadge>;
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
    return <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13, borderRadius: '50%', marginLeft: 5, background: '#FFF4DE', border: '1px solid #F4C979', color: '#B7791F', fontSize: 8, fontWeight: 900, verticalAlign: 'middle' }}>G</span>;
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
