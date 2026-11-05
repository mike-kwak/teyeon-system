-- =============================================================================
-- ISS-005 · 38 — Archive 원본 비로그인(anon) 직접 조회 차단   [초안 · 승인 전 운영 실행 금지]
--   rollback: 38_archive_anon_read_rollback.sql   확인: 38_archive_anon_read_READONLY.sql
--
--   문제(2026-11-06 Production anon 실측, 건수만 조회):
--     teyeon_archive_v1 37행(공식 23 · 미확정 14) 전부 anon SELECT 가능 — raw_data(선수 id · 아바타 URL · 참가자 설정(출생연도 등)
--     · 정산 21행) + confirmed_by(공식 23행 모두 '@' 포함 = 확정한 운영진 이메일). 레거시 matches_archive 331행 · sessions_archive 4행도 anon 조회 가능.
--   공개 화면은 이 표를 직접 읽지 않는다: /club/kdk · Guest Pass · 공개 공지는 SECURITY DEFINER 공개 RPC
--     (get_public_kdk_sessions · get_public_kdk_session 등 — 공식 · 비테스트만, 선수 id/UUID 미포함 DTO)를 쓴다.
--
--   하는 일: 3개 표의 anon SELECT(표 · 열 단위)만 회수. 그 외 무변경.
--     · authenticated(로그인 회원) 조회 · 쓰기 권한, RLS · 정책, P1-b trigger, 공개 RPC, 데이터 — 무변경.
--     · 적용 전 anon 권한을 security_backup.archive_anon_read_p2 에 저장 → rollback 이 그대로 되돌린다.
--   안전 검사(하나라도 어긋나면 STOP · 무변경):
--     · anon 이 실행할 수 있는 함수 중 이 3개 표를 읽는 SECURITY INVOKER 함수가 있으면 STOP(회수 시 그 함수가 깨짐).
--   영향(사전 확인): 메인 화면 비로그인 통계 "KDK 횟수" 가 '—' 로 표시(회원 수 통계는 이미 '—'). 로그인 화면 · 공개 화면 무영향.
--   주의: 26_p1b_state_READONLY 의 S 행 · P0-A verify V03 은 "anon SELECT 유지"를 기대하므로 적용 후 CHECK 로 보인다(의도된 변화).
--   문장 1개(DO 블록) · 재실행 안전.
-- =============================================================================
do $iss005$
declare
  t text;
  r record;
  v_bad text;
begin
  perform set_config('lock_timeout', '3s', true);

  -- 이 3개 표를 읽으면서 anon 이 실행 가능한 INVOKER 함수가 있으면 회수하면 안 된다.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.prosrc ~* '\m(teyeon_archive_v1|matches_archive|sessions_archive)\M';
  if v_bad is not null then
    raise exception 'STOP ISS-005: anon 이 실행하는 INVOKER 함수가 대상 표를 읽음(%) — 변경 없음', v_bad;
  end if;

  create schema if not exists security_backup;
  revoke all on schema security_backup from public, anon, authenticated;
  create table if not exists security_backup.archive_anon_read_p2 (
      captured_at timestamptz not null default now(),
      table_name  text not null,
      column_name text,                 -- null = 표 단위 권한
      privilege   text not null,
      restored_at timestamptz
  );
  revoke all on security_backup.archive_anon_read_p2 from public, anon, authenticated;

  foreach t in array array['teyeon_archive_v1', 'matches_archive', 'sessions_archive'] loop
    continue when to_regclass('public.' || t) is null;
    -- 백업(이번 회차에 아직 백업 안 된 것만)
    if not exists (select 1 from security_backup.archive_anon_read_p2 where table_name = t and restored_at is null) then
      if has_table_privilege('anon', ('public.' || t)::regclass, 'SELECT') then
        insert into security_backup.archive_anon_read_p2 (table_name, privilege) values (t, 'SELECT');
      end if;
      insert into security_backup.archive_anon_read_p2 (table_name, column_name, privilege)
      select t, c.column_name, 'SELECT'
        from information_schema.column_privileges c
       where c.table_schema = 'public' and c.table_name = t and c.grantee = 'anon' and c.privilege_type = 'SELECT'
         and not has_table_privilege('anon', ('public.' || t)::regclass, 'SELECT');
    end if;
    execute format('revoke select on public.%I from anon', t);
    for r in select c.column_name from information_schema.column_privileges c
              where c.table_schema = 'public' and c.table_name = t and c.grantee = 'anon' and c.privilege_type = 'SELECT' loop
      execute format('revoke select (%I) on public.%I from anon', r.column_name, t);
    end loop;
    -- PUBLIC 에 준 SELECT 가 있으면 anon 이 그것으로 계속 읽는다 → 확인만(PUBLIC 회수는 하지 않음 · 발견 시 STOP)
    if has_any_column_privilege('anon', ('public.' || t)::regclass, 'SELECT') then
      raise exception 'STOP ISS-005: % 를 anon 이 여전히 읽을 수 있음(PUBLIC 권한 등) — 전체 취소', t;
    end if;
  end loop;
end
$iss005$;

notify pgrst, 'reload schema';

select 'ISS-005' as step,
       has_any_column_privilege('anon', 'public.teyeon_archive_v1', 'SELECT') as anon_archive_read,                    -- false
       has_table_privilege('authenticated', 'public.teyeon_archive_v1', 'SELECT') as auth_archive_read,               -- true(로그인 화면 유지)
       case when to_regclass('public.matches_archive') is null then null else has_any_column_privilege('anon', 'public.matches_archive', 'SELECT') end as anon_matches_archive_read,   -- false
       case when to_regclass('public.sessions_archive') is null then null else has_any_column_privilege('anon', 'public.sessions_archive', 'SELECT') end as anon_sessions_archive_read, -- false
       has_function_privilege('anon', 'public.get_public_kdk_sessions(integer)', 'execute') as anon_public_rpc,       -- true(공개 화면 유지)
       (select count(*) from security_backup.archive_anon_read_p2 where restored_at is null) as backup_rows;
