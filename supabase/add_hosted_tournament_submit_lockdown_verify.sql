-- =============================================================================
-- VERIFY — add_hosted_tournament_submit_lockdown.sql 적용 직후 1회 실행.
--   읽기 전용이다. 어떤 데이터도 변경하지 않는다.
--   FAIL 이 하나라도 있으면 접수를 열지 말 것.
-- =============================================================================

with checks as (

-- ── A. 목표: anon 직접 제출 차단 ─────────────────────────────────────────────
select 1 as seq, 'A. anon submit EXECUTE 불가' as check_name, 'false' as expected,
       coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)') as actual

union all select 2, 'A. authenticated submit EXECUTE 불가', 'false',
       coalesce((select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 3, 'A. service_role submit EXECUTE 가능', 'true',
       coalesce((select has_function_privilege('service_role', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

-- PUBLIC(전체)에 EXECUTE 가 남아 있으면 anon 회수가 무의미해진다. grantee 0 = PUBLIC.
union all select 4, 'A. PUBLIC 에 submit EXECUTE 없음', '0',
       (select count(*)::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where n.nspname='public' and p.proname='submit_tournament_registration'
           and a.grantee = 0 and a.privilege_type = 'EXECUTE')

-- ── B. 공개 조회 RPC 2종은 유지 ──────────────────────────────────────────────
union all select 5, 'B. anon 실행 가능 공개 RPC = 조회 2종만',
       'get_public_tournament,get_public_tournament_teams',
       coalesce((select string_agg(p.proname, ',' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public'
                    and p.proname in ('get_public_tournament','get_public_tournament_teams',
                                      'submit_tournament_registration')
                    and has_function_privilege('anon', p.oid, 'EXECUTE')), '(none)')

-- ── C. 함수 구조 무변경 ──────────────────────────────────────────────────────
union all select 6, 'C. submit RPC 여전히 존재', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname='public' and p.proname='submit_tournament_registration')

union all select 7, 'C. submit RPC SECURITY DEFINER 유지', 'true',
       coalesce((select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 8, 'C. submit RPC search_path 고정 유지', 'true',
       coalesce((select (array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%')::text
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 9, 'C. submit RPC 인자 12개 유지', '12',
       coalesce((select p.pronargs::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

-- 본문에 정원·대기·중복·advisory lock 로직이 그대로 있는지 확인(문자열 존재 검사)
union all select 10, 'C. 정원/대기/중복/락 로직 유지', 'true',
       coalesce((select (p.prosrc like '%pg_advisory_xact_lock%'
                         and p.prosrc like '%TOURNAMENT_FULL%'
                         and p.prosrc like '%DUPLICATE_REGISTRATION%'
                         and p.prosrc like '%target_capacity%'
                         and p.prosrc like '%max_capacity%'
                         and p.prosrc like '%CONSENT_REQUIRED%')::text
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

-- ── D. 테이블 권한(MVP 계약) 유지 ────────────────────────────────────────────
union all select 11, 'D. anon 은 3개 테이블 어떤 권한도 없음', '0',
       (select count(*)::text from (select unnest(array[
                'public.hosted_tournaments','public.hosted_tournament_registrations',
                'public.hosted_tournament_registration_history']) as tbl) t
         where has_table_privilege('anon', tbl, 'SELECT') or has_table_privilege('anon', tbl, 'INSERT')
            or has_table_privilege('anon', tbl, 'UPDATE') or has_table_privilege('anon', tbl, 'DELETE'))

union all select 12, 'D. 운영 RPC 3종 authenticated 유지', '3',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname='public'
           and p.proname in ('get_admin_tournament_registrations',
                             'set_tournament_registration_status',
                             'set_tournament_registration_players')
           and has_function_privilege('authenticated', p.oid, 'EXECUTE'))

-- ── E. 데이터 무변경 ─────────────────────────────────────────────────────────
union all select 13, 'E. 접수 행 수(접수 오픈 전 기준)', '0',
       (select count(*)::text from public.hosted_tournament_registrations)

)
select seq, check_name, expected, actual,
       case when actual = expected then 'PASS' else '*** FAIL ***' end as verdict
  from checks
 order by seq;


-- =============================================================================
-- 눈으로 확인하는 항목 (여전히 읽기 전용)
-- =============================================================================
--   ⚠ Supabase SQL Editor 는 관리자 권한이라 여기서 함수를 직접 호출해도 차단이 재현되지 않는다.
--     실제 차단 확인은 브라우저 콘솔에서 anon key 로 호출해 42501 이 나오는지 보는 방식으로 한다.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_role_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('submit_tournament_registration',
                     'get_public_tournament', 'get_public_tournament_teams')
 order by p.proname;
