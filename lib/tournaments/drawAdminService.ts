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
  FixtureTournament,
  PromoteTeamsResult,
  TournamentCourt,
  TournamentCourtStatus,
  TournamentTeam,
  TournamentTeamSource,
  TournamentTeamStatus,
} from './drawTypes';

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournament_(teams|courts|events)|promote_confirmed_registrations|seed_fixture_tournament|(get_admin|upsert|set_feature|delete)_tournament|get_admin_fixture_tournaments|update_tournament_team/.test(
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
    const err = new Error(str(o.reason) || 'UNKNOWN');
    (err as Error & { reason?: string }).reason = str(o.reason);
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
    default:                         return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
