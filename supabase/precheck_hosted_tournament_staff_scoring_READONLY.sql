-- ============================================================================
--  현장 운영자 권한 — 적용 전 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  모든 행의 ok = true 일 때만 add_hosted_tournament_staff_scoring.sql 을 적용한다.
--  ⚠ 1~6번이 false 이면 적용하지 않는다 — 적용 SQL 은 기존 함수 3개를 '이 md5 의 원본' 기준으로 바꾼다.
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

with f(n, proname, args, want) as (values
  (1, 'start_hosted_match_timer',          'p_match_id uuid',                                                                   '102e2c5d2dbed3911fb33e32fe2876bc'),
  (2, 'complete_match',                    'p_match_id uuid, p_score1 integer, p_score2 integer, p_expected_version integer',   '0d33b70ee0dd0f0e04f3a921ac58727b'),
  (3, 'complete_knockout_match',           'p_match_id uuid, p_score1 integer, p_score2 integer, p_expected_version integer',   'ca42ef267edd9469ae65b9aa226b0615'),
  (4, 'hosted_tournament_match_begin',     'p_match_id uuid, p_expected_version integer',                                       '37066ce0cea54e45d6d4626e8e24c214'),
  (5, 'can_manage_tournaments',            '',                                                                                  '3f165edbc8211b3935382675bb4416d7'),
  (6, 'hosted_tournament_knockout_advance', 'p_tournament_id uuid, p_bracket_id uuid, p_slot_id uuid, p_team_id uuid',          '1f0a37a48a054ef0be8dcd69507c264c')
)
select item, ok, detail from (
  select f.n,
         'md5 ' || f.proname as item,
         coalesce(md5(replace(p.prosrc, chr(13), '')) = f.want, false) as ok,
         coalesce(md5(replace(p.prosrc, chr(13), '')), '없음') as detail
    from f
    left join pg_proc p on p.proname = f.proname and p.pronamespace = 'public'::regnamespace
         and pg_get_function_identity_arguments(p.oid) = f.args
  union all
  select 7, 'new table not present', to_regclass('public.hosted_tournament_staff') is null,
         coalesce(to_regclass('public.hosted_tournament_staff')::text, '-')
  union all
  select 8, 'new function names not present',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (
           'hosted_tournament_is_staff_scorer', 'hosted_tournament_staff_default_expiry', 'hosted_tournament_match_begin_score',
           'request_tournament_staff', 'get_my_tournament_staff', 'get_staff_match_board',
           'get_admin_tournament_staff', 'approve_tournament_staff', 'revoke_tournament_staff')),
         '-'
  union all
  select 9, 'profiles.nickname exists',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'profiles' and column_name = 'nickname'), '-'
  union all
  select 10, 'hosted_tournament_log_event(7 args) exists',
         to_regprocedure('public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text)') is not null, '-'
  union all
  select 11, 'matches.play_started_at exists (timer SQL applied)',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'hosted_tournament_matches' and column_name = 'play_started_at'), '-'
  union all
  select 12, 'existing 3 functions: one overload each',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
           and proname in ('start_hosted_match_timer', 'complete_match', 'complete_knockout_match')) = 3,
         (select string_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')', ', ' order by proname) from pg_proc
           where pronamespace = 'public'::regnamespace and proname in ('start_hosted_match_timer', 'complete_match', 'complete_knockout_match'))
) x order by n;
