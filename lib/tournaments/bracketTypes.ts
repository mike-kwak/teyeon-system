// 본선 Bracket 타입 (Batch 4B) — Admin 화면과 service 가 함께 쓰는 모양만 둔다.
//
//   ⚠ 개인정보 타입이 없다. 본선 도메인은 hosted_tournament_teams 스냅샷(이름)만 다룬다.
//   ⚠ 이 파일에는 구조를 '결정'하는 로직이 없다. 라운드 · 자리 수 · BYE 위치 · 연결은
//      전부 경기이사가 입력한 값이고, 여기 타입은 그 값을 담아 나르기만 한다.

export type BracketStatus = 'draft' | 'locked' | 'completed';

/**
 * 자리 종류.
 *   team      = 실제 팀이 놓인 자리
 *   qualifier = 예선 결과 대기 자리('N조 M위') — 1라운드만 (4D-0)
 *   bye       = 부전승(1라운드만) · 경기이사가 직접 지정
 *   tbd       = 2라운드 이후 '이전 경기 승자 대기'
 *   ⚠ qualifier 와 tbd 는 뜻이 다르다. 섞어 쓰지 않는다.
 */
export type BracketSlotType = 'team' | 'qualifier' | 'bye' | 'tbd';

/** 자리의 출처. group_rank 는 반영 뒤에도 지우지 않는다('1조 1위 · 팀명' 표시의 근거). */
export type BracketSourceKind = 'group_rank' | 'manual' | 'bye';

/** 진출 경로 스냅샷. 서버가 계산한 값이 아니라 경기이사가 확정할 때 함께 저장한 출처다. */
export type BracketEntrantSource = 'group_rank' | 'placement' | 'manual';

export interface Bracket {
  id: string;
  title: string | null;
  status: BracketStatus;
  version: number;
  /** 경기이사가 적어 둔 진출팀 수. ⚠ 경고 대조용 — 구조를 만들지 않는다. */
  declaredEntrantCount: number | null;
  lockedAt: string | null;
  /** 4D 공개 단계에서 사용. 4B 에서는 항상 null 이다. */
  publishedAt: string | null;
  completedAt: string | null;
}

export interface BracketRound {
  id: string;
  roundNo: number;
  name: string;
  /** 마지막 우승 destination 라운드(경기 라운드가 아니다). */
  isFinalSlot: boolean;
  slotCount: number;
}

export interface BracketSlot {
  id: string;
  roundNo: number;
  position: number;
  slotType: BracketSlotType;
  teamId: string | null;
  teamNo: number | null;
  player1Name: string | null;
  player2Name: string | null;
  teamStatus: 'active' | 'withdrawn' | null;
  /** 이 자리의 승자가 올라갈 다음 라운드 자리. 우승 자리만 null. */
  feedsSlotId: string | null;
  // ── 4D-0 Qualifier ──
  sourceKind: BracketSourceKind | null;
  sourceGroupNo: number | null;
  sourceRank: number | null;
  /** 서버가 만든 표시 문구('1조 1위'). ⚠ 프런트에서 조합하지 않는다. */
  sourceLabel: string | null;
  /** 예선 결과가 반영된 시각. null 이면 아직 실제 팀이 정해지지 않았다. */
  resolvedAt: string | null;
}

export interface BracketEntrant {
  id: string;
  teamId: string;
  teamNo: number;
  player1Name: string;
  player2Name: string;
  teamStatus: 'active' | 'withdrawn';
  source: BracketEntrantSource;
  sourceGroupNo: number | null;
  sourceRank: number | null;
  seedNo: number | null;
  note: string | null;
  /** 1라운드 자리에 이미 놓였는지. */
  placed: boolean;
}

/** validate_bracket 이 돌려주는 항목. severity 로 lock 차단 여부가 갈린다. */
export interface BracketIssue {
  code: string;
  severity: 'error' | 'warning';
  detail: Record<string, unknown>;
}

export interface BracketSummary {
  entrants: number;
  rounds: number;
  slots: number;
  firstRoundSlots: number;
  byes: number;
  unassigned: number;
  /** 4C 에서 만들 경기 수. 4B 는 숫자만 보여 준다. */
  matchesToCreate: number;
  /** 4C 에서 BYE 로 자동 진출할 자리 수. 4B 는 숫자만 보여 준다. */
  byeAdvances: number;
  /** 아직 예선 결과를 기다리는 자리 수(4D-0). */
  qualifiers: number;
  /** 예선 결과가 반영된 자리 수(4D-0). */
  resolved: number;
}

export interface BracketValidation {
  ok: boolean;
  issues: BracketIssue[];
  summary: BracketSummary;
}

/** 확정 이후 예선 결과와의 차이. ⚠ 표시 전용 — 자동 반영하지 않는다. */
export interface BracketDrift {
  code: 'qualified_not_entrant' | 'entrant_not_qualified' | string;
  teamNo: number | null;
}

/** 본선 경기 상태. 예선 경기와 같은 값을 쓴다(운영 흐름이 같기 때문). */
export type KnockoutMatchStatus = 'waiting' | 'calling' | 'playing' | 'completed' | 'cancelled';

/** 경기 카드에 쓰는 팀 표시값. ⚠ 팀 UUID 가 없다 — 서버가 내보내지 않는다. */
export interface KnockoutMatchTeam {
  teamNo: number | null;
  player1Name: string | null;
  player2Name: string | null;
  teamStatus: 'active' | 'withdrawn' | null;
}

/**
 * 본선 경기 1개(4C).
 *   ⚠ id 는 RPC 호출에만 쓴다. 화면에 표시하지 않는다.
 *   ⚠ BYE 는 경기가 아니다 — 여기에 들어오지 않는다(서버가 경기를 만들지 않는다).
 */
export interface KnockoutMatch {
  id: string;
  matchNo: number;
  roundNo: number;
  roundName: string | null;
  /** 이 경기 승자가 올라갈 자리(다음 라운드 · 자리 번호). */
  targetRoundNo: number;
  targetPosition: number;
  status: KnockoutMatchStatus;
  version: number;
  courtNo: number | null;
  courtName: string | null;
  score1: number | null;
  score2: number | null;
  winnerTeamNo: number | null;
  team1: KnockoutMatchTeam;
  team2: KnockoutMatchTeam;
}

/** 반영한 뒤 예선 순위가 달라진 자리(표시 전용). ⚠ 자동으로 되돌리지 않는다. */
export interface QualifierDrift {
  code: 'qualifier_resolution_stale' | string;
  position: number | null;
  label: string | null;
  resolvedTeamNo: number | null;
  currentTeamNo: number | null;
}

export interface AdminBracket {
  bracket: Bracket | null;
  rounds: BracketRound[];
  slots: BracketSlot[];
  entrants: BracketEntrant[];
  /** 4C. 아직 경기를 만들지 않았으면 빈 배열이다. */
  matches: KnockoutMatch[];
  entrantDrift: BracketDrift[];
  /** 4D-0. 반영 뒤 예선 순위가 바뀐 자리. */
  qualifierDrift: QualifierDrift[];
  validation: BracketValidation | null;
}

// ── 저장 payload ────────────────────────────────────────────────────────────

export interface EntrantInput {
  teamId: string;
  source: BracketEntrantSource;
  sourceGroupNo?: number | null;
  sourceRank?: number | null;
  seedNo?: number | null;
  note?: string | null;
}

export interface RoundInput {
  roundNo: number;
  name: string;
  slots: number;
  isFinalSlot?: boolean;
}

export interface ConnectionInput {
  roundNo: number;
  position: number;
  feedsPosition: number;
}

export interface StructureInput {
  rounds: RoundInput[];
  connections: ConnectionInput[];
}

export interface SlotAssignmentInput {
  position: number;
  type: BracketSlotType;
  teamId?: string | null;
  /** type = 'qualifier' 일 때만. 예: 1조 1위 → groupNo 1 · rank 1 */
  groupNo?: number | null;
  rank?: number | null;
}

/** 예선 결과 반영 결과(자리 단위). */
export interface QualifierResolved {
  position: number;
  label: string;
  teamNo: number | null;
}
export interface QualifierSkipped {
  position: number;
  label: string;
  reason: string;
}
export interface ResolveQualifiersResult {
  version: number;
  resolved: QualifierResolved[];
  skipped: QualifierSkipped[];
}

/**
 * 반영 보류 사유 → 운영자 문구.
 *   ⚠ 서버 reason 을 그대로 노출하지 않는다. 모르는 값은 일반 문구로 덮는다.
 */
export const QUALIFIER_SKIP_TEXT: Record<string, string> = {
  rank_not_final:      '예선 순위가 아직 확정되지 않았습니다',
  tie_unresolved:      '합산연령 확인이 필요합니다',
  cancelled_present:   '취소 경기 확인이 필요합니다',
  group_not_found:     '해당 예선 조를 찾을 수 없습니다',
  rank_out_of_range:   '해당 순위가 존재하지 않습니다',
  team_already_placed: '이미 다른 본선 자리에 배치된 팀입니다',
};

export const qualifierSkipText = (reason: string): string =>
  QUALIFIER_SKIP_TEXT[reason] ?? '아직 반영할 수 없습니다';

/** 경기 카드의 팀 한 줄. 이름 스냅샷만 쓴다. */
export function knockoutTeamLabel(t: KnockoutMatchTeam): string {
  if (t.teamNo == null) return '미정';
  return `${t.teamNo}. ${t.player1Name ?? ''} · ${t.player2Name ?? ''}`.trim();
}

export const KNOCKOUT_STATUS_TEXT: Record<KnockoutMatchStatus, string> = {
  waiting: '대기',
  calling: '호명 중',
  playing: '진행 중',
  completed: '완료',
  cancelled: '취소',
};

/** 화면에서 쓰는 팀 식별 문구. 이름만 쓴다(연락처·접수 정보 없음). */
export function bracketTeamLabel(
  t: Pick<BracketEntrant, 'teamNo' | 'player1Name' | 'player2Name'>,
): string {
  return `${t.teamNo}. ${t.player1Name} · ${t.player2Name}`;
}

/** validate 코드 → 운영자용 한 줄. 모르는 코드는 코드 그대로 보여 준다(삼키지 않는다). */
export const BRACKET_ISSUE_TEXT: Record<string, string> = {
  no_entrants: '본선 진출팀이 확정되지 않았습니다.',
  no_rounds: '본선 구조(라운드)가 없습니다.',
  no_slots: '자리가 만들어지지 않았습니다.',
  round_gap: '라운드 번호가 1부터 연속이 아닙니다.',
  final_round_invalid: '마지막 우승 자리 라운드가 올바르지 않습니다. (자리 1개 · 맨 뒤 라운드)',
  final_slot_has_feed: '우승 자리에는 다음 연결이 있을 수 없습니다.',
  round_no_mismatch: '자리의 라운드 번호가 라운드 정보와 다릅니다.',
  missing_feed: '다음 라운드로 가는 연결이 없는 자리가 있습니다.',
  feed_other_bracket: '다른 본선의 자리로 연결돼 있습니다.',
  feed_not_next_round: '연결 대상이 바로 다음 라운드가 아닙니다.',
  feeder_count_invalid: '한 자리로 올라오는 자리가 2개가 아닙니다.',
  bye_vs_bye: '부전승끼리 맞붙는 자리가 있습니다.',
  bye_outside_first_round: '부전승은 1라운드에만 놓을 수 있습니다.',
  unassigned_first_round_slot: '1라운드에 아직 비어 있는 자리가 있습니다.',
  non_tbd_future_slot: '2라운드 이후 자리에는 팀·부전승을 미리 놓을 수 없습니다.',
  slot_team_not_entrant: '진출팀 목록에 없는 팀이 배치돼 있습니다.',
  entrant_not_placed: '확정했지만 아직 자리에 놓이지 않은 팀이 있습니다.',
  declared_count_mismatch: '선언한 진출팀 수와 실제 확정 수가 다릅니다.',
  entrant_team_withdrawn: '기권 처리된 팀이 진출팀에 있습니다.',
  // 4D-0 Qualifier
  qualifier_group_missing: '지정한 예선 조가 없습니다. 조 편성을 확인해 주세요.',
  qualifier_rank_out_of_range: '그 조에는 없는 순위입니다. (조 정원 초과)',
  qualifier_rank_beyond_qualify: '본선 진출 인원을 넘는 순위를 지정했습니다. 의도한 것인지 확인해 주세요.',
};

export const BRACKET_DRIFT_TEXT: Record<string, string> = {
  qualified_not_entrant: '예선에서 진출(QUALIFIED)했지만 본선 진출팀에 없습니다.',
  entrant_not_qualified: '본선 진출팀이지만 현재 예선 기준으로는 진출이 아닙니다.',
};
