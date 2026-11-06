-- =============================================================================
-- TEYEON MATCH SPOTLIGHT v2.2 — 운영 사전 점검 (읽기 전용 · SELECT 1개 · 데이터 변경 없음)
--   Supabase SQL Editor 에 전체 붙여넣고 Run → 결과 표(20행)를 그대로 복사해 전달.
--   개인정보(이름·연락처·id)는 출력하지 않는다. 개수·구조 정보만.
--   판정: verdict 열에 'STOP' 이 하나라도 있으면 적용하지 않는다.
-- =============================================================================
with
cols as (
  select table_name::text as table_name, column_name::text as column_name, data_type::text as data_type
    from information_schema.columns
   where table_schema = 'public' and table_name in ('matches','profiles')
),
need(col) as (values ('id'),('club_id'),('session_id'),('status'),('round'),('court'),('player_ids'),('player_names'),('group_name')),
spot_tables as (
  select string_agg(table_name::text, ', ' order by table_name) as n
    from information_schema.tables
   where table_schema = 'public'
     and table_name in ('kdk_match_lifecycle','kdk_match_lifecycle_faults','kdk_spotlight_runs','kdk_match_predictions')
),
spot_funcs as (
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) as n
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and p.proname in ('kdk_match_lifecycle_capture','kdk_match_lifecycle_recert','kdk_spotlight_is_admin',
                       'kdk_spotlight_ledger_healthy','kdk_spotlight_match_block_reason','save_kdk_spotlight_run',
                       'get_kdk_spotlight_run_for_publish','publish_kdk_spotlight_run','unpublish_kdk_spotlight_run',
                       'get_kdk_spotlight_admin','get_public_kdk_spotlight','get_public_kdk_spotlight_link')
),
trg as (
  select t.tgname::text as tgname, t.tgenabled::text as tgenabled, pg_get_triggerdef(t.oid) as def
    from pg_trigger t
   where t.tgrelid = to_regclass('public.matches') and not t.tgisinternal
),
st as (
  select case when session_id::text like 'SP-%' then 'SPECIAL' else 'KDK' end as kind,
         coalesce(status::text, '(null)') as status, count(*) as n, count(distinct session_id) as sessions
    from public.matches group by 1, 2
),
r as (
  select 1 as o, 'P01 PostgreSQL 버전' as chk, 'INFO' as verdict, version() as detail
  union all
  select 2, 'P02 matches 테이블 존재', case when to_regclass('public.matches') is not null then 'OK' else 'STOP' end,
         coalesce(to_regclass('public.matches')::text, '없음')
  union all
  select 3, 'P03 matches 필요 컬럼 9개', case when count(c.column_name) = 9 then 'OK' else 'STOP' end,
         string_agg(need.col || ':' || coalesce(c.data_type, '없음'), ', ' order by need.col)
    from need left join cols c on c.table_name = 'matches' and c.column_name = need.col
  union all
  select 4, 'P04 matches 전체 컬럼', 'INFO',
         (select string_agg(column_name || ':' || data_type, ', ') from cols where table_name = 'matches')
  union all
  select 5, 'P05 profiles.id · role 컬럼', case when count(*) = 2 then 'OK' else 'STOP' end,
         coalesce(string_agg(column_name || ':' || data_type, ', '), '없음')
    from cols where table_name = 'profiles' and column_name in ('id','role')
  union all
  select 6, 'P06 SPOTLIGHT 테이블 사전 존재(없어야 정상)', case when n is null then 'OK' else 'STOP' end, coalesce(n, '(none)')
    from spot_tables
  union all
  select 7, 'P07 SPOTLIGHT 함수 사전 존재(없어야 정상)', case when n is null then 'OK' else 'STOP' end, coalesce(n, '(none)')
    from spot_funcs
  union all
  select 8, 'P08 matches 의 기존 trigger', case when coalesce(bool_or(tgname like 'kdk_match_lifecycle_%'), false) then 'STOP' else 'INFO' end,
         coalesce(string_agg(tgname || '[' || tgenabled || '] ' || def, ' || ' order by tgname), '(none)')
    from trg
  union all
  select 9, 'P09 matches RLS 사용', 'INFO',
         (select relrowsecurity::text || ' / force=' || relforcerowsecurity::text from pg_class where oid = to_regclass('public.matches'))
  union all
  select 10, 'P10 matches RLS 정책', 'INFO',
         coalesce((select string_agg(policyname::text || '(' || cmd || ' ' || roles::text || ') using=' || coalesce(qual, '-')
                                     || ' check=' || coalesce(with_check, '-'), ' || ' order by policyname)
                     from pg_policies where schemaname = 'public' and tablename = 'matches'), '(none)')
  union all
  select 11, 'P11 matches 권한 S/I/U/D', 'INFO',
         (select string_agg(g.r || '=' || concat_ws('',
                   case when has_table_privilege(g.r, 'public.matches', 'select') then 'S' end,
                   case when has_table_privilege(g.r, 'public.matches', 'insert') then 'I' end,
                   case when has_table_privilege(g.r, 'public.matches', 'update') then 'U' end,
                   case when has_table_privilege(g.r, 'public.matches', 'delete') then 'D' end), ', ')
            from (values ('anon'), ('authenticated'), ('service_role')) g(r))
  union all
  select 12, 'P12 Realtime publication 포함', 'INFO',
         coalesce((select string_agg(pubname::text, ', ') from pg_publication_tables where schemaname = 'public' and tablename = 'matches'), '(none)')
  union all
  select 13, 'P13 matches 행 수(설치 시 backfill 규모)', case when (select count(*) from public.matches) > 20000 then 'CHECK' else 'OK' end,
         (select count(*)::text from public.matches)
  union all
  select 14, 'P14 진행 중 경기(playing) 0 이어야 적용', case when coalesce(sum(n) filter (where status = 'playing'), 0) = 0 then 'OK' else 'STOP' end,
         coalesce(string_agg(kind || '/' || status || '=' || n || '건(' || sessions || '세션)', ', ' order by kind, status), '(matches 비어 있음)')
    from st
  union all
  select 15, 'P15 기존 KDK RPC(변경 안 함 · 참고)', 'INFO',
         coalesce((select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
                     from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                    where s.nspname = 'public'
                      and (p.proname like '%kdk%' or p.proname = 'sync_tournament_matches')), '(none)')
  union all
  select 16, 'P16 Supabase 역할 · auth.uid()',
         case when (select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')) = 3
               and to_regprocedure('auth.uid()') is not null then 'OK' else 'STOP' end,
         (select string_agg(rolname::text, ', ') from pg_roles where rolname in ('anon','authenticated','service_role'))
         || ' / auth.uid=' || coalesce(to_regprocedure('auth.uid()')::text, '없음')
  union all
  select 17, 'P17 gen_random_uuid()', case when to_regprocedure('gen_random_uuid()') is not null then 'OK' else 'STOP' end,
         coalesce(to_regprocedure('gen_random_uuid()')::text, '없음')
  union all
  select 18, 'P18 CEO·ADMIN 계정 수(개수만)', 'INFO',
         case when (select count(*) from cols where table_name = 'profiles' and column_name = 'role') = 1
              then (xpath('/row/c/text()', query_to_xml(
                     'select count(*) as c from public.profiles where upper(btrim(coalesce(role::text, ''''))) in (''CEO'',''ADMIN'')',
                     false, true, '')))[1]::text
              else '(role 컬럼 없음)' end
  union all
  select 19, 'P19 matches 잠금 · 활성 쿼리 수', 'INFO',
         (select count(*)::text from pg_locks where relation = to_regclass('public.matches'))
         || '개 잠금 / 활성 쿼리 ' || (select count(*)::text from pg_stat_activity where state = 'active' and pid <> pg_backend_pid())
  union all
  select 20, 'P20 백업 스키마 spotlight_backup 사전 존재', 'INFO',
         coalesce((select nspname::text from pg_namespace where nspname = 'spotlight_backup'), '(none)')
  union all
  -- v2.2: SPOTLIGHT 관리 권한 = 기존 KDK 관리자 체계(SQL 30). 없으면 CEO · ADMIN 만 관리 가능(적용은 가능).
  select 21, 'P21 KDK 관리자 체계(SQL 30 can_manage_kdk · kdk_managers)',
         case when to_regprocedure('public.can_manage_kdk()') is not null and to_regclass('public.kdk_managers') is not null then 'OK' else 'INFO' end,
         case when to_regprocedure('public.can_manage_kdk()') is not null and to_regclass('public.kdk_managers') is not null
              then 'SPOTLIGHT 관리 = CEO · ADMIN · KDK 관리자(등재 '
                   || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.kdk_managers', false, true, '')))[1]::text || '명)'
              else 'SQL 30 없음 — SPOTLIGHT 관리는 CEO · ADMIN 만' end
)
select chk as "check", verdict, detail from r order by o;
