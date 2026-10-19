-- ============================================================================
--  현장 팀 체크인 — 적용 후 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  모든 행의 ok = true 이면 정상 적용이다. INSERT/UPDATE/DELETE/DDL 없음.
--  ⚠ 체크인 동작(쓰기)은 여기서 시험하지 않는다 — 운영 데이터를 만들지 않기 위해서다.
--    동작 검증은 테스트 DB 와 리허설용 fixture 대회에서 한다.
-- ============================================================================

with f as (
  select p.oid, p.proname, p.prosecdef, p.proconfig
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('get_admin_team_checkins', 'set_team_checkin')
)
select item, ok, detail from (
  select 1 as n, 'table exists' as item,
         to_regclass('public.hosted_tournament_team_checkins') is not null as ok, '-' as detail
  union all
  select 2, 'RLS enabled',
         coalesce((select relrowsecurity from pg_class
                    where oid = to_regclass('public.hosted_tournament_team_checkins')), false), '-'
  union all
  select 3, 'no table privileges for anon/authenticated',
         not has_table_privilege('anon', 'public.hosted_tournament_team_checkins', 'SELECT,INSERT,UPDATE,DELETE')
         and not has_table_privilege('authenticated', 'public.hosted_tournament_team_checkins', 'SELECT,INSERT,UPDATE,DELETE'),
         '-'
  union all
  select 4, 'no RLS policies (RPC only)',
         not exists (select 1 from pg_policies where schemaname = 'public'
                      and tablename = 'hosted_tournament_team_checkins'),
         '-'
  union all
  select 5, 'composite FK to teams (on delete cascade)',
         exists (select 1 from pg_constraint where conname = 'hosted_tcheckin_team_fk'
                    and contype = 'f' and confdeltype = 'c'),
         '-'
  union all
  select 6, 'RPC 2 exist, one overload each',
         (select count(*) from f) = 2
         and (select count(distinct proname) from f) = 2, (select string_agg(proname, ', ') from f)
  union all
  select 7, 'RPC security definer + search_path',
         coalesce((select bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp']) from f), false),
         coalesce((select string_agg(proname || ':' || coalesce(array_to_string(proconfig, ';'), 'null'), ' | ') from f), '-')
  union all
  select 8, 'EXECUTE: anon=false, authenticated=true, public=false',
         coalesce((select bool_and(
                    not has_function_privilege('anon', oid, 'EXECUTE')
                    and has_function_privilege('authenticated', oid, 'EXECUTE')
                    and not exists (select 1 from aclexplode(coalesce(
                          (select proacl from pg_proc where pg_proc.oid = f.oid),
                          acldefault('f', (select proowner from pg_proc where pg_proc.oid = f.oid)))) a
                                     where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
                    from f), false),
         '-'
  union all
  select 9, 'info: check-in rows per tournament', true,
         coalesce((select string_agg(h.slug || '=' || x.n, ', ' order by h.slug)
                     from (select tournament_id, count(*) n from public.hosted_tournament_team_checkins
                            group by tournament_id) x
                     join public.hosted_tournaments h on h.id = x.tournament_id), 'none')
) z order by n;
