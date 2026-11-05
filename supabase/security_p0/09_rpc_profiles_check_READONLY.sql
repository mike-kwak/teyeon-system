-- =============================================================================
-- P0-B · P0-C 마지막 확인 — 읽기 전용 · SELECT 1개 · 항목별 1행
--   ① KDK RPC 3개(delete/start/timer) 운영 본문 = 저장소 원본인지(md5, 줄 끝 무시) · anon 실행 여부 · 내부 운영자 검사 흔적
--      start_kdk_match 는 저장소 이전판 99012c3(md5 8b6c074d…, 운영 본문과 일치 확인 2026-11-04)도 OK
--   ② profiles 쓰기 함수(sync_my_profile · set_my_profile_visibility · 그 밖의 DEFINER) 본문 일치·role 변경 가능성
--   ③ profiles trigger · 정책(P0-C guard 와 충돌 여부)
--   ④ 함수 기본 권한(새 함수에 anon 실행이 자동 부여되는지) · sessions_archive 상태
--   verdict: OK / CHECK / STOP. 행 내용은 출력하지 않는다.
-- =============================================================================
with
expect(name, sig, md5) as (values
  ('delete_kdk_live_session',   'public.delete_kdk_live_session(text,text)',  '9f7a0b856885da2899766c4daefcf6d1'),
  ('start_kdk_match',           'public.start_kdk_match(text,text)',          '81257f29c2abed42a8e28bc9e8376626'),
  ('start_kdk_match_timer',     'public.start_kdk_match_timer(text,text)',    'a5b9875242bb9c28f33f9b1ad910ccc7'),
  ('sync_my_profile',           'public.sync_my_profile(text,text)',          'ee64b99b69f2ca8d535530786654c1f4'),
  ('set_my_profile_visibility', 'public.set_my_profile_visibility(text)',     '6ab10e346d0ce946cfa8a9f4cc05e69d')),
f as (
  select e.name, e.sig, e.md5 as want, to_regprocedure(e.sig) as oid
    from expect e
),
r as (
  select 10 as o, 'R ' || f.name as chk,
         case when f.oid is null then 'CHECK'
              when (select md5(replace(p.prosrc, E'\r', '')) from pg_proc p where p.oid = f.oid) = f.want then 'OK'
              when f.name = 'start_kdk_match' and (select md5(replace(p.prosrc, E'\r', '')) from pg_proc p where p.oid = f.oid) = '8b6c074d6e336c45f5e24bba2e1fd460' then 'OK'
              when f.name = 'sync_my_profile' and (select p.prosrc like '%[P0-C]%' from pg_proc p where p.oid = f.oid) then 'OK'
              else 'STOP' end as verdict,
         case when f.oid is null then '함수 없음'
              else 'md5=' || (select left(md5(replace(p.prosrc, E'\r', '')), 12) from pg_proc p where p.oid = f.oid)
                   || ' (기대 ' || left(f.want, 12) || ')'
                   || ' | definer=' || (select p.prosecdef from pg_proc p where p.oid = f.oid)
                   || ' | anon=' || has_function_privilege('anon', f.oid, 'execute')
                   || ' | auth=' || has_function_privilege('authenticated', f.oid, 'execute')
                   || ' | auth.uid검사=' || (select p.prosrc ~* 'auth\.uid\(\)' from pg_proc p where p.oid = f.oid)
                   || ' | CEO/ADMIN검사=' || (select p.prosrc ~* '(CEO|ADMIN)' from pg_proc p where p.oid = f.oid)
                   || ' | role대입=' || (select p.prosrc ~* 'set\s[^;]*\mrole\s*=' from pg_proc p where p.oid = f.oid)
         end as detail
    from f
  union all
  select 20, 'P profiles 를 쓰는 그 밖의 DEFINER 함수 ' || p.oid::regprocedure::text,
         case when p.prosrc ~* 'set\s[^;]*\mrole\s*=' or p.prosrc ~* 'insert\s+into\s+(public\.)?profiles[^;]*\mrole\M' then 'CHECK' else 'OK' end,
         'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' role쓰기흔적=' || (p.prosrc ~* 'set\s[^;]*\mrole\s*=' or p.prosrc ~* 'insert\s+into\s+(public\.)?profiles[^;]*\mrole\M')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and p.prosecdef
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?profiles\M'
     and p.proname not in ('sync_my_profile', 'set_my_profile_visibility')
  union all
  select 30, 'T profiles trigger ' || t.tgname::text,
         case when t.tgname = 'guard_profiles_privileged_columns_trg' then 'INFO'
              when (t.tgtype & 2) <> 0 and (t.tgtype & 16) <> 0 and pr.prosrc ~* '\mrole\M' then 'CHECK' else 'OK' end,
         '[' || t.tgenabled::text || '] ' || case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end
         || ' → ' || pr.proname::text || ' role언급=' || (pr.prosrc ~* '\mrole\M')
    from pg_trigger t join pg_proc pr on pr.oid = t.tgfoid
   where t.tgrelid = to_regclass('public.profiles') and not t.tgisinternal
  union all
  select 31, 'T profiles trigger 없음 표시',
         'INFO', case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and not tgisinternal) then '위 행 참조' else '(none)' end
  union all
  select 40, 'Y profiles 정책 ' || policyname::text,
         case when cmd in ('UPDATE','ALL') and coalesce(qual, '') !~* '(CEO|ADMIN)' then 'CHECK' else 'OK' end,
         cmd || ' ' || roles::text || ' | using=' || left(coalesce(qual, '-'), 120) || ' | check=' || left(coalesce(with_check, '-'), 120)
    from pg_policies where schemaname = 'public' and tablename = 'profiles'
  union all
  select 50, 'D public 함수 기본 권한(새 함수에 자동 부여)', 'INFO',
         coalesce((select string_agg(pg_get_userbyid(a.defaclrole) || ': ' || array_to_string(a.defaclacl, ' '), ' || ')
                     from pg_default_acl a join pg_namespace n on n.oid = a.defaclnamespace
                    where n.nspname = 'public' and a.defaclobjtype = 'f'), '(none)')
  union all
  select 60, 'A sessions_archive 상태',
         'INFO',
         case when to_regclass('public.sessions_archive') is null then '없음'
              else 'rls=' || (select relrowsecurity from pg_class where oid = to_regclass('public.sessions_archive'))
                   || ' | 추정행수=' || (select greatest(reltuples, 0)::bigint from pg_class where oid = to_regclass('public.sessions_archive'))
                   || ' | anon쓰기=' || (has_table_privilege('anon', 'public.sessions_archive', 'INSERT') or has_table_privilege('anon', 'public.sessions_archive', 'UPDATE')
                                        or has_table_privilege('anon', 'public.sessions_archive', 'DELETE'))
                   || ' | 쓰는 함수=' || coalesce((select string_agg(p.oid::regprocedure::text || '[anon=' || has_function_privilege('anon', p.oid, 'execute') || ']', ', ')
                                                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                                   where n.nspname = 'public' and p.prosrc ~* 'sessions_archive'), '(none)')
         end
)
select chk as "check", verdict, detail from r order by o, chk;
