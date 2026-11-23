// KDK 누적 벌금 현황 V6 — 참가 횟수 · 벌금 발생 횟수 · 벌금 발생률(순수 함수, DB 미접속).
//
// 원칙(금액 집계는 손대지 않는다):
//   - 금액(누적 벌금액 · 납부 · 미납)은 V5 그대로 kdkPenaltyHistoryModel.aggregateMembers 값을 쓴다. 새 금액 계산 없음.
//   - 참가 = 공식 · 비테스트 · KDK 세션의 정산 스냅샷(settlement_data)에 참가자로 박제된 기록.
//       settlement_data 는 확정 시점 전체 순위 참가자(벌금 0원 포함)를 담는다 → 벌금 없는 참가도 집계된다.
//       금액 집계와 같은 세션 목록(HistorySessionInput) · 같은 회원 매칭(buildSettlementMemberMatcher)을 쓴다.
//       세션당 최대 1회(같은 세션에 여러 경기 · 중복 항목이 있어도 1회).
//       정산 스냅샷이 없는 공식 세션은 참가자를 알 수 없으므로 참가에서도 제외(금액 집계와 같은 범위).
//   - 벌금 발생 = 누적 벌금액(청구 대상 = 납부 완료 + 미납/일부 버킷)에 포함된 벌금이 있는 세션 수.
//       납부 여부 무관(미납 포함) · 같은 세션 여러 항목 1회 · 비대상/면제(취소·무효) 제외 ·
//       확인 필요(미등록·회원 연결 필요)는 금액에서 빠지므로 횟수에서도 빼고 따로 센다.
//   - 벌금 발생률 = 벌금 발생 ÷ 참가 × 100. 참가 0회면 null('—').
//   - 게스트: 세션을 넘는 고유 식별자가 없다(참가자 키 manual-guest-<이름> · g-<시각> 은 이름/세션 단위).
//       → 이름으로 합친 참가 횟수 · 발생률은 만들지 않는다(세션별 참가 인원 수만 센다).
//   - 기간: 금액과 같은 inPeriod(KDK 개최일 기준).

import { buildSettlementMemberMatcher } from './kdkPenaltyService';
import {
    aggregateMembers,
    cleanPenaltyDisplayName,
    inPeriod,
    type HistorySessionInput,
    type MemberPenaltyAggregate,
    type PenaltyHistoryRecord,
    type PeriodRange,
} from './kdkPenaltyHistoryModel';

/** 표시 방식. amount = V5 금액 화면 그대로. */
export type StatsView = 'summary' | 'amount' | 'participation' | 'penalty';
export const STATS_VIEWS: StatsView[] = ['summary', 'amount', 'participation', 'penalty'];
export const STATS_VIEW_LABEL: Record<StatsView, string> = {
    summary: '종합', amount: '금액', participation: '참가', penalty: '벌금 횟수',
};

/** 공식 세션 참가 1건(세션 × 참가자). 화면에 내부 id 를 노출하지 않는다. */
export interface ParticipationRecord {
    sessionId: string;
    sessionDate: string | null;
    side: 'member' | 'guest' | 'unlinked';
    /** side='member' 일 때만. */
    memberId: string | null;
    displayName: string;
}

/**
 * 공식 세션(정산 스냅샷 있는 것만) → 참가 기록. 같은 세션 · 같은 회원은 1건.
 *   - 회원: 매칭된 members.id 기준(이름이 바뀌어도 같은 회원).
 *   - 게스트(is_guest · 회원 미매칭): 세션 안에서만 구분(player_id). 세션을 넘어 합치지 않는다.
 *   - 회원도 게스트도 아닌 미매칭 참가자: 'unlinked'(회원 연결 필요) — 어느 회원에게도 넣지 않는다.
 */
export function buildParticipations(
    sessions: HistorySessionInput[],
    members: { id: string; nickname: string | null }[],
): ParticipationRecord[] {
    const match = buildSettlementMemberMatcher(members);
    const nameById = new Map(members.map((m) => [m.id, cleanPenaltyDisplayName(m.nickname)]));
    const out: ParticipationRecord[] = [];
    for (const s of sessions) {
        if (!Array.isArray(s.settlementData)) continue;
        const seen = new Set<string>();
        s.settlementData.forEach((entry, idx) => {
            const { member } = match(entry);
            const isGuest = entry?.is_guest === true;
            const side: ParticipationRecord['side'] = member ? 'member' : isGuest ? 'guest' : 'unlinked';
            const key = member ? `m:${member.id}` : entry?.player_id ? `p:${entry.player_id}` : `i:${idx}`;
            if (seen.has(key)) return;
            seen.add(key);
            out.push({
                sessionId: s.id,
                sessionDate: s.date,
                side,
                memberId: member?.id ?? null,
                displayName: member ? (nameById.get(member.id) || cleanPenaltyDisplayName(entry?.player_name)) : cleanPenaltyDisplayName(entry?.player_name, isGuest),
            });
        });
    }
    return out;
}

export interface MemberStatsRow extends MemberPenaltyAggregate {
    /** 공식 KDK 참가 세션 수. */
    participationCount: number;
    /** 누적 벌금액(청구 대상)에 포함된 벌금이 있는 세션 수. */
    penaltyCount: number;
    /** 확인 필요(미등록 · 연결 필요) 벌금만 있는 세션 수 — 횟수 · 금액 미포함, 참고용. */
    reviewPenaltyCount: number;
    /** 0~1. 참가 0회면 null. */
    penaltyRate: number | null;
    /** 벌금 발생 > 참가(데이터 정합성 문제) — 숨기지 않고 표시한다. */
    inconsistent: boolean;
}

const isBillable = (r: PenaltyHistoryRecord) => r.bucket === 'paid' || r.bucket === 'unpaid';

/**
 * 회원별 통계(기간 필터 적용된 기록을 받는다). 금액 필드는 aggregateMembers 값 그대로.
 *   목록: 벌금 기록이 있거나 공식 참가가 있는 회원(참가만 있고 벌금 0회인 회원 포함).
 */
export function aggregateMemberStats(records: PenaltyHistoryRecord[], participations: ParticipationRecord[]): MemberStatsRow[] {
    const money = new Map(aggregateMembers(records).map((m) => [m.memberId, m]));
    const partSessions = new Map<string, Set<string>>();
    const names = new Map<string, string>();
    for (const p of participations) {
        if (p.side !== 'member' || !p.memberId) continue;
        const set = partSessions.get(p.memberId) || new Set<string>();
        set.add(p.sessionId);
        partSessions.set(p.memberId, set);
        if (!names.has(p.memberId)) names.set(p.memberId, p.displayName);
    }
    const penSessions = new Map<string, Set<string>>();
    const reviewSessions = new Map<string, Set<string>>();
    for (const r of records) {
        if (r.side !== 'member' || !r.memberId) continue;
        const target = isBillable(r) ? penSessions : r.bucket === 'review' ? reviewSessions : null;
        if (!target) continue;
        const set = target.get(r.memberId) || new Set<string>();
        set.add(r.sessionId);
        target.set(r.memberId, set);
    }
    const ids = new Set<string>([...money.keys(), ...partSessions.keys()]);
    const rows: MemberStatsRow[] = [];
    for (const id of ids) {
        const m = money.get(id);
        const participationCount = partSessions.get(id)?.size ?? 0;
        const pen = penSessions.get(id);
        const penaltyCount = pen?.size ?? 0;
        const reviewOnly = [...(reviewSessions.get(id) || [])].filter((s) => !pen?.has(s)).length;
        rows.push({
            ...(m ?? {
                memberId: id, name: names.get(id) || '이름 없음', sessionCount: 0,
                billableAmount: 0, paidAmount: 0, unpaidAmount: 0, excludedAmount: 0, reviewAmount: 0, bucket: 'excluded' as const,
            }),
            participationCount,
            penaltyCount,
            reviewPenaltyCount: reviewOnly,
            penaltyRate: participationCount > 0 ? penaltyCount / participationCount : null,
            inconsistent: penaltyCount > participationCount,
        });
    }
    return sortMemberStats(rows, 'summary');
}

/** V5 기본 순서: 누적 벌금액(청구 대상) 내림차순 → 이름 → id. 모든 모드의 동률 기준. */
function baseCompare(a: MemberStatsRow, b: MemberStatsRow): number {
    return (b.billableAmount - a.billableAmount)
        || a.name.localeCompare(b.name, 'ko')
        || a.memberId.localeCompare(b.memberId);
}

/** 모드별 정렬. 벌금 발생률만으로 순위를 바꾸지 않는다. */
export function sortMemberStats(rows: MemberStatsRow[], view: StatsView): MemberStatsRow[] {
    const primary = (a: MemberStatsRow, b: MemberStatsRow) =>
        view === 'participation' ? b.participationCount - a.participationCount
            : view === 'penalty' ? b.penaltyCount - a.penaltyCount
                : 0;
    return [...rows].sort((a, b) => primary(a, b) || baseCompare(a, b));
}

/** 모드별 회원 목록. amount = V5 목록(벌금 기록 있는 회원만) 그대로. */
export function memberRowsForView(rows: MemberStatsRow[], view: StatsView): MemberStatsRow[] {
    const list = view === 'amount' ? rows.filter((r) => r.sessionCount > 0) : rows;
    return sortMemberStats(list, view);
}

export interface StatsOverview {
    /** 기간 내 정산 스냅샷 있는 공식 세션 수. */
    sessionCount: number;
    /** 회원 참가 연인원(회원 × 세션). */
    memberParticipations: number;
    /** 회원 벌금 발생 연인원(회원 × 세션). */
    memberPenalties: number;
    /** 0~1, 참가 0이면 null. */
    memberPenaltyRate: number | null;
    /** 참가 회원 수. */
    participatingMembers: number;
    /** 게스트 참가 연인원(세션별 · 사람 단위 합산 아님). */
    guestParticipations: number;
    /** 회원 연결 필요 참가 연인원(어느 회원에도 포함 안 됨). */
    unlinkedParticipations: number;
    /** 기간 내 정산 스냅샷 없는 공식 세션 수(참가 · 금액 모두 미집계). */
    noSnapshotSessions: number;
    /** 벌금 발생 > 참가 인 회원 수(정합성 문제). */
    inconsistentMembers: number;
}

export function buildStatsOverview(
    rows: MemberStatsRow[],
    participations: ParticipationRecord[],
    sessions: { date: string | null; hasSnapshot: boolean }[],
): StatsOverview {
    const memberParticipations = rows.reduce((a, r) => a + r.participationCount, 0);
    const memberPenalties = rows.reduce((a, r) => a + r.penaltyCount, 0);
    return {
        sessionCount: sessions.filter((s) => s.hasSnapshot).length,
        memberParticipations,
        memberPenalties,
        memberPenaltyRate: memberParticipations > 0 ? memberPenalties / memberParticipations : null,
        participatingMembers: rows.filter((r) => r.participationCount > 0).length,
        guestParticipations: participations.filter((p) => p.side === 'guest').length,
        unlinkedParticipations: participations.filter((p) => p.side === 'unlinked').length,
        noSnapshotSessions: sessions.filter((s) => !s.hasSnapshot).length,
        inconsistentMembers: rows.filter((r) => r.inconsistent).length,
    };
}

/** 기간 필터(금액과 같은 inPeriod · KDK 개최일 기준). */
export function participationsInPeriod(participations: ParticipationRecord[], range: PeriodRange): ParticipationRecord[] {
    return participations.filter((p) => inPeriod(p.sessionDate, range));
}

/** 벌금 발생률 표시. null → '—'. 소수 첫째 자리 내림(formatRate 와 같은 규칙). */
export function formatPenaltyRate(rate: number | null): string {
    if (rate == null) return '—';
    const pct = Math.floor(rate * 1000 + 1e-9) / 10;
    return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

export function readStatsView(v: string | null | undefined): StatsView {
    return STATS_VIEWS.includes(v as StatsView) ? (v as StatsView) : 'summary';
}
