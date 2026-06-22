// 월별 회비 기준 CRUD.
// 회비 기준은 코드에 하드코딩하지 않는다 — 운영진이 관리자 화면에서 자유롭게 수정.

import { supabase } from '../supabase';
import type { FinanceFeeRule } from '@/types/finance';

const TABLE = 'finance_fee_rules';

/** 특정 연도의 1~12월 회비 기준 일괄 조회. month 오름차순. */
export async function fetchFeeRulesForYear(year: number): Promise<FinanceFeeRule[]> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('year', year)
        .order('month', { ascending: true });
    if (error) {
        console.warn('[Finance/feeRules/fetchYear]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceFeeRule[];
}

/** 단일 연·월 회비 기준 조회 (없으면 null). */
export async function fetchFeeRule(year: number, month: number): Promise<FinanceFeeRule | null> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();
    if (error) {
        console.warn('[Finance/feeRules/fetchOne]', error?.message ?? error);
        return null;
    }
    return data as FinanceFeeRule | null;
}

export interface FeeRuleUpsertInput {
    year: number;
    month: number;
    title?: string | null;
    default_amount: number;
    due_date?: string | null;
    is_active?: boolean;
}

/** 단일 회비 기준 upsert. (year, month) UNIQUE 기반. */
export async function upsertFeeRule(
    input: FeeRuleUpsertInput,
    userId?: string,
): Promise<FinanceFeeRule | null> {
    const payload = {
        year: input.year,
        month: input.month,
        title: input.title ?? null,
        default_amount: Math.max(0, Math.trunc(input.default_amount)),
        due_date: input.due_date ?? null,
        is_active: input.is_active !== false,
        created_by: userId ?? null,
        updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: 'year,month' })
        .select('*')
        .single();
    if (error) {
        console.warn('[Finance/feeRules/upsert]', error?.message ?? error);
        throw error;
    }
    return data as FinanceFeeRule;
}

/** 월 범위 일괄 적용 — 1~5월에 10,000원 같은 빠른 설정용. */
export async function bulkUpsertFeeRules(opts: {
    year: number;
    fromMonth: number;
    toMonth: number;
    amount: number;
    dueDate?: string | null;
    title?: string | null;
    userId?: string;
}): Promise<FinanceFeeRule[]> {
    const from = Math.max(1, Math.min(opts.fromMonth, opts.toMonth));
    const to   = Math.min(12, Math.max(opts.fromMonth, opts.toMonth));
    const rows = [];
    for (let m = from; m <= to; m++) {
        rows.push({
            year: opts.year,
            month: m,
            title: opts.title ?? null,
            default_amount: Math.max(0, Math.trunc(opts.amount)),
            due_date: opts.dueDate ?? null,
            is_active: true,
            created_by: opts.userId ?? null,
            updated_at: new Date().toISOString(),
        });
    }
    const { data, error } = await supabase
        .from(TABLE)
        .upsert(rows, { onConflict: 'year,month' })
        .select('*');
    if (error) {
        console.warn('[Finance/feeRules/bulkUpsert]', error?.message ?? error);
        throw error;
    }
    return (data || []) as FinanceFeeRule[];
}

export async function deleteFeeRule(year: number, month: number): Promise<void> {
    const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq('year', year)
        .eq('month', month);
    if (error) throw error;
}
