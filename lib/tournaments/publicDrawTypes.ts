// 공개 예선 DRAW — get_public_preliminary_draw 응답 타입.
//   ⚠ 공개 페이로드에는 uuid · 결과 지문 · 동률 상세 · 확정 사유 · 버전 · 접수 개인정보가 없다.
//     화면 key 는 팀 번호 · 경기 번호 · 조 번호로 만든다.

import type { GroupRankingStatus, QualificationStatus } from './standingsTypes';

export interface PublicDrawTeam {
  teamNo: number;
  player1Name: string;
  player2Name: string;
}

export interface PublicStandingRow extends PublicDrawTeam {
  withdrawn: boolean;
  played: number;
  wins: number;
  losses: number;
  gamesFor: number;
  gamesAgainst: number;
  gameDiff: number;
  /** 서버 순위. 미해결 동률이면 null. */
  rank: number | null;
  qualificationStatus: QualificationStatus;
}

export interface PublicDrawMatch {
  sequenceNo: number;
  matchNo: number;
  status: string;
  courtNo: number | null;
  courtName: string | null;
  score1: number | null;
  score2: number | null;
  winnerSide: 1 | 2 | null;
  team1: PublicDrawTeam;
  team2: PublicDrawTeam;
}

export interface PublicDrawGroup {
  groupNo: number;
  members: number;
  expectedMatches: number;
  generatedMatches: number;
  completedMatches: number;
  cancelledMatches: number;
  /** 서버 순위 상태. AGE_CHECK_REQUIRED 는 공개 화면에서 '순위 확인 중'으로만 표현한다. */
  rankingStatus: GroupRankingStatus;
  standings: PublicStandingRow[];
  matches: PublicDrawMatch[];
}

export interface PublicPlacement {
  groupNo: number;
  matchNo: number;
  status: string;
  score1: number | null;
  score2: number | null;
  winnerSide: 1 | 2 | null;
  teams: PublicDrawTeam[];
}

export interface PublicPreliminaryDraw {
  slug: string;
  qualifyPerGroup: number;
  groups: PublicDrawGroup[];
  placement: PublicPlacement[];
}
