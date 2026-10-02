// Control Center 읽기 모델 (Batch 4F-1) — **순수 함수만** 둔다.
//
//   관제 화면이 보여 줄 숫자·상태를 한 곳에서 만든다. 화면 component 안에 계산을 흩지 않는다.
//   ⚠ React · DOM · 서버 의존이 없다. 단독으로 검증할 수 있다.
//   ⚠ 새로운 사실을 만들지 않는다 — 전부 기존 운영 RPC 응답에서 파생한다.
//     · 경기 상태 뜻은 기존 그대로다(대기 · 호명 · 진행 중 · 완료 · 취소).
//     · 카운트 기준도 기존 경기 운영 화면과 같다(전체 = 취소 포함, 호명은 따로 센다).
//     · 코트의 '다음 경기'를 고르지 않고, 순위를 다시 계산하지 않는다.
//   ⚠ 코트 수 · 조 수 · 진출 수를 숫자로 박지 않는다. 전부 서버가 준 값에서 센다.

import type { MatchBoard, MatchStatus, TournamentMatch } from '@/lib/tournaments/matchTypes';
import type { PreliminaryStandings } from '@/lib/tournaments/standingsTypes';
import type { AdminBracket } from '@/lib/tournaments/bracketTypes';

// ── 대회 단계 ───────────────────────────────────────────────────────────────

/** 화면이 쓰는 단계. 저장된 값에서 안전하게 구분되는 것만 둔다(추측하지 않는다). */
export type ControlPhase = 'pre_race' | 'preliminary' | 'knockout' | 'completed';

export const CONTROL_PHASE_LABEL: Record<ControlPhase, string> = {
  pre_race: 'PRE-RACE',
  preliminary: 'PRELIMINARY',
  knockout: 'KNOCKOUT',
  completed: 'COMPLETED',
};

/**
 * 단계 판정.
 *   · 대회가 끝났다고 서버가 말하거나 본선이 완료됐으면 COMPLETED
 *   · 본선 경기가 하나라도 생겼으면 KNOCKOUT
 *   · 예선 경기가 생겼고 한 경기라도 손을 댔으면 PRELIMINARY
 *   · 그 밖에는 PRE-RACE
 *   ⚠ 여기서 새 단계를 DB 에 저장하지 않는다. 볼 때마다 다시 센다.
 */
export function derivePhase(
  board: MatchBoard | null,
  bracket: AdminBracket | null,
): ControlPhase {
  if (board?.tournamentStatus === 'completed') return 'completed';
  if (bracket?.bracket?.completedAt) return 'completed';

  const matches = board?.matches ?? [];
  if (matches.some((m) => m.stage === 'knockout')) return 'knockout';

  const prelim = matches.filter((m) => m.stage !== 'knockout');
  const started = prelim.some((m) => m.status !== 'waiting');
  if (prelim.length > 0 && started) return 'preliminary';

  return 'pre_race';
}

// ── 요약 ────────────────────────────────────────────────────────────────────

export interface ControlSummary {
  /** 운영 중인 단계의 경기만 센다(예선 화면에서는 예선·순위결정전, 본선에서는 본선). */
  stage: 'preliminary' | 'knockout';
  total: number;
  waiting: number;
  calling: number;
  playing: number;
  completed: number;
  cancelled: number;
  /** 운영 중(active) 코트 수와 그중 경기 중인 코트 수. */
  activeCourts: number;
  busyCourts: number;
  /** 완료 / 전체. 전체가 0 이면 null(0% 와 '아직 없음'은 다르다). */
  progress: number | null;
}

const EMPTY_COUNTS = {
  waiting: 0, calling: 0, playing: 0, completed: 0, cancelled: 0,
} as const;

/** 상태별 경기 수. ⚠ 기존 경기 운영 화면과 같은 방식으로 센다. */
function countByStatus(matches: TournamentMatch[]): Record<MatchStatus, number> {
  const c: Record<MatchStatus, number> = { ...EMPTY_COUNTS };
  matches.forEach((m) => { if (m.status in c) c[m.status] += 1; });
  return c;
}

/**
 * 요약.
 *   stage 를 주면 그 단계의 경기만 센다. 주지 않으면 단계에서 자동으로 고른다.
 *   ⚠ '전체'는 취소를 포함한다(기존 화면과 같은 뜻). 진행률도 같은 분모를 쓴다.
 */
export function deriveSummary(
  board: MatchBoard | null,
  phase: ControlPhase,
): ControlSummary {
  const stage: ControlSummary['stage'] = phase === 'knockout' ? 'knockout' : 'preliminary';
  const matches = (board?.matches ?? []).filter((m) => (
    stage === 'knockout' ? m.stage === 'knockout' : m.stage !== 'knockout'
  ));
  const c = countByStatus(matches);
  const total = matches.length;

  const courts = board?.courts ?? [];
  const activeCourts = courts.filter((x) => x.status === 'active').length;
  const busyCourts = courts.filter((x) => x.status === 'active' && x.busy).length;

  return {
    stage,
    total,
    waiting: c.waiting,
    calling: c.calling,
    playing: c.playing,
    completed: c.completed,
    cancelled: c.cancelled,
    activeCourts,
    busyCourts,
    progress: total === 0 ? null : c.completed / total,
  };
}

// ── 코트 ────────────────────────────────────────────────────────────────────

export type CourtState = 'playing' | 'empty' | 'closed';

export interface ControlCourtTeam {
  teamNo: number;
  player1Name: string;
  player2Name: string;
}

export interface ControlCourtMatch {
  matchId: string;
  matchNo: number;
  stage: TournamentMatch['stage'];
  groupNo: number | null;
  team1: ControlCourtTeam;
  team2: ControlCourtTeam;
}

export interface ControlCourt {
  courtNo: number;
  displayName: string | null;
  state: CourtState;
  /** 지금 이 코트에서 하고 있는 경기. 없으면 null. */
  now: ControlCourtMatch | null;
}

const teamOf = (t: TournamentMatch['team1']): ControlCourtTeam => ({
  teamNo: t.teamNo, player1Name: t.player1Name, player2Name: t.player2Name,
});

/**
 * 코트 줄.
 *   · CLOSED = 코트 자체가 꺼져 있다(court.status === 'disabled')
 *   · PLAYING = 켜져 있고 그 코트에서 진행 중인 경기가 있다
 *   · EMPTY = 켜져 있고 진행 중인 경기가 없다
 *   ⚠ '진행 중(playing)' 경기만 코트를 차지한다. 호명은 코트를 점유하지 않는다.
 *   ⚠ 예선·본선을 가리지 않는다 — 코트는 대회 전체가 함께 쓴다.
 */
export function deriveCourts(board: MatchBoard | null): ControlCourt[] {
  if (!board) return [];
  const playing = board.matches
    .filter((m) => m.status === 'playing' && m.courtNo !== null)
    .sort((a, b) => a.matchNo - b.matchNo);

  return [...board.courts]
    .sort((a, b) => a.courtNo - b.courtNo)
    .map((c) => {
      const closed = c.status !== 'active';
      const m = closed ? undefined : playing.find((x) => x.courtNo === c.courtNo);
      return {
        courtNo: c.courtNo,
        displayName: c.displayName,
        state: closed ? 'closed' : m ? 'playing' : 'empty',
        now: m ? {
          matchId: m.matchId, matchNo: m.matchNo, stage: m.stage, groupNo: m.groupNo,
          team1: teamOf(m.team1), team2: teamOf(m.team2),
        } : null,
      } satisfies ControlCourt;
    });
}

/** 코트 상태별 개수(제목 줄에 쓴다). */
export function countCourtStates(courts: ControlCourt[]): Record<CourtState, number> {
  const c: Record<CourtState, number> = { playing: 0, empty: 0, closed: 0 };
  courts.forEach((x) => { c[x.state] += 1; });
  return c;
}

// ── 예선 상태 ───────────────────────────────────────────────────────────────

/** 조 하나의 진행 상태. 순위표를 복제하지 않고 '어디까지 왔는지'만 본다. */
export type GroupState = 'done' | 'attention' | 'running' | 'not_started';

export interface ControlGroup {
  groupNo: number;
  state: GroupState;
  completedMatches: number;
  expectedMatches: number;
}

export interface ControlPreliminary {
  groups: ControlGroup[];
  done: number;
  running: number;
  attention: number;
  notStarted: number;
  /** 합산연령 확인이 필요한 조 번호. 숫자를 만들지 않고 서버 상태를 그대로 옮긴다. */
  ageCheckGroups: number[];
}

/**
 * 예선 진행 상태.
 *   · attention = 조는 끝났는데 순위가 확정되지 않았다(AGE_CHECK_REQUIRED)
 *   · done      = 순위까지 확정(FINAL)
 *   · running   = 한 경기라도 끝났다
 *   · not_started = 아직 아무 경기도 끝나지 않았다
 *   ⚠ 순위를 여기서 계산하지 않는다. 서버 rankingStatus 를 그대로 읽는다.
 */
export function derivePreliminary(standings: PreliminaryStandings | null): ControlPreliminary | null {
  if (!standings || standings.groups.length === 0) return null;

  const groups: ControlGroup[] = [...standings.groups]
    .sort((a, b) => a.groupNo - b.groupNo)
    .map((g) => {
      const state: GroupState = g.rankingStatus === 'AGE_CHECK_REQUIRED' ? 'attention'
        : g.rankingStatus === 'FINAL' ? 'done'
        : g.completedMatches > 0 || g.cancelledMatches > 0 ? 'running'
        : 'not_started';
      return {
        groupNo: g.groupNo, state,
        completedMatches: g.completedMatches, expectedMatches: g.expectedMatches,
      };
    });

  const by = (s: GroupState) => groups.filter((g) => g.state === s).length;
  return {
    groups,
    done: by('done'),
    running: by('running'),
    attention: by('attention'),
    notStarted: by('not_started'),
    ageCheckGroups: groups.filter((g) => g.state === 'attention').map((g) => g.groupNo),
  };
}

// ── 본선 상태 ───────────────────────────────────────────────────────────────

export interface ControlKnockout {
  /** 경기이사가 본선 경로를 확정했는가. */
  pathLocked: boolean;
  /** 예선 결과를 기다리는 자리 수 · 반영된 자리 수(서버 검증 요약 그대로). */
  qualifiers: number;
  resolved: number;
  /** 본선 경기가 만들어졌는가. */
  matchesReady: boolean;
  matchesTotal: number;
  matchesCompleted: number;
  /** 우승이 확정됐는가(저장된 우승 자리에 팀이 올라왔을 때만 true). */
  championDecided: boolean;
}

/**
 * 본선 상태.
 *   ⚠ 대진 구조를 그리지 않는다. '어디까지 준비됐는가'만 본다.
 *   ⚠ '현재 라운드'는 저장된 값이 아니라 해석이 필요하므로 이 단계에서 만들지 않는다.
 */
export function deriveKnockout(bracket: AdminBracket | null): ControlKnockout | null {
  if (!bracket || !bracket.bracket) return null;

  const summary = bracket.validation?.summary ?? null;
  const champion = bracket.rounds.find((r) => r.isFinalSlot);
  const championSlot = champion
    ? bracket.slots.find((s) => s.roundNo === champion.roundNo)
    : undefined;

  return {
    pathLocked: bracket.bracket.status === 'locked' || bracket.bracket.status === 'completed',
    qualifiers: summary ? summary.qualifiers : 0,
    resolved: summary ? summary.resolved : 0,
    matchesReady: bracket.matches.length > 0,
    matchesTotal: bracket.matches.length,
    matchesCompleted: bracket.matches.filter((m) => m.status === 'completed').length,
    championDecided: !!championSlot && championSlot.teamNo !== null,
  };
}
