-- =============================================================================
-- SECURITY P1-b — 공식 Archive 쓰기 보호   [초안 · 승인 전 운영 실행 금지]
--
--   대상
--     · public.teyeon_archive_v1 : BEFORE INSERT/UPDATE/DELETE trigger + TRUNCATE trigger.
--         로그인 요청(JWT role = authenticated) 또는 비로그인(anon) 이면 auth.uid() + is_full_admin()(profiles CEO·ADMIN) 일 때만 쓰기 허용.
--         ※ current_user 가 아니라 "요청의 JWT 역할" 로 판정 → SECURITY DEFINER 함수 안에서 실행돼도(소유자 권한) 같은 검사를 받는다.
--         JWT 가 service_role 이거나 요청 JWT 가 없는 DB 직접 접속(SQL Editor · 마이그레이션)은 통과.
--         authenticated 의 TRUNCATE · REFERENCES · TRIGGER 회수(INSERT/UPDATE/DELETE 는 trigger 로 운영진만).
--     · 레거시 public.matches_archive · sessions_archive · kdk_sessions : 앱 쓰기 경로 없음(2026-11-05 코드 확인)
--         → authenticated 의 INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER 회수. SELECT 유지.
--   바꾸지 않는 것: 모든 SELECT(공개 조회) · RLS · 정책 · 데이터 · anon 권한(P0-A 소관) · 기존 함수 · P0-A/B/C · P1.
--   적용 전 권한은 security_backup.p1b_state 에 저장(authenticated 만) → 20_p1b... 가 아니라 25_p1b_rollback.sql 로 되돌림.
--
--   실행 방식: 문장 1개(DO 블록). SQL Editor 가 문장을 나눠 실행해도 중간 커밋·부분 적용이 생기지 않는다(P1 교훈).
--   재실행 안전: 이미 적용돼 있으면 함수·trigger 를 같은 내용으로 다시 만들고, 백업 회차는 새로 만들지 않는다.
-- =============================================================================
do $p1b$
declare
  v_first boolean;
  t text;
begin
  perform set_config('lock_timeout', '3s', true);
  perform set_config('statement_timeout', '120s', true);

  -- 0) 전제
  if to_regclass('public.teyeon_archive_v1') is null then raise exception 'STOP P1-b: public.teyeon_archive_v1 없음 — 변경 없음'; end if;
  if to_regprocedure('public.is_full_admin()') is null then raise exception 'STOP P1-b: public.is_full_admin() 없음 — 변경 없음'; end if;
  if to_regprocedure('auth.uid()') is null then raise exception 'STOP P1-b: auth.uid() 없음 — 변경 없음'; end if;

  -- 1) 적용 전 권한 백업(authenticated 만 · anon 은 P0-A 소관이라 저장·복원하지 않는다)
  create schema if not exists security_backup;
  revoke all on schema security_backup from public, anon, authenticated;
  create table if not exists security_backup.p1b_state (
      captured_at timestamptz not null default now(),
      table_name  text not null,
      grantee     text not null,
      privilege   text not null,
      restored_at timestamptz
  );
  revoke all on security_backup.p1b_state from public, anon, authenticated;
  -- 최초 설치(= P1-b trigger 없음 · 열린 백업 회차 없음)일 때만 백업한다.
  v_first := not exists (select 1 from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname = 'p1b_archive_guard_trg')
             and not exists (select 1 from security_backup.p1b_state where restored_at is null);
  if v_first then
    insert into security_backup.p1b_state (table_name, grantee, privilege)
    select x.t, 'authenticated', p.p
      from (values ('teyeon_archive_v1'), ('matches_archive'), ('sessions_archive'), ('kdk_sessions')) x(t),
           (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(p)
     where to_regclass('public.' || x.t) is not null
       and has_table_privilege('authenticated', to_regclass('public.' || x.t), p.p);
  end if;

  -- 2) 판정 함수 — trigger 함수(SECURITY INVOKER). 운영진 판정은 기존 is_full_admin()(DEFINER · profiles.role) 재사용.
  execute $fn$
create or replace function public.p1b_archive_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $g$
declare
  v_jwt_role text;
begin
  -- PostgREST 요청이면 JWT 역할이 설정돼 있다(정의자 함수 안에서도 같은 값).
  v_jwt_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  if current_user in ('anon', 'authenticated') or v_jwt_role in ('anon', 'authenticated') then
    if auth.uid() is null then
      raise exception 'archive: 로그인이 필요합니다' using errcode = '42501';
    end if;
    if not public.is_full_admin() then
      raise exception 'archive: 공식 기록 쓰기는 운영진(CEO·ADMIN)만 가능합니다' using errcode = '42501';
    end if;
  end if;
  -- service_role JWT · 요청 JWT 없는 DB 직접 접속(SQL Editor · 마이그레이션) · 운영진 → 허용
  return coalesce(new, old);
end;
$g$
$fn$;

  execute $fn$
create or replace function public.p1b_archive_block_truncate()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $g$
declare
  v_jwt_role text;
begin
  v_jwt_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  if current_user in ('anon', 'authenticated') or v_jwt_role in ('anon', 'authenticated') then
    raise exception 'archive: TRUNCATE 금지' using errcode = '42501';
  end if;
  return null;
end;
$g$
$fn$;
  revoke all on function public.p1b_archive_guard(), public.p1b_archive_block_truncate() from public, anon, authenticated;

  -- 3) trigger(같은 이름이면 다시 만든다 → 재실행 안전)
  drop trigger if exists p1b_archive_guard_trg on public.teyeon_archive_v1;
  create trigger p1b_archive_guard_trg before insert or update or delete on public.teyeon_archive_v1
    for each row execute function public.p1b_archive_guard();
  drop trigger if exists p1b_archive_block_truncate_trg on public.teyeon_archive_v1;
  create trigger p1b_archive_block_truncate_trg before truncate on public.teyeon_archive_v1
    for each statement execute function public.p1b_archive_block_truncate();

  -- 4) 권한 회수(authenticated 만)
  revoke truncate, references, trigger on public.teyeon_archive_v1 from authenticated;
  foreach t in array array['matches_archive', 'sessions_archive', 'kdk_sessions'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    end if;
  end loop;
end
$p1b$;

-- 결과 1행
select (select count(*) from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname like 'p1b_%' and tgenabled <> 'D') = 2 as triggers_on,
       has_table_privilege('authenticated', 'public.teyeon_archive_v1', 'TRUNCATE') as auth_archive_truncate,      -- false
       has_table_privilege('authenticated', 'public.teyeon_archive_v1', 'SELECT')   as auth_archive_select,        -- true
       has_table_privilege('anon', 'public.teyeon_archive_v1', 'SELECT')            as anon_archive_select,        -- true
       (select count(*) from security_backup.p1b_state where restored_at is null)   as backup_rows;
