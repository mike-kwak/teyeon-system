-- =============================================================================
-- P0-C 적용 직후 확인 — 읽기 전용 · SELECT 1개 · 8행
--   V01~V06 이 모두 OK 이고 V07 이 적용 전 R07 과 같으면 정상. 하나라도 FAIL 이면 12_p0c_rollback.sql 판단.
-- =============================================================================
with r as (
  select 1 as o, 'V01 guard trigger 설치·활성(BEFORE INSERT/UPDATE)' as chk,
         case when exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.profiles')
                             and t.tgname = 'guard_profiles_privileged_columns_trg' and t.tgenabled <> 'D'
                             and (t.tgtype & 2) <> 0 and (t.tgtype & 4) <> 0 and (t.tgtype & 16) <> 0) then 'OK' else 'FAIL' end as verdict,
         coalesce((select pg_get_triggerdef(oid) from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg'), '없음') as detail
  union all
  select 2, 'V02 guard 함수 = SECURITY INVOKER · 누구도 직접 실행 불가',
         case when to_regprocedure('public.guard_profiles_privileged_columns()') is null then 'FAIL'
              when (select not prosecdef from pg_proc where oid = to_regprocedure('public.guard_profiles_privileged_columns()'))
               and not has_function_privilege('anon', 'public.guard_profiles_privileged_columns()', 'execute')
               and not has_function_privilege('authenticated', 'public.guard_profiles_privileged_columns()', 'execute') then 'OK' else 'FAIL' end,
         coalesce(to_regprocedure('public.guard_profiles_privileged_columns()')::text, '없음')
  union all
  select 3, 'V03 helper security_actor_profile_role = DEFINER · anon 실행 불가 · authenticated 실행 가능',
         case when to_regprocedure('public.security_actor_profile_role()') is null then 'FAIL'
              when (select prosecdef from pg_proc where oid = to_regprocedure('public.security_actor_profile_role()'))
               and not has_function_privilege('anon', 'public.security_actor_profile_role()', 'execute')
               and has_function_privilege('authenticated', 'public.security_actor_profile_role()', 'execute') then 'OK' else 'FAIL' end,
         coalesce(to_regprocedure('public.security_actor_profile_role()')::text, '없음')
  union all
  select 4, 'V04 sync_my_profile = P0-C 본문 · DEFINER · search_path 고정',
         case when (select prosrc like '%[P0-C]%' and prosecdef and coalesce(array_to_string(proconfig, ' '), '') like '%search_path%'
                      from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')) then 'OK' else 'FAIL' end,
         coalesce((select left(md5(replace(prosrc, E'\r', '')), 12) from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')), '없음')
  union all
  select 5, 'V05 sync_my_profile 실행 권한: anon 불가 · authenticated 가능',
         case when not has_function_privilege('anon', 'public.sync_my_profile(text,text)', 'execute')
               and has_function_privilege('authenticated', 'public.sync_my_profile(text,text)', 'execute') then 'OK' else 'FAIL' end,
         'anon=' || has_function_privilege('anon', 'public.sync_my_profile(text,text)', 'execute')
         || ' authenticated=' || has_function_privilege('authenticated', 'public.sync_my_profile(text,text)', 'execute')
  union all
  select 6, 'V06 set_my_profile_visibility 본문 무변경',
         case when (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.set_my_profile_visibility(text)')) = '6ab10e346d0ce946cfa8a9f4cc05e69d'
              then 'OK' else 'FAIL' end,
         coalesce((select left(md5(replace(prosrc, E'\r', '')), 12) from pg_proc where oid = to_regprocedure('public.set_my_profile_visibility(text)')), '없음')
  union all
  select 7, 'V07 역할별 계정 수(적용 전 R07 과 같아야 함)', 'INFO',
         coalesce((select string_agg(k || '=' || n, ', ' order by k) from (
            select upper(btrim(coalesce(role::text, ''))) k, count(*) n from public.profiles group by 1) x), '-')
  union all
  select 8, 'V08 profiles 정책 수(P0-C 는 정책을 바꾸지 않음 · 적용 전과 같아야 함)', 'INFO',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'profiles') || '개'
)
select chk as "check", verdict, detail from r order by o;
