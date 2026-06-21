-- ────────────────────────────────────────────────────────────────────────────
-- club_schedules — 참석 체크 운영 설정 컬럼 추가
--
-- 기존 add_club_schedules.sql 은 변경하지 않는다. 이 migration은 컬럼만 ADD.
--
-- attendance_enabled = false → 참석 체크 UI 자체를 숨김
-- attendance_deadline IS NULL → 일정 시작 시각 전까지 수정 가능
-- attendance_deadline > now() → 마감 시간 이후 읽기 전용 (시안 E)
-- ────────────────────────────────────────────────────────────────────────────

alter table public.club_schedules
  add column if not exists attendance_enabled  boolean      not null default true;

alter table public.club_schedules
  add column if not exists attendance_deadline timestamptz  null;
