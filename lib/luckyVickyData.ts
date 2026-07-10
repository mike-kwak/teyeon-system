// TEYEON 클럽 문화 — 러키비키(LUCKY VICKY) 중앙 정적 데이터.
//   · 메인 Culture Spotlight 와 /lucky-vicky 전용 페이지가 동일 source 로 사용한다.
//   · 1차: DB/RLS/RPC 없이 이 파일 한 곳에서만 관리(이후 Admin/DB 로 교체 가능한 형태로 분리).
//   · ⚠ 실제 확정 정보만 기록한다. 회원명·팀명·대회명·목표·결과·지원 여부·stable id 를 임의로 만들지 않는다.
//     현재 확정: 3회차 진행 중 · 2팀 출전 준비(각 파트너가 출전 대회 협의 중). 팀 세부는 미입력(입력 대기).
//   · '본선 2회전' 등 목표 성적을 회차/팀 기본값으로 하드코딩하지 않는다.

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
  /** stable members.id 를 안전하게 확인한 경우에만 채운다(부분 일치·추측 금지). */
  memberIds?: string[];
  /** 회원 표시 이름(stable id 없이 이름만 아는 경우 포함). */
  memberNames?: string[];
  tournamentName?: string;
  tournamentDate?: string;
  /** 회차/팀별로 다를 수 있음 — 기본값 하드코딩 금지. */
  targetResult?: string;
  actualResult?: string;
  supportStatus: LuckyVickySupportStatus;
  status: LuckyVickyTeamStatus;
  selectionMethod?: string;
  note?: string;
};

export type LuckyVickyRoundStatus = 'waiting' | 'active' | 'completed';

export type LuckyVickyRound = {
  round: number;
  title: string;
  status: LuckyVickyRoundStatus;
  selectionMethod?: string;
  teams: LuckyVickyTeam[];
  /**
   * 확정됐지만 팀 세부(회원/대회 등)가 아직 입력되지 않은 경우의 팀 수(예: 3회차 2팀 준비).
   * teams 가 비어 있어도 이 값으로 "N팀 출전 준비" 요약을 표시한다(가짜 팀 카드 생성 금지).
   */
  expectedTeamCount?: number;
  note?: string;
};

// ── 실제 데이터(확정분만) ────────────────────────────────────────────────────
//   1·2회차: 종료됨(completed). 세부 기록 미입력 → History empty state 로 표시(가짜 카드 금지).
//   3회차: 진행 중(active) · 2팀 준비. 팀 세부 미입력 → 요약 + '선정 팀 정보 입력 대기'.
export const LUCKY_VICKY_ROUNDS: LuckyVickyRound[] = [
  { round: 1, title: '1회차', status: 'completed', teams: [] },
  { round: 2, title: '2회차', status: 'completed', teams: [] },
  {
    round: 3,
    title: '3회차',
    status: 'active',
    teams: [],
    expectedTeamCount: 2,
    note: '각 파트너가 출전할 대회를 협의 중입니다.',
  },
];

/** 진행 중(active) 회차 1건 — 없으면 null(메인 Spotlight 노출 조건). */
export function getActiveLuckyVickyRound(): LuckyVickyRound | null {
  return LUCKY_VICKY_ROUNDS.find((r) => r.status === 'active') ?? null;
}

/** 지난(종료) 회차 — 최신 회차 우선. History 렌더용. */
export function getPastLuckyVickyRounds(): LuckyVickyRound[] {
  return LUCKY_VICKY_ROUNDS.filter((r) => r.status === 'completed').sort((a, b) => b.round - a.round);
}

/** 회차 요약 문구용 — 확정 팀 수(teams 실제 입력분 vs expectedTeamCount 중 큰 값). */
export function roundTeamCount(round: LuckyVickyRound): number {
  return Math.max(round.teams.length, round.expectedTeamCount ?? 0);
}
