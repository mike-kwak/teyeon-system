// 공개 DRAW · MY MATCH — 조별 '첫 경기' 안내(표시 전용 순수 함수). 서버 호출 없음.
//
//   ⚠ 첫 경기는 서버가 만든 실제 경기 행에서만 찾는다 — 조 안 순서(sequenceNo)가 가장 작은 경기.
//     조의 1 · 2번 자리로 가정하지 않는다. 경기가 아직 만들어지지 않았으면 null('경기 순서 준비 중').
//   ⚠ 시작 시각은 운영진이 지정한 조별 일정(get_public_group_schedule)만 쓴다.
//     두 번째 조는 고정 시각을 만들지 않는다 — 운영진 안내 문구, 없으면 '앞 조 종료 후'.
//   ⚠ 첫 경기가 진행 · 종료 · 취소되면 'upcoming' 이 아니다 → 화면은 '첫 경기 출전' 강조를 거둔다.

import type { GroupScheduleInfo, SessionNo } from './groupScheduleModel';

export type FirstMatchPhase = 'upcoming' | 'playing' | 'over';

export interface FirstMatchInfo {
  matchNo: number;
  /** 첫 경기에 나가는 두 팀(팀 번호). */
  teamNos: number[];
  phase: FirstMatchPhase;
  sessionNo: SessionNo | null;
  /** '09:00' · '앞 조 종료 후' · null(일정 미지정 — 시각을 만들지 않는다). */
  startText: string | null;
  checkinDeadline: string | null;
  plannedCourtText: string | null;
}

export const SESSION2_DEFAULT_START = '앞 조 종료 후';

interface MatchLike {
  sequenceNo: number;
  matchNo: number;
  status: string;
  team1: { teamNo: number };
  team2: { teamNo: number };
}

const phaseOf = (status: string): FirstMatchPhase =>
  status === 'waiting' || status === 'calling' ? 'upcoming' : status === 'playing' ? 'playing' : 'over';

/** 첫 번째 조는 지정 시각(없으면 안내 문구), 두 번째 조는 안내 문구만(없으면 '앞 조 종료 후'). */
export function firstStartText(s: GroupScheduleInfo | null): string | null {
  if (!s || !s.sessionNo) return null;
  if (s.sessionNo === 1) return s.startTime ?? s.startNote ?? null;
  return s.startNote ?? SESSION2_DEFAULT_START;
}

function build(matchNo: number, teamNos: number[], status: string, s: GroupScheduleInfo | null): FirstMatchInfo {
  return {
    matchNo,
    teamNos,
    phase: phaseOf(status),
    sessionNo: s?.sessionNo ?? null,
    startText: firstStartText(s),
    checkinDeadline: s?.checkinDeadline ?? null,
    plannedCourtText: s?.plannedCourtText ?? null,
  };
}

/** 일반 조 — 실제 경기 중 조 안 순서가 가장 이른 경기. 경기가 없으면 null. */
export function groupFirstMatch(matches: MatchLike[], schedule: GroupScheduleInfo | null): FirstMatchInfo | null {
  const valid = matches.filter((m) => Number.isFinite(m.sequenceNo) && m.team1.teamNo > 0 && m.team2.teamNo > 0);
  if (valid.length === 0) return null;
  const first = valid.reduce((a, b) => (b.sequenceNo < a.sequenceNo ? b : a));
  return build(first.matchNo, [first.team1.teamNo, first.team2.teamNo], first.status, schedule);
}

/** 순위결정전 — 경기가 하나뿐이므로 그 경기가 곧 첫 경기. 경기 번호 · 두 팀이 없으면 null. */
export function placementFirstMatch(
  p: { matchNo: number; status: string; teams: Array<{ teamNo: number }> },
  schedule: GroupScheduleInfo | null,
): FirstMatchInfo | null {
  if (!(p.matchNo > 0) || p.teams.length < 2 || p.teams.some((t) => !(t.teamNo > 0))) return null;
  return build(p.matchNo, p.teams.map((t) => t.teamNo), p.status, schedule);
}

export const isFirstUpcoming = (f: FirstMatchInfo | null): f is FirstMatchInfo => f?.phase === 'upcoming';

/** '첫 경기 · 09:00' · '첫 경기 · 앞 조 종료 후' · '첫 경기 · 시간 안내 준비 중'. */
export const firstHeadline = (f: FirstMatchInfo): string =>
  `첫 경기 · ${f.startText ?? '시간 안내 준비 중'}`;

/** 보조 줄 — '예정 2번 코트 · 신고 08:40까지'(지정된 값만). */
export function firstDetail(f: FirstMatchInfo): string | null {
  const parts = [
    f.plannedCourtText ? `예정 ${f.plannedCourtText}` : null,
    f.checkinDeadline ? `신고 ${f.checkinDeadline}까지` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export const FIRST_BADGE_LABEL = '첫 경기 출전';
export const FIRST_PENDING_LABEL = '경기 순서 준비 중';
