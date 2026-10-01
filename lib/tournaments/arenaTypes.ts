// Arena TV 표시용 정규화 타입 (Batch 4E-0).
//
//   Arena 는 현장 운영 화면이다. 데이터는 Control Center 와 **같은 운영 RPC** 에서 온다
//   (get_admin_match_board · get_preliminary_standings · get_admin_bracket).
//   공개 DRAW · 공개 본선의 공개 여부와는 무관하게 동작한다.
//
//   ⚠ 이 파일은 타입만 둔다. 값을 만드는 규칙은 arenaNormalize.ts 에 있다.
//   ⚠ Arena 는 아무 것도 '결정'하지 않는다 — 시드 · 대진 · 진출 · 다음 경기를 만들지 않는다.
//     저장된 값을 화면 좌표로 옮기고 보여 줄 뿐이다.

import type { GroupRankingStatus, QualificationStatus } from './standingsTypes';
import type { MatchStage, MatchStatus } from './matchTypes';

/** Arena 가 보여 줄 두 가지 화면. 운영자가 직접 고른다(자동 전환하지 않는다). */
export type ArenaMode = 'preliminary' | 'knockout';

export interface ArenaTeam {
  teamNo: number | null;
  player1Name: string;
  player2Name: string;
  withdrawn: boolean;
}

// ── 코트 ────────────────────────────────────────────────────────────────────

/**
 * 코트에서 **지금 하고 있는** 경기.
 *   ⚠ 이 값은 status='playing' + 코트 번호가 붙은 경기에서만 나온다.
 *     '다음 경기(NEXT)'는 저장된 데이터에 없다 — call_match 는 코트를 점유하지 않는다.
 *     그래서 Arena 는 NEXT 를 추론하지 않는다.
 */
export interface ArenaCourtMatch {
  matchNo: number;
  stage: MatchStage;
  groupNo: number | null;
  team1: ArenaTeam;
  team2: ArenaTeam;
}

export interface ArenaCourt {
  courtNo: number;
  displayName: string | null;
  /** 코트 자체가 운영 중인가(서버의 court status). 쉬는 코트는 조용히 둔다. */
  active: boolean;
  /** 지금 진행 중인 경기. 없으면 EMPTY. */
  now: ArenaCourtMatch | null;
}

// ── 예선 ────────────────────────────────────────────────────────────────────

export interface ArenaStandingRow {
  teamNo: number;
  player1Name: string;
  player2Name: string;
  withdrawn: boolean;
  played: number;
  wins: number;
  losses: number;
  gameDiff: number;
  /** ⚠ 조가 끝나도 동률이 확정되지 않으면 null 이다. 임의 순위를 만들지 않는다. */
  rank: number | null;
  /** 승률·득실만으로 매긴 잠정 순위(동률이면 값이 겹친다). */
  autoRank: number;
  qualificationStatus: QualificationStatus;
}

export interface ArenaGroup {
  groupNo: number;
  members: number;
  expectedMatches: number;
  completedMatches: number;
  rankingStatus: GroupRankingStatus;
  rows: ArenaStandingRow[];
}

// ── 본선 ────────────────────────────────────────────────────────────────────

/** 자리의 성격. 저장된 slot_type 을 그대로 옮긴다. */
export type ArenaSlotKind = 'team' | 'bye' | 'tbd' | 'qualifier';

export interface ArenaSlot {
  id: string;
  roundNo: number;
  position: number;
  kind: ArenaSlotKind;
  /** 실제 팀이 정해진 자리만 값이 있다. */
  team: ArenaTeam | null;
  /** 서버가 만든 출처 문구('1조 1위'). ⚠ 프런트에서 조합하지 않는다. */
  sourceLabel: string | null;
  /** 예선 결과가 반영됐는가. 반영돼도 sourceLabel 은 그대로 남는다. */
  resolved: boolean;
  /** 이 자리의 승자가 올라갈 자리. 우승 자리만 null. */
  feedsSlotId: string | null;
}

export interface ArenaRound {
  roundNo: number;
  name: string;
  /** 경기 라운드가 아니라 '우승 자리' 라운드인가. */
  isFinalSlot: boolean;
  slotCount: number;
}

export interface ArenaKnockoutMatch {
  matchNo: number;
  roundNo: number;
  roundName: string | null;
  status: MatchStatus;
  courtNo: number | null;
  courtName: string | null;
  score1: number | null;
  score2: number | null;
  winnerTeamNo: number | null;
  /** 이 경기 승자가 올라갈 자리. 경기와 자리를 잇는 유일한 연결 고리다. */
  targetRoundNo: number;
  targetPosition: number;
  team1: ArenaTeam;
  team2: ArenaTeam;
}

export interface ArenaBracket {
  title: string | null;
  status: string | null;
  completedAt: string | null;
  rounds: ArenaRound[];
  slots: ArenaSlot[];
  matches: ArenaKnockoutMatch[];
}

// ── 화면 전체 ───────────────────────────────────────────────────────────────

export interface ArenaSnapshot {
  slug: string;
  mode: ArenaMode;
  tournamentTitle: string | null;
  courts: ArenaCourt[];
  /** mode='preliminary' 일 때만 채운다. */
  groups: ArenaGroup[];
  /** 요강상 조별 본선 진출 팀 수. ⚠ 서버가 알려 준다 — 화면이 2 를 가정하지 않는다. */
  qualifyPerGroup: number | null;
  /** mode='knockout' 일 때만 채운다. 본선 대진이 없으면 null. */
  bracket: ArenaBracket | null;
}

/** 화면 상태. 첫 조회와 배경 갱신을 구분한다. */
export interface ArenaState {
  snapshot: ArenaSnapshot | null;
  /** 첫 조회 중(화면에 아무 것도 없을 때만 true). 배경 갱신에서는 절대 true 가 되지 않는다. */
  loading: boolean;
  /** 운영 권한으로 읽을 수 있는가. false 면 '운영자 로그인 필요'. */
  authorized: boolean;
  /** 첫 조회가 실패했는가. 배경 갱신 실패는 여기 오지 않는다. */
  failed: boolean;
  /** 배경 갱신이 실패해 화면이 과거 값인가(보던 내용은 그대로 둔다). */
  stale: boolean;
  /** 마지막으로 성공한 시각. */
  updatedAt: number | null;
}
