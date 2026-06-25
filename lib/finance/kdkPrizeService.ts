// KDK 1등 상금 지급 관리 service.
//
// 핵심 규칙(중요):
//   - 상금 수령자 = "실제 1위"가 아니라 "게스트를 제외한 최고순위 TEYEON 회원".
//   - overallWinner(실제 1위, 게스트일 수 있음)와 prizeRecipient(지급 대상)를 분리한다.
//   - 회원 자격은 player_id → members.id 연결 + role 로만 판정. 이름 문자열 추측/부분일치 금지.
//   - 새 순위 계산식 없음. Archive settlement_data(rank 포함)의 순서를 그대로 사용.
//   - 상금은 receivable/payment 가 아니다(별도 finance_kdk_prize_payouts) → 미납 집계에 포함 안 됨.
//
// ⚠️ supabase/add_kdk_settlement_notices_and_prizes.sql 적용 후 동작.

import { supabase } from '../supabase';
import { isGuestRankedPlayer } from '../kdk/settlement';
import type { FinanceMember } from './duesService';

const TBL = 'finance_kdk_prize_payouts';

export const KDK_FIRST_PRIZE_TYPE = 'kdk_first_place' as const;

export interface KdkRankEntry {
    player_id: string | null;
    player_name: string;
    is_guest?: boolean;
    rank?: number;
    prize_amount?: number;
    [k: string]: any;
}

export interface KdkOverallWinner {
    name: string;
    isGuest: boolean;
    rank: number;
}

export type KdkRecipientStatus =
    | 'eligible'      // 게스트 아닌 회원 확정 — 자동 지급 대상.
    | 'needs_review'  // 비게스트지만 member 연결 불확실 — 운영진 확인 필요(자동 확정 금지).
    | 'none';         // 전원 게스트 등 지급 대상 없음.

export interface KdkPrizeRecipient {
    status: KdkRecipientStatus;
    memberId: string | null;
    name: string | null;
    overallRank: number | null;
}

export interface KdkPrizeDerivation {
    /** 실제 최종 1위. 순위 스냅샷 없으면 null. */
    overallWinner: KdkOverallWinner | null;
    recipient: KdkPrizeRecipient;
    /** Archive 에 저장된 1등 상금 금액(우선순위 1·2). 없으면 0 → 운영진 수동 입력. */
    defaultAmount: number;
    /** 순위 스냅샷 존재 여부 — false 면 상금 대상 생성 금지. */
    hasRanking: boolean;
}

function asPlayer(e: KdkRankEntry) {
    return { id: e.player_id, name: e.player_name, is_guest: e.is_guest };
}

/**
 * settlement_data(rank 순) + 회원 목록 → overallWinner / prizeRecipient / 기본 상금액.
 *   - settlement_data 가 비면 hasRanking=false(상금 생성 금지).
 *   - recipient: 1위부터 내려가며 게스트 제외 첫 회원. member 연결 불확실 시 needs_review 로 멈춤
 *     (아래 순위로 건너뛰지 않는다 — 더 높은 순위의 실제 회원을 누락할 수 있으므로).
 */
export function deriveKdkPrize(
    settlementData: KdkRankEntry[],
    settlementMeta: { prizes?: { first?: number } } | null | undefined,
    members: FinanceMember[],
): KdkPrizeDerivation {
    const entries = (Array.isArray(settlementData) ? [...settlementData] : [])
        .map((e, i) => ({ ...e, rank: Number(e?.rank ?? i + 1) }))
        .sort((a, b) => (a.rank || 0) - (b.rank || 0));

    if (entries.length === 0) {
        return {
            overallWinner: null,
            recipient: { status: 'none', memberId: null, name: null, overallRank: null },
            defaultAmount: 0,
            hasRanking: false,
        };
    }

    const byId = new Map<string, FinanceMember>();
    for (const m of members) byId.set(m.id, m);

    const top = entries[0];
    const overallWinner: KdkOverallWinner = {
        name: top.player_name,
        isGuest: isGuestRankedPlayer(asPlayer(top)),
        rank: top.rank || 1,
    };

    const firstFromMeta = Number(settlementMeta?.prizes?.first || 0);
    const firstFromSnapshot = Number(entries[0]?.prize_amount || 0);
    const defaultAmount = firstFromMeta > 0 ? firstFromMeta : (firstFromSnapshot > 0 ? firstFromSnapshot : 0);

    let recipient: KdkPrizeRecipient = { status: 'none', memberId: null, name: null, overallRank: null };
    for (const e of entries) {
        if (isGuestRankedPlayer(asPlayer(e))) continue;            // 외부 게스트/(G)/manual-guest → 제외.
        const member = e.player_id ? byId.get(e.player_id) : undefined;
        if (member) {
            const role = (member.role || '').trim();
            if (role === '게스트') continue;                        // 게스트 role 회원도 제외.
            recipient = {
                status: 'eligible',
                memberId: member.id,
                name: member.nickname || e.player_name,
                overallRank: e.rank || null,
            };
            break;
        }
        // 비게스트인데 member 연결이 안 됨 → 확실치 않으므로 멈추고 운영진 확인.
        recipient = { status: 'needs_review', memberId: null, name: e.player_name, overallRank: e.rank || null };
        break;
    }

    return { overallWinner, recipient, defaultAmount, hasRanking: true };
}

// ── DB row ──────────────────────────────────────────────────────────────────
export interface KdkPrizePayout {
    id: string;
    related_kdk_session_id: string;
    archive_id: string | null;
    prize_recipient_member_id: string | null;
    recipient_name: string;
    recipient_overall_rank: number | null;
    prize_type: 'kdk_first_place';
    amount: number;
    status: 'unpaid' | 'paid';
    paid_at: string | null;
    paid_by: string | null;
    memo: string | null;
    created_at: string;
    updated_at: string;
}

/** 세션의 1등 상금 지급 row(있으면). 없으면 null. */
export async function fetchPrizePayout(sessionId: string): Promise<KdkPrizePayout | null> {
    if (!sessionId) return null;
    const { data, error } = await supabase
        .from(TBL)
        .select('*')
        .eq('related_kdk_session_id', sessionId)
        .eq('prize_type', KDK_FIRST_PRIZE_TYPE)
        .order('created_at', { ascending: true })
        .limit(1);
    if (error) {
        console.warn('[Finance/kdkPrize/fetch]', error?.message ?? error);
        throw new Error(error?.message || '상금 지급 정보를 불러오지 못했습니다.');
    }
    return (data && data[0] ? data[0] : null) as KdkPrizePayout | null;
}

export interface CreatePrizePayoutInput {
    sessionId: string;
    archiveId?: string | null;
    recipientMemberId: string;     // eligible 일 때만 호출.
    recipientName: string;
    recipientOverallRank: number | null;
    amount: number;
    memo?: string | null;
    createdBy?: string | null;
}

export async function createPrizePayout(input: CreatePrizePayoutInput): Promise<KdkPrizePayout> {
    if (!input.recipientMemberId) throw new Error('상금 지급 대상 회원이 확인되지 않았습니다.');
    const payload = {
        related_kdk_session_id: input.sessionId,
        archive_id: input.archiveId ?? input.sessionId,
        prize_recipient_member_id: input.recipientMemberId,
        recipient_name: input.recipientName,
        recipient_overall_rank: input.recipientOverallRank,
        prize_type: KDK_FIRST_PRIZE_TYPE,
        amount: Math.max(0, Math.trunc(input.amount)),
        status: 'unpaid' as const,
        memo: input.memo ?? null,
        created_by: input.createdBy ?? null,
    };
    const { data, error } = await supabase.from(TBL).insert([payload]).select('*').single();
    if (error) {
        throw new Error(
            String(error?.code) === '23505'
                ? '이미 이 세션의 1등 상금이 등록되어 있습니다.'
                : (error?.message || '상금 등록에 실패했습니다.'),
        );
    }
    return data as KdkPrizePayout;
}

export interface UpdatePrizePayoutPatch {
    amount?: number;
    status?: 'unpaid' | 'paid';
    paid_at?: string | null;
    paid_by?: string | null;
    memo?: string | null;
}

export async function updatePrizePayout(id: string, patch: UpdatePrizePayoutPatch): Promise<KdkPrizePayout> {
    const payload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (patch.amount !== undefined) payload.amount = Math.max(0, Math.trunc(patch.amount));
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.paid_at !== undefined) payload.paid_at = patch.paid_at;
    if (patch.paid_by !== undefined) payload.paid_by = patch.paid_by;
    if (patch.memo !== undefined) payload.memo = patch.memo;
    const { data, error } = await supabase.from(TBL).update(payload).eq('id', id).select('*').single();
    if (error) throw new Error(error?.message || '상금 정보 수정에 실패했습니다.');
    return data as KdkPrizePayout;
}

/** 지급 완료 처리 — paid_at 기본 현재 시각(운영진이 수정 가능). */
export async function markPrizePaid(id: string, paidAtISO: string, userId?: string | null): Promise<KdkPrizePayout> {
    return updatePrizePayout(id, { status: 'paid', paid_at: paidAtISO, paid_by: userId ?? null });
}

/** 다시 미지급 처리. */
export async function markPrizeUnpaid(id: string): Promise<KdkPrizePayout> {
    return updatePrizePayout(id, { status: 'unpaid', paid_at: null, paid_by: null });
}
