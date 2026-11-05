-- =============================================================================
-- 운영 함수 본문 확인 — 읽기 전용 · SELECT 1개 · 결과 수백 행(본문을 한 줄씩 출력해 잘리지 않게 함)
--   대상: delete_kdk_live_session(text,text) · start_kdk_match(text,text) — 운영 md5 가 저장소 최신본과 다름(9b 결과)
--   + profiles 를 쓰는 SECURITY DEFINER 함수 전체 · profiles UPDATE 정책 원문 · role 컬럼 UPDATE 권한
--   SQL Editor 결과는 "Download CSV" 로 받아 전달하면 가장 정확하다.
--   개인정보(이름·연락처·이메일)는 출력하지 않는다. 함수 정의·정책 원문만.
-- =============================================================================
with
fx(sig) as (values ('public.delete_kdk_live_session(text,text)'), ('public.start_kdk_match(text,text)')),
defs as (
  select fx.sig, to_regprocedure(fx.sig) as oid from fx
),
lines as (
  select d.sig, l.n, l.line
    from defs d,
         lateral regexp_split_to_table(replace(pg_get_functiondef(d.oid), E'\r', ''), E'\n') with ordinality as l(line, n)
   where d.oid is not null
),
meta as (
  select d.sig,
         'md5(본문)=' || md5(replace(p.prosrc, E'\r', ''))
         || ' | owner=' || pg_get_userbyid(p.proowner)
         || ' | definer=' || p.prosecdef
         || ' | config=' || coalesce(array_to_string(p.proconfig, ' '), '-')
         || ' | acl=' || coalesce(p.proacl::text, '(기본값: PUBLIC 실행)')
         || ' | anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' | authenticated=' || has_function_privilege('authenticated', p.oid, 'execute') as detail,
         -- 안전 판단용 자동 표시(최종 판단은 아래 본문 행을 사람이 읽고 한다)
         'auth.uid검사=' || (p.prosrc ~* 'auth\.uid\(\)')
         || ' | CEO/ADMIN검사=' || (p.prosrc ~* '(CEO|ADMIN)')
         || ' | 거부raise=' || (p.prosrc ~* 'raise\s+exception[^;]*(not authorized|권한)')
         || ' | matches삭제=' || (p.prosrc ~* 'delete\s+from\s+(public\.)?matches')
         || ' | matches변경=' || (p.prosrc ~* 'update\s+(public\.)?matches')
         || ' | archive쓰기=' || (p.prosrc ~* '(delete\s+from|update|insert\s+into)\s+(public\.)?teyeon_archive_v1')   -- 주석 속 언급은 제외
         || ' | session_id조건=' || (p.prosrc ~* 'session_id\s*=\s*p_session_id')
         || ' | club_id조건=' || (p.prosrc ~* 'club_id\s*=\s*p_club_id') as flags
    from defs d join pg_proc p on p.oid = d.oid
),
r as (
  select 1 as o, d.sig as item, 0 as n,
         case when d.oid is null then '함수 없음' else (select m.detail from meta m where m.sig = d.sig) end as detail
    from defs d
  union all
  select 1, m.sig, 1, m.flags from meta m
  union all
  select 2, l.sig, 100 + l.n::int, lpad(l.n::text, 4, '0') || ' | ' || l.line from lines l
  union all
  select 3, 'profiles DEFINER 쓰기 함수 ' || p.oid::regprocedure::text, 0,
         'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' | role쓰기흔적=' || (p.prosrc ~* 'set\s[^;]*\mrole\s*=' or p.prosrc ~* 'insert\s+into\s+(public\.)?profiles[^;]*\mrole\M')
         || ' | md5=' || left(md5(replace(p.prosrc, E'\r', '')), 12)
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname not in ('pg_catalog', 'information_schema') and p.prosecdef
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?profiles\M'
  union all
  select 4, 'profiles 정책 ' || policyname::text, 0,
         cmd || ' ' || roles::text || ' ' || permissive || ' | using=' || coalesce(qual, '-') || ' | check=' || coalesce(with_check, '-')
    from pg_policies where schemaname = 'public' and tablename = 'profiles'
  union all
  select 5, 'profiles RLS · role 컬럼 권한', 0,
         'rls=' || (select relrowsecurity::text || ' force=' || relforcerowsecurity::text from pg_class where oid = to_regclass('public.profiles'))
         || ' | authenticated role UPDATE=' || has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
         || ' | authenticated role INSERT=' || has_column_privilege('authenticated', 'public.profiles', 'role', 'INSERT')
         || ' | anon role UPDATE=' || has_column_privilege('anon', 'public.profiles', 'role', 'UPDATE')
)
select item, n as line_no, detail from r order by o, item, n;
