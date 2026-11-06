-- =============================================================================
-- MATCH SPOTLIGHT 테스트 환경 — 0단계: Supabase 최소 stub (로컬 순수 PostgreSQL 전용)
--
-- ⚠️ Supabase 프로젝트(테스트·운영 모두)에서는 실행하지 않는다 — anon/authenticated/service_role,
--    auth.uid()/auth.role(), supabase_realtime 이 이미 있다. 로컬 PostgreSQL 17 에서만 사용.
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'auth') then
    raise exception 'auth 스키마가 이미 있음 — Supabase 프로젝트로 보임. 이 stub 은 로컬 PostgreSQL 전용.';
  end if;
end $$;

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase 와 같은 방식: request.jwt.claim.sub / request.jwt.claims 에서 읽는다.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create publication supabase_realtime;
