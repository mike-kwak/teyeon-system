-- ────────────────────────────────────────────────────────────────────────────
-- club_schedule_attendances — arrival_time 유연화
--
-- 현재 스키마(add_club_schedule_attendance.sql)에는 arrival_time을 특정 값으로
-- 강제하는 CHECK 제약이 없으나(이 migration은 안전 차원에서 명시적으로 풀어둠),
-- 향후 운영팀이 CHECK를 걸 수 있는 환경을 대비해 명시적으로 모든 'HH:MM[:SS]'
-- 형태를 허용하도록 정리한다.
--
-- 시작 시간 후보(18:30 / 19:00 / 19:30 / 20:00 …) 변경은 클라이언트에서 schedule
-- 의 start_time을 기준으로 동적으로 생성한다. DB는 단순히 'time' 값만 받는다.
--
-- attendance_status='not_attending' 일 때 arrival_time / leave_time IS NULL
-- 제약은 기존 그대로 유지된다.
-- ────────────────────────────────────────────────────────────────────────────

do $$
begin
  -- 혹시 모를 enum 형식의 추가 제약이 있다면 제거 (이름 패턴으로 안전 시도)
  if exists (
    select 1
    from pg_constraint
    where conname = 'club_schedule_attendances_arrival_check'
  ) then
    alter table public.club_schedule_attendances
      drop constraint club_schedule_attendances_arrival_check;
  end if;
end$$;

-- arrival_time이 비어있지 않다면 'HH:MM' (또는 'HH:MM:SS') 형태인지 가벼운 패턴
-- 검증만 추가. 특정 값 화이트리스트는 두지 않는다.
alter table public.club_schedule_attendances
  add constraint club_schedule_attendances_arrival_time_format
  check (
    arrival_time is null
    or arrival_time::text ~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$'
  );
