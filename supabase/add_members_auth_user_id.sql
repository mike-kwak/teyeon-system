-- ────────────────────────────────────────────────────────────────────────────
-- members.auth_user_id 컬럼 + unique index
--
-- 운영진이 회원과 auth.users 를 1:1로 사전 매핑하기 위한 stable key.
-- 기존 email 기반 fallback은 유지하되, auth_user_id 가 있으면 그것이 최우선.
--
-- ⚠️ 이 migration 은 운영 Supabase 에 이미 직접 적용되어 있다.
-- 이 파일은 프로젝트 schema 이력 보존 목적 (idempotent로 재실행 안전).
-- 회원별 UUID 매핑 backfill 값은 schema 와 분리 — 별도 운영 수동 작업.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.members
  add column if not exists auth_user_id uuid
  references auth.users(id) on delete set null;

-- 동일 auth user 가 두 member 에 매핑되지 않도록 보호.
-- WHERE 절로 NULL row 는 unique 검사에서 제외 (부분 인덱스).
create unique index if not exists members_auth_user_id_unique
  on public.members(auth_user_id)
  where auth_user_id is not null;

comment on column public.members.auth_user_id is
  '카카오 로그인 등 auth.users.id 와의 1:1 매핑. 운영진이 사전에 정확히 연결.';
