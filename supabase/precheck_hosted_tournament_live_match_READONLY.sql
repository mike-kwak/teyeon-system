-- ============================================================================
--  LIVE 중계 경기 연결 — 적용 전 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~5번이 모두 ok = true 여야 적용한다.
--  6번 detail 을 적어 두었다가 적용 후 verify 10번 detail 과 비교한다(기존 함수 변경 0건 확인).
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

select item, ok, detail from (
  select 1 as n, 'prerequisite tables exist' as item,
         (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
            and c.relname in ('hosted_tournaments', 'hosted_tournament_matches', 'hosted_tournament_courts',
                              'hosted_tournament_events', 'hosted_tournament_teams', 'hosted_tournament_groups',
                              'hosted_tournament_brackets', 'hosted_tournament_bracket_rounds')) = 8 as ok,
         '-' as detail
  union all
  select 2, 'prerequisite functions exist',
         to_regprocedure('public.can_manage_tournaments()') is not null
         and to_regprocedure('public.set_feature_court(text,integer)') is not null
         and to_regprocedure('public.start_match(uuid,integer,integer)') is not null,
         '-'
  union all
  select 3, 'DRAW publication columns exist',
         exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'hosted_tournaments' and column_name = 'preliminary_draw_published_at')
         and exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'hosted_tournament_brackets' and column_name = 'published_at'),
         '-'
  union all
  select 4, 'new objects not present yet',
         to_regclass('public.hosted_tournament_live_state') is null
         and to_regclass('public.hosted_tournament_live_segments') is null
         and to_regclass('public.hosted_tournament_live_clips') is null
         and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (
               'get_public_live_match', 'get_public_live_replays', 'get_admin_live_state', 'set_live_match',
               'sync_live_clips', 'adjust_live_clip', 'set_live_clip_status', 'get_admin_live_clips',
               'hosted_tournament_live_match_snapshot', 'hosted_tournament_live_stage_is_public',
               'hosted_tournament_live_on_air', 'hosted_tournament_live_sync_auto')),
         '-'
  union all
  select 5, 'multirange support (PostgreSQL 14+)',
         current_setting('server_version_num')::integer >= 140000,
         current_setting('server_version')
  union all
  select 6, 'info: existing public functions fingerprint', true,
         (select count(*)::text || ' fns · ' || md5(string_agg(
                    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(replace(p.prosrc, chr(13), ''))
                    || coalesce(array_to_string(p.proconfig, ','), '') || p.prosecdef::text,
                    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.proname not in ('get_public_live_match', 'get_public_live_replays', 'get_admin_live_state',
                                   'set_live_match', 'sync_live_clips', 'adjust_live_clip', 'set_live_clip_status',
                                   'get_admin_live_clips', 'hosted_tournament_live_match_snapshot',
                                   'hosted_tournament_live_stage_is_public', 'hosted_tournament_live_on_air',
                                   'hosted_tournament_live_sync_auto'))
  union all
  select 7, 'info: feature court (courtNo or none) · tournaments', true,
         coalesce((select string_agg(t.slug || '=' || c.court_no::text, ', ')
                     from public.hosted_tournament_courts c
                     join public.hosted_tournaments t on t.id = c.tournament_id
                    where c.is_feature_court), 'none')
         || ' · ' || (select count(*)::text from public.hosted_tournaments)
) x order by n;
