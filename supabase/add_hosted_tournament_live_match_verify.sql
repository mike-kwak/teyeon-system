-- ============================================================================
--  LIVE 중계 경기 연결 — 적용 후 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~9번이 모두 ok = true 여야 한다.
--  10번 detail 은 적용 전 precheck 6번 detail 과 글자 하나까지 같아야 한다(기존 함수 변경 0건).
--  11번은 정보 행 — 새 테이블 행 수(적용 직후 '대회 수 / 0 / 0').
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

select item, ok, detail from (
  select 1 as n, 'new tables exist + RLS enabled' as item,
         (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace
            and c.relname in ('hosted_tournament_live_state', 'hosted_tournament_live_segments',
                              'hosted_tournament_live_clips') and c.relrowsecurity) = 3 as ok,
         '-' as detail
  union all
  select 2, 'no table privileges for public/anon/authenticated · no policies',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public'
                        and table_name in ('hosted_tournament_live_state', 'hosted_tournament_live_segments',
                                           'hosted_tournament_live_clips')
                        and grantee in ('PUBLIC', 'anon', 'authenticated'))
         and not exists (select 1 from pg_policies where schemaname = 'public'
                          and tablename in ('hosted_tournament_live_state', 'hosted_tournament_live_segments',
                                            'hosted_tournament_live_clips')),
         '-'
  union all
  select 3, 'new functions exist (12)',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'get_public_live_match', 'get_public_live_replays', 'get_admin_live_state', 'set_live_match',
            'sync_live_clips', 'adjust_live_clip', 'set_live_clip_status', 'get_admin_live_clips',
            'hosted_tournament_live_match_snapshot', 'hosted_tournament_live_stage_is_public',
            'hosted_tournament_live_on_air', 'hosted_tournament_live_sync_auto')) = 12,
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'get_public_live_match', 'get_public_live_replays', 'get_admin_live_state', 'set_live_match',
            'sync_live_clips', 'adjust_live_clip', 'set_live_clip_status', 'get_admin_live_clips',
            'hosted_tournament_live_match_snapshot', 'hosted_tournament_live_stage_is_public',
            'hosted_tournament_live_on_air', 'hosted_tournament_live_sync_auto'))
  union all
  select 4, 'all SECURITY DEFINER + search_path fixed',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'get_public_live_match', 'get_public_live_replays', 'get_admin_live_state', 'set_live_match',
            'sync_live_clips', 'adjust_live_clip', 'set_live_clip_status', 'get_admin_live_clips',
            'hosted_tournament_live_match_snapshot', 'hosted_tournament_live_stage_is_public',
            'hosted_tournament_live_on_air', 'hosted_tournament_live_sync_auto')
            and (not prosecdef or coalesce(array_to_string(proconfig, ','), '') <> 'search_path=public, pg_temp')),
         '-'
  union all
  select 5, 'admin RPCs: authenticated only (no anon/public)',
         not exists (
           select 1 from (values
               ('public.get_admin_live_state(text)'),
               ('public.set_live_match(text,text,uuid,integer)'),
               ('public.sync_live_clips(text,jsonb)'),
               ('public.adjust_live_clip(uuid,numeric,numeric,integer)'),
               ('public.set_live_clip_status(uuid,text,integer)'),
               ('public.get_admin_live_clips(text)')) f(sig)
            where not has_function_privilege('authenticated', f.sig, 'execute')
               or has_function_privilege('anon', f.sig, 'execute')),
         '-'
  union all
  select 6, 'public RPCs: anon + authenticated',
         has_function_privilege('anon', 'public.get_public_live_match(text)', 'execute')
         and has_function_privilege('authenticated', 'public.get_public_live_match(text)', 'execute')
         and has_function_privilege('anon', 'public.get_public_live_replays(text)', 'execute')
         and has_function_privilege('authenticated', 'public.get_public_live_replays(text)', 'execute'),
         '-'
  union all
  select 7, 'internal helpers: no execute for anon/authenticated',
         not exists (
           select 1 from (values
               ('public.hosted_tournament_live_match_snapshot(uuid,integer)'),
               ('public.hosted_tournament_live_stage_is_public(uuid,text)'),
               ('public.hosted_tournament_live_on_air(uuid)'),
               ('public.hosted_tournament_live_sync_auto(uuid)')) f(sig)
            where has_function_privilege('anon', f.sig, 'execute')
               or has_function_privilege('authenticated', f.sig, 'execute')),
         '-'
  union all
  select 8, 'function bodies match file',
         (select count(*) from pg_proc p
           join (values
               ('get_public_live_match', '314328e6f144eab3ed19e115554dbf2b'),
               ('get_public_live_replays', '91c2429c291f90b6d7ba105887915b4f'),
               ('get_admin_live_state', '5a864e53feb3aee0c51dcc3e51b79354'),
               ('set_live_match', '439808298319098345766b6cc6caa435'),
               ('sync_live_clips', 'f247ed98f59a2ee598126285b2a413b5'),
               ('adjust_live_clip', 'bfd54284a7b5e902c52a7f7d1aae111b'),
               ('set_live_clip_status', '7def54f5087e58b21f1d700aa6fa9843'),
               ('get_admin_live_clips', 'a1196ef9f043c618a12cf0a602e278bd'),
               ('hosted_tournament_live_match_snapshot', '974932562a49f4021383adcfcc2e213b'),
               ('hosted_tournament_live_stage_is_public', 'd920469a154d76a69b478ba35faceab8'),
               ('hosted_tournament_live_on_air', 'd1946a0b40093cec1fd537b807f72aa8'),
               ('hosted_tournament_live_sync_auto', 'ef6ddfeb2be0cd3a271ffcee41e720bb')) v(name, hash)
             on v.name = p.proname
          where p.pronamespace = 'public'::regnamespace
            and md5(replace(p.prosrc, chr(13), '')) = v.hash) = 12,
         case when (select count(*) from pg_proc p
           join (values
               ('get_public_live_match', '314328e6f144eab3ed19e115554dbf2b'),
               ('get_public_live_replays', '91c2429c291f90b6d7ba105887915b4f'),
               ('get_admin_live_state', '5a864e53feb3aee0c51dcc3e51b79354'),
               ('set_live_match', '439808298319098345766b6cc6caa435'),
               ('sync_live_clips', 'f247ed98f59a2ee598126285b2a413b5'),
               ('adjust_live_clip', 'bfd54284a7b5e902c52a7f7d1aae111b'),
               ('set_live_clip_status', '7def54f5087e58b21f1d700aa6fa9843'),
               ('get_admin_live_clips', 'a1196ef9f043c618a12cf0a602e278bd'),
               ('hosted_tournament_live_match_snapshot', '974932562a49f4021383adcfcc2e213b'),
               ('hosted_tournament_live_stage_is_public', 'd920469a154d76a69b478ba35faceab8'),
               ('hosted_tournament_live_on_air', 'd1946a0b40093cec1fd537b807f72aa8'),
               ('hosted_tournament_live_sync_auto', 'ef6ddfeb2be0cd3a271ffcee41e720bb')) v(name, hash)
             on v.name = p.proname
          where p.pronamespace = 'public'::regnamespace
            and md5(replace(p.prosrc, chr(13), '')) = v.hash) = 12 then 'all match' else 'MISMATCH' end
  union all
  select 9, 'FK cascade: 3 tables → hosted_tournaments, clips → segments',
         (select count(*) from pg_constraint
           where contype = 'f' and confdeltype = 'c'
             and confrelid = 'public.hosted_tournaments'::regclass
             and conrelid in ('public.hosted_tournament_live_state'::regclass,
                              'public.hosted_tournament_live_segments'::regclass,
                              'public.hosted_tournament_live_clips'::regclass)) = 3
         and exists (select 1 from pg_constraint
                      where contype = 'f' and confdeltype = 'c'
                        and conrelid = 'public.hosted_tournament_live_clips'::regclass
                        and confrelid = 'public.hosted_tournament_live_segments'::regclass)
         and (select count(*) from pg_constraint
               where contype = 'f' and confdeltype = 'n'
                 and confrelid = 'public.hosted_tournament_matches'::regclass
                 and conrelid in ('public.hosted_tournament_live_state'::regclass,
                                  'public.hosted_tournament_live_segments'::regclass)) = 2,
         '-'
  union all
  select 10, 'info: existing public functions fingerprint', true,
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
  select 11, 'info: rows (state / segments / clips)', true,
         (select count(*)::text from public.hosted_tournament_live_state) || ' / '
         || (select count(*)::text from public.hosted_tournament_live_segments) || ' / '
         || (select count(*)::text from public.hosted_tournament_live_clips)
) x order by n;
