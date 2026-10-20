-- ============================================================================
--  대회 문자 안내 센터 — 적용 전 점검 (읽기 전용 · SQL Editor 에서 한 번 실행)
--
--  1~7번이 모두 ok = true 일 때만 add_hosted_tournament_sms_center.sql 을 적용한다.
--  8번은 정보 행이다 — detail(기존 public 함수 전체 지문)을 적어 두었다가 적용 후 verify 10번 detail 과 같은지 본다.
--  INSERT/UPDATE/DELETE/DDL 없음.
-- ============================================================================

select item, ok, detail from (
  select 1 as n, 'new tables not present' as item,
         to_regclass('public.hosted_tournament_sms_settings') is null
         and to_regclass('public.hosted_tournament_sms_logs') is null as ok,
         '-' as detail
  union all
  select 2, 'new function names not present',
         not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (
           'get_admin_sms_center', 'save_sms_template', 'save_sms_url', 'save_sms_snapshot',
           'add_sms_log', 'set_sms_log_status', 'hosted_tournament_sms_lock_settings')),
         '-'
  union all
  select 3, 'hosted_tournaments (id, slug) exists',
         (select count(*) from information_schema.columns where table_schema = 'public'
           and table_name = 'hosted_tournaments' and column_name in ('id', 'slug')) = 2,
         '-'
  union all
  select 4, 'profiles (id, role, nickname) exists',
         (select count(*) from information_schema.columns where table_schema = 'public'
           and table_name = 'profiles' and column_name in ('id', 'role', 'nickname')) = 3,
         '-'
  union all
  select 5, 'get_admin_tournament_registrations(text) exists',
         to_regprocedure('public.get_admin_tournament_registrations(text)') is not null, '-'
  union all
  select 6, 'gen_random_uuid() available',
         to_regprocedure('gen_random_uuid()') is not null, '-'
  union all
  select 7, 'md5 can_manage_tournaments',
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc
                    where proname = 'can_manage_tournaments' and pronamespace = 'public'::regnamespace)
                  = '3f165edbc8211b3935382675bb4416d7', false),
         coalesce((select md5(replace(prosrc, chr(13), '')) from pg_proc
                    where proname = 'can_manage_tournaments' and pronamespace = 'public'::regnamespace), '없음')
  union all
  -- 8) 정보: public 스키마 기존 함수 전체(새 7개 제외)의 지문. 적용 후 verify 10번 detail 과 같아야 한다.
  select 8, 'info: existing public functions fingerprint', true,
         (select count(*)::text || ' fns · ' || md5(string_agg(
                    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || md5(replace(p.prosrc, chr(13), ''))
                    || coalesce(array_to_string(p.proconfig, ','), '') || p.prosecdef::text,
                    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and p.proname not in ('get_admin_sms_center', 'save_sms_template', 'save_sms_url', 'save_sms_snapshot',
                                   'add_sms_log', 'set_sms_log_status', 'hosted_tournament_sms_lock_settings'))
) x order by n;
