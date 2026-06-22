// 회원 휴회(leave of absence) CRUD + 활성 판정.

import { supabase } from '../supabase';
import type { FinanceMemberLeave } from '@/types/finance';

const TABLE = 'finance_member_leaves';

export async function fetchLeavesByMember(memberId: string): Promise<FinanceMemberLeave[]> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('member_id', memberId)
        .order('start_date', { ascending: false });
    if (error) {
        console.warn('[Finance/leaves/member]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceMemberLeave[];
}

/** 회원 전체 휴회 조회 — 일괄 생성 시 활성 판정에 사용. */
export async function fetchAllLeaves(): Promise<FinanceMemberLeave[]> {
    const { data, error } = await supabase
        .from(TABLE)
        .select('*');
    if (error) {
        console.warn('[Finance/leaves/all]', error?.message ?? error);
        return [];
    }
    return (data || []) as FinanceMemberLeave[];
}

export async function insertLeave(input: {
    member_id: string;
    start_date: string;
    end_date?: string | null;
    reason?: string | null;
    userId?: string;
}): Promise<FinanceMemberLeave> {
    const { data, error } = await supabase
        .from(TABLE)
        .insert([{
            member_id: input.member_id,
            start_date: input.start_date,
            end_date: input.end_date ?? null,
            reason: input.reason ?? null,
            created_by: input.userId ?? null,
        }])
        .select('*')
        .single();
    if (error) throw error;
    return data as FinanceMemberLeave;
}

export async function updateLeave(id: string, patch: Partial<Pick<FinanceMemberLeave, 'start_date' | 'end_date' | 'reason'>>): Promise<FinanceMemberLeave> {
    const { data, error } = await supabase
        .from(TABLE)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).select('*').single();
    if (error) throw error;
    return data as FinanceMemberLeave;
}

export async function deleteLeave(id: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
}

// ── 활성 판정 헬퍼 ────────────────────────────────────────────────────────

/** 한 회원이 특정 (year, month) 시점에 휴회 중인가? */
export function isMemberOnLeaveAtMonth(
    leaves: FinanceMemberLeave[],
    memberId: string,
    year: number,
    month: number,
): boolean {
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    // 다음 달 1일 - 1 day = 이번 달 마지막 날 — 간단히 28일 이후로도 안전 비교.
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`;
    for (const l of leaves) {
        if (l.member_id !== memberId) continue;
        // leave 가 이 달과 겹치는지: start_date <= monthEnd AND (end_date IS NULL OR end_date >= monthStart)
        const startOk = !l.start_date || l.start_date <= monthEnd;
        const endOk = !l.end_date || l.end_date >= monthStart;
        if (startOk && endOk) return true;
    }
    return false;
}

/** 한 회원이 오늘 기준 활성 휴회 중인가? */
export function isMemberOnLeaveToday(leaves: FinanceMemberLeave[], memberId: string): boolean {
    const today = new Date().toISOString().slice(0, 10);
    for (const l of leaves) {
        if (l.member_id !== memberId) continue;
        const startOk = !l.start_date || l.start_date <= today;
        const endOk = !l.end_date || l.end_date >= today;
        if (startOk && endOk) return true;
    }
    return false;
}
