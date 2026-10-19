-- ============================================================================
--  예선 조별 일정 안내 — 적용 전 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~9번이 모두 ok = true 일 때만 add_hosted_tournament_group_schedule.sql 을 적용한다.
--  10번은 정보 행이다 — detail(기존 함수 전체 지문)을 적어 두었다가 적용 후 verify 10번 detail 과 같은지 본다.
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

select item, ok, detail from (
  select 1 as n, 'new tables not present' as item,
         to_regclass('public.hosted_tournament_schedule_settings') is null
         and to_regclass('public.hosted_tournament_group_schedules') is null as ok,
         '-' as detail
  union all
  select 2, 'new function names not present',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (
           'get_admin_group_schedule', 'set_schedule_settings', 'set_group_schedule', 'get_public_group_schedule')),
         '-'
  union all
  select 3, 'groups (tournament_id, id) unique constraint exists',
         exists (select 1 from pg_constraint where conname = 'hosted_tgroup_tid_id_unique'
                  and conrelid = 'public.hosted_tournament_groups'::regclass and contype = 'u'),
         '-'
  union all
  select 4, 'group_members (group_id, team_id) exists',
         (select count(*) from information_schema.columns where table_schema = 'public'
           and table_name = 'hosted_tournament_group_members' and column_name in ('group_id', 'team_id')) = 2,
         '-'
  union all
  select 5, 'courts (court_no, display_name, status) exists',
         (select count(*) from information_schema.columns where table_schema = 'public'
           and table_name = 'hosted_tournament_courts' and column_name in ('court_no', 'display_name', 'status')) = 3,
         '-'
  union all
  select 6, 'tournaments draw status + published_at columns exist',
         (select count(*) from information_schema.columns where table_schema = 'public'
           and table_name = 'hosted_tournaments'
           and column_name in ('preliminary_draw_status', 'preliminary_draw_published_at')) = 2,
         '-'
  union all
  select 7, 'hosted_tournament_log_event(7 args) exists',
         to_regprocedure('public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text)') is not null, '-'
  union all
  select 8, 'events entity_type allows group',
         exists (select 1 from pg_constraint where conrelid = 'public.hosted_tournament_events'::regclass
                  and contype = 'c' and pg_get_constraintdef(oid) like '%''group''%'),
         '-'
  union all
  select 9, 'md5 can_manage_tournaments',
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc
                    where proname = 'can_manage_tournaments' and pronamespace = 'public'::regnamespace)
                  = '3f165edbc8211b3935382675bb4416d7', false),
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc
                    where proname = 'can_manage_tournaments' and pronamespace = 'public'::regnamespace), '없음')
  union all
  -- 10) 정보: public 스키마 기존 함수 전체(새 4개 제외)의 지문. 적용 후 verify 10번 detail 과 같아야 한다.
  select 10, 'info: existing public functions fingerprint', true,
         (select count(*)::text || ' fns · ' || md5(string_agg(
                    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(replace(p.prosrc, chr(13), ''))
                    || coalesce(array_to_string(p.proconfig, ','), '') || p.prosecdef::text,
                    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.proname not in ('get_admin_group_schedule', 'set_schedule_settings', 'set_group_schedule', 'get_public_group_schedule'))
) x order by n;
