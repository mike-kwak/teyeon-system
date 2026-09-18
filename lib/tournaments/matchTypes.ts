// 예선 경기 공용 타입 (Batch 3A).
//
//   ⚠ 개인정보 없음. 표시 데이터는 hosted_tournament_teams 스냅샷에서만 온다.
//   ⚠ DOB · 나이 필드를 두지 않는다.
//
//   ⚠⚠ 기권 / 노쇼
//     별도 WALKOVER / RET / DEF 상태를 두지 않는다. 운영상 기권·노쇼는
//     상대팀의 **6:0 승리**로 일반 경기와 동일하게 입력한다.
//     따라서 승/패, games_for/against, game differential 에 그대로 반영된다.
//
//   ⚠ CANCELLED 의 의미는 '공식 결과 없이 경기가 취소됨' 하나뿐이다(기권 용도 아님).

export type MatchStage = 'preliminary' | 'placement' | 'knockout';

export type MatchStatus = 'waiting' | 'calling' | 'playing' | 'completed' | 'cancelled';

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  waiting: '대기',
  calling: '호명',
  playing: '진행 중',
  completed: '완료',
  cancelled: '취소',
};

/** 경기에 나오는 팀(teams 스냅샷 일부). */
export interface MatchTeam {
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  teamStatus: 'active' | 'withdrawn';
}

export interface TournamentMatch {
  matchId: string;
  /** 대회 전체 진행 번호(호명용). */
  matchNo: number;
  stage: MatchStage;
  /** placement 조도 group_no 를 갖는다. knockout 은 null. */
  groupNo: number | null;
  groupType: 'preliminary' | 'placement' | null;
  /** 조 안에서의 경기 순서. */
  sequenceNo: number;
  status: MatchStatus;
  /** PLAYING 에서만 값이 있다. CALLING 은 코트를 점유하지 않는다. */
  courtNo: number | null;
  score1: number | null;
  score2: number | null;
  winnerTeamId: string | null;
  /** 낙관적 동시성 — 이 경기 1건의 버전. 조편성 version 과 다른 개념이다. */
  version: number;
  team1: MatchTeam;
  team2: MatchTeam;
}

export interface MatchCourtSlot {
  courtNo: number;
  displayName: string | null;
  status: 'active' | 'disabled';
  /** 지금 PLAYING 경기가 올라가 있는지. */
  busy: boolean;
}

/** `get_admin_match_board` 응답. */
export interface MatchBoard {
  slug: string;
  tournamentStatus: string;
  drawStatus: 'draft' | 'locked';
  /** 조편성 version. 경기 생성 시 이 값을 넘긴다. */
  drawVersion: number;
  matchesGenerated: boolean;
  /**
   * 경기를 만든 뒤 조편성이 실제로 바뀌었는가.
   *   ⚠ 표시 순서(display_order) 같은 비본질 값 변경으로는 true 가 되지 않는다.
   */
  matchesStale: boolean;
  matches: TournamentMatch[];
  courts: MatchCourtSlot[];
}

/** 코트 표시 이름. display_name 이 없으면 번호로 부른다. */
export function matchCourtLabel(c: Pick<MatchCourtSlot, 'courtNo' | 'displayName'>): string {
  return c.displayName && c.displayName.trim() !== '' ? c.displayName : `${c.courtNo}번 코트`;
}

/** 경기 표시 이름. 조/순위결정전을 구분한다. */
export function matchGroupLabel(m: Pick<TournamentMatch, 'groupNo' | 'groupType'>): string {
  if (m.groupType === 'placement') return '순위결정전';
  return m.groupNo === null ? '-' : `${m.groupNo}조`;
}

/** 팀 표시 이름. */
export function matchTeamName(t: Pick<MatchTeam, 'player1Name' | 'player2Name'>): string {
  return `${t.player1Name} · ${t.player2Name}`;
}

/**
 * 정상 종료 스코어인가.
 *
 *   공식 규칙: 6게임 1세트 · No-Ad · 5:5 타이브레이크
 *     → 승자는 항상 6, 패자는 0~5.
 *     → 6:0 ~ 6:5 / 0:6 ~ 5:6 만 허용. 6:6 · 7:x · 4:2 는 불가.
 *
 *   ⚠ 기권승도 6:0 으로 같은 규칙을 따른다(별도 표기 없음).
 *   ⚠ 이것은 화면 1차 검증이다. 최종 판정은 서버 RPC 와 DB check 가 한다.
 */
export function isValidSetScore(score1: unknown, score2: unknown): boolean {
  if (typeof score1 !== 'number' || typeof score2 !== 'number') return false;
  if (!Number.isInteger(score1) || !Number.isInteger(score2)) return false;
  const hi = Math.max(score1, score2);
  const lo = Math.min(score1, score2);
  return hi === 6 && lo >= 0 && lo <= 5;
}

/** 스코어에서 승자를 파생한다(화면 미리보기용). 서버도 같은 규칙으로 계산한다. */
export function deriveWinnerTeamId(
  m: Pick<TournamentMatch, 'team1' | 'team2'>,
  score1: number,
  score2: number,
): string {
  return score1 > score2 ? m.team1.teamId : m.team2.teamId;
}
