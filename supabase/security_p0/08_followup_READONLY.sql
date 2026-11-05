-- =============================================================================
-- P0/P1 후속 확인 — 읽기 전용 · SELECT 1개 · 항목별 1행(목록이 잘리지 않도록 묶지 않음)
--   sec:
--     T  RLS 꺼짐 테이블 전체(anon/authenticated 권한 · P0-A 검토 여부 · Realtime · 추정 행 수)
--     F  이름이 비슷한 RPC(모든 사용자 스키마) — sync_tournament_matches / update_match_status 실제 존재·서명 확인
--     W  matches 를 쓰는 함수(모든 사용자 스키마)
--     S  스키마 CREATE 권한 · RLS 켜진 테이블의 anon TRUNCATE/TRIGGER 권한
--     P  profiles 정책 원문 · trigger · profiles 를 쓰는 DEFINER 함수
--     N  P0-C 영향 판단용 개수(사전 등록 profile · 로그인 방식별 email 확인)
--   행 내용(이름·이메일·점수)은 출력하지 않는다.
-- =============================================================================
with
reviewed(t) as (values ('matches'), ('teyeon_archive_v1'), ('teyeon_special_sessions'), ('kdk_sessions'), ('app_logs'),
  ('kdk_session_meta'), ('lucky_vicky_rounds'), ('lucky_vicky_teams'), ('notices'), ('notice_comments'), ('notice_likes'),
  ('tournament_events'), ('tournament_pairs'), ('tournament_partner_requests'), ('ranking_config'), ('ranking_snapshots'),
  ('member_achievements'), ('app_config')),
priv as (
  select c.oid, n.nspname::text as sch, c.relname::text as t, c.relrowsecurity as rls, greatest(c.reltuples, 0)::bigint as est,
         concat_ws('', case when has_table_privilege('anon', c.oid, 'SELECT') then 'S' end, case when has_table_privilege('anon', c.oid, 'INSERT') then 'I' end,
                   case when has_table_privilege('anon', c.oid, 'UPDATE') then 'U' end, case when has_table_privilege('anon', c.oid, 'DELETE') then 'D' end,
                   case when has_table_privilege('anon', c.oid, 'TRUNCATE') then 'Tr' end, case when has_table_privilege('anon', c.oid, 'TRIGGER') then 'Tg' end) as a,
         concat_ws('', case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'S' end, case when has_table_privilege('authenticated', c.oid, 'INSERT') then 'I' end,
                   case when has_table_privilege('authenticated', c.oid, 'UPDATE') then 'U' end, case when has_table_privilege('authenticated', c.oid, 'DELETE') then 'D' end,
                   case when has_table_privilege('authenticated', c.oid, 'TRUNCATE') then 'Tr' end, case when has_table_privilege('authenticated', c.oid, 'TRIGGER') then 'Tg' end) as u,
         exists (select 1 from pg_publication_tables pt where pt.schemaname = n.nspname and pt.tablename = c.relname) as rt
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
),
ufn as (
  select p.oid, n.nspname::text as sch, p.proname::text as name, p.oid::regprocedure::text as sig, p.prosecdef as definer, p.prosrc as src,
         has_function_privilege('anon', p.oid, 'execute') as ax, has_function_privilege('authenticated', p.oid, 'execute') as ux
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
),
r as (
  select 'T' as sec, 10 as o, t as item,
         'anon=' || coalesce(nullif(a, ''), '-') || ' | authenticated=' || coalesce(nullif(u, ''), '-')
         || ' | P0-A검토=' || case when t in (select t from reviewed) then '예' else '★아니오' end
         || ' | realtime=' || rt || ' | 추정행수=' || est as detail
    from priv where not rls
  union all
  select 'F', 20, sch || '.' || sig,
         'definer=' || definer || ' anon=' || ax || ' auth=' || ux || ' md5=' || left(md5(replace(src, E'\r', '')), 12)
    from ufn where name ilike '%sync%match%' or name ilike '%match%status%' or name ilike '%tournament_match%'
  union all
  select 'F', 21, '(검색 결과 없음 표시)', case when not exists (select 1 from ufn where name ilike '%sync%match%' or name ilike '%match%status%' or name ilike '%tournament_match%')
                                              then '이름에 sync*match / match*status / tournament_match 가 들어간 함수 없음' else '위 F 행 참조' end
  union all
  select 'W', 30, sch || '.' || sig,
         'definer=' || definer || ' anon=' || ax || ' auth=' || ux
    from ufn where src ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?matches\M'
  union all
  select 'S', 40, 'public 스키마 CREATE 권한', 'anon=' || has_schema_privilege('anon', 'public', 'CREATE') || ' authenticated=' || has_schema_privilege('authenticated', 'public', 'CREATE')
  union all
  select 'S', 41, 'RLS 켜진 테이블 중 anon TRUNCATE 또는 TRIGGER 권한(RLS 는 TRUNCATE 를 막지 않음)',
         count(*) || '개: ' || coalesce(string_agg(t, ', ' order by t), '-') from priv where rls and (a like '%Tr%' or a like '%Tg%')
  union all
  select 'S', 42, 'RLS 켜진 테이블 중 authenticated TRUNCATE 또는 TRIGGER 권한',
         count(*) || '개' from priv where rls and (u like '%Tr%' or u like '%Tg%')
  union all
  select 'P', 50, 'policy ' || policyname::text,
         cmd || ' ' || roles::text || ' ' || permissive || ' | using=' || coalesce(qual, '-') || ' | check=' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public' and tablename = 'profiles'
  union all
  select 'P', 51, 'trigger ' || t.tgname::text, '[' || t.tgenabled::text || '] ' || pg_get_triggerdef(t.oid)
    from pg_trigger t where t.tgrelid = to_regclass('public.profiles') and not t.tgisinternal
  union all
  select 'P', 52, 'profiles 를 쓰는 DEFINER 함수 ' || sch || '.' || sig,
         'anon=' || ax || ' auth=' || ux || ' role언급=' || (src ~* '\mrole\M')::text
    from ufn where definer and src ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?profiles\M'
  union all
  select 'N', 60, '사전 등록 profile(auth.users 에 id 없음) 역할별 수',
         coalesce((select string_agg(k || '=' || n, ', ' order by k) from (
            select upper(btrim(coalesce(p.role::text, ''))) k, count(*) n from public.profiles p
             where not exists (select 1 from auth.users u where u.id = p.id) group by 1) x), '0')
  union all
  select 'N', 61, '로그인 방식별 계정 수 / email 미확인 수',
         coalesce((select string_agg(provider || '=' || n || '/' || nc, ', ' order by provider) from (
            select i.provider::text as provider, count(distinct u.id) n, count(distinct u.id) filter (where u.email_confirmed_at is null) nc
              from auth.identities i join auth.users u on u.id = i.user_id group by 1) x), '-')
  union all
  select 'N', 62, 'email 이 없는 로그인 계정 수(sync_my_profile 이전 단계 대상 아님)',
         (select count(*)::text from auth.users where nullif(btrim(coalesce(email::text, '')), '') is null)
)
select sec, item, detail from r order by o, item;
