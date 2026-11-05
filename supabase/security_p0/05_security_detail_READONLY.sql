-- =============================================================================
-- TEYEON 운영 DB 보안 상세 점검 (읽기 전용 · SELECT 1개 · 데이터·권한 변경 없음)
--   Supabase SQL Editor 에 전체 붙여넣고 Run → 결과 표 전체를 복사(또는 CSV 다운로드)해 전달.
--   행 내용(이름·연락처·이메일·점수)은 출력하지 않는다. 구조·권한·정책 원문·함수 지문(md5)·개수만.
--   sec:
--     T  = RLS 꺼짐 또는 anon/authenticated 쓰기 가능 또는 Realtime 포함 테이블(권한 S I U D Tr)
--     P  = 그 테이블들 + profiles/members 의 정책 원문
--     F  = anon 이 실행 가능한 SECURITY DEFINER 함수 전체(본문 md5 = 저장소 SQL 대조용)
--     G  = authenticated 만 실행 가능한 SECURITY DEFINER 함수 중 profiles/members/role 을 쓰는 것
--     R  = profiles.role 권한 상승 판단 자료
--     A  = auth.users trigger · 인증 관련 개수
-- =============================================================================
with
tbl as (
  select c.oid, c.relname::text as t, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls, c.reltuples::bigint as est,
         exists (select 1 from pg_publication_tables pt where pt.schemaname = 'public' and pt.tablename = c.relname) as rt
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r','p')
),
pv as (
  select t.*, r.r,
         concat_ws('',
           case when has_table_privilege(r.r, t.oid, 'SELECT')   then 'S' end,
           case when has_table_privilege(r.r, t.oid, 'INSERT')   then 'I' end,
           case when has_table_privilege(r.r, t.oid, 'UPDATE')   then 'U' end,
           case when has_table_privilege(r.r, t.oid, 'DELETE')   then 'D' end,
           case when has_table_privilege(r.r, t.oid, 'TRUNCATE') then 'Tr' end) as p
    from tbl t, (values ('anon'), ('authenticated')) r(r)
),
tsum as (
  select oid, t, rls, force_rls, est, rt,
         max(p) filter (where r = 'anon') as anon_p, max(p) filter (where r = 'authenticated') as auth_p
    from pv group by oid, t, rls, force_rls, est, rt
),
flag as (
  select * from tsum
   where not rls or rt
      or anon_p ~ '(I|U|D|Tr)'
      or (auth_p ~ '(I|U|D|Tr)' and not rls)
      or t in ('profiles','members')
),
fn as (
  select p.oid, p.oid::regprocedure::text as sig, p.prosecdef as definer,
         has_function_privilege('anon', p.oid, 'execute') as anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
         coalesce(array_to_string(p.proconfig, ' '), '') as cfg, p.prosrc as src,
         pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind in ('f','p')
),
fnx as (
  select f.*,
         (select string_agg(distinct t.t, ',') from tbl t where f.src ~* ('\m' || t.t || '\M')) as refs,
         f.src ~* '\m(insert|update|delete|truncate)\M' as writes,
         f.src ~* 'auth\.uid\(\)' as uses_uid,
         f.src ~* '(is_admin|is_club_admin|is_ceo|role\s+in\s*\(|role\s*=\s*''(CEO|ADMIN)|kdk_spotlight_is_admin|has_role|is_operator|is_staff)' as role_check,
         md5(f.src) as h, length(f.src) as len
    from fn f
),
r as (
  -- T
  select 'T' as sec, 10 as o, t as item,
         'rls=' || rls || case when force_rls then '(force)' else '' end
         || ' | anon=' || coalesce(nullif(anon_p, ''), '-') || ' | authenticated=' || coalesce(nullif(auth_p, ''), '-')
         || ' | realtime=' || rt || ' | 정책=' || (select count(*) from pg_policies pp where pp.schemaname = 'public' and pp.tablename = flag.t)
         || ' | 추정행수=' || greatest(est, 0)
         || case when not rls and anon_p ~ '(I|U|D|Tr)' then ' | ★ANON_WRITE_NO_RLS' else '' end
         || case when not rls and auth_p ~ '(I|U|D|Tr)' then ' | ★AUTH_WRITE_NO_RLS' else '' end
         || case when rt and not rls then ' | ★REALTIME_NO_RLS' else '' end as detail
    from flag
  union all
  -- T 컬럼(Realtime + RLS 꺼짐 테이블은 컬럼 이름만 — 노출 범위 판단용)
  select 'T', 11, f.t || ' 컬럼',
         (select string_agg(a.attname::text, ', ' order by a.attnum) from pg_attribute a where a.attrelid = f.oid and a.attnum > 0 and not a.attisdropped)
    from flag f where not f.rls
  union all
  -- P
  select 'P', 20, pp.tablename::text || ' · ' || pp.policyname::text,
         pp.cmd || ' ' || pp.roles::text || ' ' || pp.permissive || ' | using=' || coalesce(pp.qual, '-') || ' | check=' || coalesce(pp.with_check, '-')
    from pg_policies pp
   where pp.schemaname = 'public' and pp.tablename in (select t from flag)
  union all
  -- F
  select 'F', 30, sig,
         'search_path=' || case when cfg ~ 'search_path' then 'fixed' else '★미고정' end
         || ' | writes=' || writes || ' | auth.uid=' || uses_uid || ' | role검사흔적=' || role_check
         || ' | refs=' || coalesce(refs, '-') || ' | owner=' || owner || ' | md5=' || left(h, 12) || ' | len=' || len
    from fnx where definer and anon_x
  union all
  -- G
  select 'G', 40, sig,
         'auth.uid=' || uses_uid || ' | role검사흔적=' || role_check || ' | refs=' || coalesce(refs, '-') || ' | md5=' || left(h, 12)
    from fnx where definer and auth_x and not anon_x and writes and (refs ~ '(profiles|members)' or src ~* '\mrole\M')
  union all
  -- R
  select 'R', 50, 'profiles 컬럼 UPDATE 권한(authenticated)',
         coalesce((select string_agg(column_name::text, ', ' order by column_name) from information_schema.column_privileges
                    where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE'), '(none)')
  union all
  select 'R', 51, 'profiles trigger',
         coalesce((select string_agg(tg.tgname::text || '[' || tg.tgenabled::text || '] ' || pg_get_triggerdef(tg.oid), ' || ')
                     from pg_trigger tg where tg.tgrelid = to_regclass('public.profiles') and not tg.tgisinternal), '(none)')
  union all
  select 'R', 52, 'profiles.role 값 분포(개수만)',
         coalesce((select string_agg(k || '=' || n, ', ' order by k) from (
            select coalesce(upper(btrim(role::text)), '(null)') as k, count(*) as n from public.profiles group by 1) x), '-')
  union all
  select 'R', 53, 'CEO·ADMIN profile 중 auth.users 에 같은 id 가 없는 수(미연결 → email 이전 경로 대상)',
         (select count(*)::text from public.profiles p
           where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
             and not exists (select 1 from auth.users u where u.id = p.id))
  union all
  select 'R', 54, 'CEO·ADMIN profile 중 profile.email ≠ 본인 auth email 수',
         (select count(*)::text from public.profiles p join auth.users u on u.id = p.id
           where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
             and lower(btrim(coalesce(p.email::text, ''))) is distinct from lower(btrim(coalesce(u.email::text, ''))))
  union all
  select 'R', 55, 'CEO·ADMIN profile 중 email 비어 있음 / 같은 email profile 이 2건 이상인 수',
         (select count(*) filter (where nullif(btrim(coalesce(p.email::text, '')), '') is null)::text from public.profiles p
           where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN'))
         || ' / ' ||
         (select count(*)::text from public.profiles p
           where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
             and nullif(btrim(coalesce(p.email::text, '')), '') is not null
             and (select count(*) from public.profiles q where lower(btrim(q.email::text)) = lower(btrim(p.email::text))) > 1)
  union all
  select 'R', 56, 'sync_my_profile 본문 md5(저장소와 대조)',
         coalesce((select left(h, 12) || ' len=' || len || ' anon=' || anon_x || ' auth=' || auth_x from fnx where sig = 'sync_my_profile(text,text)'), '(없음)')
  union all
  -- A
  select 'A', 60, 'auth.users trigger',
         coalesce((select string_agg(tg.tgname::text || ' → ' || tg.tgfoid::regproc::text, ', ')
                     from pg_trigger tg where tg.tgrelid = to_regclass('auth.users') and not tg.tgisinternal), '(none)')
  union all
  select 'A', 61, 'auth.users trigger 함수가 raw_user_meta_data 로 role 을 정하는지',
         coalesce((select string_agg(p.proname::text || ' meta=' || (p.prosrc ~* 'raw_user_meta_data')::text || ' role=' || (p.prosrc ~* '\mrole\M')::text, ', ')
                     from pg_trigger tg join pg_proc p on p.oid = tg.tgfoid
                    where tg.tgrelid = to_regclass('auth.users') and not tg.tgisinternal), '(none)')
  union all
  select 'A', 62, 'auth.users: 전체 / email 미확인 / provider 분포(개수만)',
         (select count(*) || ' / ' || count(*) filter (where email_confirmed_at is null) from auth.users)
         || ' / ' || coalesce((select string_agg(provider || '=' || n, ', ') from (
                 select provider::text, count(*) as n from auth.identities group by 1) x), '-')
)
select sec, item, detail from r order by o, item;
