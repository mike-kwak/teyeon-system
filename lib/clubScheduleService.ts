// Club Schedule 전용 Supabase CRUD.
// club_schedules 테이블 대상 — tournament_events 테이블은 건드리지 않음.
// TODO: 정모 참석 체크 연동 시 club_attendances 테이블 추가 예정.

import { supabase } from './supabase';
import { ClubSchedule, ClubScheduleInput, ClubScheduleType, ClubCourtMode } from './clubScheduleData';

export type { ClubScheduleInput };

type ClubScheduleRow = {
  id: string;
  title: string;
  schedule_type: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  court_count: number | null;
  court_mode?: string | null;
  guest_enabled: boolean;
  guest_limit: number | null;
  fee_amount: number | null;
  show_on_main: boolean;
  memo: string | null;
  created_by: string | null;
  attendance_enabled?: boolean | null;
  attendance_deadline?: string | null;
};

function toClubSchedule(row: ClubScheduleRow): ClubSchedule {
  return {
    id: row.id,
    title: row.title,
    schedule_type: row.schedule_type as ClubScheduleType,
    schedule_date: row.schedule_date,
    start_time: row.start_time ?? undefined,
    end_time: row.end_time ?? undefined,
    location: row.location ?? undefined,
    court_count: row.court_count ?? undefined,
    court_mode: (row.court_mode as ClubCourtMode | null | undefined) ?? undefined,
    guest_enabled: row.guest_enabled,
    guest_limit: row.guest_limit ?? undefined,
    fee_amount: row.fee_amount ?? undefined,
    show_on_main: row.show_on_main,
    memo: row.memo ?? undefined,
    created_by: row.created_by ?? undefined,
    attendance_enabled: row.attendance_enabled ?? undefined,
    attendance_deadline: row.attendance_deadline ?? undefined,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v?: string) { return Boolean(v && uuidPattern.test(v)); }

export async function fetchClubSchedules(): Promise<ClubSchedule[]> {
  // '*'로 가져와 add_club_schedule_attendance_settings.sql 적용 여부와 무관하게 동작.
  const { data, error } = await supabase
    .from('club_schedules')
    .select('*')
    .order('schedule_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return (data ?? []).map((row) => toClubSchedule(row as unknown as ClubScheduleRow));
}

export async function fetchClubScheduleById(id: string): Promise<ClubSchedule | null> {
  const { data, error } = await supabase
    .from('club_schedules')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toClubSchedule(data as unknown as ClubScheduleRow) : null;
}

/**
 * 새로 추가된 컬럼 ↔ 해당 migration SQL 파일명 매핑.
 * 사용자 환경에 컬럼이 없으면 retry 단계에서 payload에서 제거하고,
 * 콘솔에 필요한 SQL 파일을 명시한다.
 */
const NEW_COLUMNS_BY_MIGRATION: { columns: string[]; sql: string; }[] = [
  { columns: ['court_mode'],                                  sql: 'supabase/add_club_schedule_court_mode.sql' },
  { columns: ['attendance_enabled', 'attendance_deadline'],   sql: 'supabase/add_club_schedule_attendance_settings.sql' },
];

const logSupabaseError = (label: string, err: any) => {
  const code    = err?.code    ?? '(no code)';
  const message = err?.message ?? '(no message)';
  const details = err?.details ?? '(no details)';
  const hint    = err?.hint    ?? '(no hint)';
  console.warn(
    `[ClubSchedule/${label}] code=${code} | message=${message} | details=${details} | hint=${hint}`
  );
};

/** PostgREST 'column "X" does not exist' 류 에러 메시지에서 컬럼명 추출. */
function detectMissingColumn(err: any): string | null {
  const text = `${err?.message || ''} ${err?.details || ''} ${err?.hint || ''}`;
  // 1) "column \"foo\" does not exist"   2) "Could not find the 'foo' column"
  const m1 = text.match(/column\s+"?([a-z_][a-z0-9_]*)"?\s+does not exist/i);
  if (m1) return m1[1];
  const m2 = text.match(/Could not find the\s+'([a-z_][a-z0-9_]*)'\s+column/i);
  if (m2) return m2[1];
  // PostgREST 'PGRST204' code with details containing column name
  if (err?.code === 'PGRST204' && err?.message) {
    const m3 = err.message.match(/'([a-z_][a-z0-9_]*)'/i);
    if (m3) return m3[1];
  }
  return null;
}

function buildSavePayload(input: ClubScheduleInput) {
  return {
    title: input.title.trim(),
    schedule_type: input.schedule_type,
    schedule_date: input.schedule_date,
    start_time: input.start_time || null,
    end_time: input.end_time || null,
    location: input.location?.trim() || null,
    // court_mode가 fixed가 아니면 court_count는 null로 강제 (운영 의미 일치)
    court_count: (input.court_mode && input.court_mode !== 'fixed') ? null : (input.court_count ?? null),
    court_mode: input.court_mode ?? null,
    guest_enabled: input.guest_enabled,
    guest_limit: input.guest_enabled ? (input.guest_limit ?? null) : null,
    fee_amount: input.fee_amount ?? null,
    show_on_main: input.show_on_main,
    memo: input.memo?.trim() || null,
    attendance_enabled: input.attendance_enabled !== false,
    attendance_deadline:
      input.attendance_enabled !== false ? (input.attendance_deadline ?? null) : null,
    updated_at: new Date().toISOString(),
  } as Record<string, any>;
}

async function trySaveOnce(
  payload: Record<string, any>,
  id: string | undefined,
  userId?: string,
) {
  if (isUuid(id)) {
    return await supabase
      .from('club_schedules')
      .update(payload)
      .eq('id', id!)
      .select('id')
      .single();
  }
  return await supabase
    .from('club_schedules')
    .insert([{ ...payload, created_by: userId ?? null }])
    .select('id')
    .single();
}

export async function saveClubSchedule(
  input: ClubScheduleInput,
  userId?: string
): Promise<string> {
  let payload = buildSavePayload(input);
  const droppedColumns: string[] = [];
  // 최대 3회 retry — 누락된 새 컬럼이 여러 개여도 한 번씩 떨어내며 시도.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await trySaveOnce(payload, input.id, userId);
    if (!result.error) {
      if (droppedColumns.length > 0) {
        console.warn(
          `[ClubSchedule] 저장 성공. 단, 다음 컬럼이 DB에 없어 payload에서 제외됨: [${droppedColumns.join(', ')}].\n` +
          `→ 적용 필요 SQL 파일:\n` +
          NEW_COLUMNS_BY_MIGRATION
            .filter((g) => g.columns.some((c) => droppedColumns.includes(c)))
            .map((g) => `   - ${g.sql}`)
            .join('\n')
        );
      }
      return result.data.id as string;
    }

    logSupabaseError(`Save attempt ${attempt + 1}`, result.error);
    const missing = detectMissingColumn(result.error);
    if (!missing || !(missing in payload)) {
      throw result.error;
    }
    // 누락 컬럼 제외 후 재시도
    droppedColumns.push(missing);
    const { [missing]: _omit, ...rest } = payload;
    payload = rest;
  }
  throw new Error('club_schedules 저장 재시도 한도 초과');
}

export async function deleteClubSchedule(id: string): Promise<void> {
  const { error } = await supabase
    .from('club_schedules')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── 삭제 안전성 판정 (상세/캘린더 공용) ──────────────────────────────────────
// club_schedules 삭제 시 FK 정책상 attendance/댓글/Guest Pass 는 CASCADE 로 함께 삭제되지만,
// kdk_session_meta.club_schedule_id 는 SET NULL 이라 KDK 세션이 고아로 남는다.
// → KDK 가 연결된 일정은 삭제 차단. 명시적 club_schedule_id 만 사용(날짜/제목 추정 금지).
// 연결 조회 실패는 fail-closed('check_failed'). KDK/Archive 는 절대 자동 삭제/변경하지 않는다.
export type ClubScheduleDeleteReason = 'safe' | 'kdk_linked' | 'official_kdk' | 'check_failed';
export interface ClubScheduleDeleteSafety {
  canDelete: boolean;
  reason: ClubScheduleDeleteReason;
  linkedSessionCount: number;
}

export async function checkClubScheduleDeleteSafety(scheduleId: string): Promise<ClubScheduleDeleteSafety> {
  if (!scheduleId) return { canDelete: false, reason: 'check_failed', linkedSessionCount: 0 };

  // 1) 연결된 KDK 세션 조회 (명시적 연결 키). 실패 → fail-closed.
  const { data, error } = await supabase
    .from('kdk_session_meta')
    .select('session_id')
    .eq('club_schedule_id', scheduleId);
  if (error) {
    logSupabaseError('DeleteSafety/kdk', error);
    return { canDelete: false, reason: 'check_failed', linkedSessionCount: 0 };
  }
  const rows = (data as { session_id: string }[]) || [];
  if (rows.length === 0) return { canDelete: true, reason: 'safe', linkedSessionCount: 0 };

  // 2) 공식 Archive 여부 — teyeon_archive_v1.id = KDK session_id, is_official=true.
  //    조회 실패해도 연결 자체로 차단되므로(kdk_linked) 삭제되진 않는다(더 약한 차단으로만 강등).
  let official = false;
  const sessionIds = rows.map((r) => r.session_id).filter(Boolean);
  if (sessionIds.length > 0) {
    const { data: arch, error: archErr } = await supabase
      .from('teyeon_archive_v1')
      .select('id, is_official')
      .in('id', sessionIds);
    if (archErr) {
      logSupabaseError('DeleteSafety/archive', archErr);
    } else if ((arch || []).some((a: any) => a?.is_official === true)) {
      official = true;
    }
  }

  return {
    canDelete: false,
    reason: official ? 'official_kdk' : 'kdk_linked',
    linkedSessionCount: rows.length,
  };
}

/**
 * 삭제 차단 사유 → 사용자 안내 문구. 차단 대상이 아니면(safe) null.
 * 상세/캘린더가 동일 문구를 쓰도록 한 곳에서 관리(문구 drift 방지).
 */
export function clubScheduleDeleteBlockAlert(safety: ClubScheduleDeleteSafety): string | null {
  switch (safety.reason) {
    case 'safe':
      return null;
    case 'official_kdk':
      return '공식 확정된 KDK 기록이 연결되어 삭제할 수 없습니다.';
    case 'kdk_linked':
      return 'KDK 세션이 연결되어 있어 삭제할 수 없습니다. KDK 설정에서 정모 연결을 해제한 후 다시 시도해주세요.';
    case 'check_failed':
      return 'KDK 연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
}
