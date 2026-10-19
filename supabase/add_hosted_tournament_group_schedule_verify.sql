-- ============================================================================
--  예선 조별 일정 안내 — 적용 후 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~9번이 모두 ok = true 이면 정상 적용이다.
--  10번 detail 은 precheck 10번 detail 과 '완전히 같아야' 한다(기존 함수 정의 변경 0건).
--  11번은 정보 행이다. INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

with fn(proname, args, kind, want) as (values
  ('get_admin_group_schedule',  'p_slug text', 'admin', '0e611e093783ab97cdcdae77accfb3a2'),
  ('set_schedule_settings',     'p_slug text, p_checkin_place text, p_session1_deadline text, p_session1_start text, p_session1_note text, p_session2_deadline text, p_session2_start text, p_session2_note text', 'admin', '85b4d28c15317d1d4dfd25a2ec5bf93e'),
  ('set_group_schedule',        'p_slug text, p_group_no integer, p_session_no integer, p_planned_court_no integer', 'admin', 'cdc4658e03b8ba37d726cff735888ceb'),
  ('get_public_group_schedule', 'p_slug text', 'public', '74355e5a142b59e328ea85545dc8887f')
), f as (
  select fn.*, p.oid, p.prosecdef, p.proconfig, p.prosrc, p.proacl, p.proowner
    from fn left join pg_proc p on p.proname = fn.proname and p.pronamespace = 'public'::regnamespace
         and pg_get_function_identity_arguments(p.oid) = fn.args
), tbl(t) as (values ('public.hosted_tournament_schedule_settings'), ('public.hosted_tournament_group_schedules'))
select item, ok, detail from (
  select 1 as n, 'new tables exist + RLS on' as item,
         (select bool_and(coalesce((select relrowsecurity from pg_class where oid = to_regclass(t)), false)) from tbl) as ok,
         '-' as detail
  union all
  select 2, 'no table privileges / no policies',
         (select bool_and(not has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE')
                          and not has_table_privilege('authenticated', t, 'SELECT,INSERT,UPDATE,DELETE')) from tbl)
         and not exists (select 1 from pg_policies where schemaname = 'public'
                          and tablename in ('hosted_tournament_schedule_settings', 'hosted_tournament_group_schedules')),
         '-'
  union all
  select 3, 'new functions: 4, one overload each',
         (select count(*) from f where oid is not null) = 4
         and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
               'get_admin_group_schedule', 'set_schedule_settings', 'set_group_schedule', 'get_public_group_schedule')) = 4,
         (select count(*)::text from f where oid is not null)
  union all
  select 4, 'security definer + search_path',
         coalesce((select bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp']) from f), false), '-'
  union all
  select 5, 'admin RPCs: anon=false, authenticated=true, public=false',
         coalesce((select bool_and(not has_function_privilege('anon', oid, 'EXECUTE')
                                   and has_function_privilege('authenticated', oid, 'EXECUTE')
                                   and not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) x
                                                    where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                     from f where kind = 'admin'), false), '-'
  union all
  select 6, 'public RPC: anon=true, authenticated=true, public=false',
         coalesce((select bool_and(has_function_privilege('anon', oid, 'EXECUTE')
                                   and has_function_privilege('authenticated', oid, 'EXECUTE')
                                   and not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) x
                                                    where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                     from f where kind = 'public'), false), '-'
  union all
  select 7, 'function bodies = repository file (4)',
         (select count(*) from f where md5(replace(prosrc, chr(13), '')) = want) = 4,
         coalesce((select string_agg(proname, ', ') from f where md5(replace(coalesce(prosrc, ''), chr(13), '')) <> want), 'all match')
  union all
  select 8, 'group schedule FK → groups (on delete cascade)',
         exists (select 1 from pg_constraint where conname = 'hosted_tgsched_group_fk'
                  and conrelid = 'public.hosted_tournament_group_schedules'::regclass
                  and confrelid = 'public.hosted_tournament_groups'::regclass and confdeltype = 'c'),
         '-'
  union all
  select 9, 'settings PK/FK → tournaments (on delete cascade)',
         exists (select 1 from pg_constraint where conrelid = 'public.hosted_tournament_schedule_settings'::regclass
                  and contype = 'f' and confrelid = 'public.hosted_tournaments'::regclass and confdeltype = 'c'),
         '-'
  union all
  -- 10) precheck 10번과 같은 식 — 기존 함수(새 4개 제외) 전체 지문. detail 이 precheck 와 같아야 한다.
  select 10, 'info: existing public functions fingerprint (= precheck 10)', true,
         (select count(*)::text || ' fns · ' || md5(string_agg(
                    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(replace(p.prosrc, chr(13), ''))
                    || coalesce(array_to_string(p.proconfig, ','), '') || p.prosecdef::text,
                    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.proname not in ('get_admin_group_schedule', 'set_schedule_settings', 'set_group_schedule', 'get_public_group_schedule'))
  union all
  select 11, 'info: rows (settings / group schedules)', true,
         (select count(*) from public.hosted_tournament_schedule_settings)::text || ' / '
         || (select count(*) from public.hosted_tournament_group_schedules)::text
) z order by n;
