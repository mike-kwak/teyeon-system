// 회원별 납부 대상(receivables) + 실제 납부 기록(payments) service.

import { supabase } from '../supabase';
import { fetchFeeRulesForYear } from './feeRulesService';
import { fetchLeavesByMember, isMemberOnLeaveAtMonth } from './leavesService';
import type {
    FinanceDuesPayment,
    FinanceDuesReceivable,
    FinanceMemberLeave,
    FinanceReceivableStatus,
    FinanceReceivableType,
} from '@/types/finance';

const TBL_RECV = 'finance_dues_receivables';
const TBL_PAY  = 'finance_dues_payments';

// ── Receivables ────────────────────────────────────────────────────────────

export async function fetchReceivablesByMonth(
    year: number,
    month: number,
): Promise<FinanceDuesReceivable[]> {
    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('*')
        .eq('target_year', year)
        .eq('target_month', month)
        .order('created_at', { ascending: true });
    if (error) {
        console.warn('[Finance/recv/fetchMonth]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceDuesReceivable[];
}

export async function fetchReceivablesByMember(
    memberId: string,
    year?: number,
): Promise<FinanceDuesReceivable[]> {
    let q = supabase.from(TBL_RECV).select('*').eq('member_id', memberId);
    if (year != null) q = q.eq('target_year', year);
    const { data, error } = await q.order('target_month', { ascending: true });
    if (error) {
        console.warn('[Finance/recv/fetchMember]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceDuesReceivable[];
}

/**
 * 휴회 구간(startDate~endDate)과 겹치는 회원의 **월회비** receivable 조회.
 * 자동 면제는 하지 않는다 — UI 가 확인을 받은 뒤 별도로 status 를 'exempt' 로 변경.
 *
 * 겹침 판정 (월 단위로 추상):
 *   - receivable.target_year/target_month 가 모두 있어야 한다 (연회비/벌금 등 제외).
 *   - 해당 월의 시작일 <= endDate (없으면 무기한)
 *     AND 해당 월의 말일 >= startDate
 *   - 이미 exempt / not_target 인 row 도 호출자가 보고 결정하도록 함께 반환.
 *
 * 구현 노트: DB 쿼리에서 좁힐 수 있는 부분(year 범위)만 인덱스로 사전 필터하고,
 * 월 단위 겹침은 클라이언트 측에서 평가 — 월회비는 회원당 연 12 건 수준이라 부담 없음.
 */
export async function fetchOverlappingMonthlyReceivables(opts: {
    memberId: string;
    startDate: string;        // 'YYYY-MM-DD'
    endDate: string | null;   // null = 무기한
}): Promise<FinanceDuesReceivable[]> {
    const start = opts.startDate;
    const end = opts.endDate; // nullable
    if (!start) return [];

    const startYear = Number(start.slice(0, 4));
    if (!Number.isInteger(startYear)) return [];
    const endYear = end ? Number(end.slice(0, 4)) : (startYear + 5);
    const yearLo = Math.min(startYear, endYear);
    const yearHi = Math.max(startYear, endYear);

    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('*')
        .eq('member_id', opts.memberId)
        .eq('receivable_type', 'monthly_fee')
        .gte('target_year', yearLo)
        .lte('target_year', yearHi);
    if (error) {
        console.warn('[Finance/recv/fetchOverlap]', error?.message ?? error);
        return [];
    }
    const rows = (data || []) as FinanceDuesReceivable[];
    return rows.filter((r) => {
        if (r.target_year == null || r.target_month == null) return false;
        const y = r.target_year;
        const m = r.target_month;
        const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
        const monthEnd   = `${y}-${String(m).padStart(2, '0')}-31`;
        const afterStart = monthEnd >= start;            // 월 말일이 휴회 시작 이상
        const beforeEnd  = end ? monthStart <= end : true; // 월 시작이 휴회 종료 이하 (무기한이면 항상 true)
        return afterStart && beforeEnd;
    });
}

export async function fetchReceivablesByYear(year: number): Promise<FinanceDuesReceivable[]> {
    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('*')
        .eq('target_year', year)
        .order('target_month', { ascending: true });
    if (error) {
        console.warn('[Finance/recv/fetchYear]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceDuesReceivable[];
}

export interface ReceivableUpsertInput {
    id?: string;
    member_id: string;
    receivable_type: FinanceReceivableType;
    title?: string | null;
    target_year?: number | null;
    target_month?: number | null;
    amount_due: number;
    due_date?: string | null;
    status?: FinanceReceivableStatus;
    exemption_reason?: string | null;
    /** 회원 공개 메모. */
    memo?: string | null;
    /** 운영진 전용 메모. */
    admin_memo?: string | null;
}

export async function upsertReceivable(
    input: ReceivableUpsertInput,
    userId?: string,
): Promise<FinanceDuesReceivable> {
    const payload: Record<string, any> = {
        member_id: input.member_id,
        receivable_type: input.receivable_type,
        title: input.title ?? null,
        target_year: input.target_year ?? null,
        target_month: input.target_month ?? null,
        amount_due: Math.max(0, Math.trunc(input.amount_due)),
        due_date: input.due_date ?? null,
        status: input.status ?? 'pending',
        exemption_reason: input.exemption_reason ?? null,
        memo: input.memo ?? null,
        admin_memo: input.admin_memo ?? null,
        updated_at: new Date().toISOString(),
    };
    if (input.id) {
        const { data, error } = await supabase
            .from(TBL_RECV).update(payload).eq('id', input.id).select('*').single();
        if (error) throw error;
        return data as FinanceDuesReceivable;
    }
    const { data, error } = await supabase
        .from(TBL_RECV).insert([{ ...payload, created_by: userId ?? null }])
        .select('*').single();
    if (error) throw error;
    return data as FinanceDuesReceivable;
}

export async function updateReceivableStatus(
    id: string,
    status: FinanceReceivableStatus,
    opts?: { exemption_reason?: string | null; memo?: string | null },
): Promise<FinanceDuesReceivable> {
    const payload: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (opts?.exemption_reason !== undefined) payload.exemption_reason = opts.exemption_reason;
    if (opts?.memo !== undefined) payload.memo = opts.memo;
    const { data, error } = await supabase
        .from(TBL_RECV).update(payload).eq('id', id).select('*').single();
    if (error) throw error;
    return data as FinanceDuesReceivable;
}

export async function deleteReceivable(id: string): Promise<void> {
    const { error } = await supabase.from(TBL_RECV).delete().eq('id', id);
    if (error) throw error;
}

// ── Payments ──────────────────────────────────────────────────────────────

export async function fetchPaymentsByMonth(
    year: number,
    month: number,
): Promise<FinanceDuesPayment[]> {
    // 해당 월 receivable 에 연결된 payment + 같은 월에 paid_at 가 떨어진 독립 payment 모두 포함.
    // 단순화: 해당 월 receivable 의 payments + 같은 월의 paid_at 범위.
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const from = `${monthStr}-01`;
    const to   = `${monthStr}-31`;
    const { data, error } = await supabase
        .from(TBL_PAY)
        .select('*')
        .gte('paid_at', from)
        .lte('paid_at', to)
        .order('paid_at', { ascending: false });
    if (error) {
        console.warn('[Finance/pay/fetchMonth]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceDuesPayment[];
}

export async function fetchPaymentsByMember(
    memberId: string,
    year?: number,
): Promise<FinanceDuesPayment[]> {
    let q = supabase.from(TBL_PAY).select('*').eq('member_id', memberId);
    if (year != null) {
        const from = `${year}-01-01`;
        const to   = `${year}-12-31`;
        q = q.gte('paid_at', from).lte('paid_at', to);
    }
    const { data, error } = await q.order('paid_at', { ascending: false });
    if (error) {
        console.warn('[Finance/pay/fetchMember]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceDuesPayment[];
}

export async function fetchPaymentsByReceivables(
    receivableIds: string[],
): Promise<FinanceDuesPayment[]> {
    if (receivableIds.length === 0) return [];
    const { data, error } = await supabase
        .from(TBL_PAY)
        .select('*')
        .in('receivable_id', receivableIds);
    if (error) {
        console.warn('[Finance/pay/fetchByRecv]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceDuesPayment[];
}

export interface PaymentInsertInput {
    member_id: string;
    receivable_id?: string | null;
    payment_type: FinanceReceivableType;
    amount: number;
    paid_at: string;          // 'YYYY-MM-DD'
    memo?: string | null;
    admin_memo?: string | null;
}

export async function insertPayment(
    input: PaymentInsertInput,
    userId?: string,
): Promise<FinanceDuesPayment> {
    const amount = Math.trunc(input.amount);
    if (!(amount > 0)) throw new Error('금액은 0보다 커야 합니다.');
    const payload = {
        member_id: input.member_id,
        receivable_id: input.receivable_id ?? null,
        payment_type: input.payment_type,
        amount,
        paid_at: input.paid_at,
        memo: input.memo ?? null,
        admin_memo: input.admin_memo ?? null,
        created_by: userId ?? null,
        updated_by: userId ?? null,
    };
    const { data, error } = await supabase
        .from(TBL_PAY).insert([payload]).select('*').single();
    if (error) throw error;
    return data as FinanceDuesPayment;
}

/**
 * 납부 기록 취소 (soft-cancel). hard delete 대신 사용.
 * is_voided=true / voided_at / voided_by / void_reason 기록.
 * 합계 계산은 client side 에서 is_voided!==true 만 합산.
 */
export async function voidPayment(
    id: string,
    reason: string | null,
    userId?: string,
): Promise<FinanceDuesPayment> {
    const { data, error } = await supabase
        .from(TBL_PAY)
        .update({
            is_voided: true,
            voided_at: new Date().toISOString(),
            voided_by: userId ?? null,
            void_reason: reason ?? null,
            updated_by: userId ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id).select('*').single();
    if (error) throw error;
    return data as FinanceDuesPayment;
}

export async function unvoidPayment(id: string, userId?: string): Promise<FinanceDuesPayment> {
    const { data, error } = await supabase
        .from(TBL_PAY)
        .update({
            is_voided: false,
            voided_at: null,
            voided_by: null,
            void_reason: null,
            updated_by: userId ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', id).select('*').single();
    if (error) throw error;
    return data as FinanceDuesPayment;
}

/** 여러 회원에게 동일 항목 일괄 납부 처리 (bulk). */
export async function insertPaymentsBulk(opts: {
    memberIds: string[];
    receivableMap?: Record<string, string | null>;  // member_id → receivable_id
    payment_type: FinanceReceivableType;
    amount: number;
    paid_at: string;
    memo?: string | null;
    admin_memo?: string | null;
    userId?: string;
}): Promise<FinanceDuesPayment[]> {
    if (opts.memberIds.length === 0) return [];
    const amount = Math.trunc(opts.amount);
    if (!(amount > 0)) throw new Error('금액은 0보다 커야 합니다.');
    const rows = opts.memberIds.map((mid) => ({
        member_id: mid,
        receivable_id: opts.receivableMap?.[mid] ?? null,
        payment_type: opts.payment_type,
        amount,
        paid_at: opts.paid_at,
        memo: opts.memo ?? null,
        admin_memo: opts.admin_memo ?? null,
        created_by: opts.userId ?? null,
        updated_by: opts.userId ?? null,
    }));
    const { data, error } = await supabase
        .from(TBL_PAY).insert(rows).select('*');
    if (error) throw error;
    return (data || []) as FinanceDuesPayment[];
}

// ── 회원 본인 1년치 (RPC) — admin_memo 미포함 + is_voided 제외 ──────────
export interface MyFinanceYearResult {
    memberFound: boolean;
    receivables: FinanceDuesReceivable[];
    payments: FinanceDuesPayment[];
    leaves: { id: string; start_date: string; end_date: string | null; reason: string | null }[];
}

export async function fetchMyFinanceYear(year: number): Promise<MyFinanceYearResult> {
    const { data, error } = await supabase.rpc('get_my_finance_year', { p_year: year });
    if (error) {
        console.warn('[Finance/RPC/get_my_finance_year]', error?.message ?? error);
        return { memberFound: false, receivables: [], payments: [], leaves: [] };
    }
    if (!data) return { memberFound: false, receivables: [], payments: [], leaves: [] };
    const j = data as any;
    return {
        memberFound: !!j.memberFound,
        receivables: Array.isArray(j.receivables) ? j.receivables as FinanceDuesReceivable[] : [],
        payments: Array.isArray(j.payments) ? j.payments as FinanceDuesPayment[] : [],
        leaves: Array.isArray(j.leaves) ? j.leaves : [],
    };
}

export async function updatePayment(
    id: string,
    patch: Partial<Pick<FinanceDuesPayment, 'amount' | 'paid_at' | 'memo' | 'admin_memo' | 'receivable_id' | 'payment_type'>>,
    userId?: string,
): Promise<FinanceDuesPayment> {
    const payload: Record<string, any> = {
        ...patch,
        updated_by: userId ?? null,
        updated_at: new Date().toISOString(),
    };
    if (payload.amount !== undefined) {
        payload.amount = Math.trunc(payload.amount);
        if (!(payload.amount > 0)) throw new Error('금액은 0보다 커야 합니다.');
    }
    const { data, error } = await supabase
        .from(TBL_PAY).update(payload).eq('id', id).select('*').single();
    if (error) throw error;
    return data as FinanceDuesPayment;
}

export async function deletePayment(id: string): Promise<void> {
    const { error } = await supabase.from(TBL_PAY).delete().eq('id', id);
    if (error) throw error;
}

/** 같은 회원·같은 항목·같은 날짜·같은 금액 중복 여부 사전 점검 (UI 경고용). */
export async function findDuplicatePayment(input: {
    member_id: string;
    payment_type: FinanceReceivableType;
    amount: number;
    paid_at: string;
}): Promise<FinanceDuesPayment | null> {
    const { data, error } = await supabase
        .from(TBL_PAY)
        .select('*')
        .eq('member_id', input.member_id)
        .eq('payment_type', input.payment_type)
        .eq('amount', Math.trunc(input.amount))
        .eq('paid_at', input.paid_at)
        .maybeSingle();
    if (error) {
        // 중복 검사가 실패해도 입력 자체는 막지 않도록 null 반환.
        console.warn('[Finance/pay/dup-check]', error?.message ?? error);
        return null;
    }
    return data as FinanceDuesPayment | null;
}

// ── 활성 회원 + auth_user_id 매핑 (관리/본인 조회 공통) ─────────────────────

export interface FinanceMember {
    id: string;
    nickname: string | null;
    avatar_url: string | null;
    auth_user_id: string | null;
    /**
     * 회원 구분 (`members.role`).
     * 운영 DB 의 실 값은 한글: `'회장' | '부회장' | '총무' | '재무' | '경기' | '섭외' |
     * '정회원' | '준회원' | '게스트'` 등. 임원진/정회원/준회원/게스트 분기에 사용.
     * 신규 분류 컬럼은 만들지 않는다 — 기존 필드 재사용.
     */
    role: string | null;
}

export async function fetchAllMembers(): Promise<FinanceMember[]> {
    const { data, error } = await supabase
        .from('members')
        .select('id, nickname, avatar_url, auth_user_id, role')
        .order('nickname', { ascending: true });
    if (error) {
        console.warn('[Finance/members]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceMember[];
}

/**
 * 월회비 청구 대상 회원인지 판정.
 *   - `'준회원'` / `'게스트'` 는 월회비 청구 자동 제외 (개별 게스트비/벌금은 별도 등록 가능).
 *   - 그 외 (`정회원`, 임원진, null) 는 모두 청구 대상.
 *   - 휴회 여부는 별도 leavesService 로 평가 — 여기는 회원 구분만.
 */
export function isMonthlyFeeTargetMember(role: string | null | undefined): boolean {
    const r = (role ?? '').trim();
    if (r === '준회원') return false;
    if (r === '게스트') return false;
    return true;
}

/** 현재 로그인 사용자의 members.id 를 auth_user_id 매칭으로 찾는다. */
export async function fetchMyMemberId(authUserId: string): Promise<string | null> {
    if (!authUserId) return null;
    const { data, error } = await supabase
        .from('members')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
    if (error) {
        console.warn('[Finance/myMember]', error?.message ?? error);
        return null;
    }
    return (data?.id as string) ?? null;
}

/**
 * 일괄 회원별 receivable 등록 (월회비 기준 적용용).
 * 호출자는 휴회·준회원 등 제외 대상을 미리 memberIds 에서 빼서 전달.
 *
 * 구현 노트:
 *   - 월회비 UNIQUE INDEX 가 PARTIAL (`where receivable_type='monthly_fee'`) 이라
 *     PostgREST 의 `.upsert(..., { onConflict: ... })` 가 환경별로 정상 동작하지 않음.
 *     → 기존 코드의 catch-regex 폴백도 actual 에러 패턴을 못 잡아 1월 일괄 생성이
 *       silent fail 하던 회귀.
 *   - 그래서 onConflict 의존을 제거하고: (1) 같은 (year,month,monthly_fee) 의 기존 row 를 pre-fetch,
 *     (2) 신규 회원 분만 단일 INSERT 로 넣는 결정론적 흐름으로 교체.
 *   - 0 명이면 빈 배열 즉시 반환 — 기존과 동일.
 */
export async function bulkCreateMonthlyReceivables(opts: {
    memberIds: string[];
    year: number;
    month: number;
    amount: number;
    dueDate?: string | null;
    userId?: string;
}): Promise<FinanceDuesReceivable[]> {
    if (opts.memberIds.length === 0) return [];
    const year = Number(opts.year);
    const month = Number(opts.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new Error(`잘못된 월: ${opts.month}`);
    }

    // 1) 기존 월회비 row 회원 id 집합 — 중복 INSERT 방지.
    const existing = await supabase
        .from(TBL_RECV)
        .select('member_id')
        .eq('target_year', year)
        .eq('target_month', month)
        .eq('receivable_type', 'monthly_fee')
        .in('member_id', opts.memberIds);
    if (existing.error) {
        console.warn('[Finance/recv/bulkCreate/pre-check]', existing.error?.message ?? existing.error);
        throw existing.error;
    }
    const taken = new Set(((existing.data || []) as { member_id: string }[]).map((r) => r.member_id));
    const targets = opts.memberIds.filter((id) => !taken.has(id));
    if (targets.length === 0) return [];

    const amount_due = Math.max(0, Math.trunc(Number(opts.amount)));
    const rows = targets.map((mid) => ({
        member_id: mid,
        receivable_type: 'monthly_fee' as const,
        title: `${year}년 ${month}월 회비`,
        target_year: year,
        target_month: month,
        amount_due,
        due_date: opts.dueDate ?? null,
        status: 'pending' as const,
        created_by: opts.userId ?? null,
    }));
    const { data, error } = await supabase
        .from(TBL_RECV).insert(rows).select('*');
    if (error) {
        console.warn('[Finance/recv/bulkCreate/insert]', error?.message ?? error);
        throw error;
    }
    return (data || []) as FinanceDuesReceivable[];
}

// ── 회비 기준 변경을 기존 청구에 적용 ───────────────────────────────────────
// 회비 기준(finance_fee_rules)만 바꾸면 이미 생성된 monthly_fee receivable 의 amount_due 는
// 그대로 남는다. 운영진이 "기존 청구에도 적용"을 선택하면 해당 연·월 monthly_fee 의
// amount_due 만 새 금액으로 바꾼다. payment 는 건드리지 않으며, 표시 상태(paid/partial/pending)는
// summarizeReceivable 가 payment 합계로 매번 파생하므로 자동 재계산된다.
//
// 보호: exempt / not_target 은 제외(운영진 결정 보존). penalty/guest_fee/event_fee 등 비월회비는
//       receivable_type='monthly_fee' 필터로 애초에 대상 아님. payment 원본은 변경 없음.

export interface FeeApplyPreview {
    /** 적용 대상(= exempt/not_target 제외 monthly_fee) 수. */
    targetCount: number;
    /** 대상 중 amount_due 가 실제로 바뀌는 row 수. 0 이면 적용 불필요. */
    changedCount: number;
    oldTotalDue: number;
    newTotalDue: number;
    currentPaid: number;        // 기존 납부 합계(불변).
    newRemaining: number;       // 변경 후 남은 금액 합계.
    newPaidCount: number;
    newPartialCount: number;
    newPendingCount: number;
}

const EMPTY_FEE_PREVIEW: FeeApplyPreview = {
    targetCount: 0, changedCount: 0, oldTotalDue: 0, newTotalDue: 0,
    currentPaid: 0, newRemaining: 0, newPaidCount: 0, newPartialCount: 0, newPendingCount: 0,
};

/** (year, month) monthly_fee 청구에 새 금액을 적용했을 때의 예상 결과(미적용 — 조회만). */
export async function previewFeeRuleApplication(
    year: number,
    month: number,
    newAmount: number,
): Promise<FeeApplyPreview> {
    const amount = Math.max(0, Math.trunc(Number(newAmount)));
    const { data: recvData, error } = await supabase
        .from(TBL_RECV)
        .select('id, amount_due, status')
        .eq('target_year', year)
        .eq('target_month', month)
        .eq('receivable_type', 'monthly_fee')
        .neq('status', 'exempt')
        .neq('status', 'not_target');
    if (error) {
        console.warn('[Finance/recv/feePreview]', error?.message ?? error);
        throw error;
    }
    const recv = (recvData || []) as { id: string; amount_due: number; status: string }[];
    if (recv.length === 0) return { ...EMPTY_FEE_PREVIEW };

    const ids = recv.map((r) => r.id);
    const payments = await fetchPaymentsByReceivables(ids);
    const paidByRecv = new Map<string, number>();
    for (const p of payments) {
        if (p.is_voided === true || !p.receivable_id) continue;
        paidByRecv.set(p.receivable_id, (paidByRecv.get(p.receivable_id) || 0) + (p.amount || 0));
    }

    const out: FeeApplyPreview = { ...EMPTY_FEE_PREVIEW, targetCount: recv.length };
    for (const r of recv) {
        const paid = paidByRecv.get(r.id) || 0;
        out.oldTotalDue += Math.max(0, r.amount_due);
        out.newTotalDue += amount;
        out.currentPaid += paid;
        out.newRemaining += Math.max(0, amount - paid);
        if (r.amount_due !== amount) out.changedCount += 1;
        if (paid <= 0) out.newPendingCount += 1;
        else if (paid < amount) out.newPartialCount += 1;
        else out.newPaidCount += 1;
    }
    return out;
}

/**
 * (year, month) monthly_fee 청구의 amount_due 를 새 금액으로 일괄 변경(단일 UPDATE = 원자적).
 *   - exempt / not_target 제외. payment 는 변경/생성/삭제하지 않음.
 *   - 같은 금액 재적용도 안전(idempotent — payment 추가 없음).
 * 반환: 변경된 row 수.
 */
export async function applyFeeRuleToMonthlyReceivables(
    year: number,
    month: number,
    newAmount: number,
): Promise<number> {
    const amount = Math.max(0, Math.trunc(Number(newAmount)));
    const { data, error } = await supabase
        .from(TBL_RECV)
        .update({ amount_due: amount, updated_at: new Date().toISOString() })
        .eq('target_year', year)
        .eq('target_month', month)
        .eq('receivable_type', 'monthly_fee')
        .neq('status', 'exempt')
        .neq('status', 'not_target')
        .select('id');
    if (error) {
        console.warn('[Finance/recv/feeApply]', error?.message ?? error);
        throw error;
    }
    return (data || []).length;
}

// ── 납부 ↔ 청구 연결 / 연회비 잔액 일괄 납부 ─────────────────────────────────
// (버그) /finance/record 가 insertPayment 에 receivable_id 를 넘기지 않아 monthly_fee 납부가
//        어떤 receivable 에도 연결되지 않았고, summarizeReceivable / 홈·납부현황의
//        `.in('receivable_id', recvIds)` 집계에서 모두 누락됐다. 아래 helper 로 연결 id 를 찾는다.

/** (member, year, month) 의 monthly_fee receivable 1건(unique). 없으면 null. */
export async function findMonthlyReceivable(
    memberId: string,
    year: number,
    month: number,
): Promise<FinanceDuesReceivable | null> {
    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('*')
        .eq('member_id', memberId)
        .eq('target_year', year)
        .eq('target_month', month)
        .eq('receivable_type', 'monthly_fee')
        .maybeSingle();
    if (error) {
        console.warn('[Finance/recv/findMonthly]', error?.message ?? error);
        throw error;
    }
    return (data as FinanceDuesReceivable) ?? null;
}

/**
 * 여러 회원의 (year, month) monthly_fee receivable 을 한 번에 조회해 member_id → receivable 맵으로 반환.
 *   - 일괄 납부(/finance/bulk)가 저장 직전 "선택한 연·월"의 청구를 다시 확인하는 용도.
 *     화면 state(receivables)는 연·월 전환 직후 비동기 로드 경합으로 직전 달 데이터가 남아 있을 수 있어,
 *     그대로 쓰면 다른 달 청구에 잘못 연결된다. 저장 시점에 이 함수로 정확한 달 청구만 다시 묶는다.
 *   - receivable_type='monthly_fee' 만 대상. (member, year, month) 는 unique 라 회원당 최대 1건.
 *     exempt/not_target 도 포함해 반환 — 대상 여부 판단은 호출자가 한다.
 */
export async function fetchMonthlyReceivableMap(
    memberIds: string[],
    year: number,
    month: number,
): Promise<Map<string, FinanceDuesReceivable>> {
    const out = new Map<string, FinanceDuesReceivable>();
    if (memberIds.length === 0) return out;
    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('*')
        .eq('target_year', year)
        .eq('target_month', month)
        .eq('receivable_type', 'monthly_fee')
        .in('member_id', memberIds);
    if (error) {
        console.warn('[Finance/recv/monthlyMap]', error?.message ?? error);
        throw error;
    }
    for (const r of (data || []) as FinanceDuesReceivable[]) {
        if (!out.has(r.member_id)) out.set(r.member_id, r);
    }
    return out;
}

export type AnnualMonthStatus =
    | 'paid' | 'partial' | 'pending'
    | 'exempt' | 'not_target'
    | 'no_fee_rule'      // 청구도 없고 회비 기준도 없음 — 연회비 계산 불가(처리 중단 사유)
    | 'leave_excluded';  // 청구 없음 + 해당 월 휴회 — 대상 제외(생성 안 함)

export interface AnnualFeeMonthLine {
    month: number;
    /** 아직 생성되지 않은 달은 null. */
    receivableId: string | null;
    amountDue: number;
    amountPaid: number;
    remaining: number;
    status: AnnualMonthStatus;
    /** 저장 시 fee rule 로 새로 생성될 누락 청구. */
    willCreate: boolean;
}

export interface AnnualFeePreview {
    year: number;
    /** 1~12월 전체(항상 12개). */
    lines: AnnualFeeMonthLine[];
    /** 실제 납부 대상(paid/partial/pending) 중 남은 금액 > 0 인 달. */
    payableLines: AnnualFeeMonthLine[];
    totalRemaining: number;
    payableCount: number;
    /** 실제 의무 대상 월 수(exempt/not_target/leave/no_fee_rule 제외). */
    obligationCount: number;
    paidObligationCount: number;
    /** 저장 시 생성할 누락 청구(fee rule 존재 월만). */
    toCreate: { month: number; amount: number; dueDate: string | null }[];
    /** 의무 대상인데 fee rule 이 없어 계산 불가인 달 — 있으면 처리 중단. */
    missingFeeRuleMonths: number[];
    /** missingFeeRuleMonths.length > 0 — 연회비 처리 불가. */
    blocked: boolean;
    /** 선택 연도 월회비 의무가 모두 완납(차단 없음 + 의무 1건 이상). */
    annualFeePaid: boolean;
    /** 청구 자체가 없는 달(1~12 중) — 안내용(하위 호환). */
    missingMonths: number[];
}

/**
 * 한 회원·한 연도의 연회비(=월회비 12개월) 상태를 순수 계산(읽기 전용, DB 접근 없음).
 *   - 월회비 청구가 있으면 그 금액/납부로 paid/partial/pending/exempt/not_target 판정.
 *   - 청구가 없으면: 준회원·게스트(비대상) → not_target / 해당 월 휴회 → leave_excluded /
 *     fee rule 존재 → willCreate(저장 시 생성) / fee rule 없음 → no_fee_rule(차단).
 *   - 12개월을 단일 금액×12 로 단순화하지 않고 월별 fee rule·receivable 기준으로 계산.
 *   - 대상 판정은 기존 isMonthlyFeeTargetMember / isMemberOnLeaveAtMonth 를 재사용(복제 금지).
 */
export function computeAnnualFeeStatus(opts: {
    year: number;
    role: string | null;
    /** 회원의 해당 연도 receivable(어떤 타입이든) — monthly_fee 만 사용. */
    receivables: FinanceDuesReceivable[];
    /** payment 목록(receivable_id 로 내부 필터). */
    payments: FinanceDuesPayment[];
    feeRuleByMonth: Map<number, { default_amount: number; due_date: string | null }>;
    isOnLeave: (month: number) => boolean;
}): AnnualFeePreview {
    const { year, role, receivables, payments, feeRuleByMonth, isOnLeave } = opts;
    const isTarget = isMonthlyFeeTargetMember(role);

    const paidByRecv = new Map<string, number>();
    for (const p of payments) {
        if (p.is_voided === true || !p.receivable_id) continue;
        paidByRecv.set(p.receivable_id, (paidByRecv.get(p.receivable_id) || 0) + (p.amount || 0));
    }
    const recvByMonth = new Map<number, FinanceDuesReceivable>();
    for (const r of receivables) {
        if (r.receivable_type !== 'monthly_fee' || r.target_month == null) continue;
        if (!recvByMonth.has(r.target_month)) recvByMonth.set(r.target_month, r);
    }

    const lines: AnnualFeeMonthLine[] = [];
    const toCreate: { month: number; amount: number; dueDate: string | null }[] = [];
    const missingFeeRuleMonths: number[] = [];
    const missingMonths: number[] = [];

    for (let m = 1; m <= 12; m++) {
        const r = recvByMonth.get(m);
        const rule = feeRuleByMonth.get(m);
        if (!r) missingMonths.push(m);
        if (r) {
            const due = Math.max(0, r.amount_due);
            const paid = paidByRecv.get(r.id) || 0;
            let status: AnnualMonthStatus; let remaining: number;
            if (r.status === 'exempt') { status = 'exempt'; remaining = 0; }
            else if (r.status === 'not_target') { status = 'not_target'; remaining = 0; }
            else if (paid <= 0) { status = 'pending'; remaining = due; }
            else if (paid < due) { status = 'partial'; remaining = due - paid; }
            else { status = 'paid'; remaining = 0; }
            lines.push({ month: m, receivableId: r.id, amountDue: due, amountPaid: paid, remaining, status, willCreate: false });
        } else if (!isTarget) {
            lines.push({ month: m, receivableId: null, amountDue: 0, amountPaid: 0, remaining: 0, status: 'not_target', willCreate: false });
        } else if (isOnLeave(m)) {
            lines.push({ month: m, receivableId: null, amountDue: 0, amountPaid: 0, remaining: 0, status: 'leave_excluded', willCreate: false });
        } else if (rule) {
            const amt = Math.max(0, Math.trunc(rule.default_amount));
            lines.push({ month: m, receivableId: null, amountDue: amt, amountPaid: 0, remaining: amt, status: 'pending', willCreate: true });
            toCreate.push({ month: m, amount: amt, dueDate: rule.due_date ?? null });
        } else {
            lines.push({ month: m, receivableId: null, amountDue: 0, amountPaid: 0, remaining: 0, status: 'no_fee_rule', willCreate: false });
            missingFeeRuleMonths.push(m);
        }
    }

    const obligationLines = lines.filter((l) => l.status === 'paid' || l.status === 'partial' || l.status === 'pending');
    const payableLines = obligationLines.filter((l) => l.remaining > 0);
    const blocked = missingFeeRuleMonths.length > 0;
    const totalRemaining = payableLines.reduce((s, l) => s + l.remaining, 0);
    return {
        year,
        lines,
        payableLines,
        totalRemaining,
        payableCount: payableLines.length,
        obligationCount: obligationLines.length,
        paidObligationCount: obligationLines.filter((l) => l.remaining === 0).length,
        toCreate,
        missingFeeRuleMonths,
        blocked,
        annualFeePaid: !blocked && obligationLines.length > 0 && totalRemaining === 0,
        missingMonths,
    };
}

/**
 * 선택 회원·연도의 연회비(월회비 12개월) 미리보기.
 *   - 누락된 달은 fee rule 존재 시 willCreate(저장 때 생성), fee rule 없으면 no_fee_rule(차단).
 *   - 회원 role / 휴회를 반영(준회원·게스트·휴회 제외 규칙 유지).
 */
export async function fetchAnnualFeePreview(memberId: string, year: number): Promise<AnnualFeePreview> {
    const [mRes, recvRes, feeRules, leaves] = await Promise.all([
        supabase.from('members').select('role').eq('id', memberId).maybeSingle(),
        supabase.from(TBL_RECV).select('*')
            .eq('member_id', memberId).eq('target_year', year).eq('receivable_type', 'monthly_fee'),
        fetchFeeRulesForYear(year),
        fetchLeavesByMember(memberId),
    ]);
    if (recvRes.error) {
        console.warn('[Finance/annual/preview]', recvRes.error?.message ?? recvRes.error);
        throw recvRes.error;
    }
    const recv = (recvRes.data || []) as FinanceDuesReceivable[];
    const ids = recv.map((r) => r.id);
    const payments = ids.length > 0 ? await fetchPaymentsByReceivables(ids) : [];
    const feeRuleByMonth = new Map<number, { default_amount: number; due_date: string | null }>();
    for (const fr of feeRules) {
        if (fr.is_active !== false) feeRuleByMonth.set(fr.month, { default_amount: fr.default_amount, due_date: fr.due_date });
    }
    return computeAnnualFeeStatus({
        year,
        role: (mRes.data?.role as string) ?? null,
        receivables: recv,
        payments,
        feeRuleByMonth,
        isOnLeave: (m) => isMemberOnLeaveAtMonth(leaves, memberId, year, m),
    });
}

/**
 * 여러 회원의 "연회비 납부 완료" 여부를 한 번에 계산해 memberId Set 으로 반환.
 *   - 회원 상세 배지 / 납부 현황 배지 / 공개 공지 스냅샷에서 공통 사용.
 *   - 메모 문구가 아니라 실제 월별 청구·납부 잔액 기준으로 판정(computeAnnualFeeStatus).
 */
export async function fetchAnnualFeePaidSet(
    year: number,
    members: { id: string; role: string | null }[],
    leaves: FinanceMemberLeave[],
): Promise<Set<string>> {
    const out = new Set<string>();
    if (members.length === 0) return out;
    const [feeRules, allRecv] = await Promise.all([
        fetchFeeRulesForYear(year),
        fetchReceivablesByYear(year),
    ]);
    const feeRuleByMonth = new Map<number, { default_amount: number; due_date: string | null }>();
    for (const fr of feeRules) {
        if (fr.is_active !== false) feeRuleByMonth.set(fr.month, { default_amount: fr.default_amount, due_date: fr.due_date });
    }
    const monthlyRecv = allRecv.filter((r) => r.receivable_type === 'monthly_fee');
    const recvIds = monthlyRecv.map((r) => r.id);
    const payments = recvIds.length > 0 ? await fetchPaymentsByReceivables(recvIds) : [];
    const byMember = new Map<string, FinanceDuesReceivable[]>();
    for (const r of monthlyRecv) {
        const arr = byMember.get(r.member_id);
        if (arr) arr.push(r); else byMember.set(r.member_id, [r]);
    }
    for (const m of members) {
        const st = computeAnnualFeeStatus({
            year,
            role: m.role,
            receivables: byMember.get(m.id) ?? [],
            payments,
            feeRuleByMonth,
            isOnLeave: (mon) => isMemberOnLeaveAtMonth(leaves, m.id, year, mon),
        });
        if (st.annualFeePaid) out.add(m.id);
    }
    return out;
}

/**
 * 연회비 일괄 납부(누락 청구 생성 + 잔액 납부) — 단일 RPC(pay_annual_fee_full) 트랜잭션.
 *   1) toCreate(누락 + fee rule 존재 월)의 monthly_fee 청구를 생성(이미 있으면 건너뜀, 중복/수정 없음).
 *   2) 선택 연도 monthly_fee 청구(exempt/not_target 제외)의 남은 금액만큼만 payment 생성.
 *   - 청구 생성과 잔액 납부가 한 트랜잭션 — 일부만 생성되고 payment 가 빠지는 중간 상태 없음.
 *   - paid_at/메모는 동일 적용. 이미 완납 월은 payment 추가 안 함(재실행 시 0건).
 * 반환: 생성 청구 수 + 생성 payment 수 + 총액.
 */
export async function payAnnualFeeFull(
    memberId: string,
    year: number,
    paidAt: string,
    memo: string,
    toCreate: { month: number; amount: number; dueDate: string | null }[],
): Promise<{ createdCount: number; paymentCount: number; totalAmount: number }> {
    // 서버가 DB fee rule 기준으로 금액/대상 재검증하도록 "월 번호만" 전달(금액 미전송 — 변조 차단).
    const { data, error } = await supabase.rpc('pay_annual_fee_full', {
        p_member_id: memberId,
        p_year: year,
        p_paid_at: paidAt,
        p_memo: memo,
        p_months: Array.from(new Set(toCreate.map((c) => c.month))).sort((a, b) => a - b),
    });
    if (error) {
        const msg = String(error?.message || '');
        if (String(error?.code) === 'PGRST202' || /pay_annual_fee_full/i.test(msg)) {
            throw new Error('연회비 일괄 납부 기능이 아직 활성화되지 않았습니다. (supabase/add_annual_fee_full_rpc.sql 적용 필요)');
        }
        if (/inactive fee rule/i.test(msg)) {
            throw new Error('비활성 회비 기준이 있어 연회비를 처리할 수 없습니다. 회비 기준 설정을 확인해 주세요.');
        }
        if (/no fee rule/i.test(msg)) {
            throw new Error('회비 기준이 설정되지 않은 달이 있어 연회비를 처리할 수 없습니다. 회비 기준 설정에서 먼저 등록해 주세요.');
        }
        if (/duplicate month/i.test(msg)) {
            throw new Error('중복된 월 요청으로 연회비 처리를 중단했습니다. 다시 시도해 주세요.');
        }
        console.warn('[Finance/annual/payFull]', msg || error);
        throw new Error(msg || '연회비 일괄 납부에 실패했습니다.');
    }
    const j = (data || {}) as any;
    return {
        createdCount: Number(j.createdCount || 0),
        paymentCount: Number(j.paymentCount || 0),
        totalAmount: Number(j.totalAmount || 0),
    };
}
