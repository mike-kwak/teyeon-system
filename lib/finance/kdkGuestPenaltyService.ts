// KDK 게스트(비회원) 벌금 납부 상태 service.
//
//   - 회원 벌금은 finance_dues_receivables/payments(member_id 필수)로 관리되지만,
//     member_id 가 없는 게스트는 저장할 수 없다 → 전용 테이블 kdk_guest_penalty_payments 사용.
//   - 식별: session_id + participant_id(= settlement player_id) + charge_type='penalty'.
//   - 쓰기(납부/되돌리기)는 SECURITY DEFINER RPC 로만 수행한다. 클라이언트는 amount/이름/status 를
//     전달하지 않으며, RPC 가 공식 Archive 를 재조회해 금액/이름을 확정한다(화면값 미신뢰).
//   - 조회(SELECT)는 운영진(is_finance_manager)만. 테이블/RPC 미적용 환경에서는 available=false 로
//     안전하게 비활성(게스트 납부 버튼 미노출) — 기존 회원 벌금 흐름 무영향.
//
// ⚠️ supabase/add_kdk_guest_penalty_payments.sql 적용 후에만 실제 저장/조회 동작.

import { supabase } from '../supabase';

const TBL = 'kdk_guest_penalty_payments';
const RPC_MARK = 'mark_kdk_guest_penalty_paid';
const RPC_REVERT = 'revert_kdk_guest_penalty_paid';

export interface GuestPenaltyRecord {
    participantId: string;
    amount: number;
    paidAt: string | null;
}

export interface GuestPenaltyState {
    /** 저장소(테이블/RPC)가 적용돼 있는지. false 면 게스트 납부 UI 를 비활성(기존 동작 유지). */
    available: boolean;
    /** status='paid' 인 참가자만. key = participant_id. */
    paidByParticipant: Map<string, GuestPenaltyRecord>;
}

const EMPTY_STATE: GuestPenaltyState = { available: false, paidByParticipant: new Map() };

/** 테이블/함수 미적용(스키마에 없음) 에러인지 판별 — 이 경우 기능을 조용히 비활성한다. */
function isMissingObject(error: any): boolean {
    const code = String(error?.code || '');
    // 42P01: undefined_table, 42883: undefined_function, PGRST20x: schema cache 미탐색.
    if (['42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)) return true;
    const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    return /kdk_guest_penalty|mark_kdk_guest_penalty_paid|revert_kdk_guest_penalty_paid/i.test(msg)
        && /(does not exist|not find|schema cache|relation|function)/i.test(msg);
}

/** RPC 예외 코드 → 사용자 안내 문구. */
function mapWriteError(error: any): Error {
    if (isMissingObject(error)) {
        return new Error('게스트 벌금 납부 저장소가 아직 적용되지 않았습니다.\n(supabase/add_kdk_guest_penalty_payments.sql 적용이 필요합니다.)');
    }
    const msg = `${error?.message || ''} ${error?.details || ''}`;
    if (/GUEST_PENALTY_NOT_VERIFIED/i.test(msg)) {
        return new Error('공식 기록에서 게스트 벌금 정보를 확인하지 못했습니다. 기록을 다시 확인해주세요.');
    }
    if (/FORBIDDEN/i.test(msg)) return new Error('게스트 벌금을 처리할 권한이 없습니다.');
    if (/AUTH_REQUIRED/i.test(msg)) return new Error('로그인이 필요합니다.');
    if (/INVALID_INPUT/i.test(msg)) return new Error('게스트 참가자 정보가 올바르지 않습니다.');
    console.warn('[Finance/kdkGuestPenalty/write]', error?.message ?? error);
    return new Error(error?.message || '게스트 벌금 처리에 실패했습니다.');
}

/** 세션의 게스트 벌금 납부 상태 로드. 테이블이 없거나 조회 실패면 available=false(빈 상태). */
export async function fetchGuestPenaltyState(sessionId: string): Promise<GuestPenaltyState> {
    if (!sessionId) return EMPTY_STATE;
    const { data, error } = await supabase
        .from(TBL)
        .select('participant_id, amount, status, paid_at')
        .eq('session_id', sessionId)
        .eq('charge_type', 'penalty');
    if (error) {
        if (isMissingObject(error)) return EMPTY_STATE; // 미적용 → 조용히 비활성
        console.warn('[Finance/kdkGuestPenalty/fetch]', error?.message ?? error);
        return EMPTY_STATE; // 조회 실패 시에도 게스트 UI 비활성(잘못된 상태 표시 방지)
    }
    const map = new Map<string, GuestPenaltyRecord>();
    for (const r of (data || []) as any[]) {
        if (r?.status === 'paid') {
            const pid = String(r.participant_id);
            map.set(pid, { participantId: pid, amount: Number(r.amount || 0), paidAt: r.paid_at ?? null });
        }
    }
    return { available: true, paidByParticipant: map };
}

/**
 * 게스트 벌금 납부 완료 — SECURITY DEFINER RPC 호출.
 *   클라이언트는 sessionId + participantId 만 전달. 금액/이름/status/식별자(auth.uid)는 서버가 확정.
 *   RPC 가 공식 Archive(is_official & !is_test)와 penalty_amount 를 재검증하고 멱등 upsert 한다.
 */
export async function markGuestPenaltyPaid(input: { sessionId: string; participantId: string }): Promise<void> {
    if (!input.sessionId || !input.participantId) {
        throw new Error('게스트 참가자 정보가 없어 납부 처리를 할 수 없습니다.');
    }
    const { error } = await supabase.rpc(RPC_MARK, {
        p_session_id: input.sessionId,
        p_participant_id: input.participantId,
    });
    if (error) throw mapWriteError(error);
}

/** 게스트 벌금 미납으로 되돌리기 — RPC(soft-cancel). 존재하지 않으면 서버에서 no-op. */
export async function revertGuestPenaltyPaid(input: { sessionId: string; participantId: string }): Promise<void> {
    if (!input.sessionId || !input.participantId) {
        throw new Error('게스트 참가자 정보가 없어 되돌릴 수 없습니다.');
    }
    const { error } = await supabase.rpc(RPC_REVERT, {
        p_session_id: input.sessionId,
        p_participant_id: input.participantId,
    });
    if (error) throw mapWriteError(error);
}
