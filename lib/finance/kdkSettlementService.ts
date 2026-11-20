// KDK 세션별 벌금 정산 service — 등록된 벌금 receivable 의 납부(완료/미납) 수동 관리.
//
//   - 금액 source of truth: Archive settlement_data 스냅샷(kdkPenaltyService 와 동일).
//   - 납부 완료 = finance_dues_payments(payment_type='penalty') 를 해당 penalty receivable 에 연결.
//   - 다시 미납 = 연결된 payment 를 soft-cancel(void).
//   - 기존 finance_dues_payments 구조 재사용 — 신규 컬럼/테이블 없음.
//
// ⚠️ 벌금은 월회비와 분리(target_month=null) → 월회비 KPI/공개공지에 영향 없음.

import { supabase } from '../supabase';
import { summarizeReceivable } from './calculatePaymentStatus';
import {
    fetchAllMembers,
    fetchPaymentsByReceivables,
    voidPayment,
    type FinanceMember,
} from './duesService';
import {
    buildKdkPenaltyPreview,
    registerKdkPenalties,
    type KdkPenaltyPreviewRow,
    type KdkSettlementEntry,
} from './kdkPenaltyService';
import { fetchGuestPenaltyState, type GuestPenaltyState } from './kdkGuestPenaltyService';
import type { FinanceDuesPayment, FinanceDuesReceivable } from '@/types/finance';

const TBL_RECV = 'finance_dues_receivables';
const ARCHIVE_TBL = 'teyeon_archive_v1';

export interface KdkArchiveSession {
    id: string;
    title: string;
    date: string | null;
    isOfficial: boolean;
    isTest: boolean;
    settlementData: any[];
    settlementMeta: { prizes?: { first?: number; l1?: number; l2?: number }; guest_fee?: number } | null;
    rankingData: any[];
}

/** Archive 세션 1건 로드(teyeon_archive_v1). 없으면 null. */
export async function loadKdkSession(sessionId: string): Promise<KdkArchiveSession | null> {
    if (!sessionId) return null;
    const { data, error } = await supabase
        .from(ARCHIVE_TBL)
        .select('id, is_official, is_test, raw_data, created_at')
        .eq('id', sessionId)
        .maybeSingle();
    if (error) {
        console.warn('[Finance/kdkSettlement/loadSession]', error?.message ?? error);
        throw new Error(error?.message || 'KDK 세션 정보를 불러오지 못했습니다.');
    }
    if (!data) return null;
    const raw = (data as any).raw_data || {};
    return {
        id: (data as any).id,
        title: raw.title || 'KDK 세션',
        date: raw.date || ((data as any).created_at ? String((data as any).created_at).slice(0, 10) : null),
        isOfficial: Boolean((data as any).is_official),
        isTest: Boolean((data as any).is_test),
        settlementData: Array.isArray(raw.settlement_data) ? raw.settlement_data : [],
        settlementMeta: raw.settlement_meta || null,
        rankingData: Array.isArray(raw.ranking_data) ? raw.ranking_data : [],
    };
}

export type KdkPenaltyPaymentStatus =
    | 'paid'         // 납부 완료(받을 금액 전액 납부).
    | 'partial'      // 일부 납부.
    | 'pending'      // 등록됨 · 미납.
    | 'unregistered' // 회원 매칭됨 · 아직 Finance 미등록.
    | 'needs_link'   // 회원 연결 필요(외부 게스트 등).
    | 'exempt'       // 등록됨 · 운영진 면제(receivable.status='exempt'). 미납 아님.
    | 'not_target';  // 등록됨 · 운영진 비대상(receivable.status='not_target'). 미납 아님.

export interface KdkPenaltyRow {
    memberId: string | null;
    /** 공식 Archive settlement_data[].player_id (게스트 납부 식별용 안정 id). 없으면 null. */
    playerId: string | null;
    playerName: string;
    memberName: string | null;
    isGuest: boolean;
    amount: number;            // 벌금 금액(양수, 스냅샷).
    matchType: 'id' | 'name' | null;
    receivableId: string | null;
    status: KdkPenaltyPaymentStatus;
    amountPaid: number;
    paidAt: string | null;     // 최근 납부일('YYYY-MM-DD').
    /** 게스트 전용 벌금 납부(kdk_guest_penalty_payments)로 처리 가능한 행인지.
     *  = 게스트 + 안정 participant_id 존재 + 저장소(테이블) 적용됨. */
    isGuestPayable?: boolean;
}

export interface KdkPenaltySummary {
    targetCount: number;       // 벌금 대상 인원(매칭 여부 무관, 표시 대상 전체).
    registeredCount: number;
    paidCount: number;
    unpaidCount: number;       // 등록됨 · 미납/일부.
    needsLinkCount: number;
    unregisteredCount: number;
    /** 면제·비대상(운영진 처리). 납부/미납 어느 쪽에도 집계하지 않는다. */
    exemptCount: number;
    totalPenalty: number;      // 전체 대상 벌금 합.
    totalPaid: number;
    totalUnpaid: number;       // 등록 대상 중 남은 금액.
}

export interface KdkPenaltyContext {
    rows: KdkPenaltyRow[];
    summary: KdkPenaltySummary;
    members: FinanceMember[];
    receivables: FinanceDuesReceivable[];
    payments: FinanceDuesPayment[];
}

async function fetchSessionPenaltyReceivables(sessionId: string): Promise<FinanceDuesReceivable[]> {
    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('*')
        .eq('related_kdk_session_id', sessionId)
        .eq('receivable_type', 'penalty');
    if (error) {
        console.warn('[Finance/kdkSettlement/recv]', error?.message ?? error);
        throw new Error(error?.message || '벌금 등록 내역을 불러오지 못했습니다.');
    }
    return (data || []) as FinanceDuesReceivable[];
}

/** 세션 벌금 정산 컨텍스트(목록 + 집계) 로드. */
export async function loadKdkPenaltyContext(
    sessionId: string,
    settlementData: any[],
): Promise<KdkPenaltyContext> {
    const [members, receivables, guestState] = await Promise.all([
        fetchAllMembers(),
        fetchSessionPenaltyReceivables(sessionId),
        fetchGuestPenaltyState(sessionId),
    ]);
    const recvIds = receivables.map((r) => r.id);
    const payments = recvIds.length > 0 ? await fetchPaymentsByReceivables(recvIds) : [];

    const rows = buildKdkPenaltyRows(settlementData, members, receivables, payments, guestState);
    const summary = summarizePenaltyRows(rows);
    return { rows, summary, members, receivables, payments };
}

/**
 * 세션 1개의 벌금 행 판정(순수 함수 — DB 미접속).
 *   세션 정산 화면(loadKdkPenaltyContext)과 누적 벌금 현황(kdkPenaltyHistoryService)이 같은 규칙을 쓰도록
 *   분리했다. 판정 로직은 분리 전과 동일하다(동작 변경 없음).
 *   - receivables: 해당 세션(related_kdk_session_id)의 penalty 청구만.
 *   - payments: 위 청구들에 연결된 납부(취소 포함 — summarizeReceivable 가 is_voided 제외).
 *   - guestState: 해당 세션의 게스트 납부 상태.
 */
export function buildKdkPenaltyRows(
    settlementData: KdkSettlementEntry[],
    members: Pick<FinanceMember, 'id' | 'nickname'>[],
    receivables: FinanceDuesReceivable[],
    payments: FinanceDuesPayment[],
    guestState: GuestPenaltyState,
): KdkPenaltyRow[] {
    const existing = receivables.map((r) => ({ id: r.id, member_id: r.member_id }));
    // 미리보기 매칭은 id·nickname 만 사용한다(누적 현황은 최소 컬럼만 조회).
    const preview = buildKdkPenaltyPreview(settlementData, members as FinanceMember[], existing);
    const recvByMember = new Map<string, FinanceDuesReceivable>();
    for (const r of receivables) recvByMember.set(r.member_id, r);

    const rows: KdkPenaltyRow[] = preview.map((p) => {
        if (!p.memberId) {
            // 회원 미매칭. 게스트 + 안정 participant_id + 저장소 적용 시엔 게스트 전용 납부로 처리.
            const canGuestPay = p.isGuest && !!p.playerId && guestState.available;
            if (canGuestPay) {
                const paid = guestState.paidByParticipant.get(p.playerId as string);
                return {
                    memberId: null, playerId: p.playerId, playerName: p.playerName, memberName: null, isGuest: true,
                    amount: p.amount, matchType: p.matchType, receivableId: null,
                    status: paid ? 'paid' : 'pending',
                    amountPaid: paid ? p.amount : 0,
                    paidAt: paid?.paidAt ? String(paid.paidAt).slice(0, 10) : null,
                    isGuestPayable: true,
                };
            }
            return {
                memberId: null, playerId: p.playerId, playerName: p.playerName, memberName: null, isGuest: p.isGuest,
                amount: p.amount, matchType: p.matchType, receivableId: null,
                status: 'needs_link', amountPaid: 0, paidAt: null, isGuestPayable: false,
            };
        }
        const recv = recvByMember.get(p.memberId);
        if (!recv) {
            return {
                memberId: p.memberId, playerId: p.playerId, playerName: p.playerName, memberName: p.memberNickname, isGuest: p.isGuest,
                amount: p.amount, matchType: p.matchType, receivableId: null,
                status: 'unregistered', amountPaid: 0, paidAt: null,
            };
        }
        const s = summarizeReceivable(recv, payments);
        // exempt / not_target 은 운영진 결정 — 미납(pending)으로 뭉개지 않고 그대로 구분한다
        // (회원 상세 화면 summarizeReceivable 판정과 일치).
        const status: KdkPenaltyPaymentStatus =
            s.derivedStatus === 'paid' ? 'paid'
                : s.derivedStatus === 'partial' ? 'partial'
                    : s.derivedStatus === 'exempt' ? 'exempt'
                        : s.derivedStatus === 'not_target' ? 'not_target'
                            : 'pending';
        return {
            memberId: p.memberId, playerId: p.playerId, playerName: p.playerName, memberName: p.memberNickname, isGuest: p.isGuest,
            amount: Math.max(0, recv.amount_due), matchType: p.matchType, receivableId: recv.id,
            status, amountPaid: s.amount_paid, paidAt: s.latestPaidAt,
        };
    });
    return rows;
}

export function summarizePenaltyRows(rows: KdkPenaltyRow[]): KdkPenaltySummary {
    let registeredCount = 0, paidCount = 0, unpaidCount = 0, needsLinkCount = 0, unregisteredCount = 0, exemptCount = 0;
    let totalPenalty = 0, totalPaid = 0, totalUnpaid = 0;
    for (const r of rows) {
        totalPenalty += r.amount;
        if (r.status === 'needs_link') { needsLinkCount += 1; continue; }
        if (r.status === 'unregistered') { unregisteredCount += 1; continue; }
        registeredCount += 1;
        // 면제·비대상: 미납 건수/금액에 넣지 않는다. 혹시 연결된 유효 납부가 있으면 납부액만 반영.
        if (r.status === 'exempt' || r.status === 'not_target') {
            exemptCount += 1;
            totalPaid += r.amountPaid;
            continue;
        }
        totalPaid += r.amountPaid;
        if (r.status === 'paid') paidCount += 1;
        else {
            unpaidCount += 1;
            totalUnpaid += Math.max(0, r.amount - r.amountPaid);
        }
    }
    return {
        targetCount: rows.length,
        registeredCount, paidCount, unpaidCount, needsLinkCount, unregisteredCount, exemptCount,
        totalPenalty, totalPaid, totalUnpaid,
    };
}

/** 납부 처리할 수 없는 벌금(면제·비대상·청구 불일치 등). 일괄 처리에서는 건너뛴다. */
export class PenaltyNotPayableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PenaltyNotPayableError';
    }
}

const RPC_PAY = 'pay_kdk_member_penalty';

/** DB(RPC)가 확정한 납부 결과. 금액은 서버가 계산한 값만 사용한다. */
export interface PenaltyPayResult {
    /** paid=잔액 기록 / already_paid=이미 완납(기록 없음) / stale=화면 정보가 오래됨(기록 없음, 새로고침 필요) */
    status: 'paid' | 'already_paid' | 'stale';
    insertedAmount: number;
    paymentId: string | null;
    amountDue: number;
    paidBefore: number;
    paidAfter: number;
    remainingBefore: number;
}

/** 같은 탭에서 같은 청구에 대한 요청이 겹치지 않게(더블 클릭) — 다른 탭/운영자 간 직렬화는 RPC 의 행 잠금이 담당. */
const inFlightPenaltyPayments = new Set<string>();

/** RPC 예외 → 사용자 안내. 처리 불가 상태는 PenaltyNotPayableError. */
function mapPayRpcError(error: any): Error {
    const code = String(error?.code || '');
    const msg = `${error?.message || ''} ${error?.details || ''}`;
    if (['42883', 'PGRST202'].includes(code) || /pay_kdk_member_penalty/i.test(msg) && /(not find|does not exist|schema cache)/i.test(msg)) {
        // 구 경로(클라이언트 INSERT)로 fallback 하지 않는다 — 동시성 보호가 없는 경로이기 때문.
        return new Error('회원 벌금 납부 기능의 DB 업데이트가 아직 적용되지 않았습니다.\n(supabase/add_kdk_member_penalty_payment_rpc.sql 적용 필요)');
    }
    if (/PENALTY_EXEMPT/.test(msg)) return new PenaltyNotPayableError('면제 처리된 벌금은 납부 처리할 수 없습니다.');
    if (/PENALTY_NOT_TARGET/.test(msg)) return new PenaltyNotPayableError('비대상 처리된 벌금은 납부 처리할 수 없습니다.');
    if (/RECEIVABLE_NOT_FOUND/.test(msg)) return new PenaltyNotPayableError('벌금 청구를 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요.');
    if (/NOT_KDK_PENALTY|MEMBER_MISMATCH/.test(msg)) return new PenaltyNotPayableError('벌금 청구 정보가 일치하지 않습니다. 새로고침 후 다시 확인해 주세요.');
    if (/FORBIDDEN/.test(msg)) return new Error('벌금 납부를 처리할 권한이 없습니다.');
    if (/AUTH_REQUIRED/.test(msg)) return new Error('로그인이 필요합니다.');
    if (/INVALID_INPUT/.test(msg)) return new PenaltyNotPayableError('남은 벌금이 없거나 요청 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.');
    console.warn('[Finance/kdkSettlement/payRpc]', error?.message ?? error);
    return new Error(error?.message || '벌금 납부 처리에 실패했습니다.');
}

function toPayResult(data: any): PenaltyPayResult {
    const status = data?.status;
    if (status !== 'paid' && status !== 'already_paid' && status !== 'stale') {
        throw new Error('벌금 납부 결과를 확인하지 못했습니다. 새로고침 후 납부 상태를 확인해 주세요.');
    }
    return {
        status,
        insertedAmount: Number(data.inserted_amount || 0),
        paymentId: data.payment_id ?? null,
        amountDue: Number(data.amount_due || 0),
        paidBefore: Number(data.paid_before || 0),
        paidAfter: Number(data.paid_after || 0),
        remainingBefore: Number(data.remaining_before || 0),
    };
}

/**
 * 회원 벌금 납부 완료 — DB RPC(pay_kdk_member_penalty) 1 트랜잭션:
 *   청구 행 잠금 → 상태·유효 납부 재조회 → 미납 잔액만 기록. (예: 청구 5,000 · 납부 2,000 → 3,000)
 *   - 화면 금액은 기록 금액으로 쓰지 않는다. expected(화면이 본 잔액)는 "그 사이 변동 감지"용으로만 전달.
 *   - 완납 → already_paid(기록 없음) / 화면 정보가 오래됨 → stale(기록 없음).
 *   - 면제·비대상·청구 불일치 → PenaltyNotPayableError. 그 외 실패 → Error(기록 없음 — RPC 전체 롤백).
 */
export async function markPenaltyPaid(
    row: { memberId: string | null; receivableId: string | null; amount: number; amountPaid?: number },
    _userId?: string | null, // 기록자는 서버가 auth.uid() 로 확정(클라이언트 값 미사용). 시그니처 호환용.
): Promise<PenaltyPayResult> {
    if (!row.memberId || !row.receivableId) throw new Error('등록된 벌금만 납부 처리할 수 있습니다.');
    const expected = Math.max(0, Math.trunc(Number(row.amount || 0)) - Math.trunc(Number(row.amountPaid || 0)));
    if (expected <= 0) throw new PenaltyNotPayableError('이미 납부 완료된 벌금입니다.');

    const key = row.receivableId;
    if (inFlightPenaltyPayments.has(key)) {
        throw new PenaltyNotPayableError('이 벌금의 납부 처리가 이미 진행 중입니다.');
    }
    inFlightPenaltyPayments.add(key);
    try {
        const { data, error } = await supabase.rpc(RPC_PAY, {
            p_receivable_id: row.receivableId,
            p_member_id: row.memberId,
            p_expected_remaining: expected,
        });
        if (error) throw mapPayRpcError(error);
        return toPayResult(data);
    } finally {
        inFlightPenaltyPayments.delete(key);
    }
}

/** 개별 납부 결과 안내 문구(기록이 없었던 경우만). */
export function describePenaltyPayResult(r: PenaltyPayResult): string | null {
    if (r.status === 'already_paid') return '이미 납부 완료된 벌금입니다. 추가로 기록하지 않았습니다.';
    if (r.status === 'stale') return `그 사이 납부 내역이 변경되었습니다(현재 남은 금액 ${r.remainingBefore.toLocaleString('ko-KR')}원). 새로고침된 화면에서 다시 확인해 주세요.`;
    return null;
}

/** 다시 미납 처리 — receivable 에 연결된 유효 payment 전부 soft-cancel. */
export async function markPenaltyUnpaid(
    receivableId: string,
    payments: FinanceDuesPayment[],
    userId?: string | null,
): Promise<void> {
    const linked = payments.filter((p) => p.receivable_id === receivableId && p.is_voided !== true);
    for (const p of linked) {
        await voidPayment(p.id, 'KDK 벌금 미납 처리', userId ?? undefined);
    }
}

export interface PenaltyBulkPayResult {
    paid: number;          // 실제 기록된 청구 수
    insertedTotal: number; // 실제 기록된 금액 합(서버 확정)
    alreadyPaid: number;   // 이미 완납이라 건너뜀
    stale: number;         // 화면 정보가 오래돼 건너뜀(새로고침 후 재시도)
    notPayable: number;    // 면제·비대상·불일치로 건너뜀
}

/**
 * 여러 명 일괄 납부 — 각 청구마다 개별 RPC(각각 원자적) 를 순서대로 호출.
 *   ⚠️ 여러 청구 전체는 한 트랜잭션이 아니다. 중간에 예외(네트워크/권한 등)가 나면 그 앞의 청구들은
 *      이미 기록된 채로 남고, 예외 메시지에 처리된 건수를 포함해 알린다(부분 성공 가능).
 */
export async function markPenaltiesPaidBulk(
    rows: { memberId: string | null; receivableId: string | null; amount: number; amountPaid?: number }[],
    userId?: string | null,
): Promise<PenaltyBulkPayResult> {
    const res: PenaltyBulkPayResult = { paid: 0, insertedTotal: 0, alreadyPaid: 0, stale: 0, notPayable: 0 };
    const seen = new Set<string>();
    for (const r of rows) {
        if (!r.memberId || !r.receivableId) continue;
        if (seen.has(r.receivableId)) continue; // 같은 청구가 중복 전달돼도 1회만.
        seen.add(r.receivableId);
        try {
            const out = await markPenaltyPaid(r, userId);
            if (out.status === 'paid') { res.paid += 1; res.insertedTotal += out.insertedAmount; }
            else if (out.status === 'already_paid') res.alreadyPaid += 1;
            else res.stale += 1;
        } catch (e: any) {
            if (e instanceof PenaltyNotPayableError) { res.notPayable += 1; continue; }
            const done = res.paid > 0 ? `\n(중단 전 ${res.paid}명 · ${res.insertedTotal.toLocaleString('ko-KR')}원은 이미 납부 처리되었습니다.)` : '';
            throw new Error(`${e?.message || '일괄 납부 처리 중 오류가 발생했습니다.'}${done}`);
        }
    }
    return res;
}

/** 매칭됐지만 미등록인 대상들을 일괄 Finance 등록(registerKdkPenalties 재사용). */
export async function registerUnregisteredPenalties(
    sessionId: string,
    sessionDate: string | null,
    rows: KdkPenaltyRow[],
    createdBy?: string | null,
): Promise<number> {
    const toRegister: KdkPenaltyPreviewRow[] = rows
        .filter((r) => r.status === 'unregistered' && r.memberId)
        .map((r) => ({
            playerId: null,
            playerName: r.playerName,
            isGuest: r.isGuest,
            penaltyLevel: null,
            amount: r.amount,
            memberId: r.memberId,
            memberNickname: r.memberName,
            matchType: r.matchType,
            status: 'registerable',
            registeredReceivableId: null,
        }));
    if (toRegister.length === 0) return 0;
    const res = await registerKdkPenalties({ sessionId, sessionDate, rows: toRegister, createdBy });
    return res.newlyRegistered;
}
