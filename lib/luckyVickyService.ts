// TEYEON 러키비키 — DB 조회/CRUD 계층.
//   · 읽기(Spotlight, /lucky-vicky): 회원 전용(RLS can_access_tennis_log). 게스트는 빈 결과.
//   · 쓰기(/admin/lucky-vicky): CEO/ADMIN(RLS). 중복참여·단일 active 는 DB(trigger/부분 unique)가 최종 보장.
//   · 테이블 미생성(마이그레이션 전)이면 빈 결과로 폴백 — 메인/‑lucky-vicky 가 깨지지 않는다(무장애).
import { supabase } from './supabase';
import type {
  LuckyVickyRound,
  LuckyVickyTeam,
  LuckyVickyRoundStatus,
  LuckyVickyTeamStatus,
  LuckyVickySupportStatus,
} from './luckyVickyData';

// ── DB row 타입 ────────────────────────────────────────────────────────────────
type RoundRow = {
  id: string;
  round_number: number;
  title: string;
  status: LuckyVickyRoundStatus;
  selection_method: string | null;
  expected_team_count: number | null;
  note: string | null;
  spotlight_enabled: boolean;
  created_at: string;
};
type TeamRow = {
  id: string;
  round_id: string;
  member_1_id: string;
  member_2_id: string;
  tournament_name: string | null;
  tournament_date: string | null;
  target_result: string | null;
  actual_result: string | null;
  team_status: LuckyVickyTeamStatus;
  support_status: LuckyVickySupportStatus;
  note: string | null;
  created_at: string;
};

const ROUND_COLS = 'id, round_number, title, status, selection_method, expected_team_count, note, spotlight_enabled, created_at';
const TEAM_COLS = 'id, round_id, member_1_id, member_2_id, tournament_name, tournament_date, target_result, actual_result, team_status, support_status, note, created_at';

/** 테이블/스키마 미생성(마이그레이션 전) 판정 — 그 경우 빈 결과 폴백. */
const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
    (msg.includes('lucky_vicky') && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('Could not find')));
};

const orEmpty = <T,>(err: unknown, empty: T): T => {
  if (isMissingRelation(err)) return empty;
  throw err;
};

// ── 매퍼 ───────────────────────────────────────────────────────────────────────
const undef = (v: string | null): string | undefined => (v && v.trim() ? v : undefined);

function mapTeam(row: TeamRow, nameById: Map<string, string>): LuckyVickyTeam {
  const ids = [row.member_1_id, row.member_2_id];
  return {
    id: row.id,
    memberIds: ids,
    memberNames: ids.map((id) => nameById.get(id) || ''),
    tournamentName: undef(row.tournament_name),
    tournamentDate: undef(row.tournament_date),
    targetResult: undef(row.target_result),
    actualResult: undef(row.actual_result),
    supportStatus: row.support_status,
    status: row.team_status,
    note: undef(row.note),
  };
}

function mapRound(row: RoundRow, teams: LuckyVickyTeam[]): LuckyVickyRound {
  return {
    id: row.id,
    round: row.round_number,
    title: row.title,
    status: row.status,
    selectionMethod: undef(row.selection_method),
    teams,
    expectedTeamCount: row.expected_team_count ?? undefined,
    spotlightEnabled: row.spotlight_enabled,
    note: undef(row.note),
  };
}

/** memberId → nickname 맵(표시명). id 로 확인된 실제 회원만. */
async function loadMemberNameMap(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data, error } = await supabase.from('members').select('id, nickname').in('id', unique);
  if (error) return map; // 이름 조회 실패 시 이름 비움(치명적 아님)
  for (const m of (data || []) as { id: string; nickname: string | null }[]) {
    map.set(String(m.id), String(m.nickname || ''));
  }
  return map;
}

async function assembleRounds(rounds: RoundRow[]): Promise<LuckyVickyRound[]> {
  if (rounds.length === 0) return [];
  const roundIds = rounds.map((r) => r.id);
  const { data: teamData, error: teamErr } = await supabase
    .from('lucky_vicky_teams').select(TEAM_COLS).in('round_id', roundIds);
  if (teamErr) return orEmpty(teamErr, rounds.map((r) => mapRound(r, [])));
  const teamRows = (teamData || []) as TeamRow[];
  const nameById = await loadMemberNameMap(teamRows.flatMap((t) => [t.member_1_id, t.member_2_id]));
  const byRound = new Map<string, LuckyVickyTeam[]>();
  for (const t of teamRows) {
    const list = byRound.get(t.round_id) || [];
    list.push(mapTeam(t, nameById));
    byRound.set(t.round_id, list);
  }
  return rounds.map((r) => mapRound(r, byRound.get(r.id) || []));
}

// ── 읽기 ───────────────────────────────────────────────────────────────────────

/** 메인 Spotlight 대상 회차 — active AND spotlight_enabled(둘 이상이면 최신 round_number). 없으면 null. */
export async function fetchSpotlightRound(): Promise<LuckyVickyRound | null> {
  try {
    const { data, error } = await supabase
      .from('lucky_vicky_rounds').select(ROUND_COLS)
      .eq('status', 'active').eq('spotlight_enabled', true)
      .order('round_number', { ascending: false });
    if (error) throw error;
    const rows = (data || []) as RoundRow[];
    if (rows.length === 0) return null;
    if (rows.length > 1) console.warn('[LuckyVicky] active+spotlight 회차가 2개 이상 — 최신 회차 사용:', rows.map((r) => r.round_number));
    const assembled = await assembleRounds([rows[0]]);
    return assembled[0] ?? null;
  } catch (err) {
    return orEmpty(err, null);
  }
}

/** /lucky-vicky 읽기 — 현재 active 회차 + completed 지난 회차(최신순), 팀 포함. */
export async function fetchLuckyVickyView(): Promise<{ active: LuckyVickyRound | null; past: LuckyVickyRound[] }> {
  try {
    const { data, error } = await supabase
      .from('lucky_vicky_rounds').select(ROUND_COLS)
      .in('status', ['active', 'completed'])
      .order('round_number', { ascending: false });
    if (error) throw error;
    const rounds = await assembleRounds((data || []) as RoundRow[]);
    const active = rounds.find((r) => r.status === 'active') ?? null;
    const past = rounds.filter((r) => r.status === 'completed');
    return { active, past };
  } catch (err) {
    return orEmpty(err, { active: null, past: [] });
  }
}

// ── 관리자 CRUD ─────────────────────────────────────────────────────────────────

/** 관리자 — 전체 회차(waiting 포함) + 팀. round_number 내림차순. */
export async function fetchAllRoundsAdmin(): Promise<LuckyVickyRound[]> {
  try {
    const { data, error } = await supabase
      .from('lucky_vicky_rounds').select(ROUND_COLS)
      .order('round_number', { ascending: false });
    if (error) throw error;
    return assembleRounds((data || []) as RoundRow[]);
  } catch (err) {
    return orEmpty(err, []);
  }
}

export interface RoundInput {
  roundNumber: number;
  title: string;
  status: LuckyVickyRoundStatus;
  selectionMethod?: string | null;
  expectedTeamCount?: number | null;
  note?: string | null;
  spotlightEnabled: boolean;
}

const roundPayload = (v: RoundInput) => ({
  round_number: v.roundNumber,
  title: v.title.trim(),
  status: v.status,
  selection_method: v.selectionMethod?.trim() || null,
  expected_team_count: v.expectedTeamCount ?? null,
  note: v.note?.trim() || null,
  spotlight_enabled: v.spotlightEnabled,
});

export async function createRound(v: RoundInput, createdBy?: string | null): Promise<void> {
  const { error } = await supabase.from('lucky_vicky_rounds').insert({ ...roundPayload(v), created_by: createdBy ?? null });
  if (error) throw error;
}
export async function updateRound(id: string, v: RoundInput): Promise<void> {
  const { error } = await supabase.from('lucky_vicky_rounds').update({ ...roundPayload(v), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function deleteRound(id: string): Promise<void> {
  const { error } = await supabase.from('lucky_vicky_rounds').delete().eq('id', id);
  if (error) throw error;
}

export interface TeamInput {
  roundId: string;
  member1Id: string;
  member2Id: string;
  tournamentName?: string | null;
  tournamentDate?: string | null;
  targetResult?: string | null;
  actualResult?: string | null;
  teamStatus: LuckyVickyTeamStatus;
  supportStatus: LuckyVickySupportStatus;
  note?: string | null;
}

const teamPayload = (v: TeamInput) => ({
  round_id: v.roundId,
  member_1_id: v.member1Id,
  member_2_id: v.member2Id,
  tournament_name: v.tournamentName?.trim() || null,
  tournament_date: v.tournamentDate || null,
  target_result: v.targetResult?.trim() || null,
  actual_result: v.actualResult?.trim() || null,
  team_status: v.teamStatus,
  support_status: v.supportStatus,
  note: v.note?.trim() || null,
});

export async function createTeam(v: TeamInput): Promise<void> {
  const { error } = await supabase.from('lucky_vicky_teams').insert(teamPayload(v));
  if (error) throw error;
}
export async function updateTeam(id: string, v: TeamInput): Promise<void> {
  const { error } = await supabase.from('lucky_vicky_teams').update(teamPayload(v)).eq('id', id);
  if (error) throw error;
}
export async function deleteTeam(id: string): Promise<void> {
  const { error } = await supabase.from('lucky_vicky_teams').delete().eq('id', id);
  if (error) throw error;
}

/** DB 오류를 관리자용 안내 문구로 변환(trigger/제약 위반 등). */
export function luckyVickyErrorMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  if (msg.includes('another team of this round')) return '이미 이 회차의 다른 팀에 포함된 회원입니다.';
  if (msg.includes('two different members') || code === '23514') return '한 팀에는 서로 다른 회원 2명을 선택해야 합니다.';
  if (msg.includes('lucky_vicky_rounds_single_active') || (code === '23505' && msg.includes('active'))) return '진행 중(active) 회차는 클럽당 1개만 가능합니다.';
  if (msg.includes('spotlight_active_only')) return '메인 노출(spotlight)은 진행 중(active) 회차에서만 켤 수 있습니다.';
  if (code === '23505') return '중복된 값이 있습니다(회차 번호 또는 진행 상태 확인).';
  if (code === '23503') return '존재하지 않는 회원 또는 회차입니다.';
  if (code === '42501') return '권한이 없습니다(CEO/ADMIN 전용).';
  return msg || '저장에 실패했습니다.';
}
