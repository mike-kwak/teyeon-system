-- =============================================================================
-- P1-b 공식 Archive 쓰기 권한 점검 — 읽기 전용 · SELECT 1개 · 아무것도 바꾸지 않음
--   T 행: Archive 계열 테이블별 RLS · 역할별 권한 · 정책 · trigger · 공식/테스트 건수(데이터 내용은 출력하지 않음)
--   K 행: KDK 공식 저장이 P0-A 이후에도 되고 있는지(최근 저장 시각만)
--   F 행: 이 테이블들을 쓰는 SECURITY DEFINER 함수(anon/authenticated 실행 가능 여부)
--   R 행: profiles 역할별 인원 수(운영진 판정 기준 확인용 · 이름/이메일 출력 없음)
--   없는 테이블은 query_to_xml 로 실행 시점에만 조회 → 오류 없이 동작.
-- =============================================================================
with
tbl(o, t) as (values (1, 'teyeon_archive_v1'), (2, 'matches_archive'), (3, 'sessions_archive'), (4, 'kdk_sessions'),
                     (5, 'teyeon_special_sessions'), (6, 'kdk_archive_corrections')),
t as (
  select tbl.o, tbl.t, to_regclass('public.' || tbl.t) as rel from tbl
),
priv as (
  select t.o, t.t, t.rel,
         (select relrowsecurity from pg_class where oid = t.rel) as rls,
         (select relforcerowsecurity from pg_class where oid = t.rel) as rls_force,
         (select string_agg(r || '=' || coalesce(nullif(concat_ws('',
            case when has_table_privilege(r, t.rel, 'SELECT') then 'S' end, case when has_table_privilege(r, t.rel, 'INSERT') then 'I' end,
            case when has_table_privilege(r, t.rel, 'UPDATE') then 'U' end, case when has_table_privilege(r, t.rel, 'DELETE') then 'D' end,
            case when has_table_privilege(r, t.rel, 'TRUNCATE') then 'Tr' end), ''), '-'), ' ' order by r)
            from unnest(array['anon','authenticated','service_role']) r) as grants,
         (select string_agg(policyname || '(' || cmd || ':' || array_to_string(roles, '/') || ')', ', ' order by policyname)
            from pg_policies where schemaname = 'public' and tablename = t.t) as policies,
         (select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgrelid = t.rel and not tgisinternal) as triggers
    from t
),
r as (
  select p.o, 'T ' || p.t as item,
         case when p.rel is null then 'INFO'
              when not p.rls and (p.grants like '%authenticated=%I%' or p.grants like '%authenticated=%U%' or p.grants like '%authenticated=%D%')
                then 'RISK'
              else 'INFO' end as verdict,
         case when p.rel is null then '(없음)'
              else concat_ws(' · ', 'rls=' || p.rls || coalesce(case when p.rls_force then '(force)' end, ''), p.grants,
                             'policies=' || coalesce(p.policies, '(없음)'), 'triggers=' || coalesce(p.triggers, '(없음)'),
                             'rows=' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', p.t), false, true, '')))[1]::text)
         end as detail
    from priv p
  union all
  select 10, 'T teyeon_archive_v1 공식/테스트 구분 컬럼', 'INFO',
         coalesce((select string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) from information_schema.columns
                    where table_schema = 'public' and table_name = 'teyeon_archive_v1'), '(없음)')
  union all
  select 11, 'T teyeon_archive_v1 건수(공식 · 테스트 · 미확정)', 'INFO',
         case when to_regclass('public.teyeon_archive_v1') is null then '(없음)' else
           (xpath('/row/s/text()', query_to_xml($q$select 'official=' || count(*) filter (where coalesce(is_official, false))
                                                     || ' test=' || count(*) filter (where coalesce(is_test, false))
                                                     || ' other=' || count(*) filter (where not coalesce(is_official, false) and not coalesce(is_test, false)) as s
                                                  from public.teyeon_archive_v1$q$, false, true, '')))[1]::text end
  union all
  -- K: KDK 최종 저장(app/kdk handleFinalArchive)은 anon 키로 직접 POST → P0-A(anon 쓰기 회수) 이후 실패 가능.
  select 20, 'K 최근 Archive 저장 시각(전체 · KDK)', 'INFO',
         case when to_regclass('public.teyeon_archive_v1') is null then '(없음)' else
           (xpath('/row/s/text()', query_to_xml($q$select 'latest_any=' || coalesce(to_char(max(created_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), '-')
                                                     || ' latest_kdk=' || coalesce(to_char(max(created_at) filter (where coalesce(archive_type, raw_data->>'archive_type', 'kdk') = 'kdk') at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), '-') as s
                                                  from public.teyeon_archive_v1$q$, false, true, '')))[1]::text end
  union all
  select 21, 'K P0-A 적용 시각(security_backup.table_grants_p0a)', 'INFO',
         case when to_regclass('security_backup.table_grants_p0a') is null then '(백업 없음)' else
           (xpath('/row/s/text()', query_to_xml($q$select coalesce(to_char(max(captured_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'), '-') as s
                                                  from security_backup.table_grants_p0a where restored_at is null$q$, false, true, '')))[1]::text end
  union all
  select 22, 'K anon 의 teyeon_archive_v1 INSERT·UPDATE (KDK 최종 저장 경로)',
         case when to_regclass('public.teyeon_archive_v1') is null then 'INFO'
              when not (has_table_privilege('anon', to_regclass('public.teyeon_archive_v1'), 'INSERT') and has_table_privilege('anon', to_regclass('public.teyeon_archive_v1'), 'UPDATE'))
              then 'BROKEN' else 'INFO' end,
         case when to_regclass('public.teyeon_archive_v1') is null then '(없음)'
              else 'INSERT=' || has_table_privilege('anon', to_regclass('public.teyeon_archive_v1'), 'INSERT')
                   || ' UPDATE=' || has_table_privilege('anon', to_regclass('public.teyeon_archive_v1'), 'UPDATE')
                   || ' — false 면 /kdk 공식 저장(anon 키 POST + merge-duplicates)은 거부됨' end
  union all
  select 30, 'F ' || p.oid::regprocedure::text,
         case when has_function_privilege('anon', p.oid, 'execute') then 'RISK' else 'INFO' end,
         concat_ws(' · ', 'definer=' || p.prosecdef, 'anon=' || has_function_privilege('anon', p.oid, 'execute'),
                   'auth=' || has_function_privilege('authenticated', p.oid, 'execute'),
                   'admin_check=' || (p.prosrc ~* '(is_full_admin|''CEO''|''ADMIN'')'),
                   'writes=' || array_to_string(array(select x from unnest(array['teyeon_archive_v1','matches_archive','sessions_archive','kdk_sessions','matches']) x
                                                       where p.prosrc ~* ('(insert\s+into|update|delete\s+from)\s+(public\.)?' || x || '\M')), '/'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(teyeon_archive_v1|matches_archive|sessions_archive|kdk_sessions)\M'
  union all
  select 31, 'F final_sync_v7_absolute(jsonb) 존재(anon 실행 가능 DEFINER · matches UPDATE)',
         case when to_regprocedure('public.final_sync_v7_absolute(jsonb)') is null then 'OK'
              when has_function_privilege('anon', to_regprocedure('public.final_sync_v7_absolute(jsonb)'), 'execute') then 'RISK' else 'CHECK' end,
         case when to_regprocedure('public.final_sync_v7_absolute(jsonb)') is null then '없음(앱 코드도 호출 안 함)'
              else 'anon=' || has_function_privilege('anon', to_regprocedure('public.final_sync_v7_absolute(jsonb)'), 'execute') end
  union all
  select 40, 'R profiles 역할별 인원(운영진 판정 = is_full_admin: CEO·ADMIN)', 'INFO',
         coalesce((select string_agg(coalesce(nullif(upper(btrim(role::text)), ''), '(없음)') || '=' || c, ' · ' order by c desc)
                     from (select role, count(*) c from public.profiles group by role) x), '(없음)')
  union all
  select 41, 'R is_full_admin() 존재 · authenticated 실행', case when to_regprocedure('public.is_full_admin()') is null then 'CHECK' else 'OK' end,
         case when to_regprocedure('public.is_full_admin()') is null then '(없음)'
              else 'auth=' || has_function_privilege('authenticated', to_regprocedure('public.is_full_admin()'), 'execute') end
)
select item, verdict, detail from r order by o, item;
