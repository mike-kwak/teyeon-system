-- profiles 테이블에 공개 범위 컬럼 추가
-- 적용 환경: Supabase SQL Editor 또는 CLI
-- 기존 rows에 영향 없음 (default 'public')

alter table public.profiles
  add column if not exists profile_visibility_level text default 'public'
  check (profile_visibility_level in ('public', 'partial', 'private'));

comment on column public.profiles.profile_visibility_level is
  'public=전체공개, partial=일부공개(배지+출석), private=기본정보만';
