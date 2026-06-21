-- ────────────────────────────────────────────────────────────────────────────
-- club_schedules — 코트 운영 방식(court_mode) 컬럼 추가
--
-- 기존 add_club_schedules.sql 은 그대로 둔다. 이 migration은 컬럼만 ADD.
--
-- court_mode:
--   - 'fixed'      : 고정 코트 수 (court_count 숫자 사용)
--   - 'unknown'    : 미정
--   - 'na'         : 해당 없음 (회식 등)
--   - 'first_come' : 선착순 운영 (이순신 등)
--
-- 마이그레이션 후 기존 row는 default 'fixed'로 자동 채워진다.
-- court_count 값이 이미 있다면 'fixed'와 자연스럽게 호환됨.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.club_schedules
  add column if not exists court_mode text not null default 'fixed'
  check (court_mode in ('fixed', 'unknown', 'na', 'first_come'));

comment on column public.club_schedules.court_mode is
  'fixed=고정코트, unknown=미정, na=해당없음, first_come=선착순';
