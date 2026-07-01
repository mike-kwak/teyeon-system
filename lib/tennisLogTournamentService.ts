// TENNIS LOG — 외부 대회 기록 service.
//   · DB: public.tennis_log_tournaments (supabase/add_tennis_log_tournaments.sql)
//   · 모든 접근은 RLS(owner_user_id = auth.uid() + 회원 자격)로 보호된다.
//     service 는 추가로 owner_user_id 를 명시 필터/주입해 의도를 분명히 한다.
//   · 타인의 id 를 직접 넘겨도 RLS 로 0행이 반환된다(상세는 not-found 로 처리).

import { supabase } from './supabase';
import type {
  TournamentRecord,
  TournamentRecordInput,
  TournamentMatchResult,
  TournamentMatchOutcome,
} from '@/types/tennisLog';

const TABLE = 'tennis_log_tournaments';

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

const NOT_LOGGED_IN = '로그인이 필요합니다. 다시 로그인해 주세요.';
const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function humanizeError(err: { message?: string; code?: string } | null): string {
  if (!err) return GENERIC_ERROR;
  // RLS 위반 등 사용자 친화 문구로 치환(원문은 콘솔에만).
  console.warn('[tennisLogTournamentService]', err.code ?? '', err.message ?? '');
  return GENERIC_ERROR;
}

async function getOwnerId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function nz(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s ? s : null;
}

const VALID_OUTCOMES: TournamentMatchOutcome[] = ['win', 'loss', 'draw', 'other'];

/** 빈 경기 행 제거 + 문자열 정리. 단계/상대/점수/메모가 모두 비면 버린다. */
function sanitizeMatchResults(list: TournamentMatchResult[] | null | undefined): TournamentMatchResult[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((m, i) => {
      const stage = (m?.stage ?? '').trim();
      const opponent = (m?.opponent ?? '').trim();
      const scoreFor = (m?.scoreFor ?? '').trim();
      const scoreAgainst = (m?.scoreAgainst ?? '').trim();
      const memo = (m?.memo ?? '').trim();
      const result: TournamentMatchOutcome = VALID_OUTCOMES.includes(m?.result) ? m.result : 'other';
      const id = (m?.id ?? '').toString() || `m_${i}`;
      return { id, stage, opponent, scoreFor, scoreAgainst, result, memo };
    })
    .filter((m) => m.stage || m.opponent || m.scoreFor || m.scoreAgainst || m.memo)
    .map((m) => (m.memo ? m : { ...m, memo: undefined }));
}

/** 입력값 → DB payload(트림/빈값 null 정리). owner_user_id 는 호출부에서 주입. */
function buildPayload(input: TournamentRecordInput) {
  const isCustomCategory = input.participation_category === '기타';
  const isBonseon = input.final_result === '본선';
  const rating =
    input.condition_rating === null || input.condition_rating === undefined
      ? null
      : Number(input.condition_rating);
  return {
    tournament_date: input.tournament_date,
    tournament_name: (input.tournament_name ?? '').trim(),
    region: nz(input.region),
    venue: nz(input.venue),
    event_type: (input.event_type ?? '').trim(),
    participation_category: nz(input.participation_category),
    // '기타'가 아니면 직접 입력값은 저장하지 않음(null).
    participation_category_custom: isCustomCategory ? nz(input.participation_category_custom) : null,
    partner_name: nz(input.partner_name),
    final_result: (input.final_result ?? '').trim(),
    // '본선'이 아니면 본선 상세는 저장하지 않음(null).
    result_detail: isBonseon ? nz(input.result_detail) : null,
    condition_rating: rating !== null && rating >= 1 && rating <= 5 ? rating : null,
    one_line_review: (input.one_line_review ?? '').trim(),
    good_points: nz(input.good_points),
    improvements: nz(input.improvements),
    next_goal: nz(input.next_goal),
    partner_memo: nz(input.partner_memo),
    match_results: sanitizeMatchResults(input.match_results),
  };
}

function rowToRecord(row: any): TournamentRecord {
  const rawMatches = Array.isArray(row?.match_results) ? row.match_results : [];
  const match_results: TournamentMatchResult[] = rawMatches.map((m: any, i: number) => ({
    id: (m?.id ?? `m_${i}`).toString(),
    stage: (m?.stage ?? '').toString(),
    opponent: (m?.opponent ?? '').toString(),
    scoreFor: (m?.scoreFor ?? '').toString(),
    scoreAgainst: (m?.scoreAgainst ?? '').toString(),
    result: VALID_OUTCOMES.includes(m?.result) ? m.result : 'other',
    memo: m?.memo ? m.memo.toString() : undefined,
  }));
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    tournament_date: row.tournament_date,
    tournament_name: row.tournament_name,
    region: row.region ?? null,
    venue: row.venue ?? null,
    event_type: row.event_type,
    participation_category: row.participation_category ?? null,
    participation_category_custom: row.participation_category_custom ?? null,
    partner_name: row.partner_name ?? null,
    final_result: row.final_result,
    result_detail: row.result_detail ?? null,
    condition_rating: row.condition_rating ?? null,
    one_line_review: row.one_line_review,
    good_points: row.good_points ?? null,
    improvements: row.improvements ?? null,
    next_goal: row.next_goal ?? null,
    partner_memo: row.partner_memo ?? null,
    match_results,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** 대회 기록 생성. 성공 시 생성된 레코드(상세 이동용 id 포함) 반환. */
export async function createTournament(
  input: TournamentRecordInput,
): Promise<ServiceResult<TournamentRecord>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const payload = { owner_user_id: owner, ...buildPayload(input) };
  const { data, error } = await supabase.from(TABLE).insert(payload).select('*').single();
  if (error) return { data: null, error: humanizeError(error) };
  return { data: rowToRecord(data), error: null };
}

/** 본인 대회 기록 전체 목록(tournament_date desc, created_at desc). */
export async function listTournaments(): Promise<ServiceResult<TournamentRecord[]>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('owner_user_id', owner)
    .order('tournament_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: humanizeError(error) };
  return { data: (data ?? []).map(rowToRecord), error: null };
}

/** 본인 대회 기록 단건. 없거나 타인 기록이면 data=null(not-found). */
export async function getTournament(id: string): Promise<ServiceResult<TournamentRecord>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };
  if (!id) return { data: null, error: null };

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .eq('owner_user_id', owner)
    .maybeSingle();
  if (error) return { data: null, error: humanizeError(error) };
  return { data: data ? rowToRecord(data) : null, error: null };
}

/** 본인 대회 기록 수정. owner_user_id 는 변경하지 않는다. */
export async function updateTournament(
  id: string,
  input: TournamentRecordInput,
): Promise<ServiceResult<TournamentRecord>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const payload = buildPayload(input);
  const { data, error } = await supabase
    .from(TABLE)
    .update(payload)
    .eq('id', id)
    .eq('owner_user_id', owner)
    .select('*')
    .single();
  if (error) return { data: null, error: humanizeError(error) };
  return { data: rowToRecord(data), error: null };
}

/** 본인 대회 기록 삭제. */
export async function deleteTournament(id: string): Promise<ServiceResult<true>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id)
    .eq('owner_user_id', owner);
  if (error) return { data: null, error: humanizeError(error) };
  return { data: true, error: null };
}

/** 특정 연도 본인 대회 기록 수(홈 '올해 외부 대회'). */
export async function countTournamentsByYear(year: number): Promise<ServiceResult<number>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const { count, error } = await supabase
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', owner)
    .gte('tournament_date', start)
    .lte('tournament_date', end);
  if (error) return { data: null, error: humanizeError(error) };
  return { data: count ?? 0, error: null };
}

/** 최근 본인 대회 기록 N개(홈 '최근 대회'). */
export async function getRecentTournaments(limit = 3): Promise<ServiceResult<TournamentRecord[]>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('owner_user_id', owner)
    .order('tournament_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { data: null, error: humanizeError(error) };
  return { data: (data ?? []).map(rowToRecord), error: null };
}

/**
 * 월 범위 본인 대회 기록 — 기록 캘린더용. [startDate 포함, endDateExclusive 미만).
 *   date 오름차순 + created_at 내림차순(같은 날짜 안에서 최신 먼저).
 *   RLS(owner_user_id = auth.uid()) 위에 명시 필터로 본인 데이터만 반환.
 */
export async function listTournamentsByDateRange(
  startDate: string,
  endDateExclusive: string,
): Promise<ServiceResult<TournamentRecord[]>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('owner_user_id', owner)
    .gte('tournament_date', startDate)
    .lt('tournament_date', endDateExclusive)
    .order('tournament_date', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: humanizeError(error) };
  return { data: (data ?? []).map(rowToRecord), error: null };
}
