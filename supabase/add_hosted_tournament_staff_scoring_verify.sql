-- ============================================================================
--  현장 운영자 권한 — 적용 후 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~12번이 모두 ok = true 이면 정상 적용이다. INSERT/UPDATE/DELETE/DDL 없음.
--  ⚠ 권한 요청 · 승인 같은 쓰기 동작은 여기서 시험하지 않는다(운영 데이터를 만들지 않기 위해).
-- ============================================================================

with pub(proname) as (values
  ('request_tournament_staff'), ('get_my_tournament_staff'), ('get_staff_match_board'),
  ('get_admin_tournament_staff'), ('approve_tournament_staff'), ('revoke_tournament_staff')
), internal(proname) as (values
  ('hosted_tournament_is_staff_scorer'), ('hosted_tournament_staff_default_expiry'), ('hosted_tournament_match_begin_score')
), all_new as (
  select p.oid, p.proname, p.prosecdef, p.proconfig from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (select proname from pub union all select proname from internal)
), changed(proname, orig) as (values
  ('start_hosted_match_timer', '102e2c5d2dbed3911fb33e32fe2876bc'),
  ('complete_match',           '0d33b70ee0dd0f0e04f3a921ac58727b'),
  ('complete_knockout_match',  'ca42ef267edd9469ae65b9aa226b0615')
), pub_exec as (
  select p.oid from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (select proname from pub union all select proname from changed)
), body(proname, args, want) as (values
  -- 이 대회 SQL 이 만든 함수 12개의 본문 지문(저장소 파일 기준) — 붙여넣기 누락 · 시그니처 차이를 잡는다
  ('hosted_tournament_is_staff_scorer',      'p_tid uuid',                                                                         '13fca491dd69da36cc4e7879c72ac76d'),
  ('hosted_tournament_staff_default_expiry', 'p_tid uuid',                                                                         '23c7c602037305aebda1edcbf212ab16'),
  ('hosted_tournament_match_begin_score',    'p_match_id uuid, p_expected_version integer',                                        'ccdabac35757589ba737f38eace02b60'),
  ('start_hosted_match_timer',               'p_match_id uuid',                                                                    '1adc72bf18fd87aa897f96679d85145f'),
  ('complete_match',                         'p_match_id uuid, p_score1 integer, p_score2 integer, p_expected_version integer',    '5a023c6ad206cd2b17839936de491d82'),
  ('complete_knockout_match',                'p_match_id uuid, p_score1 integer, p_score2 integer, p_expected_version integer',    '0a3ff10559a22b9324c88f8d05b71ee3'),
  ('request_tournament_staff',               'p_slug text, p_display_name text',                                                   '3f3017d7a1fed7caf4fe6a8a77442ea8'),
  ('get_my_tournament_staff',                'p_slug text',                                                                        '9b32d5e2e071f4f547d1b98a14014b85'),
  ('get_staff_match_board',                  'p_slug text',                                                                        'f5509fe0b15303ddb0ab5a0f11defc47'),
  ('get_admin_tournament_staff',             'p_slug text',                                                                        '15a1baa1092f26ae47f64e67f9081c70'),
  ('approve_tournament_staff',               'p_slug text, p_user_id uuid, p_expires_at timestamp with time zone, p_verify_code text', 'b914ff42737ea2cc64ffedff26d40c63'),
  ('revoke_tournament_staff',                'p_slug text, p_user_id uuid',                                                        '046ff859f48d1469fd3db46110fff1ef')
), body_check as (
  select b.proname, (md5(replace(p.prosrc, chr(13), '')) = b.want) as ok
    from body b
    left join pg_proc p on p.proname = b.proname and p.pronamespace = 'public'::regnamespace
         and pg_get_function_identity_arguments(p.oid) = b.args
)
select item, ok, detail from (
  select 1 as n, 'table exists + RLS on' as item,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.hosted_tournament_staff')), false) as ok,
         '-' as detail
  union all
  select 2, 'no table privileges / no policies',
         not has_table_privilege('anon', 'public.hosted_tournament_staff', 'SELECT,INSERT,UPDATE,DELETE')
         and not has_table_privilege('authenticated', 'public.hosted_tournament_staff', 'SELECT,INSERT,UPDATE,DELETE')
         and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'hosted_tournament_staff'),
         '-'
  union all
  select 3, 'table columns: verify_code + revoke_count',
         (select count(*) from information_schema.columns
           where table_schema = 'public' and table_name = 'hosted_tournament_staff'
             and column_name in ('verify_code', 'revoke_count')) = 2,
         '-'
  union all
  select 4, 'new functions: 9, one overload each',
         (select count(*) from all_new) = 9 and (select count(distinct proname) from all_new) = 9,
         (select count(*)::text from all_new)
  union all
  select 5, 'new functions: security definer + search_path',
         coalesce((select bool_and(prosecdef and proconfig @> array['search_path=public, pg_temp']) from all_new), false), '-'
  union all
  select 6, 'internal helpers: no EXECUTE for anon/authenticated/public',
         coalesce((select bool_and(not has_function_privilege('anon', a.oid, 'EXECUTE')
                                   and not has_function_privilege('authenticated', a.oid, 'EXECUTE')
                                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                                    where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                     from all_new a join pg_proc p on p.oid = a.oid
                    where a.proname in (select proname from internal)), false), '-'
  union all
  select 7, 'operator RPCs + changed 3: anon=false, authenticated=true, public=false',
         coalesce((select bool_and(not has_function_privilege('anon', e.oid, 'EXECUTE')
                                   and has_function_privilege('authenticated', e.oid, 'EXECUTE')
                                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                                    where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
                     from pub_exec e join pg_proc p on p.oid = e.oid), false),
         (select count(*)::text from pub_exec)
  union all
  select 8, 'changed 3 = original except entry point (one call each)',
         (select count(*) from changed c join pg_proc p on p.proname = c.proname and p.pronamespace = 'public'::regnamespace
           where md5(replace(replace(p.prosrc, chr(13), ''), 'public.hosted_tournament_match_begin_score(', 'public.hosted_tournament_match_begin(')) = c.orig
             and (length(p.prosrc) - length(replace(p.prosrc, 'public.hosted_tournament_match_begin_score(', '')))
                 = length('public.hosted_tournament_match_begin_score(')) = 3,
         '-'
  union all
  select 9, 'changed 3: security definer + search_path',
         (select count(*) from changed c join pg_proc p on p.proname = c.proname and p.pronamespace = 'public'::regnamespace
           where p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']) = 3,
         '-'
  union all
  -- 10) 그대로여야 하는 기존 함수(코트 투입 · 호명 · 취소/복구 · 공통 진입점 · 권한 판정 · 보드 · 승자 진출)
  select 10, 'unchanged: start_match / call / uncall / cancel / restore / match_begin / can_manage / board / knockout_advance',
         (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname, md5(replace(p.prosrc, chr(13), ''))) in (
            ('start_match', '8af2717700404903a3f8523e66cc6248'),
            ('call_match', '337985abc5084b804bf8afdf30a91e20'),
            ('uncall_match', '774c74016d977ba03cb453ca98b4a797'),
            ('cancel_match', '1d626162fe658bf592fa32a8e2ea6f79'),
            ('restore_cancelled_match', 'ae944e9bfaa51882cef09c9c93af5cd1'),
            ('hosted_tournament_match_begin', '37066ce0cea54e45d6d4626e8e24c214'),
            ('can_manage_tournaments', '3f165edbc8211b3935382675bb4416d7'),
            ('get_admin_match_board', 'dc3f0f9eaa0907bff3b7f7834f4dc0bc'),
            ('hosted_tournament_knockout_advance', '1f0a37a48a054ef0be8dcd69507c264c'))) = 9,
         '-'
  union all
  select 11, 'function bodies = repository file (12)',
         (select count(*) from body_check where ok) = 12,
         coalesce((select string_agg(proname, ', ') from body_check where ok is not true), 'all match')
  union all
  select 12, 'approve signature (text, uuid, timestamptz, text)',
         to_regprocedure('public.approve_tournament_staff(text,uuid,timestamptz,text)') is not null,
         '-'
  union all
  select 13, 'info: staff rows per tournament/status', true,
         coalesce((select string_agg(h.slug || ':' || s.status || '=' || s.n, ', ' order by h.slug, s.status)
                     from (select tournament_id, status, count(*) n from public.hosted_tournament_staff group by 1, 2) s
                     join public.hosted_tournaments h on h.id = s.tournament_id), 'none')
) z order by n;
