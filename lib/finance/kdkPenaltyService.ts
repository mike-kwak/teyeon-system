// KDK 공식 기록 → Finance 벌금(penalty) 반자동 등록 service.
//
// 핵심 원칙:
//   - 벌금 금액은 "새로 계산하지 않는다". 공식 확정 시점에 lib/kdk/settlement.computeSettlement
//     로 박제된 Archive raw_data.settlement_data[].penalty_amount(음수) 를 그대로 절대값으로 쓴다.
//     (RankingTab / app/kdk 와 동일 기준. 규칙·금액 변경 없음.)
//   - 자동 확정이 아니라 운영진이 미리보기에서 확인한 대상만 finance_dues_receivables 에 등록.
//   - 회원 매칭은 stable member id(= members.id, settlement player_id) 우선.
//   - member_id 가 없는 외부 게스트는 자동 생성하지 않는다(회원 연결 필요로 표시만).
//
// ⚠️ supabase/add_kdk_penalty_finance_link.sql 적용 후에만 동작(related_kdk_session_id 컬럼 필요).

import { supabase } from '../supabase';
import type { FinanceMember } from './duesService';

const TBL_RECV = 'finance_dues_receivables';

// settlement_data 한 항목(= lib/kdk/settlement.SettlementSnapshotEntry 의 부분집합).
export interface KdkSettlementEntry {
    player_id: string | null;
    player_name: string;
    is_guest?: boolean;
    penalty_level?: 'L1' | 'L2' | null;
    penalty_amount?: number; // 음수(벌금) / 0
    [k: string]: any;
}

export type KdkPenaltyMatchType = 'id' | 'name' | null;
export type KdkPenaltyRowStatus = 'registerable' | 'registered' | 'needs_link';

export interface KdkPenaltyPreviewRow {
    playerId: string | null;
    playerName: string;
    isGuest: boolean;
    penaltyLevel: 'L1' | 'L2' | null;
    /** 등록 금액(양수). settlement penalty_amount 의 절대값. */
    amount: number;
    /** 매칭된 members.id (없으면 null). */
    memberId: string | null;
    memberNickname: string | null;
    matchType: KdkPenaltyMatchType;
    status: KdkPenaltyRowStatus;
    /** 이미 등록된 경우의 receivable id. */
    registeredReceivableId: string | null;
}

// settlement / archive 와 동일한 이름 정규화(부분 일치 금지 — 정확 일치만 사용).
function normalizeName(value?: string | null): string {
    return String(value || '')
        .replace(/^manual-guest-/i, '')
        .replace(/\s*\(G\)\s*$/i, '')
        .replace(/\s+g$/i, '')
        .replace(/\s+/g, '')
        .trim()
        .toLowerCase();
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD'. 형식이 아니면 원본 반환. */
export function formatKdkDateDots(date?: string | null): string {
    const raw = String(date || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return raw;
    return `${m[1]}.${m[2]}.${m[3]}`;
}

export function buildKdkPenaltyTitle(date?: string | null): string {
    const dots = formatKdkDateDots(date);
    return dots ? `${dots} KDK 벌금` : 'KDK 벌금';
}

/** 'YYYY-MM-DD' → 연도(number) / 없으면 null. */
export function kdkYearOf(date?: string | null): number | null {
    const m = String(date || '').match(/^(\d{4})-/);
    return m ? Number(m[1]) : null;
}

interface ExistingPenalty {
    id: string;
    member_id: string;
}

/** 해당 KDK 세션에 이미 등록된 penalty receivable 목록. */
export async function fetchExistingKdkPenalties(sessionId: string): Promise<ExistingPenalty[]> {
    if (!sessionId) return [];
    const { data, error } = await supabase
        .from(TBL_RECV)
        .select('id, member_id')
        .eq('related_kdk_session_id', sessionId)
        .eq('receivable_type', 'penalty');
    if (error) {
        console.warn('[Finance/kdkPenalty/fetchExisting]', error?.message ?? error);
        throw new Error(error?.message || '기존 KDK 벌금 등록 내역을 불러오지 못했습니다.');
    }
    return (data || []) as ExistingPenalty[];
}

/**
 * settlement_data + 회원 목록 + 기존 등록 내역 → 미리보기 행.
 *   - penalty_amount 가 음수인(벌금 대상) 항목만 포함. 0원/상금 대상은 단순 제외.
 *   - 매칭: (1) player_id == members.id  (2) 정확 이름 일치(유일할 때만). 부분/유사 금지.
 *   - 이미 등록된 member 는 status='registered'.
 *   - 매칭 실패(외부 게스트 등)는 status='needs_link'.
 */
export function buildKdkPenaltyPreview(
    settlementData: KdkSettlementEntry[],
    members: FinanceMember[],
    existing: ExistingPenalty[],
): KdkPenaltyPreviewRow[] {
    const byId = new Map<string, FinanceMember>();
    const byName = new Map<string, FinanceMember[]>();
    for (const m of members) {
        byId.set(m.id, m);
        const key = normalizeName(m.nickname);
        if (!key) continue;
        const arr = byName.get(key) || [];
        arr.push(m);
        byName.set(key, arr);
    }
    const existingByMember = new Map<string, string>();
    for (const e of existing) existingByMember.set(e.member_id, e.id);

    const rows: KdkPenaltyPreviewRow[] = [];
    for (const entry of settlementData || []) {
        const penalty = Number(entry?.penalty_amount || 0);
        if (!(penalty < 0)) continue; // 벌금 대상만(0원/상금 제외).
        const amount = Math.abs(Math.trunc(penalty));

        const playerId = entry?.player_id ?? null;
        const playerName = String(entry?.player_name || '').trim();
        const isGuest = entry?.is_guest === true;

        // 1) stable id 매칭.
        let member: FinanceMember | null = (playerId && byId.get(playerId)) || null;
        let matchType: KdkPenaltyMatchType = member ? 'id' : null;

        // 2) 정확 이름 일치(유일할 때만). 동명이인이면 매칭하지 않음.
        if (!member) {
            const key = normalizeName(playerName);
            const candidates = key ? byName.get(key) : undefined;
            if (candidates && candidates.length === 1) {
                member = candidates[0];
                matchType = 'name';
            }
        }

        const memberId = member?.id ?? null;
        const registeredReceivableId = memberId ? existingByMember.get(memberId) ?? null : null;
        const status: KdkPenaltyRowStatus = !memberId
            ? 'needs_link'
            : registeredReceivableId
                ? 'registered'
                : 'registerable';

        rows.push({
            playerId,
            playerName,
            isGuest,
            penaltyLevel: (entry?.penalty_level ?? null) as 'L1' | 'L2' | null,
            amount,
            memberId,
            memberNickname: member?.nickname ?? null,
            matchType,
            status,
            registeredReceivableId,
        });
    }
    return rows;
}

export interface RegisterKdkPenaltiesInput {
    sessionId: string;
    sessionDate?: string | null;
    rows: KdkPenaltyPreviewRow[]; // 운영진이 선택한 행만 전달.
    createdBy?: string | null;
}

export interface RegisterKdkPenaltiesResult {
    newlyRegistered: number;
    alreadyRegistered: number;
    skippedNeedsLink: number;
    totalAmount: number; // 신규 등록 금액 합계.
}

/**
 * 선택된 행을 finance_dues_receivables 에 등록.
 *   - member_id 없는 행은 건너뜀(외부 게스트).
 *   - 이미 등록(또는 등록 직전 재조회로 발견)된 회원은 INSERT 하지 않음 — 중복 방지.
 *   - target_month = null(월회비 KPI 와 분리), target_year = KDK 연도.
 */
export async function registerKdkPenalties(
    input: RegisterKdkPenaltiesInput,
): Promise<RegisterKdkPenaltiesResult> {
    const { sessionId, sessionDate, rows, createdBy } = input;
    if (!sessionId) throw new Error('KDK 세션 정보가 없습니다.');

    const result: RegisterKdkPenaltiesResult = {
        newlyRegistered: 0,
        alreadyRegistered: 0,
        skippedNeedsLink: 0,
        totalAmount: 0,
    };

    const linkable = rows.filter((r) => {
        if (!r.memberId) { result.skippedNeedsLink += 1; return false; }
        return true;
    });
    if (linkable.length === 0) return result;

    // 등록 직전 최신 기존 내역 재조회(미리보기 이후 변동/중복 클릭 방지).
    const existing = await fetchExistingKdkPenalties(sessionId);
    const takenMembers = new Set(existing.map((e) => e.member_id));

    const targetYear = kdkYearOf(sessionDate);
    const title = buildKdkPenaltyTitle(sessionDate);

    const toInsert = linkable.filter((r) => {
        if (takenMembers.has(r.memberId as string)) { result.alreadyRegistered += 1; return false; }
        return true;
    });
    if (toInsert.length === 0) return result;

    // 같은 회원이 행에 중복으로 들어오는 비정상 케이스 방지(de-dup by memberId).
    const seen = new Set<string>();
    const payload = toInsert
        .filter((r) => {
            const id = r.memberId as string;
            if (seen.has(id)) { result.alreadyRegistered += 1; return false; }
            seen.add(id);
            return true;
        })
        .map((r) => ({
            member_id: r.memberId,
            receivable_type: 'penalty' as const,
            title,
            target_year: targetYear,
            target_month: null,
            amount_due: Math.max(0, Math.trunc(r.amount)),
            status: 'pending' as const,
            related_kdk_session_id: sessionId,
            created_by: createdBy ?? null,
        }));

    if (payload.length === 0) return result;

    const { data, error } = await supabase.from(TBL_RECV).insert(payload).select('id, amount_due');
    if (error) {
        // unique index(같은 세션·회원) 위반 등은 동시성 충돌 → 사용자에게 재시도 안내.
        console.warn('[Finance/kdkPenalty/register]', error?.message ?? error);
        throw new Error(
            String(error?.code) === '23505'
                ? '일부 벌금이 방금 다른 곳에서 등록되었습니다. 다시 불러와 확인해 주세요.'
                : (error?.message || '벌금 등록 중 오류가 발생했습니다.'),
        );
    }

    const inserted = (data || []) as { id: string; amount_due: number }[];
    result.newlyRegistered = inserted.length;
    result.totalAmount = inserted.reduce((sum, r) => sum + Number(r.amount_due || 0), 0);
    return result;
}
