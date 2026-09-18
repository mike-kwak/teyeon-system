// 예선 순위 / 합산연령 동률 확정 공용 타입 (Batch 3B).
//
//   ⚠⚠ 개인정보 없음.
//     DOB · 생년 · 나이 · 합산연령 값을 **받지도 저장하지도 않는다**.
//     운영진이 현장에서 합산연령을 확인한 뒤 '최종 순서'만 서버로 보낸다.
//
//   ⚠ 순위 정렬은 승률 → 게임 득실 **두 단계에서 끝난다.**
//     team_no · 이름 · 등록순 같은 3차 tie-breaker 를 두지 않는다.
//     그 뒤로도 갈리지 않으면 시스템이 순위를 만들어내지 않고 사람에게 넘긴다.
//
//   ⚠ 기권 / 노쇼는 이미 6:0 COMPLETED 로 저장돼 있어 별도 분기가 없다.
//   ⚠ CANCELLED 는 공식 결과가 아니다 — 집계에 포함되지 않고,
//     하나라도 남아 있으면 그 조는 FINAL 이 되지 않는다.

/**
 * 조 단위 순위 확정 상태.
 *
 *   PROVISIONAL        경기가 남아 있음(또는 CANCELLED 잔존) → 잠정 순위
 *   AGE_CHECK_REQUIRED 조는 끝났지만 승률·득실로 갈리지 않은 동률이 남음
 *   FINAL              순위가 확정됨(동률이 없거나, 전부 확정됨)
 */
export type GroupRankingStatus = 'PROVISIONAL' | 'AGE_CHECK_REQUIRED' | 'FINAL';

/**
 * 본선 진출 판정.
 *
 *   QUALIFIED     순서와 무관하게 진출 확정
 *   NOT_QUALIFIED 순서와 무관하게 탈락 확정
 *   PENDING       아직 판정할 수 없음(조 진행 중이거나, 동률이 진출 경계에 걸쳐 있음)
 */
export type QualificationStatus = 'QUALIFIED' | 'NOT_QUALIFIED' | 'PENDING';

/**
 * 운영 정책 판단이 필요한 상황.
 *   cancelled_matches_present — 취소된 경기가 남아 있어 조를 FINAL 로 볼 수 없다.
 *     ⚠ 시스템이 0:0 이나 6:0 으로 자동 보정하지 않는다.
 */
export type GroupPolicyRequired = 'cancelled_matches_present';

export const RANKING_STATUS_LABEL: Record<GroupRankingStatus, string> = {
  PROVISIONAL: '잠정',
  AGE_CHECK_REQUIRED: '합산연령 확인 필요',
  FINAL: '확정',
};

export const QUALIFICATION_LABEL: Record<QualificationStatus, string> = {
  QUALIFIED: '본선 진출',
  NOT_QUALIFIED: '탈락',
  PENDING: '미정',
};

export const GROUP_POLICY_LABEL: Record<GroupPolicyRequired, string> = {
  cancelled_matches_present:
    '취소된 경기가 남아 있어 순위를 확정할 수 없습니다. 운영 판단이 필요합니다.',
};

/** 조 안의 한 팀. */
export interface StandingRow {
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  teamStatus: 'active' | 'withdrawn';

  /** ⚠ COMPLETED 경기만 집계한다. CANCELLED / 진행 중은 포함하지 않는다. */
  played: number;
  wins: number;
  losses: number;
  gamesFor: number;
  gamesAgainst: number;
  gameDiff: number;
  /** 경기가 0이면 null. 0 이 아니다(‘아직 없음’과 ‘0할’은 다르다). */
  winRate: number | null;

  /** 승률·득실만으로 매긴 순위. 동률이면 같은 값이 공유된다(1,1,3 처럼). */
  autoRank: number;
  /**
   * 화면에 쓸 최종 순위.
   *   ⚠ 조가 끝났는데 동률이 확정되지 않았으면 **null** 이다.
   *     이때 임의 순위를 만들어 표시하면 안 된다.
   */
  rank: number | null;

  /** 이 팀이 속한 동률 묶음의 시작 순위 / 크기. 동률이 아니면 null. */
  tieGroupRank: number | null;
  tieGroupSize: number | null;

  /** 운영진이 확정한 순서(절대 순위). 확정 전에는 null. */
  resolvedOrder: number | null;
  resolvedAt: string | null;
  resolvedReason: string | null;

  qualificationStatus: QualificationStatus;
}

/** 승률·득실이 같아 시스템이 갈라내지 못한 팀 묶음. */
export interface TieGroup {
  /** 묶음이 차지하는 첫 순위. 크기가 N 이면 rank … rank+N-1 을 점유한다. */
  rank: number;
  size: number;
  /** ⚠ 이 순서는 슬롯 순일 뿐 '순위'가 아니다. */
  teamIds: string[];
  resolved: boolean;
}

export interface GroupStandings {
  groupId: string;
  groupNo: number;
  groupType: 'preliminary';
  expectedSize: number;
  members: number;

  /** N(N-1)/2. 조 크기가 바뀌어도 식이 그대로다. */
  expectedMatches: number;
  generatedMatches: number;
  completedMatches: number;
  cancelledMatches: number;
  /** 생성된 경기가 전부 COMPLETED 인가. CANCELLED 가 있으면 false 다. */
  groupComplete: boolean;

  rankingStatus: GroupRankingStatus;
  policyRequired: GroupPolicyRequired | null;

  /**
   * 그 조의 완료 결과 지문.
   *   ⚠ 순위 확정 시 그대로 되돌려 보낸다. 서버가 다르면 거부한다(standings_changed).
   *   ⚠ version 컬럼을 두지 않은 이유: 확정/무효화 자체로 버전이 튀면
   *     결과가 그대로인데도 '바뀌었다'고 오판하기 때문이다.
   */
  resultsFingerprint: string;

  tieGroups: TieGroup[];
  standings: StandingRow[];
}

/** 순위결정전(placement). ⚠ 두 팀 모두 본선 진출이며 순위를 매기지 않는다. */
export interface PlacementSummary {
  groupId: string;
  groupNo: number;
  matchId: string;
  matchNo: number;
  status: string;
  score1: number | null;
  score2: number | null;
  winnerTeamId: string | null;
  loserTeamId: string | null;
  teams: {
    teamId: string;
    teamNo: number;
    player1Name: string;
    player2Name: string;
  }[];
}

/** `get_preliminary_standings` 응답. */
export interface PreliminaryStandings {
  slug: string;
  /** 요강상 조별 본선 진출 팀 수. 서버가 알려준다(화면이 2를 가정하지 않는다). */
  qualifyPerGroup: number;
  groups: GroupStandings[];
  placement: PlacementSummary[];
}

/** 팀 표시 이름. */
export function standingTeamName(
  t: Pick<StandingRow, 'player1Name' | 'player2Name'>,
): string {
  return `${t.player1Name} · ${t.player2Name}`;
}

/** 승률 표기(3자리). 경기가 없으면 '-'. */
export function formatWinRate(winRate: number | null): string {
  return winRate === null ? '-' : winRate.toFixed(3);
}

/** 득실 표기. 양수에 + 를 붙인다. */
export function formatGameDiff(gameDiff: number): string {
  return gameDiff > 0 ? `+${gameDiff}` : String(gameDiff);
}

/** 운영진이 손을 대야 하는 조인가. */
export function needsAgeCheck(g: Pick<GroupStandings, 'rankingStatus'>): boolean {
  return g.rankingStatus === 'AGE_CHECK_REQUIRED';
}

/** 아직 확정되지 않은 동률 묶음만 고른다. */
export function unresolvedTieGroups(g: Pick<GroupStandings, 'tieGroups'>): TieGroup[] {
  return g.tieGroups.filter((t) => !t.resolved);
}

/**
 * 동률 묶음에 순서를 매겼을 때 각 팀이 갖게 될 최종 순위.
 *   서버와 같은 규칙: 묶음 시작 순위 + 입력 순서.
 *     1,2,2 의 2위 묶음 → 2, 3      → 조 전체 1,2,3
 *     1,1,3 의 1위 묶음 → 1, 2      → 조 전체 1,2,3
 *     1,1,1 의 1위 묶음 → 1, 2, 3   → 조 전체 1,2,3
 *   ⚠ 화면 미리보기 전용이다. 실제 저장값은 서버가 다시 계산한다.
 */
export function previewResolvedRanks(tie: Pick<TieGroup, 'rank' | 'size'>): number[] {
  return Array.from({ length: tie.size }, (_, i) => tie.rank + i);
}

/**
 * 동률 묶음 순서를 보낼 수 있는 상태인가(화면 1차 검증).
 *   ⚠ 최종 판정은 서버가 한다. 여기서 통과해도 서버가 거부할 수 있다.
 */
export function isValidTieOrder(
  tie: Pick<TieGroup, 'teamIds' | 'size'>,
  orderedTeamIds: string[],
): boolean {
  if (orderedTeamIds.length !== tie.size) return false;
  if (new Set(orderedTeamIds).size !== orderedTeamIds.length) return false;
  const expected = new Set(tie.teamIds);
  return orderedTeamIds.every((id) => expected.has(id));
}
