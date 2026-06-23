// 회원별 납부 대상(receivables) + 실제 납부 기록(payments) service.

import { supabase } from '../supabase';
import type {
    FinanceDuesPayment,
    FinanceDuesReceivable,
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
