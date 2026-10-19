-- ============================================================================
--  현장 팀 체크인 — 적용 전 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  모든 행의 ok = true 이면 add_hosted_tournament_team_checkin.sql 을 적용해도 된다.
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

select item, ok, detail from (
  -- 1) 새로 만들 이름이 아직 없다(이미 있으면 누군가 먼저 적용했거나 다른 정의가 있다)
  select 1 as n, 'new table not present' as item,
         to_regclass('public.hosted_tournament_team_checkins') is null as ok,
         coalesce(to_regclass('public.hosted_tournament_team_checkins')::text, '-') as detail
  union all
  select 2, 'new RPC names not present',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                      and proname in ('get_admin_team_checkins', 'set_team_checkin')),
         coalesce((select string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', ', ')
                     from pg_proc where pronamespace = 'public'::regnamespace
                      and proname in ('get_admin_team_checkins', 'set_team_checkin')), '-')
  -- 2) 기대는 기존 객체
  union all
  select 3, 'teams (tournament_id, id) unique exists',
         exists (select 1 from pg_constraint where conname = 'hosted_tteam_tid_id_unique'
                    and conrelid = 'public.hosted_tournament_teams'::regclass and contype = 'u'),
         'hosted_tteam_tid_id_unique'
  union all
  select 4, 'can_manage_tournaments() exists',
         to_regprocedure('public.can_manage_tournaments()') is not null, '-'
  union all
  select 5, 'hosted_tournament_log_event(7 args) exists',
         to_regprocedure('public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text)') is not null, '-'
  union all
  select 6, 'events.entity_type allows team',
         exists (select 1 from pg_constraint
                  where conrelid = 'public.hosted_tournament_events'::regclass and contype = 'c'
                    and pg_get_constraintdef(oid) like '%entity_type%' and pg_get_constraintdef(oid) like '%''team''%'),
         '-'
  -- 3) 참고: 대회별 팀 수(개인정보 없음). 적용 판단에는 쓰지 않는다.
  union all
  select 7, 'info: teams per tournament', true,
         coalesce((select string_agg(h.slug || '=' || (select count(*) from public.hosted_tournament_teams t
                                                       where t.tournament_id = h.id), ', ' order by h.slug)
                     from public.hosted_tournaments h), '-')
) x order by n;
