-- =============================================================================
-- P0-A 적용 직전 확인 — 읽기 전용 · SELECT 1개 · 대상 테이블당 1행 + 요약 행
--   목록은 10_p0a_revoke_anon_table_writes.sql 과 같다(reviewed + approved_extra). 미검토 테이블이 있으면 STOP.
--   T 행의 authenticated 권한은 적용 후 10_p0a_verify_READONLY.sql 의 T 행과 같아야 한다(P0-A 는 anon 만 바꾼다).
-- =============================================================================
with
reviewed(t) as (values ('matches'), ('teyeon_archive_v1'), ('teyeon_special_sessions'), ('kdk_sessions'), ('app_logs'),
  ('kdk_session_meta'), ('lucky_vicky_rounds'), ('lucky_vicky_teams'), ('notices'), ('notice_comments'), ('notice_likes'),
  ('tournament_events'), ('tournament_pairs'), ('tournament_partner_requests'), ('ranking_config'), ('ranking_snapshots'),
  ('member_achievements'), ('app_config')),
approved(t) as (values ('matches_archive'), ('sessions_archive')),
pv as (
  select c.oid, c.relname::text as t, c.relrowsecurity as rls, greatest(c.reltuples, 0)::bigint as est,
         concat_ws('', case when has_table_privilege('anon', c.oid, 'SELECT') then 'S' end, case when has_table_privilege('anon', c.oid, 'INSERT') then 'I' end,
                   case when has_table_privilege('anon', c.oid, 'UPDATE') then 'U' end, case when has_table_privilege('anon', c.oid, 'DELETE') then 'D' end,
                   case when has_table_privilege('anon', c.oid, 'TRUNCATE') then 'Tr' end, case when has_table_privilege('anon', c.oid, 'REFERENCES') then 'R' end,
                   case when has_table_privilege('anon', c.oid, 'TRIGGER') then 'Tg' end) as a,
         concat_ws('', case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'S' end, case when has_table_privilege('authenticated', c.oid, 'INSERT') then 'I' end,
                   case when has_table_privilege('authenticated', c.oid, 'UPDATE') then 'U' end, case when has_table_privilege('authenticated', c.oid, 'DELETE') then 'D' end,
                   case when has_table_privilege('authenticated', c.oid, 'TRUNCATE') then 'Tr' end, case when has_table_privilege('authenticated', c.oid, 'REFERENCES') then 'R' end,
                   case when has_table_privilege('authenticated', c.oid, 'TRIGGER') then 'Tg' end) as u,
         exists (select 1 from pg_publication_tables pt where pt.schemaname = 'public' and pt.tablename = c.relname) as rt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
),
tgt as (   -- P0-A 가 대상으로 삼는 조건과 동일
  select * from pv
   where not rls
     and (has_table_privilege('anon', oid, 'UPDATE') or has_table_privilege('anon', oid, 'DELETE') or has_table_privilege('anon', oid, 'TRUNCATE')
          or (has_table_privilege('anon', oid, 'INSERT') and t <> 'app_logs')
          or (t = 'app_logs' and has_table_privilege('anon', oid, 'SELECT')))
),
r as (
  select 1 as o, 'A01 P0-C 적용 상태(전제)' as item,
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D')
              then 'OK' else 'CHECK' end as verdict,
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg') then 'P0-C 설치됨' else 'P0-C 미설치' end as detail
  union all
  select 2, 'A02 대상 판정(미검토가 있으면 P0-A 가 STOP)',
         case when exists (select 1 from tgt where t not in (select t from reviewed) and t not in (select t from approved)) then 'STOP'
              when exists (select 1 from tgt) then 'OK' else 'INFO' end,
         (select count(*) from tgt)::text || '개 대상 / 미검토 '
         || (select count(*) from tgt where t not in (select t from reviewed) and t not in (select t from approved))::text || '개'
  union all
  select 10, 'T ' || t,
         case when t in (select t from reviewed) then 'OK' when t in (select t from approved) then 'OK(승인)' else 'STOP(미검토)' end,
         'anon=' || coalesce(nullif(a, ''), '-') || ' → 적용 후 ' || case when t = 'app_logs' then 'I' when a like 'S%' then 'S' else '-' end
         || ' | authenticated=' || coalesce(nullif(u, ''), '-') || '(변경 없음)'
         || ' | realtime=' || rt || ' | 추정행수=' || est
    from tgt
  union all
  select 20, 'A03 app_logs 방문 기록(anon INSERT 유지 · 시퀀스 사용 권한)', 'INFO',
         case when to_regclass('public.app_logs') is null then '(app_logs 없음)'
              else 'anon INSERT=' || has_table_privilege('anon', 'public.app_logs', 'INSERT') || ' SELECT=' || has_table_privilege('anon', 'public.app_logs', 'SELECT')
                   || ' | 시퀀스 ' || coalesce((select string_agg(s.relname || ' usage=' || has_sequence_privilege('anon', s.oid, 'USAGE'), ', ')
                                                from pg_depend d join pg_class s on s.oid = d.objid and s.relkind = 'S'
                                               where d.refobjid = to_regclass('public.app_logs') and d.deptype in ('a','i')), '없음') end
  union all
  select 21, 'A04 이전 P0-A 적용 회차(되돌리지 않은 것) — 있으면 이미 적용된 상태',
         -- 백업 테이블이 아직 없을 수 있으므로 정적 참조 대신 실행 시점 조회(query_to_xml)
         case when to_regclass('security_backup.table_grants_p0a') is null then 'OK'
              when (xpath('/row/n/text()', query_to_xml(
                     'select count(*) as n from security_backup.table_grants_p0a where restored_at is null', false, true, '')))[1]::text::int > 0 then 'CHECK'
              else 'OK' end,
         case when to_regclass('security_backup.table_grants_p0a') is null then '백업 테이블 없음(최초 적용)'
              else (xpath('/row/n/text()', query_to_xml(
                     'select count(*) as n from security_backup.table_grants_p0a where restored_at is null', false, true, '')))[1]::text || '행' end
  union all
  select 22, 'A05 Realtime publication 테이블(적용 후 같아야 함)', 'INFO',
         coalesce((select string_agg(tablename::text, ', ' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'), '(none)')
  union all
  select 23, 'A06 대상 테이블 잠금(다른 세션) — 적용 시 3초 lock_timeout', 'INFO',
         coalesce((select string_agg(c.relname || '=' || n, ', ') from (
            select l.relation, count(*) n from pg_locks l where l.pid <> pg_backend_pid() and l.relation in (select oid from tgt) group by 1) x
            join pg_class c on c.oid = x.relation), '(none)')
  union all
  select 24, 'A07 (참고) RLS 켜진 테이블 중 anon 쓰기 권한 보유(P0-A 대상 아님 · 정책이 막음)', 'INFO',
         (select count(*) from pv where rls and (a ~ '(I|U|D|Tr)'))::text || '개'
)
select item, verdict, detail from r order by o, item;
