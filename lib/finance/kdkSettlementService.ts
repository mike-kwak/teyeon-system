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
    insertPayment,
    voidPayment,
    type FinanceMember,
} from './duesService';
import {
    buildKdkPenaltyPreview,
    registerKdkPenalties,
    type KdkPenaltyPreviewRow,
} from './kdkPenaltyService';
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
    | 'needs_link';  // 회원 연결 필요(외부 게스트 등).

export interface KdkPenaltyRow {
    memberId: string | null;
    playerName: string;
    memberName: string | null;
    isGuest: boolean;
    amount: number;            // 벌금 금액(양수, 스냅샷).
    matchType: 'id' | 'name' | null;
    receivableId: string | null;
    status: KdkPenaltyPaymentStatus;
    amountPaid: number;
    paidAt: string | null;     // 최근 납부일('YYYY-MM-DD').
}

export interface KdkPenaltySummary {
    targetCount: number;       // 벌금 대상 인원(매칭 여부 무관, 표시 대상 전체).
    registeredCount: number;
    paidCount: number;
    unpaidCount: number;       // 등록됨 · 미납/일부.
    needsLinkCount: number;
    unregisteredCount: number;
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
    const [members, receivables] = await Promise.all([
        fetchAllMembers(),
        fetchSessionPenaltyReceivables(sessionId),
    ]);
    const recvIds = receivables.map((r) => r.id);
    const payments = recvIds.length > 0 ? await fetchPaymentsByReceivables(recvIds) : [];

    const existing = receivables.map((r) => ({ id: r.id, member_id: r.member_id }));
    const preview = buildKdkPenaltyPreview(settlementData, members, existing);
    const recvByMember = new Map<string, FinanceDuesReceivable>();
    for (const r of receivables) recvByMember.set(r.member_id, r);

    const rows: KdkPenaltyRow[] = preview.map((p) => {
        if (!p.memberId) {
            return {
                memberId: null, playerName: p.playerName, memberName: null, isGuest: p.isGuest,
                amount: p.amount, matchType: p.matchType, receivableId: null,
                status: 'needs_link', amountPaid: 0, paidAt: null,
            };
        }
        const recv = recvByMember.get(p.memberId);
        if (!recv) {
            return {
                memberId: p.memberId, playerName: p.playerName, memberName: p.memberNickname, isGuest: p.isGuest,
                amount: p.amount, matchType: p.matchType, receivableId: null,
                status: 'unregistered', amountPaid: 0, paidAt: null,
            };
        }
        const s = summarizeReceivable(recv, payments);
        const status: KdkPenaltyPaymentStatus =
            s.derivedStatus === 'paid' ? 'paid' : s.derivedStatus === 'partial' ? 'partial' : 'pending';
        return {
            memberId: p.memberId, playerName: p.playerName, memberName: p.memberNickname, isGuest: p.isGuest,
            amount: Math.max(0, recv.amount_due), matchType: p.matchType, receivableId: recv.id,
            status, amountPaid: s.amount_paid, paidAt: s.latestPaidAt,
        };
    });

    const summary = summarizePenaltyRows(rows);
    return { rows, summary, members, receivables, payments };
}

export function summarizePenaltyRows(rows: KdkPenaltyRow[]): KdkPenaltySummary {
    let registeredCount = 0, paidCount = 0, unpaidCount = 0, needsLinkCount = 0, unregisteredCount = 0;
    let totalPenalty = 0, totalPaid = 0, totalUnpaid = 0;
    for (const r of rows) {
        totalPenalty += r.amount;
        if (r.status === 'needs_link') { needsLinkCount += 1; continue; }
        if (r.status === 'unregistered') { unregisteredCount += 1; continue; }
        registeredCount += 1;
        totalPaid += r.amountPaid;
        if (r.status === 'paid') paidCount += 1;
        else {
            unpaidCount += 1;
            totalUnpaid += Math.max(0, r.amount - r.amountPaid);
        }
    }
    return {
        targetCount: rows.length,
        registeredCount, paidCount, unpaidCount, needsLinkCount, unregisteredCount,
        totalPenalty, totalPaid, totalUnpaid,
    };
}

/** 오늘 'YYYY-MM-DD'(로컬). finance_dues_payments.paid_at 은 date 컬럼. */
function todayDate(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 개별 납부 완료 처리 — 받을 금액 전액을 penalty payment 로 기록. */
export async function markPenaltyPaid(
    row: { memberId: string | null; receivableId: string | null; amount: number },
    userId?: string | null,
): Promise<void> {
    if (!row.memberId || !row.receivableId) throw new Error('등록된 벌금만 납부 처리할 수 있습니다.');
    await insertPayment({
        member_id: row.memberId,
        receivable_id: row.receivableId,
        payment_type: 'penalty',
        amount: Math.max(1, Math.trunc(row.amount)),
        paid_at: todayDate(),
    }, userId ?? undefined);
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

/** 여러 명 일괄 납부 완료. (이미 완납인 행은 호출자가 제외해 전달.) */
export async function markPenaltiesPaidBulk(
    rows: { memberId: string | null; receivableId: string | null; amount: number }[],
    userId?: string | null,
): Promise<number> {
    let done = 0;
    for (const r of rows) {
        if (!r.memberId || !r.receivableId) continue;
        await markPenaltyPaid(r, userId);
        done += 1;
    }
    return done;
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
