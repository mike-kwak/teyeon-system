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

/**
 * 단일 회비 기준 upsert.
 *
 * 구현 노트:
 *   - PostgREST 의 `upsert(..., { onConflict: 'year,month' })` 가 환경별로
 *     UNIQUE INDEX(=UNIQUE CONSTRAINT 가 아닌) 를 못 잡는 케이스가 있었음.
 *     1월 같은 첫 등록 케이스에서 INSERT vs UPDATE 가 모호해져 저장 실패 → alert 만 뜨고
 *     사용자에겐 "저장이 안 됐다" 처럼 보이는 회귀가 보고됨.
 *   - 그래서 명시적으로 SELECT → INSERT 또는 UPDATE 분기. 부수 효과:
 *       * UPDATE 시 `created_by` 를 덮어쓰지 않음 (최초 등록자 보존).
 *       * RLS 거부 / CHECK 위반 시 error 가 그대로 throw 되어 UI 가 정확히 표시.
 *       * 성공/실패 로그가 일관됨.
 */
export async function upsertFeeRule(
    input: FeeRuleUpsertInput,
    userId?: string,
): Promise<FinanceFeeRule | null> {
    const year = Number(input.year);
    const month = Number(input.month);
    if (!Number.isInteger(year) || year < 2020 || year > 2099) {
        throw new Error(`잘못된 연도: ${input.year}`);
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new Error(`잘못된 월: ${input.month}`);
    }
    const default_amount = Math.max(0, Math.trunc(Number(input.default_amount)));
    const due_date = input.due_date ?? null;
    const title = input.title ?? null;
    const is_active = input.is_active !== false;

    // 1) 기존 row 확인 — RLS 우회는 일어나지 않음 (admin 만 SELECT 가능).
    const existing = await supabase
        .from(TABLE).select('id').eq('year', year).eq('month', month).maybeSingle();
    if (existing.error) {
        console.warn('[Finance/feeRules/upsert/select]', existing.error?.message ?? existing.error);
        throw existing.error;
    }

    if (existing.data?.id) {
        // UPDATE — created_by 는 덮어쓰지 않음.
        const { data, error } = await supabase
            .from(TABLE)
            .update({
                title,
                default_amount,
                due_date,
                is_active,
                updated_at: new Date().toISOString(),
            })
            .eq('id', existing.data.id)
            .select('*')
            .single();
        if (error) {
            console.warn('[Finance/feeRules/upsert/update]', error?.message ?? error);
            throw error;
        }
        return data as FinanceFeeRule;
    }

    // INSERT — 신규 row 는 created_by 도 같이 기록.
    const { data, error } = await supabase
        .from(TABLE)
        .insert([{
            year, month, title, default_amount, due_date, is_active,
            created_by: userId ?? null,
        }])
        .select('*')
        .single();
    if (error) {
        console.warn('[Finance/feeRules/upsert/insert]', error?.message ?? error);
        throw error;
    }
    return data as FinanceFeeRule;
}

/**
 * 월 범위 일괄 적용 — 1~5월에 10,000원 같은 빠른 설정용.
 * 내부적으로 upsertFeeRule 를 월별로 순차 호출 (PostgREST upsert 부작용 회피).
 * 일부 월이 실패해도 다른 월은 그대로 진행 — UI 가 결과를 모아 표시.
 */
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
    const results: FinanceFeeRule[] = [];
    const errors: { month: number; message: string }[] = [];
    for (let m = from; m <= to; m++) {
        try {
            const r = await upsertFeeRule(
                {
                    year: opts.year,
                    month: m,
                    title: opts.title ?? null,
                    default_amount: opts.amount,
                    due_date: opts.dueDate ?? null,
                    is_active: true,
                },
                opts.userId,
            );
            if (r) results.push(r);
        } catch (e: any) {
            errors.push({ month: m, message: e?.message || String(e) });
        }
    }
    if (errors.length > 0) {
        console.warn('[Finance/feeRules/bulkUpsert] partial failure', errors);
        if (results.length === 0) {
            // 모두 실패 — 첫 오류 throw 해서 UI 가 alert.
            throw new Error(`일괄 적용 실패 — ${errors[0].month}월: ${errors[0].message}`);
        }
    }
    return results;
}

export async function deleteFeeRule(year: number, month: number): Promise<void> {
    const { error } = await supabase
        .from(TABLE)
        .delete()
        .eq('year', year)
        .eq('month', month);
    if (error) throw error;
}
