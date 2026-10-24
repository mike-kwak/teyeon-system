// Control Center 읽기 모델 (Batch 4F-1) — **순수 함수만** 둔다.
//
//   관제 화면이 보여 줄 숫자·상태를 한 곳에서 만든다. 화면 component 안에 계산을 흩지 않는다.
//   ⚠ React · DOM · 서버 의존이 없다. 단독으로 검증할 수 있다.
//   ⚠ 새로운 사실을 만들지 않는다 — 전부 기존 운영 RPC 응답에서 파생한다.
//     · 경기 상태 뜻은 기존 그대로다(대기 · 호명 · 진행 중 · 완료 · 취소).
//     · 카운트 기준도 기존 경기 운영 화면과 같다(전체 = 취소 포함, 호명은 따로 센다).
//     · 코트의 '다음 경기'는 조 일정에 저장된 배정으로 **추천만** 한다(deriveCourtSuggestions — 투입은 운영자).
//       순위를 다시 계산하지 않는다.
//   ⚠ 코트 수 · 조 수 · 진출 수를 숫자로 박지 않는다. 전부 서버가 준 값에서 센다.

import type { MatchBoard, MatchStatus, TournamentMatch } from '@/lib/tournaments/matchTypes';
import type { PreliminaryStandings } from '@/lib/tournaments/standingsTypes';
import type { AdminBracket } from '@/lib/tournaments/bracketTypes';
import { placementPublicNo, PLACEMENT_NAME } from '@/lib/tournaments/publicGroupNo';

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
  /** 저장된 경기 version 그대로. 여기서 만들지 않는다 — 조작은 이 값을 그대로 되돌려 보낸다. */
  version: number;
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
          version: m.version,
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

// ── 지금 진행 중 · 대기 경기 ────────────────────────────────────────────────

/**
 * 관제 목록에 쓰는 경기 한 줄.
 *   ⚠ 진행 중 경기의 점수는 담지 않는다 — 이 시스템은 점수를 경기 완료 때 한 번 받는다.
 */
export interface ControlMatchRow {
  matchId: string;
  matchNo: number;
  stage: TournamentMatch['stage'];
  status: MatchStatus;
  groupNo: number | null;
  courtNo: number | null;
  /**
   * 저장된 경기 version 그대로.
   *   ⚠ 여기서 계산하지 않는다. 조작(호명 · 투입 · 완료)은 이 값을 expectedVersion 으로 되돌려 보낸다.
   */
  version: number;
  /** 본선이면 저장된 라운드 이름('16강'). 없으면 null — 번호로 추측하지 않는다. */
  roundName: string | null;
  /**
   * 이 경기 승자가 우승 자리로 바로 올라가는가(= 결승인가).
   *   ⚠ 저장된 대진 구조로만 판정한다(승자가 올라갈 라운드 == 우승 자리 라운드).
   *     경기 번호 · 라운드 이름으로 추측하지 않는다.
   *   ⚠ 이것은 확인 문구를 고르기 위한 표시용이다. 실제 본선 종료는 서버 응답이 정한다.
   */
  isFinal: boolean;
  team1: ControlCourtTeam;
  team2: ControlCourtTeam;
  /**
   * 예선 · 순위결정전의 예정 코트 · 차수(조 일정에 저장된 값) — 안내 표시 전용.
   *   ⚠ 실제 코트(courtNo)와 다르다. 투입 가능 여부 · 코트 선택에 쓰지 않는다(자동 배정 없음).
   *   일정이 없거나 본선이면 null.
   */
  planned?: { courtNo: number | null; sessionNo: number | null } | null;
  /**
   * 순위결정전의 참가자 화면 표기('1조 순위결정전'). 내부 group_no(19)는 쓰지 않는다. 그 밖에는 null.
   */
  publicLabel?: string | null;
  /** 경기 시각(서버 ISO) — 타이머 표시 전용. 경기 운영 판정에 쓰지 않는다. 없으면 null. */
  startedAt?: string | null;
  playStartedAt?: string | null;
  completedAt?: string | null;
}

/** 본선 경기 번호 → 저장된 라운드 이름. 저장된 값이 없으면 담지 않는다. */
export function knockoutRoundNames(bracket: AdminBracket | null): Map<number, string> {
  const m = new Map<number, string>();
  (bracket?.matches ?? []).forEach((k) => {
    if (k.roundName) m.set(k.matchNo, k.roundName);
  });
  return m;
}

/**
 * 결승 경기 번호.
 *   저장된 라운드 중 우승 자리(isFinalSlot)를 찾고, 승자가 그 라운드로 올라가는 경기만 담는다.
 *   ⚠ 우승 자리가 없으면 빈 집합이다(추측해서 채우지 않는다).
 */
export function knockoutFinalMatchNos(bracket: AdminBracket | null): Set<number> {
  const s = new Set<number>();
  const finalRound = (bracket?.rounds ?? []).find((r) => r.isFinalSlot);
  if (!finalRound) return s;
  (bracket?.matches ?? []).forEach((k) => {
    if (k.targetRoundNo === finalRound.roundNo) s.add(k.matchNo);
  });
  return s;
}

/** 조 일정 한 줄(관리자 일정 조회 응답에서 필요한 값만). */
export interface ControlPlannedGroup { groupNo: number; plannedCourtNo: number | null; sessionNo: number | null }

/**
 * 대기 · 진행 줄에 붙일 표시 정보 — 예정 코트 · 차수, 순위결정전 공개 표기.
 *   ⚠ 표시 전용. 경기 상태 · 조작 · 코트 판정에 쓰지 않는다.
 */
export interface ControlRowContext {
  planned: Map<number, { courtNo: number | null; sessionNo: number | null }>;
  /** 순위결정전 공개 표기('1조 순위결정전'). 정할 수 없으면 '순위결정전'. */
  placementLabel: string;
}

export function deriveRowContext(board: MatchBoard | null, schedule: ControlPlannedGroup[] | null): ControlRowContext {
  const planned = new Map<number, { courtNo: number | null; sessionNo: number | null }>();
  (schedule ?? []).forEach((g) => {
    if (g.plannedCourtNo !== null || g.sessionNo !== null) planned.set(g.groupNo, { courtNo: g.plannedCourtNo, sessionNo: g.sessionNo });
  });
  // 공개 조 번호 규칙과 같은 helper — 일반 예선 조 번호만 보고 정한다(2 ~ 18조 → 순위결정전 = 1조).
  const prelimNos = [...new Set((board?.matches ?? [])
    .filter((m) => m.stage === 'preliminary' && m.groupNo !== null).map((m) => m.groupNo as number))];
  const no = prelimNos.length ? placementPublicNo(prelimNos) : null;
  return { planned, placementLabel: no === null ? PLACEMENT_NAME : `${no}조 ${PLACEMENT_NAME}` };
}

const rowOf = (
  m: TournamentMatch, rounds: Map<number, string>, finals: Set<number>, ctx: ControlRowContext | null = null,
): ControlMatchRow => ({
  matchId: m.matchId,
  matchNo: m.matchNo,
  stage: m.stage,
  status: m.status,
  groupNo: m.groupNo,
  courtNo: m.courtNo,
  version: m.version,
  roundName: m.stage === 'knockout' ? (rounds.get(m.matchNo) ?? null) : null,
  isFinal: m.stage === 'knockout' && finals.has(m.matchNo),
  team1: teamOf(m.team1),
  team2: teamOf(m.team2),
  planned: m.stage !== 'knockout' && m.groupNo !== null ? (ctx?.planned.get(m.groupNo) ?? null) : null,
  publicLabel: m.stage === 'placement' ? (ctx?.placementLabel ?? null) : null,
  startedAt: m.startedAt ?? null,
  playStartedAt: m.playStartedAt ?? null,
  completedAt: m.completedAt ?? null,
});

/**
 * 목록에 담을 경기 단계.
 *   'preliminary' = 예선 + 순위결정전 · 'knockout' = 본선 · 'all' = 전부.
 *   ⚠ 예선과 본선(64강 선행 경기)은 같은 코트에서 동시에 돌 수 있다 — 진행 중 · 대기 목록은 화면 단계(phase)로 거르지 않는다.
 */
export type ControlStageFilter = ControlSummary['stage'] | 'all';

/** 고른 단계의 경기만(요약과 같은 기준, 'all' 이면 전부). */
const stageMatches = (board: MatchBoard | null, stage: ControlStageFilter): TournamentMatch[] =>
  (board?.matches ?? []).filter((m) => (
    stage === 'all' ? true : stage === 'knockout' ? m.stage === 'knockout' : m.stage !== 'knockout'
  ));

/**
 * 지금 진행 중인 경기.
 *   코트 번호 순으로 둔다 — 운영자가 코트를 보고 읽기 때문이다.
 *   ⚠ 정렬은 저장된 값(코트 번호 · 경기 번호)만 쓴다. 우선순위를 만들어 내지 않는다.
 *   ⚠ 코트가 없는 진행 중 경기는 있을 수 없지만(서버가 코트를 함께 기록한다),
 *     들어오더라도 버리지 않고 뒤에 붙인다.
 */
export function derivePlaying(
  board: MatchBoard | null,
  stage: ControlStageFilter,
  bracket: AdminBracket | null = null,
  ctx: ControlRowContext | null = null,
): ControlMatchRow[] {
  const rounds = knockoutRoundNames(bracket);
  const finals = knockoutFinalMatchNos(bracket);
  return stageMatches(board, stage)
    .filter((m) => m.status === 'playing')
    .map((m) => rowOf(m, rounds, finals, ctx))
    .sort((a, b) => {
      const ac = a.courtNo ?? Number.MAX_SAFE_INTEGER;
      const bc = b.courtNo ?? Number.MAX_SAFE_INTEGER;
      return (ac - bc) || (a.matchNo - b.matchNo);
    });
}

export interface ControlWaiting {
  /** 화면에 그릴 줄(표시 개수 제한 적용). */
  rows: ControlMatchRow[];
  /** 대기 전체 수(호명 포함). 제한과 무관하게 항상 실제 값이다. */
  total: number;
  calling: number;
  waiting: number;
  /** 화면에 못 그린 나머지 수. */
  hidden: number;
}

/**
 * 대기 중인 경기(호명 포함).
 *   ⚠ 이것은 '다음에 할 경기' 추천 목록이 아니다. 시스템은 다음 경기를 고르지 않는다.
 *     운영자가 보고 직접 정한다.
 *   ⚠ 호명은 대기와 다른 상태다. 같은 목록 안에서 상태로 구분하고,
 *     이미 호명한 경기를 먼저 둔다(순서를 매기는 것이 아니라 상태별로 묶는 것이다).
 *   ⚠ 그 안의 순서는 저장된 경기 번호 그대로다.
 */
export function deriveWaiting(
  board: MatchBoard | null,
  stage: ControlStageFilter,
  limit: number,
  bracket: AdminBracket | null = null,
  ctx: ControlRowContext | null = null,
): ControlWaiting {
  const rounds = knockoutRoundNames(bracket);
  const finals = knockoutFinalMatchNos(bracket);
  const all = stageMatches(board, stage)
    .filter((m) => m.status === 'waiting' || m.status === 'calling')
    .map((m) => rowOf(m, rounds, finals, ctx))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'calling' ? -1 : 1;
      return a.matchNo - b.matchNo;
    });

  const rows = limit > 0 ? all.slice(0, limit) : all;
  const calling = all.filter((m) => m.status === 'calling').length;
  return {
    rows,
    total: all.length,
    calling,
    waiting: all.length - calling,
    hidden: Math.max(0, all.length - rows.length),
  };
}

// ── 코트별 다음 경기 추천 (표시 전용) ───────────────────────────────────────
//
//   빈 코트에 '이 코트에 배정된 조의 다음 경기' 를 보여 준다. **추천은 표시일 뿐이다.**
//   ⚠ 투입 · 호명 · 시작을 하지 않는다. 운영자가 [추천 경기 투입] → [이 코트에 투입] 을 직접 누른다(기존 확인 · RPC 그대로).
//   ⚠ 배정은 조 일정(get_admin_group_schedule)에 저장된 예정 코트 · 차수만 쓴다. 배정표를 따로 박지 않는다.
//     저장값이 비었거나 어긋나면 고쳐 쓰지 않고 경고로 보여 준다(그 조는 추천에서 빠진다).
//   ⚠ 순서: ① 그 코트의 조 ② 1차 → 2차(1차 경기가 남아 있으면 2차를 추천하지 않는다) ③ 조 안 경기 순서
//     ④ 두 팀 체크인 완료 우선(같은 순서끼리일 때만) ⑤ 다른 코트에서 진행 중인 팀이 있는 경기는 뺀다.
//   ⚠ 시각 조건(09:20 등)으로 2차를 막거나 열지 않는다 — 2차 투입 시점은 운영자가 정한다.

/** 추천 한 칸에 붙이는 팀 체크인 상태. 체크인 정보를 모르면 null. */
export type SuggestCheckin = 'both' | 'partial' | null;

export type ControlCourtSuggestion =
  /** 추천 경기가 있다. */
  | { courtNo: number; kind: 'match'; match: ControlMatchRow; sessionNo: number | null; checkin: SuggestCheckin; uncheckedTeamNos: number[] }
  /** 배정된 경기가 남아 있지만 지금은 넣을 수 없다(그 조 경기가 다른 코트에서 진행 중 등). */
  | { courtNo: number; kind: 'hold'; message: string }
  /** 이 코트에 배정된 경기가 모두 끝났다(또는 배정된 조가 없다). */
  | { courtNo: number; kind: 'none'; message: string }
  /** 조 일정을 읽지 못했다 — 추천하지 않는다. */
  | { courtNo: number; kind: 'unknown'; message: string };

export interface ControlSuggestions {
  /** 코트 번호 → 추천. 사용 중인 코트(active)만 담는다. */
  byCourt: Map<number, ControlCourtSuggestion>;
  /** 배정 데이터 경고(고치지 않고 보여 준다). 정상이면 빈 배열. */
  warnings: string[];
}

const SESSION_WORD = (s: number | null): string => (s === 1 ? '1차' : s === 2 ? '2차' : '차수 미정');

/**
 * 코트별 다음 경기 추천.
 *   @param schedule  조 일정(예정 코트 · 차수). null = 아직 못 읽음 · 읽기 실패 → 'unknown'.
 *   @param checkin   팀 번호 → 체크인. null = 모름(체크인 우선 판단 없이 경기 순서만 쓴다).
 *   ⚠ 본선 경기는 다루지 않는다(예선 · 순위결정전만).
 */
export function deriveCourtSuggestions(
  board: MatchBoard | null,
  schedule: ControlPlannedGroup[] | null,
  checkin: ReadonlyMap<number, { checkedIn: boolean; status: string }> | null,
  ctx: ControlRowContext | null = null,
  /** NEXT UP 으로 대기 지정된 경기 → 그 코트. 다른 코트의 추천에서 뺀다(대기 코트 고정). */
  reserved: ReadonlyMap<string, number> | null = null,
): ControlSuggestions {
  const byCourt = new Map<number, ControlCourtSuggestion>();
  const warnings: string[] = [];
  if (!board) return { byCourt, warnings };
  const courts = [...board.courts].sort((a, b) => a.courtNo - b.courtNo);
  const active = courts.filter((c) => c.status === 'active');

  if (!schedule) {
    active.forEach((c) => byCourt.set(c.courtNo, { courtNo: c.courtNo, kind: 'unknown', message: '조 일정을 불러오지 못해 추천하지 않습니다.' }));
    return { byCourt, warnings };
  }

  const prelim = board.matches.filter((m) => m.stage !== 'knockout' && m.groupNo !== null);
  const label = (g: number) => {
    const m = prelim.find((x) => x.groupNo === g);
    return m?.stage === 'placement' ? (ctx?.placementLabel ?? PLACEMENT_NAME) : `${g}조`;
  };
  const plan = new Map(schedule.map((g) => [g.groupNo, g] as const));
  const groupNos = [...new Set(prelim.map((m) => m.groupNo as number))].sort((a, b) => a - b);
  const courtNos = new Set(courts.map((c) => c.courtNo));

  // 배정 데이터 점검 — 고쳐 쓰지 않는다. 문제 있는 조는 추천에서 빠진다.
  const usable = new Set<number>();
  groupNos.forEach((g) => {
    const p = plan.get(g);
    if (!p || p.plannedCourtNo === null || p.sessionNo === null) {
      warnings.push(`${label(g)}: 예정 코트 또는 차수가 지정되지 않아 추천에서 빠졌습니다.`);
      return;
    }
    if (!courtNos.has(p.plannedCourtNo)) {
      warnings.push(`${label(g)}: 예정 ${p.plannedCourtNo}번 코트가 코트 목록에 없어 추천에서 빠졌습니다.`);
      return;
    }
    usable.add(g);
  });
  const perSlot = new Map<string, number[]>();
  usable.forEach((g) => {
    const p = plan.get(g)!;
    const k = `${p.plannedCourtNo}:${p.sessionNo}`;
    perSlot.set(k, [...(perSlot.get(k) ?? []), g]);
  });
  perSlot.forEach((gs, k) => {
    if (gs.length < 2) return;
    const [c, s] = k.split(':').map(Number);
    warnings.push(`${c}번 코트 ${SESSION_WORD(s)}에 ${gs.map(label).join(' · ')} 가 함께 지정되어 있습니다. 조 일정을 확인해 주세요.`);
  });

  // 지금 진행 중인 팀(본선 포함) — 이 팀이 들어간 경기는 추천하지 않는다.
  const busyTeams = new Set<number>();
  board.matches.filter((m) => m.status === 'playing').forEach((m) => { busyTeams.add(m.team1.teamNo); busyTeams.add(m.team2.teamNo); });
  const rounds = new Map<number, string>();
  const finals = new Set<number>();
  const checkedBoth = (m: TournamentMatch): SuggestCheckin => {
    if (!checkin) return null;
    const u = [m.team1.teamNo, m.team2.teamNo].filter((n) => { const v = checkin.get(n); return v !== undefined && v.status === 'active' && !v.checkedIn; });
    return u.length === 0 ? 'both' : 'partial';
  };

  courts.forEach((c) => {
    const mine = [...usable].filter((g) => plan.get(g)!.plannedCourtNo === c.courtNo);
    const left = prelim.filter((m) => mine.includes(m.groupNo as number) && (m.status === 'waiting' || m.status === 'calling' || m.status === 'playing'));
    if (c.status !== 'active') {
      if (left.length > 0) warnings.push(`${c.courtNo}번 코트가 사용 중지 상태인데 배정 경기 ${left.length}개가 남아 있습니다.`);
      return;
    }
    if (left.length === 0) {
      byCourt.set(c.courtNo, { courtNo: c.courtNo, kind: 'none', message: '배정 경기 없음' });
      return;
    }
    // 가장 앞 차수(1차 → 2차)만 본다 — 앞 차수 경기가 하나라도 남아 있으면 다음 차수를 추천하지 않는다.
    const sessionOf = (m: TournamentMatch) => plan.get(m.groupNo as number)!.sessionNo as number;
    const head = Math.min(...left.map(sessionOf));
    const cur = left.filter((m) => sessionOf(m) === head);
    const elsewhere = (m: TournamentMatch) => { const r = reserved?.get(m.matchId); return r !== undefined && r !== c.courtNo; };
    const candidates = cur
      .filter((m) => m.status !== 'playing' && !elsewhere(m) && !busyTeams.has(m.team1.teamNo) && !busyTeams.has(m.team2.teamNo))
      .sort((a, b) => (a.sequenceNo - b.sequenceNo)
        || ((checkedBoth(a) === 'partial' ? 1 : 0) - (checkedBoth(b) === 'partial' ? 1 : 0))
        || ((a.groupNo as number) - (b.groupNo as number))
        || (a.matchNo - b.matchNo));
    const pickM = candidates[0];
    if (!pickM && cur.some((m) => m.status !== 'playing' && elsewhere(m))) {
      const moved = cur.filter((m) => m.status !== 'playing' && elsewhere(m)).map((m) => `M${m.matchNo} → ${reserved!.get(m.matchId)}번`).join(' · ');
      byCourt.set(c.courtNo, { courtNo: c.courtNo, kind: 'hold', message: `남은 경기가 다른 코트 대기로 지정되어 있습니다(${moved}).` });
      return;
    }
    if (!pickM) {
      const playingHere = cur.filter((m) => m.status === 'playing');
      const blocked = cur.filter((m) => m.status !== 'playing');
      const where = playingHere.map((m) => `M${m.matchNo}${m.courtNo !== null ? ` ${m.courtNo}번 코트` : ''}`).join(' · ');
      byCourt.set(c.courtNo, {
        courtNo: c.courtNo, kind: 'hold',
        message: blocked.length > 0
          ? `${[...new Set(cur.map((m) => m.groupNo as number))].map(label).join(' · ')} 다음 경기 팀이 다른 코트에서 경기 중입니다${where ? `(${where})` : ''}.`
          : `${SESSION_WORD(head)} ${[...new Set(cur.map((m) => m.groupNo as number))].map(label).join(' · ')} 경기 진행 중${where ? `(${where})` : ''} — 끝나면 다음 차수를 추천합니다.`,
      });
      return;
    }
    const row = rowOf(pickM, rounds, finals, ctx);
    const u = checkin ? [pickM.team1.teamNo, pickM.team2.teamNo].filter((n) => { const v = checkin.get(n); return v !== undefined && v.status === 'active' && !v.checkedIn; }) : [];
    byCourt.set(c.courtNo, { courtNo: c.courtNo, kind: 'match', match: row, sessionNo: head, checkin: checkedBoth(pickM), uncheckedTeamNos: u });
  });

  return { byCourt, warnings };
}

// ── 코트 NEXT UP(대기 코트 지정) 판정 ──────────────────────────────────────
//
//   지정 자체는 useCourtNextUp(이 브라우저 저장)이 들고 있다. 여기서는 최신 경기 데이터로 '지금 유효한가' 만 본다.
//   ⚠ 무효여도 지우지 않는다 — 표시하고, 해제는 운영자가 한다.

export type ControlNextUp =
  /** 대기 중(대기 · 호명) — busyTeams 가 비어 있고 코트가 비면 투입할 수 있다. */
  | { courtNo: number; kind: 'ready'; matchId: string; match: ControlMatchRow; busyTeams: number[]; uncheckedTeamNos: number[] | null }
  /** 더는 대기 경기가 아니다(완료 · 취소 · 다른 코트에서 진행 · 찾을 수 없음). */
  | { courtNo: number; kind: 'invalid'; matchId: string; matchNo: number; match: ControlMatchRow | null; message: string };

export function deriveNextUps(
  entries: ReadonlyArray<{ courtNo: number; matchId: string; matchNo: number }>,
  board: MatchBoard | null,
  checkin: ReadonlyMap<number, { checkedIn: boolean; status: string }> | null,
  ctx: ControlRowContext | null = null,
): Map<number, ControlNextUp> {
  const out = new Map<number, ControlNextUp>();
  if (!board) return out;
  const rounds = new Map<number, string>(); const finals = new Set<number>();
  entries.forEach((e) => {
    const m = latestOf(board, e.matchId);
    if (!m) { out.set(e.courtNo, { courtNo: e.courtNo, kind: 'invalid', matchId: e.matchId, matchNo: e.matchNo, match: null, message: `M${e.matchNo} 경기를 찾을 수 없습니다.` }); return; }
    const row = rowOf(m, rounds, finals, ctx);
    if (m.status === 'waiting' || m.status === 'calling') {
      const busy = board.matches
        .filter((x) => x.status === 'playing' && x.matchId !== m.matchId)
        .flatMap((x) => [x.team1.teamNo, x.team2.teamNo])
        .filter((n) => n === m.team1.teamNo || n === m.team2.teamNo);
      const unchecked = checkin ? [m.team1.teamNo, m.team2.teamNo].filter((n) => { const v = checkin.get(n); return v !== undefined && v.status === 'active' && !v.checkedIn; }) : null;
      out.set(e.courtNo, { courtNo: e.courtNo, kind: 'ready', matchId: e.matchId, match: row, busyTeams: [...new Set(busy)], uncheckedTeamNos: unchecked });
      return;
    }
    const message = m.status === 'playing'
      ? (m.courtNo === e.courtNo ? `M${m.matchNo} 은(는) 이미 이 코트에서 진행 중입니다.` : `M${m.matchNo} 은(는) ${m.courtNo ?? '?'}번 코트에서 진행 중입니다.`)
      : `M${m.matchNo} 은(는) 이미 ${STATUS_WORD[m.status]}되었습니다.`;
    out.set(e.courtNo, { courtNo: e.courtNo, kind: 'invalid', matchId: e.matchId, matchNo: m.matchNo, match: row, message });
  });
  return out;
}

/**
 * 이 경기를 이 코트 대기로 지정할 수 있는가. 막히면 이유, 아니면 null.
 *   · 대기 · 호명 경기만
 *   · 순위결정전(M52)은 조 일정의 예정 코트(운영 3번)에만 — 예정 코트를 모르면 막는다(추측하지 않는다).
 */
export function nextUpAssignBlock(
  m: Pick<ControlMatchRow, 'status' | 'stage' | 'matchNo' | 'planned' | 'publicLabel'>,
  courtNo: number,
): string | null {
  if (m.status !== 'waiting' && m.status !== 'calling') return `M${m.matchNo} 은(는) 대기 경기가 아닙니다.`;
  if (m.stage === 'placement') {
    const pc = m.planned?.courtNo ?? null;
    if (pc === null) return `${m.publicLabel ?? PLACEMENT_NAME}의 예정 코트를 알 수 없어 대기 지정할 수 없습니다.`;
    if (pc !== courtNo) return `${m.publicLabel ?? PLACEMENT_NAME}(M${m.matchNo})은(는) ${pc}번 코트에만 대기 지정할 수 있습니다.`;
  }
  return null;
}

/** 대기 지정 후보 — 대기 · 호명 경기 전부(단계 무관), 경기 번호 순. */
export function deriveAssignable(board: MatchBoard | null, bracket: AdminBracket | null = null, ctx: ControlRowContext | null = null): ControlMatchRow[] {
  const rounds = knockoutRoundNames(bracket); const finals = knockoutFinalMatchNos(bracket);
  return (board?.matches ?? [])
    .filter((m) => m.status === 'waiting' || m.status === 'calling')
    .map((m) => rowOf(m, rounds, finals, ctx))
    .sort((a, b) => a.matchNo - b.matchNo);
}

// ── NEXT UP 스마트 추천 (표시 전용) ─────────────────────────────────────────
//
//   [다음 경기 지정] 창에서 '이 코트 대기로 지정하기 좋은 경기' 를 최대 3개 보여 준다. 운영 안정성 우선:
//   ① 이 코트 조 일정 먼저. 다른 코트 경기 당겨오기는 이 코트에 지정할 일정 경기가 하나도 없을 때만(보조 수단).
//   ② 추천 제외 — 다른 코트에서 경기 중인 팀 · 조 순서 위반(같은 조 앞 경기 대기) · 코트 제한(순위결정전) ·
//      다른 코트 NEXT UP · 이 코트 앞 차수 경기 남음 · 비어 있는 다른 코트의 다음 경기.
//   ③ 체크인 미완료 · 체크인 정보 없음은 '확인 필요' 로 안전 후보 뒤에 둔다.
//   ⚠ 종료 시각을 예측하지 않는다. 남은 경기 수 · 코트 상태 · 체크인 · 조 순서처럼 저장된 값만 쓴다.
//   ⚠ 표시 전용 — 지정 · 투입 · 호명을 하지 않는다. 3개를 억지로 채우지 않는다. 본선 경기는 추천하지 않는다(수동 선택).

export interface NextUpRecItem {
  match: ControlMatchRow;
  /** safe = 바로 지정해도 되는 후보 · check = 현장 확인 필요. */
  tier: 'safe' | 'check';
  /** own = 이 코트 조 일정 · pull = 다른 코트 경기 당겨오기. */
  source: 'own' | 'pull';
  reason: string;
}
export interface NextUpRecommendation {
  items: NextUpRecItem[];
  /** 추천하지 않은 경기와 짧은 이유(이 코트 일정 경기 먼저). */
  excluded: { matchNo: number; reason: string }[];
  /** 추천을 만들지 못한 이유(일정 · 경기 정보 없음, 사용 중지 코트). 정상이면 null. */
  note: string | null;
}

export const NEXT_UP_REC_LIMIT = 3;

export function deriveNextUpRecommendations(
  board: MatchBoard | null,
  schedule: ControlPlannedGroup[] | null,
  checkin: ReadonlyMap<number, { checkedIn: boolean; status: string }> | null,
  ctx: ControlRowContext | null,
  reserved: ReadonlyMap<string, number> | null,
  courtNo: number,
  /** 보여 줄 후보 수. 지정 직전 재확인은 순위가 밀린 후보도 찾도록 제한 없이 부른다. */
  limit = NEXT_UP_REC_LIMIT,
): NextUpRecommendation {
  const none = (note: string): NextUpRecommendation => ({ items: [], excluded: [], note });
  if (!board) return none('경기 정보를 불러오는 중입니다.');
  if (!schedule) return none('조 일정을 불러오지 못해 추천하지 않습니다. 아래에서 직접 골라 주세요.');
  const court = board.courts.find((c) => c.courtNo === courtNo);
  if (!court || court.status !== 'active') return none('사용 중인 코트가 아니어서 추천하지 않습니다.');

  const courtNos = new Set(board.courts.map((c) => c.courtNo));
  const plan = new Map<number, { courtNo: number; sessionNo: number }>();
  schedule.forEach((g) => {
    if (g.plannedCourtNo !== null && g.sessionNo !== null && courtNos.has(g.plannedCourtNo)) plan.set(g.groupNo, { courtNo: g.plannedCourtNo, sessionNo: g.sessionNo });
  });
  // 경기 중인 팀 → 그 코트
  const busyAt = new Map<number, number | null>();
  board.matches.filter((m) => m.status === 'playing').forEach((m) => { busyAt.set(m.team1.teamNo, m.courtNo); busyAt.set(m.team2.teamNo, m.courtNo); });
  const isOpen = (m: TournamentMatch) => m.status === 'waiting' || m.status === 'calling';
  const open = board.matches.filter((m) => m.stage !== 'knockout' && m.groupNo !== null && isOpen(m));
  // 조마다 가장 앞 순서의 대기 경기(조 순서)
  const head = new Map<number, TournamentMatch>();
  open.forEach((m) => { const h = head.get(m.groupNo as number); if (!h || m.sequenceNo < h.sequenceNo || (m.sequenceNo === h.sequenceNo && m.matchNo < h.matchNo)) head.set(m.groupNo as number, m); });
  const elsewhere = (m: TournamentMatch) => { const r = reserved?.get(m.matchId); return r !== undefined && r !== courtNo ? r : null; };
  // 코트별 남은(대기 · 호명) 일정 경기 수 — 다른 코트 NEXT UP 으로 빠진 경기는 세지 않는다.
  const load = new Map<number, number>();
  open.forEach((m) => { const p = plan.get(m.groupNo as number); if (p && elsewhere(m) === null) load.set(p.courtNo, (load.get(p.courtNo) ?? 0) + 1); });
  // 비어 있는 다른 코트가 지금 받을 다음 경기 — 당겨오지 않는다.
  const sugg = deriveCourtSuggestions(board, schedule, checkin, ctx, reserved).byCourt;
  const emptyCourts = new Set(board.courts.filter((c) => c.status === 'active' && !board.matches.some((m) => m.status === 'playing' && m.courtNo === c.courtNo)).map((c) => c.courtNo));
  const rounds = new Map<number, string>(); const finals = new Set<number>();
  const unchecked = (m: TournamentMatch) => (checkin ? [m.team1.teamNo, m.team2.teamNo].filter((n) => { const v = checkin.get(n); return v !== undefined && v.status === 'active' && !v.checkedIn; }) : null);
  const teamNo = (n: number) => `TEAM ${String(n).padStart(2, '0')}`;

  /** 공통 제외 판정 — 막히면 짧은 이유. */
  const blockOf = (m: TournamentMatch, row: ControlMatchRow): string | null => {
    if (reserved?.get(m.matchId) === courtNo) return '이미 이 코트 NEXT UP';
    const r = elsewhere(m); if (r !== null) return `${r}번 코트 NEXT UP`;
    const b = nextUpAssignBlock(row, courtNo); if (b) return m.stage === 'placement' ? `${row.planned?.courtNo ?? '?'}번 코트 전용` : '지정 불가';
    const h = head.get(m.groupNo as number); if (h && h.matchId !== m.matchId) return `조 순서 — M${h.matchNo} 먼저`;
    const busy = [m.team1.teamNo, m.team2.teamNo].filter((n) => busyAt.has(n) && busyAt.get(n) !== courtNo);
    if (busy.length) return `${busy.map(teamNo).join(' · ')} ${busyAt.get(busy[0]) ?? '?'}번 코트 경기 중`;
    return null;
  };
  const consecutive = (m: TournamentMatch) => [m.team1.teamNo, m.team2.teamNo].filter((n) => busyAt.get(n) === courtNo);
  const checkText = (u: number[] | null) => (u === null ? '체크인 정보 없음 — 확인 필요' : `${u.map(teamNo).join(' · ')} 체크인 미완료 — 확인 필요`);
  const order = (a: TournamentMatch, b: TournamentMatch) => ((plan.get(a.groupNo as number)!.sessionNo - plan.get(b.groupNo as number)!.sessionNo)
    || (a.sequenceNo - b.sequenceNo) || ((a.groupNo as number) - (b.groupNo as number)) || (a.matchNo - b.matchNo));

  // 제외 이유 — 운영자에게 중요한 순서로 보여 준다(이 코트 일정 → 다른 코트 NEXT UP → 코트 제한 → 경기 중 → 그 밖).
  const excluded: { matchNo: number; reason: string; rank: number }[] = [];
  const rankOf = (own: boolean, why: string) => (own ? 0 : /NEXT UP/.test(why) ? 1 : /전용/.test(why) ? 2 : /경기 중/.test(why) ? 3 : 4);
  const items: NextUpRecItem[] = [];

  // ① 이 코트 조 일정
  const own = open.filter((m) => plan.get(m.groupNo as number)?.courtNo === courtNo).sort(order);
  const ownHeadSession = own.length ? Math.min(...own.map((m) => plan.get(m.groupNo as number)!.sessionNo)) : null;
  const ownOk: NextUpRecItem[] = [];
  own.forEach((m) => {
    const row = rowOf(m, rounds, finals, ctx);
    const s = plan.get(m.groupNo as number)!.sessionNo;
    const blocked = blockOf(m, row) ?? (ownHeadSession !== null && s > ownHeadSession ? `이 코트 ${SESSION_WORD(ownHeadSession)} 경기 남음` : null);
    if (blocked) { excluded.push({ matchNo: m.matchNo, reason: blocked, rank: rankOf(true, blocked) }); return; }
    const u = unchecked(m); const c = consecutive(m);
    const tier = u === null || u.length > 0 ? 'check' : 'safe';
    const base = emptyCourts.has(courtNo) ? '이 코트 일정' : '이 코트 일정 다음 경기 · 현재 경기 후 투입';
    const reason = tier === 'check' ? `${base} · ${checkText(u)}`
      : `${base}${c.length ? ` · ${c.map(teamNo).join(' · ')} 연속 출전` : emptyCourts.has(courtNo) ? ' · 양 팀 준비 완료 · 바로 투입 가능' : ' · 양 팀 준비 완료'}`;
    ownOk.push({ match: row, tier, source: 'own', reason });
  });

  // ② 다른 코트 경기 당겨오기 — 이 코트에 지정할 일정 경기가 없을 때만
  const pullOk: NextUpRecItem[] = [];
  if (ownOk.length === 0) {
    const fromCourt = new Set<number>();
    open.filter((m) => { const p = plan.get(m.groupNo as number); return p !== undefined && p.courtNo !== courtNo; })
      .sort((a, b) => ((load.get(plan.get(b.groupNo as number)!.courtNo) ?? 0) - (load.get(plan.get(a.groupNo as number)!.courtNo) ?? 0)) || order(a, b))
      .forEach((m) => {
        const row = rowOf(m, rounds, finals, ctx);
        const src = plan.get(m.groupNo as number)!.courtNo; const left = load.get(src) ?? 0;
        let blocked = blockOf(m, row);
        if (blocked?.startsWith('조 순서')) return; // 조 안 뒷경기 — 이유 목록을 채우지 않는다
        const sg = sugg.get(src);
        if (!blocked && emptyCourts.has(src) && sg?.kind === 'match' && sg.match.matchId === m.matchId) blocked = `${src}번 코트가 비어 있어 그 코트 다음 경기`;
        if (!blocked && left < 2) blocked = `${src}번 코트 잔여 ${left}경기 — 당겨올 부담 적음`;
        if (blocked) { excluded.push({ matchNo: m.matchNo, reason: blocked, rank: rankOf(false, blocked) }); return; }
        if (fromCourt.has(src)) return; // 코트 하나에서 하나만 — 여러 코트 부담을 고르게 본다
        fromCourt.add(src);
        const u = unchecked(m); const tier = u === null || u.length > 0 ? 'check' : 'safe';
        pullOk.push({ match: row, tier, source: 'pull',
          reason: tier === 'check' ? `${src}번 코트 잔여 ${left}경기 분산 · ${checkText(u)}` : `${src}번 코트 잔여 ${left}경기 부담 분산 · 양 팀 준비 완료` });
      });
  }
  // 안전 후보 먼저(이 코트 일정 → 당겨오기), 그다음 확인 필요.
  [...ownOk, ...pullOk].filter((x) => x.tier === 'safe').forEach((x) => items.push(x));
  [...ownOk, ...pullOk].filter((x) => x.tier === 'check').forEach((x) => items.push(x));
  const shownExcluded = excluded.map((x, i) => ({ ...x, i })).sort((a, b) => (a.rank - b.rank) || (a.i - b.i)).slice(0, 6)
    .map(({ matchNo, reason }) => ({ matchNo, reason }));
  return { items: items.slice(0, limit), excluded: shownExcluded, note: null };
}

// ── 확인 필요 ───────────────────────────────────────────────────────────────

export type AttentionSeverity = 'warning' | 'info';

export type AttentionCode =
  | 'age_check'
  | 'cancelled_matches'
  | 'bracket_not_locked'
  | 'qualifier_unresolved';

export interface AttentionItem {
  code: AttentionCode;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  /** 확인하러 갈 기존 화면. 조작 버튼이 아니라 이동 링크다. */
  link: { label: string; path: 'standings' | 'matches' | 'bracket' } | null;
}

/** 예선이 사실상 끝났는가 — 더 치를 조 경기가 남아 있지 않다. */
function preliminaryClosing(p: ControlPreliminary | null): boolean {
  if (!p || p.groups.length === 0) return false;
  return p.running === 0 && p.notStarted === 0;
}

/**
 * 사람이 확인하거나 움직여야 하는 것만 모은다.
 *   ⚠ DB · RPC 가 이미 막는 것(코트 중복 · 팀 중복 · 꺼진 코트 투입 · 잘못된 점수)은
 *     평상시 경고로 띄우지 않는다. 그건 서버가 거절할 때 그 자리에서 알리면 된다.
 *   ⚠ 아직 때가 되지 않은 것도 띄우지 않는다 — 예선이 한창인데 '본선 경로 미확정' 을
 *     계속 띄우면 경고가 소음이 된다.
 *   ⚠ 정상일 때는 빈 배열이다(화면에서 영역 자체가 사라진다).
 */
export function deriveAttention(input: {
  summary: ControlSummary;
  preliminary: ControlPreliminary | null;
  knockout: ControlKnockout | null;
  phase: ControlPhase;
}): AttentionItem[] {
  const { summary, preliminary, knockout, phase } = input;
  const items: AttentionItem[] = [];

  // 1) 조는 끝났는데 순위가 확정되지 않았다 — 언제 나와도 사람이 확인해야 한다.
  if (preliminary && preliminary.ageCheckGroups.length > 0) {
    items.push({
      code: 'age_check',
      severity: 'warning',
      title: `${preliminary.ageCheckGroups.map((n) => `${n}조`).join(' · ')} 합산연령 확인 필요`,
      detail: '예선 순위 확정 대기',
      link: { label: '예선 순위 확인', path: 'standings' },
    });
  }

  // 2) 취소 경기 — 잘못된 상태가 아니라 '확인해 둘 것'이다.
  if (summary.cancelled > 0) {
    items.push({
      code: 'cancelled_matches',
      severity: 'info',
      title: `취소 경기 ${summary.cancelled}건`,
      detail: '경기 운영 화면에서 확인',
      link: { label: '경기 운영 확인', path: 'matches' },
    });
  }

  // 3)·4) 본선 준비 — 예선이 끝나 본선 전환이 실제로 임박한 때만 알린다.
  const closing = preliminaryClosing(preliminary);
  if (knockout && closing && phase !== 'completed') {
    if (!knockout.pathLocked) {
      items.push({
        code: 'bracket_not_locked',
        severity: 'warning',
        title: '본선 경로가 아직 확정되지 않았습니다',
        detail: '예선이 끝나 본선 전환을 준비할 시점입니다',
        link: { label: '본선 대진 확인', path: 'bracket' },
      });
    } else if (knockout.qualifiers > knockout.resolved) {
      items.push({
        code: 'qualifier_unresolved',
        severity: 'warning',
        title: `예선 결과 반영 ${knockout.resolved} / ${knockout.qualifiers}`,
        detail: '본선 자리에 예선 결과를 반영해야 합니다',
        link: { label: '본선 대진 확인', path: 'bracket' },
      });
    }
  }

  return items;
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

// ── 조회 사이클 판정 (4F-4a) ────────────────────────────────────────────────

/** 한 번의 조회로 얻은 세 자료. 화면은 언제나 같은 사이클의 세 자료를 함께 쓴다. */
export interface ControlSnapshot {
  board: MatchBoard | null;
  standings: PreliminaryStandings | null;
  bracket: AdminBracket | null;
}

/**
 * 조회 실패의 종류 — 화면 문구와 재시도 방식이 다르다.
 *   · network : 연결 자체가 안 됐다(오프라인 · 망 전환 · 응답 없음)
 *   · auth    : 로그인 만료 · 권한 확인 실패(JWT 만료 · 42501)
 *   · server  : 그 밖의 서버 오류
 */
export type ControlFetchCause = 'network' | 'auth' | 'server';

export type ControlCycleOutcome =
  | { kind: 'ok'; snapshot: ControlSnapshot }
  /** 운영 권한이 없거나 대회를 못 찾음 — match board RPC 가 null 을 준 경우. */
  | { kind: 'unauthorized' }
  | { kind: 'error'; cause: ControlFetchCause };

/**
 * 조회 오류 분류. ⚠ 가능한 범위에서만 구분한다 — 모르면 server 다.
 *   PostgREST: JWT 만료 = PGRST301/302, 권한 없음 = 42501('permission denied' · 'not authorized').
 *   fetch 자체 실패는 postgrest-js 가 code '' + 'TypeError: Failed to fetch' 류 문구로 돌려준다.
 */
export function classifyFetchError(err: unknown): ControlFetchCause {
  const e = (err ?? {}) as { code?: unknown; message?: unknown; name?: unknown };
  const code = String(e.code ?? '');
  const msg = `${String(e.name ?? '')} ${String(e.message ?? '')}`;
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501'
    || /jwt|not authorized|permission denied/i.test(msg)) return 'auth';
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|typeerror/i.test(msg)
    || err instanceof TypeError) return 'network';
  return 'server';
}

const CAUSE_RANK: Record<ControlFetchCause, number> = { auth: 3, network: 2, server: 1 };

/**
 * 세 조회 결과를 사이클 하나의 결과로 판정한다.
 *   · match board 가 판정의 기준이다 — 권한 없음(null)은 오류가 아니라 '권한 없음' 이다.
 *   · 셋 중 하나라도 **오류(throw)** 면 사이클 전체가 실패다. 일부만 바꿔 끼우지 않는다.
 *     ⚠ 실패한 쪽을 null 로 채우면 '조편성 전 · 본선 없음' 으로 잘못 그려진다.
 *   · '아직 자료가 없음' 은 오류가 아니다. service 가 ready=false(테이블 미적용 · null 응답)
 *     또는 bracket=null(본선 미생성)로 따로 돌려준다 — 그대로 null 로 둔다.
 */
export function controlCycleOutcome(
  board: PromiseSettledResult<{ ready: boolean; board: MatchBoard | null }>,
  standings: PromiseSettledResult<{ ready: boolean; standings: PreliminaryStandings | null }>,
  bracket: PromiseSettledResult<{ ready: boolean; data: AdminBracket }>,
): ControlCycleOutcome {
  const rejected = [board, standings, bracket]
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => classifyFetchError(r.reason))
    .sort((a, b) => CAUSE_RANK[b] - CAUSE_RANK[a]);
  if (board.status === 'rejected') return { kind: 'error', cause: rejected[0] };
  if (!board.value.ready) return { kind: 'unauthorized' };
  if (standings.status === 'rejected' || bracket.status === 'rejected') {
    return { kind: 'error', cause: rejected[0] };
  }
  return {
    kind: 'ok',
    snapshot: {
      board: board.value.board,
      standings: standings.value.ready ? standings.value.standings : null,
      bracket: bracket.value.ready ? bracket.value.data : null,
    },
  };
}

// ── 선택 · 점수 입력 보호 (4F-4a) ───────────────────────────────────────────
//
//   운영자가 고른 경기는 **고른 순간의 값**(matchId · version · 팀 · 결승 여부)으로 고정한다.
//   재조회는 그 값을 바꾸지 않는다 — 최신 상태와 비교해 '그대로인가' 만 판정한다.
//   ⚠ 다른 경기로 옮겨 가지 않는다. 선택을 조용히 지우지 않는다. 해제는 운영자가 한다.
//   ⚠ 이 판정은 화면 안내용이다. 최종 판정은 언제나 서버(expected version)가 한다.
//   ⚠ 안내 문구는 '누가' 바꿨는지 단정하지 않는다(4F-4b) — 서버 상태로는 알 수 없고,
//     공용 fetch 래퍼의 재시도로 이 화면의 요청이 반영된 경우일 수도 있다.

const STATUS_WORD: Record<MatchStatus, string> = {
  waiting: '대기', calling: '호명', playing: '진행 중', completed: '완료', cancelled: '취소',
};

const latestOf = (board: MatchBoard | null, matchId: string): TournamentMatch | null =>
  (board?.matches ?? []).find((m) => m.matchId === matchId) ?? null;

export type ControlPickState =
  /** 고른 그대로다 — 투입할 수 있다. */
  | { kind: 'ok' }
  /** 아직 대기/호명이지만 다른 곳에서 바뀌었다(version 이 다르다) — 투입을 막는다. */
  | { kind: 'changed'; message: string }
  /** 더 이상 대기/호명이 아니다(투입 · 완료 · 취소 · 사라짐) — 투입을 막는다. */
  | { kind: 'gone'; message: string };

/**
 * 투입하려고 고른 경기가 지금도 고른 그대로인가.
 *   ⚠ 최신 version 으로 슬쩍 바꿔 진행하지 않는다 — 새 상태로 하려면 운영자가 다시 고른다.
 */
export function derivePickState(picked: ControlMatchRow, board: MatchBoard | null): ControlPickState {
  const m = latestOf(board, picked.matchId);
  if (!m) return { kind: 'gone', message: '이 경기를 더 이상 찾을 수 없습니다.' };
  if (m.status === 'waiting' || m.status === 'calling') {
    if (m.version === picked.version) return { kind: 'ok' };
    return {
      kind: 'changed',
      message: m.status === picked.status
        ? '이 경기의 상태가 바뀌었습니다.'
        : `이 경기의 상태가 바뀌었습니다(${STATUS_WORD[picked.status]} → ${STATUS_WORD[m.status]}).`,
    };
  }
  if (m.status === 'playing') {
    return {
      kind: 'gone',
      message: m.courtNo !== null
        ? `이 경기는 이미 ${m.courtNo}번 코트에 투입되었습니다.`
        : '이 경기는 이미 시작되었습니다.',
    };
  }
  return { kind: 'gone', message: `이 경기는 이미 ${STATUS_WORD[m.status]}되었습니다.` };
}

/**
 * 점수를 입력하는 경기가 지금도 모달을 연 그대로인가. 그대로면 null.
 *   ⚠ 다르면 저장을 막는다. 입력한 점수는 지우지 않는다(운영자가 보고 닫는다).
 */
export function deriveScoreConflict(target: ControlMatchRow, board: MatchBoard | null): string | null {
  const m = latestOf(board, target.matchId);
  if (!m) return '이 경기를 더 이상 찾을 수 없습니다. 입력한 점수는 저장되지 않습니다.';
  if (m.status === 'playing' && m.version === target.version) return null;
  if (m.status === 'completed') {
    const rec = m.score1 !== null && m.score2 !== null ? `(서버 기록 ${m.score1}:${m.score2})` : '';
    return `이 경기는 이미 완료되었습니다${rec}. 입력한 점수는 저장되지 않습니다.`;
  }
  if (m.status === 'cancelled') return '이 경기는 취소되었습니다. 입력한 점수는 저장되지 않습니다.';
  return '이 경기의 상태가 바뀌었습니다. 입력한 점수는 저장되지 않습니다.';
}

// ── 자동 갱신 주기 (4F-4b) ──────────────────────────────────────────────────

/** 평상시 갱신 주기 — 다른 운영자의 변경이 최대 이 시간 안에 보인다. */
export const CONTROL_POLL_MS = 5_000;
/** 연속 실패 시 다음 시도까지: 5 → 10 → 20 → 30초(상한). 성공하면 5초로 돌아간다. */
const CONTROL_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000] as const;
/** 인증 오류 첫 회는 조용히 이만큼 뒤 한 번 더 본다(복귀 직후 토큰 갱신과 겹치는 경우). */
export const CONTROL_AUTH_RETRY_MS = 1_500;
/** 마지막 정상 갱신이 이보다 오래되면 '오래된 정보' 경고를 띄운다. */
export const CONTROL_STALE_MS = 30_000;

/** 다음 갱신까지 기다릴 시간. failStreak = 연속 실패 수(성공하면 0). */
export function controlPollDelay(failStreak: number, authStreak = 0): number {
  if (authStreak === 1) return CONTROL_AUTH_RETRY_MS;
  const i = Math.min(Math.max(failStreak, 0), CONTROL_BACKOFF_MS.length - 1);
  return CONTROL_BACKOFF_MS[i];
}

// ── 조작 결과 판정 (4F-4b) ──────────────────────────────────────────────────
//
//   공용 fetch 래퍼(lib/supabase.ts fetchWithRetry)는 5xx · 네트워크 오류 때 같은 POST 를
//   다시 보낸다. 첫 요청이 서버에 반영됐는데 응답만 잃으면, 재시도는 expected version 이
//   이미 지나가 version_conflict 로 거절된다 → 화면은 자기 성공을 '다른 운영자가 먼저' 로 오인한다.
//   그래서 '늦었다 · 알 수 없음' 류 실패는 재조회한 서버 상태와 **요청한 결과**를 비교해 다시 판정한다.
//   ⚠ 서버 상태만으로는 '누가' 바꿨는지 알 수 없다 — 요청한 결과가 보여도 성공이라 추정하지 않는다.

/**
 * 판정하는 조작. 경기 한 건의 상태 · 결과를 바꾸는 RPC 들이며, 모두 같은 규칙을 따른다(SQL 확인 — 4F-4c-2):
 *   · hosted_tournament_match_begin 이 advisory lock 뒤 **version 을 먼저** 비교한다
 *   · 그 경기 행의 version 을 **정확히 1** 올린다(본선 결과 수정이 다음 경기 행을 고칠 때도
 *     그건 다른 행의 version 이다 — 이 경기 판정에 섞이지 않는다)
 *   다른 것은 '반영됐다면 보여야 할 상태' 뿐이다 → intentVisible 에서만 갈린다.
 *     call → 호명 · uncall → 대기 · start → 그 코트에서 진행 중 · complete → 완료 + 그 점수
 *     amend(예선 · 본선 결과 수정) → 완료 + **새** 점수 · cancel → 취소 · restore(취소 복구) → 대기
 */
export type ControlActionKind = 'call' | 'uncall' | 'start' | 'complete' | 'amend' | 'cancel' | 'restore';

/** 이 조작이 서버에 반영됐다면 보여야 할 상태. */
export interface ControlActionIntent {
  kind: ControlActionKind;
  matchId: string;
  /** 보낸 expected version. */
  version: number;
  courtNo?: number;
  score1?: number;
  score2?: number;
}

export type ControlActionVerdict =
  /** 서버가 받아들였다고 응답했다. */
  | 'success'
  /** 서버가 거절했고, 재조회한 상태에도 요청한 결과가 없다. */
  | 'failure'
  /** 응답으로는 실패지만 서버에 요청한 결과가 보인다 — 이 화면의 요청인지 확인할 수 없다. */
  | 'unverified';

/**
 * 서버가 **확실히** 거절한 것인가.
 *   조작 RPC 는 상태 판정(already_changed · court_conflict · team_busy …)보다 **먼저** version 을 비교한다.
 *   그보다 앞서 거절되는 것(invalid_score · version_required)은 요청 내용 자체가 잘못된 것이라
 *   첫 시도도 같은 이유로 반영되지 않았다.
 *   → version_conflict 를 뺀 모든 거절은 '이 요청의 version 그대로에서 서버가 판단한 거절' 이다
 *     (앞선 시도가 반영됐다면 version 이 올라가 version_conflict 가 났을 것이다).
 *   ⚠ version_conflict 와 응답 없음(네트워크)만 '앞선 시도가 반영됐을 수도 있는' 경우다.
 */
const isDefiniteReject = (reason: string | null): boolean =>
  reason !== null && reason !== 'version_conflict';

/** 판정에 필요한 경기 한 건의 모양 — 대회 경기 board(TournamentMatch)와 본선 대진(KnockoutMatch) 공통. */
export interface MatchStateLike {
  status: string;
  version: number;
  courtNo: number | null;
  score1: number | null;
  score2: number | null;
}

/** 요청한 결과가 지금 서버 상태에 보이는가. */
export function intentVisible(intent: ControlActionIntent, m: MatchStateLike | null): boolean {
  if (!m) return false;
  switch (intent.kind) {
    case 'call': return m.status === 'calling';
    case 'uncall': return m.status === 'waiting';
    case 'start': return m.status === 'playing' && m.courtNo === intent.courtNo;
    case 'complete':
    case 'amend': return m.status === 'completed'
      && m.score1 === intent.score1 && m.score2 === intent.score2;
    case 'cancel': return m.status === 'cancelled';
    case 'restore': return m.status === 'waiting';
    default: return false;
  }
}

/**
 * 조작 결과 판정.
 *   @param reason   서버 거절 사유(없으면 네트워크 · 알 수 없는 실패)
 *   @param latest   재조회한 최신 board. **조작 뒤 재조회가 실패했으면 null** 을 준다.
 *
 *   확실한 서버 거절은 실패다. 그 밖(version_conflict · 응답 없음)은 서버 상태로 다시 보되,
 *   **증명되는 경우에만** 실패라고 한다 — 경기의 모든 변경은 version 을 정확히 1 올린다.
 *     · version 이 보낸 값 그대로        → 그 뒤 아무 변경도 없었다 = 이 요청은 반영되지 않았다 → 실패
 *     · 정확히 1 올랐고 요청한 결과가 아님 → 그 한 번의 변경은 이 요청이 아니다           → 실패
 *     · 정확히 1 올랐고 요청한 결과가 보임 → 이 요청인지 같은 조작을 한 다른 운영자인지 모른다 → 확인 불가
 *     · 2 이상 올랐다                   → 이 요청이 반영된 뒤 다른 변경이 있었을 수도 있다  → 확인 불가
 *     · 경기를 못 찾음 · 재조회 실패      → 판단할 근거가 없다                              → 확인 불가
 */
export function judgeActionResult(
  intent: ControlActionIntent,
  reason: string | null,
  latest: MatchBoard | null,
): ControlActionVerdict {
  return judgeMatchAction(intent, reason, latest ? latestOf(latest, intent.matchId) : undefined);
}

/**
 * 경기 한 건으로 판정한다(경기 운영 · 본선 대진 화면용 — 규칙은 judgeActionResult 와 같다).
 *   @param m  조작 뒤 다시 읽은 그 경기. **재조회 자체가 실패했으면 undefined**, 읽었는데 경기가 없으면 null.
 */
export function judgeMatchAction(
  intent: ControlActionIntent,
  reason: string | null,
  m: MatchStateLike | null | undefined,
): ControlActionVerdict {
  if (isDefiniteReject(reason)) return 'failure';
  if (m === undefined) return 'unverified';            // 확인할 길이 없다 → 추정하지 않는다
  if (!m || !Number.isFinite(m.version)) return 'unverified';
  const changes = m.version - intent.version;
  if (changes <= 0) return 'failure';
  if (changes === 1) return intentVisible(intent, m) ? 'unverified' : 'failure';
  return 'unverified';
}

/** 확인 필요 안내에 쓰는 서버 상태 한 줄 — '완료 · 6:3 · v8' 처럼. */
export function describeMatchState(m: MatchStateLike | null | undefined): string | null {
  if (!m) return null;
  const word = (STATUS_WORD as Record<string, string>)[m.status] ?? m.status;
  const parts = [word];
  if (m.status === 'playing' && m.courtNo !== null) parts.push(`${m.courtNo}번 코트`);
  if (m.score1 !== null && m.score2 !== null) parts.push(`${m.score1}:${m.score2}`);
  parts.push(`v${m.version}`);
  return parts.join(' · ');
}
