// 예선 조별 일정 — 경기이사 확정 운영안(조 → 출전 순서 · 예정 코트) 일괄 적용용 순수 함수(서버 호출 없음).
//
//   ⚠ 확정안은 대회마다 코드에 명시한다(자동 추정 없음). 저장은 기존 set_group_schedule 을 조마다 그대로 호출한다.
//   ⚠ 조편성 · 팀 자리 · 잠금 · 공개 · 경기는 건드리지 않는다. 일정(순서 · 예정 코트)만 바꾼다.
//   ⚠ 순위결정전은 내부 조 번호(placementGroupNo)로 저장하고, 일반 조와 groupType 으로 구분한다.

import type { SessionNo } from './groupScheduleModel';

export interface PlanEntry { groupNo: number; placement: boolean; sessionNo: SessionNo; courtNo: number }

export interface ConfirmedSchedulePlan {
  label: string;
  courts: number[];                        // 반드시 등록 · 사용 중이어야 하는 코트
  placementGroupNo: number;                // 순위결정전 내부 조 번호
  entries: PlanEntry[];
  staff: { name: string; groupNo: number }[];  // 반드시 두 번째 조여야 하는 운영진
  singleSessionCourts: number[];           // 첫 번째 조만 배정하는 코트
}

const P = (groupNo: number, sessionNo: SessionNo, courtNo: number, placement = false): PlanEntry => ({ groupNo, placement, sessionNo, courtNo });

/** 2026 TEYEON OPEN — 10-22 확정 코트 배정표(운영진 남인우 3조 · 김영호 13조 · 박광현 9조 두 번째 조). */
const TEYEON_OPEN_2026: ConfirmedSchedulePlan = {
  label: '10-22 확정 운영안(코트 10면)',
  courts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  placementGroupNo: 19,
  entries: [
    P(2, 1, 1),  P(3, 2, 1),
    P(12, 1, 2), P(13, 2, 2),
    P(4, 1, 3),  P(19, 2, 3, true),
    P(5, 1, 4),
    P(6, 1, 5),
    P(7, 1, 6),  P(14, 2, 6),
    P(8, 1, 7),  P(15, 2, 7),
    P(16, 1, 8), P(9, 2, 8),
    P(10, 1, 9), P(17, 2, 9),
    P(11, 1, 10), P(18, 2, 10),
  ],
  staff: [{ name: '남인우', groupNo: 3 }, { name: '김영호', groupNo: 13 }, { name: '박광현', groupNo: 9 }],
  singleSessionCourts: [4, 5],
};

const PLANS: Record<string, ConfirmedSchedulePlan> = { '2026-teyeon-open': TEYEON_OPEN_2026 };

export const confirmedPlanFor = (slug: string): ConfirmedSchedulePlan | null => PLANS[slug] ?? null;

// ── 현재 상태(본부 조회 결과의 필요한 부분만) ──
export interface PlanGroupState {
  groupNo: number;
  groupType: 'preliminary' | 'placement';
  sessionNo: SessionNo | null;
  plannedCourtNo: number | null;
  teams: { player1Name: string; player2Name: string }[];
}
export interface PlanCourtState { courtNo: number; status: string }

export const planGroupLabel = (e: { groupNo: number; placement: boolean }): string => (e.placement ? '순위결정전' : `${e.groupNo}조`);

/** 확정안 자체의 규칙 검사(코드 실수 방지). 빈 배열 = 정상. */
export function validatePlan(plan: ConfirmedSchedulePlan): string[] {
  const errs: string[] = [];
  const seen = new Set<number>();
  for (const e of plan.entries) {
    if (seen.has(e.groupNo)) errs.push(`확정안에 ${planGroupLabel(e)}가 두 번 있습니다.`);
    seen.add(e.groupNo);
    if (!plan.courts.includes(e.courtNo)) errs.push(`${planGroupLabel(e)}: ${e.courtNo}번 코트는 확정안 코트 목록에 없습니다.`);
    if (e.placement !== (e.groupNo === plan.placementGroupNo)) errs.push(`${e.groupNo}: 순위결정전 구분이 맞지 않습니다.`);
  }
  if (plan.entries.filter((e) => e.placement).length !== 1) errs.push('확정안의 순위결정전은 정확히 1개여야 합니다.');
  const slot = new Map<string, PlanEntry>();
  for (const e of plan.entries) {
    const k = `${e.courtNo}:${e.sessionNo}`;
    const prev = slot.get(k);
    if (prev) errs.push(`${e.courtNo}번 코트 ${e.sessionNo === 1 ? '첫 번째' : '두 번째'} 조가 겹칩니다(${planGroupLabel(prev)} · ${planGroupLabel(e)}).`);
    slot.set(k, e);
  }
  for (const c of plan.singleSessionCourts) {
    if (plan.entries.some((e) => e.courtNo === c && e.sessionNo !== 1)) errs.push(`${c}번 코트는 첫 번째 조만 배정해야 합니다.`);
  }
  for (const s of plan.staff) {
    const e = plan.entries.find((x) => x.groupNo === s.groupNo);
    if (!e || e.sessionNo !== 2) errs.push(`운영진 ${s.name}(${s.groupNo}조)이 두 번째 조가 아닙니다.`);
  }
  return errs;
}

/** 현재 DB 상태가 확정안을 적용할 수 있는지(코트 · 조 · 운영진 소속). 빈 배열 = 적용 가능. */
export function precheckPlan(plan: ConfirmedSchedulePlan, groups: PlanGroupState[], courts: PlanCourtState[]): string[] {
  const errs = validatePlan(plan);
  for (const no of plan.courts) {
    const c = courts.find((x) => x.courtNo === no);
    if (!c) errs.push(`${no}번 코트가 등록되어 있지 않습니다. 코트 관리에서 먼저 등록해 주세요.`);
    else if (c.status !== 'active') errs.push(`${no}번 코트가 사용 중지 상태입니다.`);
  }
  const dup = groups.map((g) => g.groupNo).filter((n, i, a) => a.indexOf(n) !== i);
  for (const n of new Set(dup)) errs.push(`조 번호 ${n}이 중복되어 있습니다.`);
  for (const e of plan.entries) {
    const g = groups.find((x) => x.groupNo === e.groupNo);
    if (!g) errs.push(`${planGroupLabel(e)}가 조편성에 없습니다.`);
    else if ((g.groupType === 'placement') !== e.placement) errs.push(`${e.groupNo}번 조의 종류(${g.groupType === 'placement' ? '순위결정전' : '일반 조'})가 확정안과 다릅니다.`);
    else if (g.teams.length === 0) errs.push(`${planGroupLabel(e)}에 팀이 없습니다.`);
  }
  for (const g of groups) {
    if (!plan.entries.some((e) => e.groupNo === g.groupNo)) errs.push(`확정안에 없는 조가 있습니다(${g.groupType === 'placement' ? '순위결정전' : `${g.groupNo}조`}).`);
  }
  for (const s of plan.staff) {
    const where = groups.filter((g) => g.teams.some((t) => t.player1Name.trim() === s.name || t.player2Name.trim() === s.name)).map((g) => g.groupNo);
    if (where.length !== 1 || where[0] !== s.groupNo) {
      errs.push(`운영진 ${s.name}의 소속 조가 확정안(${s.groupNo}조)과 다릅니다(현재 ${where.length ? where.map((n) => `${n}조`).join(', ') : '없음'}).`);
    }
  }
  return errs;
}

export type DiffKind = 'new' | 'overwrite' | 'same';
export interface PlanDiffRow {
  entry: PlanEntry;
  kind: DiffKind;
  before: { sessionNo: SessionNo | null; courtNo: number | null };
}

/** 조마다 현재 값과 확정안 비교. new = 비어 있음, overwrite = 다른 값이 있음, same = 이미 같음. */
export function diffPlan(plan: ConfirmedSchedulePlan, groups: PlanGroupState[]): PlanDiffRow[] {
  return plan.entries.map((entry) => {
    const g = groups.find((x) => x.groupNo === entry.groupNo);
    const before = { sessionNo: g?.sessionNo ?? null, courtNo: g?.plannedCourtNo ?? null };
    const kind: DiffKind = before.sessionNo === entry.sessionNo && before.courtNo === entry.courtNo ? 'same'
      : before.sessionNo === null && before.courtNo === null ? 'new' : 'overwrite';
    return { entry, kind, before };
  });
}

/** 저장 후 DB 재조회 값으로 확정안과 하나하나 대조. 빈 배열 = 18개 모두 일치. */
export function verifyPlan(plan: ConfirmedSchedulePlan, groups: PlanGroupState[]): PlanEntry[] {
  return diffPlan(plan, groups).filter((r) => r.kind !== 'same').map((r) => r.entry);
}
