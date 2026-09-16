// Tournament 운영(DRAW) 공용 타입 — Batch 1 범위: Team / Court / Fixture.
//
//   ⚠ 여기에는 개인정보 타입이 없다. 경기 운영 도메인은 hosted_tournament_teams
//     스냅샷만 다루며, 전화번호·입금·동의는 접수 도메인(lib/tournaments/types.ts)에 남는다.
//   ⚠ Group / Match / Bracket 타입은 후속 Batch 에서 이 파일에 추가한다.

/** 팀 출처. fixture = 허수 데이터, manual = 운영자 직접 생성. */
export type TournamentTeamSource = 'registration' | 'fixture' | 'manual';

/** 팀 상태. 기권/불참은 withdrawn 으로 두고 행을 지우지 않는다(기록 보존). */
export type TournamentTeamStatus = 'active' | 'withdrawn';

export interface TournamentTeam {
  id: string;
  /** 경기이사가 쓰는 대회 내 팀 번호. 접수 순번과 다를 수 있다. */
  teamNo: number;
  player1Name: string;
  player2Name: string;
  /** 선수별 클럽. 미입력이면 null — '무소속' 같은 값을 만들어내지 않는다. */
  player1ClubName: string | null;
  player2ClubName: string | null;
  /** legacy 팀 단위 클럽(원본 보존). */
  clubName: string | null;
  source: TournamentTeamSource;
  status: TournamentTeamStatus;
  /** 경기이사가 부여하는 선택값. 시스템이 계산하지 않는다. */
  seedNo: number | null;
  /** confirmed 접수에서 승격된 팀인지. 접수 id 자체는 공개하지 않는다. */
  fromRegistration: boolean;
  createdAt: string | null;
}

export type TournamentCourtStatus = 'active' | 'disabled';

export interface TournamentCourt {
  id: string;
  courtNo: number;
  /** null 이면 화면에서 'N번 코트'로 표기한다. */
  displayName: string | null;
  displayOrder: number;
  status: TournamentCourtStatus;
  /** LIVE 중계 코트. 대회당 최대 1면. */
  isFeatureCourt: boolean;
}

/** `promote_confirmed_registrations` 결과. 멱등이므로 재실행 시 inserted=0 이 정상이다. */
export interface PromoteTeamsResult {
  inserted: number;
  alreadyPromoted: number;
  confirmedTotal: number;
}

export interface FixtureTournament {
  slug: string;
  title: string;
  status: string;
  teamCount: number;
  courtCount: number;
}

/** fixture 시딩 시나리오 — 조 편성과 진출팀 수는 참고 표시용이며 시스템이 강제하지 않는다. */
export interface FixtureScenario {
  slug: string;
  title: string;
  teamCount: number;
  /** 3팀 1조 기준 조 수. */
  groups: number;
  /** 3으로 나눈 나머지 팀(0 또는 2). 2면 순위결정전 대상이다. */
  remainder: number;
  /** 각 조 상위 2팀 + 순위결정전 2팀 기준 본선 진출 수(참고값). */
  qualifiers: number;
  note: string;
}

/**
 * Batch 1 에서 준비하는 fixture 6종.
 *   ⚠ 이 표의 groups/qualifiers 는 '참고 계산'이다. 실제 조 편성과 본선 구조는
 *     경기이사가 결정하며 시스템이 자동 생성하지 않는다.
 */
export const FIXTURE_SCENARIOS: FixtureScenario[] = [
  { slug: 'fixture-open-48', title: 'FIXTURE 48팀', teamCount: 48, groups: 16, remainder: 0, qualifiers: 32,
    note: '나머지 0 · 진출 32 — 플레이인/BYE 없이 떨어지는 정상 경로' },
  { slug: 'fixture-open-50', title: 'FIXTURE 50팀', teamCount: 50, groups: 16, remainder: 2, qualifiers: 34,
    note: '나머지 2 → 순위결정전 1개. 두 팀 모두 진출' },
  { slug: 'fixture-open-51', title: 'FIXTURE 51팀', teamCount: 51, groups: 17, remainder: 0, qualifiers: 34,
    note: '50팀과 같은 진출 34를 다른 경로로 — 본선이 진출 경위에 무관함을 검증' },
  { slug: 'fixture-open-54', title: 'FIXTURE 54팀', teamCount: 54, groups: 18, remainder: 0, qualifiers: 36, note: '나머지 0 · 진출 36' },
  { slug: 'fixture-open-57', title: 'FIXTURE 57팀', teamCount: 57, groups: 19, remainder: 0, qualifiers: 38, note: '나머지 0 · 진출 38' },
  { slug: 'fixture-open-60', title: 'FIXTURE 60팀', teamCount: 60, groups: 20, remainder: 0, qualifiers: 40,
    note: '최대 규모 · 진출 40 — 예선 60경기' },
];

/** 팀 표시 이름. 화면 여러 곳에서 같은 규칙을 쓰기 위해 한 곳에 둔다. */
export function teamDisplayName(t: Pick<TournamentTeam, 'player1Name' | 'player2Name'>): string {
  return `${t.player1Name} · ${t.player2Name}`;
}

/** 코트 표시 이름. display_name 이 없으면 번호로 부른다(값을 지어내지 않는다). */
export function courtDisplayName(c: Pick<TournamentCourt, 'courtNo' | 'displayName'>): string {
  return c.displayName && c.displayName.trim() !== '' ? c.displayName : `${c.courtNo}번 코트`;
}
