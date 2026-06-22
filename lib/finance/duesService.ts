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
}

export async function fetchAllMembers(): Promise<FinanceMember[]> {
    const { data, error } = await supabase
        .from('members')
        .select('id, nickname, avatar_url, auth_user_id')
        .order('nickname', { ascending: true });
    if (error) {
        console.warn('[Finance/members]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceMember[];
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
 * 호출자는 휴회 회원을 미리 memberIds 에서 제외해야 한다 (이 함수는 그 검사를 하지 않음).
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
    const rows = opts.memberIds.map((mid) => ({
        member_id: mid,
        receivable_type: 'monthly_fee' as const,
        title: `${opts.year}년 ${opts.month}월 회비`,
        target_year: opts.year,
        target_month: opts.month,
        amount_due: Math.max(0, Math.trunc(opts.amount)),
        due_date: opts.dueDate ?? null,
        status: 'pending' as const,
        created_by: opts.userId ?? null,
    }));
    // 월회비 unique index 충돌 시 무시 — 이미 등록된 회원은 건너뜀.
    const { data, error } = await supabase
        .from(TBL_RECV)
        .upsert(rows, { onConflict: 'member_id,target_year,target_month', ignoreDuplicates: true })
        .select('*');
    if (error) {
        // onConflict 가 부분 인덱스를 못 잡으면 한 건씩 폴백.
        if (/no.*unique|conflict/i.test(`${error.message || ''} ${error.details || ''}`)) {
            const inserted: FinanceDuesReceivable[] = [];
            for (const row of rows) {
                const existing = await supabase
                    .from(TBL_RECV)
                    .select('*')
                    .eq('member_id', row.member_id)
                    .eq('target_year', row.target_year)
                    .eq('target_month', row.target_month)
                    .eq('receivable_type', 'monthly_fee')
                    .maybeSingle();
                if (existing.data) continue;
                const ins = await supabase.from(TBL_RECV).insert([row]).select('*').single();
                if (ins.data) inserted.push(ins.data as FinanceDuesReceivable);
            }
            return inserted;
        }
        throw error;
    }
    return (data || []) as FinanceDuesReceivable[];
}
