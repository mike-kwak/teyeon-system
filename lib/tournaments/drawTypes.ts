// Tournament 운영(DRAW) 공용 타입 — Batch 1 범위: Team / Court / Fixture.
//
//   ⚠ 여기에는 개인정보 타입이 없다. 경기 운영 도메인은 hosted_tournament_teams
//     스냅샷만 다루며, 전화번호·입금·동의는 접수 도메인(lib/tournaments/types.ts)에 남는다.
//   ⚠ Group / Match / Bracket 타입은 후속 Batch 에서 이 파일에 추가한다.

/** 팀 출처. fixture = 허수 데이터, manual = 운영자 직접 생성. */
export type TournamentTeamSource = 'registration' | 'fixture' | 'manual';

/** 팀 상태. 기권/불참은 withdrawn 으로 두고 행을 지우지 않는다(기록 보존). */
export type TournamentTeamStatus = 'active' | 'withdrawn';

/**
 * 기권 사유. null = 참가 중이거나 사유 미상(legacy).
 *   registration_cancelled = 접수 취소·거절로 서버가 자동 기권시킨 팀. 접수가 복구되면 자동으로 되살아난다.
 *   manual                 = 운영진이 직접 기권시킨 팀. 접수가 복구돼도 자동 복구하지 않는다.
 */
export type TournamentTeamWithdrawnReason = 'registration_cancelled' | 'manual' | null;

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
  /** 기권 사유(운영 화면 전용). 공개 경로에는 내보내지 않는다. */
  withdrawnReason: TournamentTeamWithdrawnReason;
  /** 승격 원본 접수 id. fixture/manual 팀은 null. ⚠ 운영 화면 전용 내부 식별자. */
  registrationId: string | null;
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

// ── 예선 조편성 (Batch 2A) ───────────────────────────────────────────────────
//
//   ⚠ 시스템은 조를 자동으로 짜지 않는다. 아래 타입들은 경기이사가 만든 배치를
//     담고 보여주기 위한 것이며, 배치를 계산하는 코드는 여기에도 서버에도 없다.

/**
 * placement = 3의 배수가 아닐 때 남는 2팀.
 *   ⚠ 일반적인 '2팀 예선조'가 아니다. 두 팀은 순위결정전 대상이며 **둘 다 본선에 진출**한다.
 *     그 경기는 탈락을 가르는 경기가 아니라 본선 진출 순서/배치를 정하는 경기다.
 *     Match 생성은 Batch 3 범위다.
 */
export type TournamentGroupType = 'preliminary' | 'placement';

/** 대회 단위 조편성 잠금 상태. 조별 lock 은 두지 않는다. */
export type PreliminaryDrawStatus = 'draft' | 'locked';

/** 조 안의 한 자리. 표시 데이터는 전부 teams 스냅샷에서 온다(접수 원장 미참조). */
export interface GroupMember {
  slotNo: number;
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  player1ClubName: string | null;
  player2ClubName: string | null;
  teamStatus: TournamentTeamStatus;
}

export interface TournamentGroup {
  groupId: string;
  groupNo: number;
  /** 별칭('A조' 등). Batch 2 UI 에서는 편집하지 않는다. */
  label: string | null;
  groupType: TournamentGroupType;
  /** preliminary=3 / placement=2. 검증이 3을 하드코딩하지 않기 위한 값. */
  expectedSize: number;
  displayOrder: number;
  members: GroupMember[];
}

/** 아직 어느 조에도 들어가지 않은 팀. */
export interface UnassignedTeam {
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  player1ClubName: string | null;
  player2ClubName: string | null;
  teamStatus: TournamentTeamStatus;
}

/** 검증 실패 항목. ⚠ 서버는 무엇이 틀렸는지만 알려주고 자동 교정하지 않는다. */
export interface DrawIssue {
  code: string;
  /** code 별로 들어오는 부가 정보(groups / teams / slots / count …). */
  [key: string]: unknown;
}

export interface DrawValidation {
  ok: boolean;
  summary: {
    groupCount: number;
    preliminaryGroups: number;
    placementGroups: number;
    activeTeams: number;
    assignedTeams: number;
    unassignedTeams: number;
  };
  issues: DrawIssue[];
}

/** `get_admin_preliminary_draw` 응답 전체. */
export interface PreliminaryDraw {
  slug: string;
  /** 대회 lifecycle status(draft / registration_open …). 조편성 전제조건은 아니다. */
  tournamentStatus: string;
  drawStatus: PreliminaryDrawStatus;
  /** 낙관적 동시성 버전. write RPC 마다 증가한다. */
  version: number;
  lockedAt: string | null;
  groups: TournamentGroup[];
  unassigned: UnassignedTeam[];
  validation: DrawValidation;
}

/** 조 표시 이름. label 이 없으면 번호로 부른다. */
export function groupDisplayName(g: Pick<TournamentGroup, 'groupNo' | 'label' | 'groupType'>): string {
  if (g.label && g.label.trim() !== '') return g.label;
  return g.groupType === 'placement' ? '순위결정전' : `${g.groupNo}조`;
}

/** 조편성 검증 실패 코드 → 운영자용 문구. 없는 코드는 호출부가 기본 문구로 처리한다. */
export const DRAW_ISSUE_LABEL: Record<string, string> = {
  no_groups: '조가 하나도 없습니다.',
  group_size_mismatch: '인원이 맞지 않는 조가 있습니다.',
  unassigned_teams: '아직 배정되지 않은 팀이 있습니다.',
  withdrawn_assigned: '기권 처리된 팀이 조에 남아 있습니다.',
  slot_out_of_range: '조 정원을 넘는 자리 번호가 있습니다.',
  duplicate_membership: '한 팀이 두 조에 배정돼 있습니다.',
  duplicate_slot: '같은 자리에 두 팀이 있습니다.',
  cross_tournament_reference: '다른 대회의 팀/조가 섞여 있습니다.',
};

/**
 * 조 수 **참고 계산값**.
 *
 *   ⚠⚠ 이 값은 화면에 '참고'로만 표시한다. 시스템이 조를 자동 생성하거나
 *      팀을 자동 배치하는 데 쓰지 않는다. 실제 조 개수는 경기이사가 입력하고
 *      생성 버튼을 눌러 확정한다.
 *
 *   예) 60팀 → 20조 / 나머지 0
 *       50팀 → 16조 / 나머지 2 → 순위결정전 대상
 */
export interface GroupPlanHint {
  activeTeams: number;
  /** 3팀 기준 조 수(참고). */
  preliminaryGroups: number;
  /** 3으로 나눈 나머지. 2면 순위결정전 대상이 된다. */
  remainder: number;
  /** 나머지가 2일 때만 true. */
  suggestsPlacement: boolean;
}

export function groupPlanHint(activeTeams: number): GroupPlanHint {
  const n = Number.isFinite(activeTeams) && activeTeams > 0 ? Math.floor(activeTeams) : 0;
  return {
    activeTeams: n,
    preliminaryGroups: Math.floor(n / 3),
    remainder: n % 3,
    suggestsPlacement: n % 3 === 2,
  };
}
