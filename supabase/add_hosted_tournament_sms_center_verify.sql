-- ============================================================================
--  대회 문자 안내 센터 — 적용 후 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~9번이 모두 ok = true 여야 한다.
--  10번 detail 은 적용 전 precheck 8번 detail 과 글자 하나까지 같아야 한다(기존 함수 변경 0건).
--  11번은 정보 행 — 새 테이블 행 수(적용 직후 '0 / 0').
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

select item, ok, detail from (
  select 1 as n, 'new tables exist + RLS enabled' as item,
         (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace
            and c.relname in ('hosted_tournament_sms_settings', 'hosted_tournament_sms_logs') and c.relrowsecurity) = 2 as ok,
         '-' as detail
  union all
  select 2, 'no table privileges for public/anon/authenticated · no policies',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public'
                        and table_name in ('hosted_tournament_sms_settings', 'hosted_tournament_sms_logs')
                        and grantee in ('PUBLIC', 'anon', 'authenticated'))
         and not exists (select 1 from pg_policies where schemaname = 'public'
                          and tablename in ('hosted_tournament_sms_settings', 'hosted_tournament_sms_logs')),
         '-'
  union all
  select 3, 'new functions exist (7)',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'get_admin_sms_center', 'save_sms_template', 'save_sms_url', 'save_sms_snapshot',
            'add_sms_log', 'set_sms_log_status', 'hosted_tournament_sms_lock_settings')) = 7,
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'get_admin_sms_center', 'save_sms_template', 'save_sms_url', 'save_sms_snapshot',
            'add_sms_log', 'set_sms_log_status', 'hosted_tournament_sms_lock_settings'))
  union all
  select 4, 'all SECURITY DEFINER + search_path fixed',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (
            'get_admin_sms_center', 'save_sms_template', 'save_sms_url', 'save_sms_snapshot',
            'add_sms_log', 'set_sms_log_status', 'hosted_tournament_sms_lock_settings')
            and (not prosecdef or coalesce(array_to_string(proconfig, ','), '') <> 'search_path=public, pg_temp')),
         '-'
  union all
  select 5, 'admin RPCs: authenticated only (no anon/public)',
         not exists (
           select 1 from (values
               ('public.get_admin_sms_center(text)'),
               ('public.save_sms_template(text,text,text,text,integer,boolean)'),
               ('public.save_sms_url(text,text,text)'),
               ('public.save_sms_snapshot(text,jsonb,integer,integer)'),
               ('public.add_sms_log(text,text,text,text,text,text,integer,text,text)'),
               ('public.set_sms_log_status(text,uuid,text,text)')) f(sig)
            where not has_function_privilege('authenticated', f.sig, 'execute')
               or has_function_privilege('anon', f.sig, 'execute')),
         '-'
  union all
  select 6, 'internal lock helper: no execute for anon/authenticated',
         not has_function_privilege('anon', 'public.hosted_tournament_sms_lock_settings(uuid)', 'execute')
         and not has_function_privilege('authenticated', 'public.hosted_tournament_sms_lock_settings(uuid)', 'execute'),
         '-'
  union all
  select 7, 'function bodies match file',
         (select count(*) from pg_proc p
           join (values
               ('get_admin_sms_center',                '850e6e968c9541be75330a5a771a56e3'),
               ('save_sms_template',                   '852d02e207167b4521fdb6081c27a423'),
               ('save_sms_url',                        'e2cb5806e10014f681306714a21ce3f1'),
               ('save_sms_snapshot',                   'd7072cfdc1d35b5a0471b72d0b3f17aa'),
               ('add_sms_log',                         '1fc9830465ad623ef7d4307c9404a6dd'),
               ('set_sms_log_status',                  'ed43b0593b4db9f72f555dee2b2fd98a'),
               ('hosted_tournament_sms_lock_settings', 'ddf4fa741a4eea74044a1d871ed706e8')) v(name, hash)
             on v.name = p.proname
          where p.pronamespace = 'public'::regnamespace
            and md5(replace(p.prosrc, chr(13), '')) = v.hash) = 7,
         case when (select count(*) from pg_proc p
           join (values
               ('get_admin_sms_center',                '850e6e968c9541be75330a5a771a56e3'),
               ('save_sms_template',                   '852d02e207167b4521fdb6081c27a423'),
               ('save_sms_url',                        'e2cb5806e10014f681306714a21ce3f1'),
               ('save_sms_snapshot',                   'd7072cfdc1d35b5a0471b72d0b3f17aa'),
               ('add_sms_log',                         '1fc9830465ad623ef7d4307c9404a6dd'),
               ('set_sms_log_status',                  'ed43b0593b4db9f72f555dee2b2fd98a'),
               ('hosted_tournament_sms_lock_settings', 'ddf4fa741a4eea74044a1d871ed706e8')) v(name, hash)
             on v.name = p.proname
          where p.pronamespace = 'public'::regnamespace
            and md5(replace(p.prosrc, chr(13), '')) = v.hash) = 7 then 'all match' else 'MISMATCH' end
  union all
  select 8, 'FK on delete cascade to hosted_tournaments (2)',
         (select count(*) from pg_constraint
           where contype = 'f' and confdeltype = 'c'
             and confrelid = 'public.hosted_tournaments'::regclass
             and conrelid in ('public.hosted_tournament_sms_settings'::regclass, 'public.hosted_tournament_sms_logs'::regclass)) = 2,
         '-'
  union all
  select 9, 'log (tournament_id, client_key) unique',
         exists (select 1 from pg_constraint where conname = 'hosted_tsms_log_client_key_unique' and contype = 'u'),
         '-'
  union all
  select 10, 'info: existing public functions fingerprint', true,
         (select count(*)::text || ' fns · ' || md5(string_agg(
                    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(replace(p.prosrc, chr(13), ''))
                    || coalesce(array_to_string(p.proconfig, ','), '') || p.prosecdef::text,
                    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.proname not in ('get_admin_sms_center', 'save_sms_template', 'save_sms_url', 'save_sms_snapshot',
                                   'add_sms_log', 'set_sms_log_status', 'hosted_tournament_sms_lock_settings'))
  union all
  select 11, 'info: rows (settings / logs)', true,
         (select count(*)::text from public.hosted_tournament_sms_settings) || ' / '
         || (select count(*)::text from public.hosted_tournament_sms_logs)
) x order by n;
