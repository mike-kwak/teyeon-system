// TEYEON 클럽 문화 — 러키비키(LUCKY VICKY) 타입 + 표시 helper.
//   · 운영 데이터 source 는 DB(lib/luckyVickyService) 로 이관됨 — 이 파일은 타입/표시 helper 전용.
//   · 정적 fixture 배열은 두지 않는다(Production 에 가짜 데이터 노출 방지).
//   · '본선 2회전' 등 목표 성적 기본값 하드코딩 금지.

export type LuckyVickySupportStatus =
  | 'pending_result'   // 결과 대기(아직 목표 달성 판정 전)
  | 'eligible'         // 지원 대상(목표 달성 → 지원 예정, 아직 미지급)
  | 'supported'        // 지원 완료(실제 지급됨)
  | 'not_eligible';    // 미지원(목표 미달 등)

export type LuckyVickyTeamStatus =
  | 'selecting_tournament' // 대회 선택 중(파트너 협의)
  | 'preparing'            // 출전 준비
  | 'registered'           // 참가 신청 완료
  | 'completed';           // 출전 완료

export type LuckyVickyTeam = {
  id: string;
  /** stable members.id (정확한 id 만 — 부분 일치·추측·가상 id 금지). 팀은 정확히 2명. */
  memberIds: string[];
  /** 회원 표시 이름(members.nickname). id 로 확인된 실제 회원만. */
  memberNames: string[];
  tournamentName?: string;
  tournamentDate?: string;
  /** 회차/팀별로 다를 수 있음 — 기본값 하드코딩 금지. */
  targetResult?: string;
  actualResult?: string;
  supportStatus: LuckyVickySupportStatus;
  status: LuckyVickyTeamStatus;
  note?: string;
};

export type LuckyVickyRoundStatus = 'waiting' | 'active' | 'completed';

export type LuckyVickyRound = {
  id: string;
  round: number;
  title: string;
  status: LuckyVickyRoundStatus;
  selectionMethod?: string;
  teams: LuckyVickyTeam[];
  /** 확정됐지만 팀 세부 미입력 시의 팀 수(요약 표시용). 메인 팀 수는 이 값 우선, 없으면 실제 teams 수. */
  expectedTeamCount?: number;
  spotlightEnabled: boolean;
  note?: string;
};

/** 회차 요약 팀 수 — expected_team_count 우선, 없으면 실제 team row 수. */
export function roundTeamCount(round: Pick<LuckyVickyRound, 'teams' | 'expectedTeamCount'>): number {
  return round.expectedTeamCount != null ? round.expectedTeamCount : round.teams.length;
}
