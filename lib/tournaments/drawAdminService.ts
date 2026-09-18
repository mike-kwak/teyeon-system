// Tournament 운영(Admin) — Team / Court / Fixture. Batch 1 범위.
//
//   · 원본 테이블을 클라이언트가 직접 SELECT 하지 않는다. 전부 운영 RPC 경유.
//     RPC 내부에서 can_manage_tournaments()(CEO/ADMIN)를 다시 검증하므로
//     UI 가 뚫려도 데이터가 나가지 않는다. (adminService.ts 와 동일 원칙)
//   · migration 미적용/권한 없음은 ready=false 로 흡수해 화면이 깨지지 않게 한다.
//   · 신규 RPC 는 업무 실패를 예외가 아니라 { ok:false, reason } jsonb 로 돌려준다.
//     권한 실패(42501)만 예외다. 아래 unwrap 이 두 경로를 한 가지로 정리한다.

import { supabase } from '@/lib/supabase';
import type {
  DrawIssue,
  DrawValidation,
  FixtureTournament,
  GroupMember,
  PreliminaryDraw,
  PreliminaryDrawStatus,
  PromoteTeamsResult,
  TournamentCourt,
  TournamentCourtStatus,
  TournamentGroup,
  TournamentGroupType,
  TournamentTeam,
  TournamentTeamSource,
  TournamentTeamStatus,
  UnassignedTeam,
} from './drawTypes';
import type { BulkAssignmentGroup } from './groupPasteParser';

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournament_(teams|courts|events|groups|group_members)|promote_confirmed_registrations|seed_fixture_tournament|(get_admin|upsert|set_feature|delete)_tournament|get_admin_fixture_tournaments|update_tournament_team|(create|delete)_tournament_group|(assign|unassign|move)_group_team|swap_group_teams|reorder_group_slots|(validate|lock|unlock)_preliminary_draw|get_admin_preliminary_draw|replace_preliminary_group_assignments/.test(
      msg,
    ) &&
      /does not exist|schema cache|Could not find/.test(msg))
  );
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/** RPC 가 돌려준 { ok, reason } 을 확인한다. ok=false 면 reason 을 담아 throw. */
function unwrap(data: unknown): Record<string, unknown> {
  const o = rec(data);
  if (o.ok === false) {
    const err = new Error(str(o.reason) || 'UNKNOWN') as Error & {
      reason?: string;
      payload?: Record<string, unknown>;
    };
    err.reason = str(o.reason);
    // lock 실패 시 validation 상세처럼 부가 정보가 붙는 경우가 있어 원본을 함께 남긴다.
    err.payload = o;
    throw err;
  }
  return o;
}

// ── Team ─────────────────────────────────────────────────────────────────────

export async function fetchAdminTeams(
  slug: string,
): Promise<{ ready: boolean; rows: TournamentTeam[] }> {
  try {
    const { data, error } = await supabase.rpc('get_admin_tournament_teams', { p_slug: slug });
    if (error) throw error;
    // 권한이 없으면 RPC 가 null 을 준다 — 빈 목록이 아니라 '조회 불가'로 구분한다.
    if (data === null || data === undefined) return { ready: false, rows: [] };
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return {
      ready: true,
      rows: rows.map((r) => ({
        id: str(r.id),
        teamNo: num(r.teamNo),
        player1Name: str(r.player1Name),
        player2Name: str(r.player2Name),
        player1ClubName: strOrNull(r.player1ClubName),
        player2ClubName: strOrNull(r.player2ClubName),
        clubName: strOrNull(r.clubName),
        source: (str(r.source) || 'manual') as TournamentTeamSource,
        status: (str(r.status) || 'active') as TournamentTeamStatus,
        seedNo: r.seedNo === null || r.seedNo === undefined ? null : num(r.seedNo),
        fromRegistration: r.fromRegistration === true,
        createdAt: strOrNull(r.createdAt),
      })),
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    throw err;
  }
}

/**
 * confirmed 접수 → Tournament Team 승격. **멱등**이다.
 *   ⚠ 실제 운영 대회에서는 참가접수 마감 후 운영자가 명시적으로 실행한다.
 *     이 함수는 접수 데이터를 읽기만 하고 수정·삭제하지 않는다.
 */
export async function promoteConfirmedRegistrations(slug: string): Promise<PromoteTeamsResult> {
  const { data, error } = await supabase.rpc('promote_confirmed_registrations', { p_slug: slug });
  if (error) throw error;
  const o = unwrap(data);
  return {
    inserted: num(o.inserted),
    alreadyPromoted: num(o.alreadyPromoted),
    confirmedTotal: num(o.confirmedTotal),
  };
}

export interface UpdateTeamInput {
  teamId: string;
  /** null/undefined = 변경 없음. */
  teamNo?: number | null;
  seedNo?: number | null;
  status?: TournamentTeamStatus | null;
  /** true 면 seedNo 를 지운다(seedNo 값보다 우선). */
  clearSeed?: boolean;
}

export async function updateTeam(v: UpdateTeamInput): Promise<void> {
  const { data, error } = await supabase.rpc('update_tournament_team', {
    p_team_id: v.teamId,
    p_team_no: v.teamNo ?? null,
    p_seed_no: v.seedNo ?? null,
    p_status: v.status ?? null,
    p_clear_seed: v.clearSeed === true,
  });
  if (error) throw error;
  unwrap(data);
}

// ── Court ────────────────────────────────────────────────────────────────────

export async function fetchAdminCourts(
  slug: string,
): Promise<{ ready: boolean; rows: TournamentCourt[] }> {
  try {
    const { data, error } = await supabase.rpc('get_admin_tournament_courts', { p_slug: slug });
    if (error) throw error;
    if (data === null || data === undefined) return { ready: false, rows: [] };
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return {
      ready: true,
      rows: rows.map((r) => ({
        id: str(r.id),
        courtNo: num(r.courtNo),
        displayName: strOrNull(r.displayName),
        displayOrder: num(r.displayOrder),
        status: (str(r.status) || 'active') as TournamentCourtStatus,
        isFeatureCourt: r.isFeatureCourt === true,
      })),
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    throw err;
  }
}

export interface UpsertCourtInput {
  slug: string;
  courtNo: number;
  /** null/undefined = 변경 없음. */
  displayName?: string | null;
  displayOrder?: number | null;
  status?: TournamentCourtStatus | null;
  /** true 면 표시 이름을 지운다(번호로 표기). */
  clearName?: boolean;
}

export async function upsertCourt(v: UpsertCourtInput): Promise<void> {
  const { data, error } = await supabase.rpc('upsert_tournament_court', {
    p_slug: v.slug,
    p_court_no: v.courtNo,
    p_display_name: v.displayName ?? null,
    p_display_order: v.displayOrder ?? null,
    p_status: v.status ?? null,
    p_clear_name: v.clearName === true,
  });
  if (error) throw error;
  unwrap(data);
}

/** LIVE 중계 코트 지정. courtNo=null 이면 해제. 대회당 1면은 DB 가 강제한다. */
export async function setFeatureCourt(slug: string, courtNo: number | null): Promise<void> {
  const { data, error } = await supabase.rpc('set_feature_court', {
    p_slug: slug,
    p_court_no: courtNo,
  });
  if (error) throw error;
  unwrap(data);
}

export async function deleteCourt(slug: string, courtNo: number): Promise<void> {
  const { data, error } = await supabase.rpc('delete_tournament_court', {
    p_slug: slug,
    p_court_no: courtNo,
  });
  if (error) throw error;
  unwrap(data);
}

// ── Fixture ──────────────────────────────────────────────────────────────────

export async function fetchFixtureTournaments(): Promise<{
  ready: boolean;
  rows: FixtureTournament[];
}> {
  try {
    const { data, error } = await supabase.rpc('get_admin_fixture_tournaments');
    if (error) throw error;
    if (data === null || data === undefined) return { ready: false, rows: [] };
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return {
      ready: true,
      rows: rows.map((r) => ({
        slug: str(r.slug),
        title: str(r.title),
        status: str(r.status),
        teamCount: num(r.teamCount),
        courtCount: num(r.courtCount),
      })),
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    throw err;
  }
}

export interface SeedFixtureInput {
  slug: string;
  title: string;
  teamCount: number;
  /** true 면 기존 fixture 팀을 지우고 다시 만든다. */
  reset?: boolean;
  /** 0 이면 코트를 만들지 않는다. */
  courtCount?: number;
}

export async function seedFixtureTournament(
  v: SeedFixtureInput,
): Promise<{ teamsCreated: number; courtsCreated: number }> {
  const { data, error } = await supabase.rpc('seed_fixture_tournament', {
    p_slug: v.slug,
    p_title: v.title,
    p_team_count: v.teamCount,
    p_reset: v.reset === true,
    p_court_count: v.courtCount ?? 0,
  });
  if (error) throw error;
  const o = unwrap(data);
  return { teamsCreated: num(o.teamsCreated), courtsCreated: num(o.courtsCreated) };
}

// ── 예선 조편성 (Batch 2A) ───────────────────────────────────────────────────
//
//   ⚠ 여기에는 조를 계산하거나 팀을 배치하는 코드가 없다. 전부 '경기이사가 지정한 값'을
//     서버 RPC 로 그대로 넘기는 얇은 래퍼다. 자동 편성 로직을 이 파일에 추가하지 않는다.
//   ⚠ 모든 write 는 version 을 되돌려준다. 화면은 그 값을 보관했다가 lock 에 넘긴다.

const memberOf = (r: Record<string, unknown>): GroupMember => ({
  slotNo: num(r.slotNo),
  teamId: str(r.teamId),
  teamNo: num(r.teamNo),
  player1Name: str(r.player1Name),
  player2Name: str(r.player2Name),
  player1ClubName: strOrNull(r.player1ClubName),
  player2ClubName: strOrNull(r.player2ClubName),
  teamStatus: (str(r.teamStatus) || 'active') as TournamentTeamStatus,
});

const validationOf = (v: unknown): DrawValidation => {
  const o = rec(v);
  const s = rec(o.summary);
  return {
    ok: o.ok === true,
    summary: {
      groupCount: num(s.groupCount),
      preliminaryGroups: num(s.preliminaryGroups),
      placementGroups: num(s.placementGroups),
      activeTeams: num(s.activeTeams),
      assignedTeams: num(s.assignedTeams),
      unassignedTeams: num(s.unassignedTeams),
    },
    issues: (Array.isArray(o.issues) ? o.issues : []).map((i) => rec(i) as DrawIssue),
  };
};

/**
 * 조편성 전체 조회.
 *   권한이 없거나 대회를 못 찾으면 RPC 가 null 을 준다 → ready=false 로 구분한다
 *   ('조가 0개'와 '조회 불가'는 다른 상태다).
 */
export async function fetchPreliminaryDraw(
  slug: string,
): Promise<{ ready: boolean; draw: PreliminaryDraw | null }> {
  try {
    const { data, error } = await supabase.rpc('get_admin_preliminary_draw', { p_slug: slug });
    if (error) throw error;
    if (data === null || data === undefined) return { ready: false, draw: null };
    const o = rec(data);
    return {
      ready: true,
      draw: {
        slug: str(o.slug),
        tournamentStatus: str(o.tournamentStatus),
        drawStatus: (str(o.drawStatus) || 'draft') as PreliminaryDrawStatus,
        version: num(o.version),
        lockedAt: strOrNull(o.lockedAt),
        groups: (Array.isArray(o.groups) ? o.groups : []).map((g) => {
          const r = rec(g);
          return {
            groupId: str(r.groupId),
            groupNo: num(r.groupNo),
            label: strOrNull(r.label),
            groupType: (str(r.groupType) || 'preliminary') as TournamentGroupType,
            expectedSize: num(r.expectedSize),
            displayOrder: num(r.displayOrder),
            members: (Array.isArray(r.members) ? r.members : []).map((m) => memberOf(rec(m))),
          } satisfies TournamentGroup;
        }),
        unassigned: (Array.isArray(o.unassigned) ? o.unassigned : []).map((u) => {
          const r = rec(u);
          return {
            teamId: str(r.teamId),
            teamNo: num(r.teamNo),
            player1Name: str(r.player1Name),
            player2Name: str(r.player2Name),
            player1ClubName: strOrNull(r.player1ClubName),
            player2ClubName: strOrNull(r.player2ClubName),
            teamStatus: (str(r.teamStatus) || 'active') as TournamentTeamStatus,
          } satisfies UnassignedTeam;
        }),
        validation: validationOf(o.validation),
      },
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, draw: null };
    throw err;
  }
}

/** write RPC 공통 결과. */
export interface DrawWriteResult {
  version: number;
}

async function drawWrite(fn: string, args: Record<string, unknown>): Promise<DrawWriteResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const o = unwrap(data);
  return { version: num(o.version) };
}

export interface CreateGroupsInput {
  slug: string;
  /** 경기이사가 입력한 조 개수. ⚠ 시스템이 팀 수로부터 계산하지 않는다. */
  preliminaryCount: number;
  /** 순위결정전 조(2팀)를 함께 만들지. 대회당 1개. */
  withPlacement?: boolean;
  expectedVersion?: number | null;
}

export async function createGroups(v: CreateGroupsInput): Promise<DrawWriteResult> {
  return drawWrite('create_tournament_groups', {
    p_slug: v.slug,
    p_preliminary_count: v.preliminaryCount,
    p_with_placement: v.withPlacement === true,
    p_expected_version: v.expectedVersion ?? null,
  });
}

export async function deleteGroup(
  slug: string, groupNo: number, expectedVersion?: number | null,
): Promise<DrawWriteResult> {
  return drawWrite('delete_tournament_group', {
    p_slug: slug, p_group_no: groupNo, p_expected_version: expectedVersion ?? null,
  });
}

export interface AssignTeamInput {
  slug: string;
  groupNo: number;
  teamId: string;
  /** 생략하면 서버가 그 조의 가장 작은 빈 자리를 고른다. */
  slotNo?: number | null;
  expectedVersion?: number | null;
}

export async function assignTeam(v: AssignTeamInput): Promise<DrawWriteResult> {
  return drawWrite('assign_group_team', {
    p_slug: v.slug, p_group_no: v.groupNo, p_team_id: v.teamId,
    p_slot_no: v.slotNo ?? null, p_expected_version: v.expectedVersion ?? null,
  });
}

export async function unassignTeam(
  slug: string, teamId: string, expectedVersion?: number | null,
): Promise<DrawWriteResult> {
  return drawWrite('unassign_group_team', {
    p_slug: slug, p_team_id: teamId, p_expected_version: expectedVersion ?? null,
  });
}

export interface MoveTeamInput {
  slug: string;
  teamId: string;
  toGroupNo: number;
  toSlotNo?: number | null;
  expectedVersion?: number | null;
}

export async function moveTeam(v: MoveTeamInput): Promise<DrawWriteResult> {
  return drawWrite('move_group_team', {
    p_slug: v.slug, p_team_id: v.teamId, p_to_group_no: v.toGroupNo,
    p_to_slot_no: v.toSlotNo ?? null, p_expected_version: v.expectedVersion ?? null,
  });
}

export async function swapTeams(
  slug: string, teamAId: string, teamBId: string, expectedVersion?: number | null,
): Promise<DrawWriteResult> {
  return drawWrite('swap_group_teams', {
    p_slug: slug, p_team_a_id: teamAId, p_team_b_id: teamBId,
    p_expected_version: expectedVersion ?? null,
  });
}

/** 조 내 순서 일괄 재배치. teamIds 의 순서가 곧 slot 1..N 이다. */
export async function reorderGroupSlots(
  slug: string, groupNo: number, teamIds: string[], expectedVersion?: number | null,
): Promise<DrawWriteResult> {
  return drawWrite('reorder_group_slots', {
    p_slug: slug, p_group_no: groupNo, p_team_ids: teamIds,
    p_expected_version: expectedVersion ?? null,
  });
}

/**
 * 조편성 검증(읽기 전용).
 *   ⚠ ok=false 는 '오류'가 아니라 '검증 미통과'다. throw 하지 않고 그대로 돌려준다.
 *     대회를 못 찾은 경우(reason 이 있는 응답)만 예외로 올린다.
 */
export async function validateDraw(slug: string): Promise<DrawValidation> {
  const { data, error } = await supabase.rpc('validate_preliminary_draw', { p_slug: slug });
  if (error) throw error;
  const o = rec(data);
  if (o.issues === undefined && o.ok === false) unwrap(data); // reason 계열 → throw
  return validationOf(o);
}

export interface LockDrawResult extends DrawWriteResult {
  /** 예: 'registration_still_open' — 잠그긴 했지만 알아둬야 할 사항. */
  warnings: string[];
}

/** 조편성 잠금. 서버가 검증을 다시 실행하며, 실패하면 reason='validation_failed'. */
export async function lockDraw(slug: string, expectedVersion: number): Promise<LockDrawResult> {
  const { data, error } = await supabase.rpc('lock_preliminary_draw', {
    p_slug: slug, p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    version: num(o.version),
    warnings: (Array.isArray(o.warnings) ? o.warnings : []).map((w) => str(w)).filter(Boolean),
  };
}

export interface UnlockDrawResult extends DrawWriteResult {
  /** 이미 만들어진 경기 수. 0 보다 크면 조편성 변경 시 경기 목록이 낡게 된다. */
  existingMatches: number;
  /** unlock 하면서 WAITING 으로 되돌린 CALLING 경기 수. */
  callingReset: number;
  /** 예: 'matches_exist' · 'calling_reset' */
  warnings: string[];
}

/**
 * 조편성 잠금 해제. ⚠ 사유(reason)가 없으면 서버가 거부한다.
 *   ⚠ 진행·완료된 경기가 하나라도 있으면 서버가 'matches_in_progress' 로 차단한다.
 *   ⚠ 성공 시 CALLING 경기는 서버가 WAITING 으로 되돌린다(경기 삭제는 하지 않는다).
 */
export async function unlockDraw(
  slug: string, reason: string, expectedVersion?: number | null,
): Promise<UnlockDrawResult> {
  const { data, error } = await supabase.rpc('unlock_preliminary_draw', {
    p_slug: slug, p_reason: reason, p_expected_version: expectedVersion ?? null,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    version: num(o.version),
    existingMatches: num(o.existingMatches),
    callingReset: num(o.callingReset),
    warnings: (Array.isArray(o.warnings) ? o.warnings : []).map((w) => str(w)).filter(Boolean),
  };
}

// ── 일괄 조편성 반영 (Batch 2B-2) ────────────────────────────────────────────
//
//   ⚠ 클라이언트가 assign RPC 를 50번 반복하지 않는다. 서버가 한 트랜잭션에서 전체를
//     교체한다. 중간 상태(절반만 배정된 조편성)가 만들어질 수 없다.
//   ⚠ payload 의 조 번호는 경기이사가 붙여넣은 값이다. 클라이언트도 서버도 정하지 않는다.

export interface ReplaceAssignmentsResult {
  assignedTeams: number;
  previousAssignedTeams: number;
  createdGroups: number;
  removedGroups: number;
  version: number;
}

export async function replaceGroupAssignments(
  slug: string,
  groups: BulkAssignmentGroup[],
  expectedVersion: number,
): Promise<ReplaceAssignmentsResult> {
  const { data, error } = await supabase.rpc('replace_preliminary_group_assignments', {
    p_slug: slug,
    p_groups: groups,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    assignedTeams: num(o.assignedTeams),
    previousAssignedTeams: num(o.previousAssignedTeams),
    createdGroups: num(o.createdGroups),
    removedGroups: num(o.removedGroups),
    version: num(o.version),
  };
}

// ── 오류 문구 ────────────────────────────────────────────────────────────────

/** RPC reason / SQLSTATE 를 운영자용 한국어 한 줄로. 내부 상세를 그대로 보여주지 않는다. */
export function drawActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = String(e?.code || '');
  const reason = String(e?.reason || '');
  const msg = String(e?.message || '');
  const key = reason || msg;

  if (code === '42501' || /not authorized/i.test(msg)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isMissingRelation(err)) return 'Tournament 운영 테이블이 아직 적용되지 않았습니다. (migration 대기)';

  switch (key) {
    case 'tournament_not_found':     return '대회를 찾을 수 없습니다.';
    case 'team_not_found':           return '팀을 찾을 수 없습니다.';
    case 'team_no_taken':            return '이미 사용 중인 팀 번호입니다.';
    case 'invalid_team_no':          return '팀 번호는 1 이상이어야 합니다.';
    case 'invalid_status':           return '허용되지 않은 상태입니다.';
    case 'court_not_found':          return '코트를 찾을 수 없습니다.';
    case 'court_conflict':           return '코트 번호 또는 표시 순서가 다른 코트와 겹칩니다.';
    case 'invalid_court_no':         return '코트 번호는 1~30 사이여야 합니다.';
    case 'invalid_display_order':    return '표시 순서는 1 이상이어야 합니다.';
    case 'invalid_court_count':      return '코트 수는 0~30 사이여야 합니다.';
    case 'invalid_team_count':       return '팀 수는 1~200 사이여야 합니다.';
    case 'not_a_fixture_slug':       return 'fixture- 로 시작하는 대회에서만 실행할 수 있습니다.';
    case 'not_draft':                return 'draft 상태인 대회에서만 실행할 수 있습니다.';
    case 'has_real_registrations':   return '실제 참가신청이 있는 대회에는 fixture 를 생성할 수 없습니다.';
    case 'already_seeded':           return '이미 팀이 있습니다. 다시 만들려면 초기화를 선택하세요.';

    // ── 조편성 (Batch 2A) ──
    case 'draw_locked':              return '조편성이 확정(잠금)되어 있습니다. 수정하려면 먼저 잠금을 해제하세요.';
    case 'draw_not_locked':          return '잠겨 있지 않은 조편성입니다.';
    case 'matches_in_progress':      return '진행 중이거나 완료된 경기가 있어 조편성을 열 수 없습니다.';
    case 'version_conflict':         return '다른 곳에서 먼저 변경됐습니다. 새로고침 후 다시 시도해 주세요.';
    case 'version_required':         return '조편성 버전이 필요합니다. 새로고침 후 다시 시도해 주세요.';
    case 'reason_required':          return '잠금 해제 사유를 입력해 주세요.';
    case 'validation_failed':        return '검증을 통과하지 못했습니다. 아래 항목을 확인해 주세요.';
    case 'invalid_group_count':      return '조 개수는 0~40 사이여야 합니다.';
    case 'nothing_to_create':        return '만들 조가 없습니다.';
    case 'group_not_found':          return '조를 찾을 수 없습니다.';
    case 'group_not_empty':          return '팀이 배정된 조는 삭제할 수 없습니다. 먼저 팀을 빼주세요.';
    case 'group_full':               return '조 정원이 찼습니다.';
    case 'slot_taken':               return '이미 사용 중인 자리입니다.';
    case 'slot_out_of_range':        return '조 정원을 넘는 자리 번호입니다.';
    case 'team_not_in_tournament':   return '이 대회의 팀이 아닙니다.';
    case 'team_withdrawn':           return '기권 처리된 팀은 배정할 수 없습니다.';
    case 'team_already_assigned':    return '이미 다른 조에 배정된 팀입니다.';
    case 'team_not_assigned':        return '아직 배정되지 않은 팀입니다.';
    case 'team_not_in_group':        return '해당 조에 속하지 않은 팀이 목록에 있습니다.';
    case 'same_team':                return '같은 팀끼리는 교환할 수 없습니다.';
    case 'empty_team_list':          return '순서를 지정할 팀이 없습니다.';
    case 'duplicate_team_in_list':   return '목록에 같은 팀이 중복되어 있습니다.';
    case 'member_list_mismatch':     return '조의 팀 수와 지정한 순서의 개수가 다릅니다.';

    // ── 일괄 반영 (Batch 2B-2) ──
    case 'invalid_payload':          return '붙여넣은 조편성 데이터 형식이 올바르지 않습니다.';
    case 'empty_payload':            return '반영할 조편성이 없습니다.';
    case 'invalid_group_no':         return '조 번호가 올바르지 않습니다.';
    case 'duplicate_group_no':       return '같은 조 번호가 두 번 나옵니다.';
    case 'invalid_team_id':          return '팀 식별자가 올바르지 않습니다. 다시 미리보기를 실행해 주세요.';
    case 'duplicate_team':           return '같은 팀이 두 번 이상 배정돼 있습니다.';
    case 'multiple_placement':       return '순위결정전 조는 하나만 만들 수 있습니다.';
    case 'missing_active_teams':     return '입력에서 빠진 참가팀이 있습니다. 전체 조편성을 붙여넣어야 반영됩니다.';

    default:                         return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
