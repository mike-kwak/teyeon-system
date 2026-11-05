-- =============================================================================
-- P0-A 적용 직후 확인 — 읽기 전용 · SELECT 1개
--   V01~V05 가 OK 이고, T 행의 authenticated 권한이 적용 전(precheck T 행)과 같으면 정상.
--   FAIL 이 있으면 10_p0a_rollback.sql 판단.
-- =============================================================================
with
batch as (
  select max(captured_at) as at from security_backup.table_grants_p0a where restored_at is null
),
tgt as (   -- 이번 회차에 P0-A 가 바꾼 테이블
  select distinct g.table_name as t from security_backup.table_grants_p0a g, batch b where g.captured_at = b.at
),
r as (
  select 1 as o, 'V01 RLS 꺼짐 + anon 쓰기 남은 테이블(app_logs INSERT 제외) = 없음' as item,
         case when exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
              and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE')
                   or has_table_privilege('anon', c.oid, 'REFERENCES') or has_table_privilege('anon', c.oid, 'TRIGGER')
                   or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs'))) then 'FAIL' else 'OK' end as verdict,
         coalesce((select string_agg(c.relname::text, ', ') from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
                      and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE')
                           or has_table_privilege('anon', c.oid, 'REFERENCES') or has_table_privilege('anon', c.oid, 'TRIGGER')
                           or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs'))), '(none)') as detail
  union all
  select 2, 'V02 백업 회차 기록(rollback 근거)',
         case when to_regclass('security_backup.table_grants_p0a') is not null and (select at from batch) is not null then 'OK' else 'FAIL' end,
         coalesce((select count(*)::text from security_backup.table_grants_p0a g, batch b where g.captured_at = b.at), '0') || '행 · '
         || coalesce((select count(*)::text from tgt), '0') || '개 테이블'
  union all
  select 3, 'V03 공개 조회 유지: 대상 테이블 anon SELECT(app_logs 제외)',
         case when exists (select 1 from tgt join security_backup.table_grants_p0a g on g.table_name = tgt.t and g.privilege = 'SELECT', batch b
                            where g.captured_at = b.at and tgt.t <> 'app_logs' and not has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'SELECT'))
              then 'FAIL' else 'OK' end,
         '적용 전 anon SELECT 가 있던 대상은 모두 그대로'
  union all
  select 4, 'V04 app_logs(이번 회차 대상일 때만): anon INSERT 유지 · anon SELECT 차단',
         case when to_regclass('public.app_logs') is null or not exists (select 1 from tgt where t = 'app_logs') then 'OK'
              when has_table_privilege('anon', 'public.app_logs', 'INSERT') and not has_table_privilege('anon', 'public.app_logs', 'SELECT') then 'OK' else 'FAIL' end,
         case when to_regclass('public.app_logs') is null then '(없음)'
              when not exists (select 1 from tgt where t = 'app_logs') then 'P0-A 대상 아님(RLS 켜짐 등) — 변경 없음 · 현재 INSERT=' || has_table_privilege('anon', 'public.app_logs', 'INSERT')
                   || ' SELECT=' || has_table_privilege('anon', 'public.app_logs', 'SELECT')
              else 'INSERT=' || has_table_privilege('anon', 'public.app_logs', 'INSERT') || ' SELECT=' || has_table_privilege('anon', 'public.app_logs', 'SELECT') end
  union all
  select 5, 'V05 P0-C 유지(guard trigger)',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D')
              then 'OK' else 'FAIL' end, ''
  union all
  select 6, 'V06 Realtime publication 테이블(적용 전 A05 와 같아야 함)', 'INFO',
         coalesce((select string_agg(tablename::text, ', ' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'), '(none)')
  union all
  select 10, 'T ' || tgt.t, 'INFO',
         'anon=' || coalesce(nullif(concat_ws('',
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'SELECT') then 'S' end,
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'INSERT') then 'I' end,
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'UPDATE') then 'U' end,
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'DELETE') then 'D' end,
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'TRUNCATE') then 'Tr' end,
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'REFERENCES') then 'R' end,
            case when has_table_privilege('anon', 'public.' || quote_ident(tgt.t), 'TRIGGER') then 'Tg' end), ''), '-')
         || ' | authenticated=' || coalesce(nullif(concat_ws('',
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'SELECT') then 'S' end,
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'INSERT') then 'I' end,
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'UPDATE') then 'U' end,
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'DELETE') then 'D' end,
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'TRUNCATE') then 'Tr' end,
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'REFERENCES') then 'R' end,
            case when has_table_privilege('authenticated', 'public.' || quote_ident(tgt.t), 'TRIGGER') then 'Tg' end), ''), '-')
         || '(적용 전과 같아야 함)'
    from tgt
)
select item, verdict, detail from r order by o, item;
