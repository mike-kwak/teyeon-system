// TENNIS LOG — 레슨일지 service. 대회 기록 service(tennisLogTournamentService)와 동일 패턴.
//   · DB: public.tennis_log_lessons (supabase/add_tennis_log_lessons.sql)
//   · 모든 접근은 RLS(owner_user_id = auth.uid() + 회원 자격)로 보호된다.
//     service 는 추가로 owner_user_id 를 명시 필터/주입해 의도를 분명히 한다.
//   · 타인의 id 를 직접 넘겨도 RLS 로 0행이 반환된다(상세는 not-found 로 처리).

import { supabase } from './supabase';
import type { TennisLessonRecord, TennisLessonInput } from '@/types/tennisLog';

const TABLE = 'tennis_log_lessons';

export interface ServiceResult<T> {
  data: T | null;
  error: string | null;
}

const NOT_LOGGED_IN = '로그인이 필요합니다. 다시 로그인해 주세요.';
const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';

function humanizeError(err: { message?: string; code?: string } | null): string {
  if (!err) return GENERIC_ERROR;
  console.warn('[tennisLogLessonService]', err.code ?? '', err.message ?? '');
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

/** 입력값 → DB payload(트림/빈값 null 정리). owner_user_id 는 호출부에서 주입. */
function buildPayload(input: TennisLessonInput) {
  return {
    lesson_date: input.lesson_date,
    coach_name: nz(input.coach_name),
    lesson_topic: (input.lesson_topic ?? '').trim(),
    learned_points: (input.learned_points ?? '').trim(),
    correction_points: nz(input.correction_points),
    practice_tasks: nz(input.practice_tasks),
    next_goal: nz(input.next_goal),
    free_memo: nz(input.free_memo),
  };
}

function rowToRecord(row: any): TennisLessonRecord {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    lesson_date: row.lesson_date,
    coach_name: row.coach_name ?? null,
    lesson_topic: row.lesson_topic,
    learned_points: row.learned_points,
    correction_points: row.correction_points ?? null,
    practice_tasks: row.practice_tasks ?? null,
    next_goal: row.next_goal ?? null,
    free_memo: row.free_memo ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** 레슨일지 생성. 성공 시 생성된 레코드(상세 이동용 id 포함) 반환. */
export async function createLesson(input: TennisLessonInput): Promise<ServiceResult<TennisLessonRecord>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const payload = { owner_user_id: owner, ...buildPayload(input) };
  const { data, error } = await supabase.from(TABLE).insert(payload).select('*').single();
  if (error) return { data: null, error: humanizeError(error) };
  return { data: rowToRecord(data), error: null };
}

/** 본인 레슨일지 전체 목록(lesson_date desc, created_at desc). */
export async function listLessons(): Promise<ServiceResult<TennisLessonRecord[]>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('owner_user_id', owner)
    .order('lesson_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: humanizeError(error) };
  return { data: (data ?? []).map(rowToRecord), error: null };
}

/** 본인 레슨일지 단건. 없거나 타인 기록이면 data=null(not-found). */
export async function getLesson(id: string): Promise<ServiceResult<TennisLessonRecord>> {
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

/** 본인 레슨일지 수정. owner_user_id 는 변경하지 않는다. */
export async function updateLesson(
  id: string,
  input: TennisLessonInput,
): Promise<ServiceResult<TennisLessonRecord>> {
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

/** 본인 레슨일지 삭제. */
export async function deleteLesson(id: string): Promise<ServiceResult<true>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('owner_user_id', owner);
  if (error) return { data: null, error: humanizeError(error) };
  return { data: true, error: null };
}

/** 특정 연도 본인 레슨 수(홈 '올해 레슨'). */
export async function countLessonsByYear(year: number): Promise<ServiceResult<number>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const { count, error } = await supabase
    .from(TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('owner_user_id', owner)
    .gte('lesson_date', start)
    .lte('lesson_date', end);
  if (error) return { data: null, error: humanizeError(error) };
  return { data: count ?? 0, error: null };
}

/** 최근 본인 레슨 N개(홈 '최근 레슨'). */
export async function getRecentLessons(limit = 2): Promise<ServiceResult<TennisLessonRecord[]>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('owner_user_id', owner)
    .order('lesson_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { data: null, error: humanizeError(error) };
  return { data: (data ?? []).map(rowToRecord), error: null };
}

/**
 * 현재 연습 목표 — 가장 최근의 비어있지 않은 next_goal.
 *   정렬: lesson_date desc, created_at desc. next_goal null/공백 제외.
 *   (PostgREST 로 next_goal null 만 1차 제외하고, 공백-only 는 JS 에서 한 번 더 거른다.)
 */
export async function getCurrentPracticeGoal(): Promise<ServiceResult<string | null>> {
  const owner = await getOwnerId();
  if (!owner) return { data: null, error: NOT_LOGGED_IN };

  const { data, error } = await supabase
    .from(TABLE)
    .select('next_goal, lesson_date, created_at')
    .eq('owner_user_id', owner)
    .not('next_goal', 'is', null)
    .order('lesson_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return { data: null, error: humanizeError(error) };

  const goal = (data ?? [])
    .map((r: any) => (r.next_goal ?? '').trim())
    .find((g: string) => g.length > 0);
  return { data: goal ?? null, error: null };
}
