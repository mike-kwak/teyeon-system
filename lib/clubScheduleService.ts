// Club Schedule 전용 Supabase CRUD.
// club_schedules 테이블 대상 — tournament_events 테이블은 건드리지 않음.
// TODO: 정모 참석 체크 연동 시 club_attendances 테이블 추가 예정.

import { supabase } from './supabase';
import { ClubSchedule, ClubScheduleInput, ClubScheduleType } from './clubScheduleData';

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
  guest_enabled: boolean;
  guest_limit: number | null;
  fee_amount: number | null;
  show_on_main: boolean;
  memo: string | null;
  created_by: string | null;
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
    guest_enabled: row.guest_enabled,
    guest_limit: row.guest_limit ?? undefined,
    fee_amount: row.fee_amount ?? undefined,
    show_on_main: row.show_on_main,
    memo: row.memo ?? undefined,
    created_by: row.created_by ?? undefined,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v?: string) { return Boolean(v && uuidPattern.test(v)); }

export async function fetchClubSchedules(): Promise<ClubSchedule[]> {
  const { data, error } = await supabase
    .from('club_schedules')
    .select(
      'id, title, schedule_type, schedule_date, start_time, end_time, ' +
      'location, court_count, guest_enabled, guest_limit, fee_amount, ' +
      'show_on_main, memo, created_by'
    )
    .order('schedule_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return (data ?? []).map((row) => toClubSchedule(row as unknown as ClubScheduleRow));
}

export async function saveClubSchedule(
  input: ClubScheduleInput,
  userId?: string
): Promise<string> {
  const payload = {
    title: input.title.trim(),
    schedule_type: input.schedule_type,
    schedule_date: input.schedule_date,
    start_time: input.start_time || null,
    end_time: input.end_time || null,
    location: input.location?.trim() || null,
    court_count: input.court_count ?? null,
    guest_enabled: input.guest_enabled,
    guest_limit: input.guest_enabled ? (input.guest_limit ?? null) : null,
    fee_amount: input.fee_amount ?? null,
    show_on_main: input.show_on_main,
    memo: input.memo?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const result = isUuid(input.id)
    ? await supabase
        .from('club_schedules')
        .update(payload)
        .eq('id', input.id!)
        .select('id')
        .single()
    : await supabase
        .from('club_schedules')
        .insert([{ ...payload, created_by: userId ?? null }])
        .select('id')
        .single();

  if (result.error) throw result.error;
  return result.data.id as string;
}

export async function deleteClubSchedule(id: string): Promise<void> {
  const { error } = await supabase
    .from('club_schedules')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
