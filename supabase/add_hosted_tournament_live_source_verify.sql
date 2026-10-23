-- =============================================================================
-- (READ-ONLY) add_hosted_tournament_live_source.sql 적용 확인 — SELECT 만. 쓰기 없음.
--   모든 행의 ok 가 true 여야 한다.
-- =============================================================================
select 'table exists' as check_name,
       to_regclass('public.hosted_tournament_live_source') is not null as ok
union all
select 'rls enabled',
       coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.hosted_tournament_live_source')), false)
union all
select 'anon cannot select table',
       not has_table_privilege('anon', 'public.hosted_tournament_live_source', 'select')
union all
select 'authenticated cannot select table',
       not has_table_privilege('authenticated', 'public.hosted_tournament_live_source', 'select')
union all
select 'get_public_live_source: anon execute',
       has_function_privilege('anon', 'public.get_public_live_source(text)', 'execute')
union all
select 'get_admin_live_source: anon blocked',
       not has_function_privilege('anon', 'public.get_admin_live_source(text)', 'execute')
union all
select 'set_live_source: anon blocked',
       not has_function_privilege('anon', 'public.set_live_source(text,text,text,text,integer)', 'execute')
union all
select 'set_live_source: authenticated execute',
       has_function_privilege('authenticated', 'public.set_live_source(text,text,text,text,integer)', 'execute')
union all
select 'functions are security definer',
       (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and p.proname in ('get_public_live_source', 'get_admin_live_source', 'set_live_source'))
union all
select 'public read works (2026-teyeon-open)',
       (public.get_public_live_source('2026-teyeon-open') ->> 'available') is not null
union all
select 'no secret-like columns',
       not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'hosted_tournament_live_source'
                      and column_name ~* '(key|token|secret|rtmp|password)');
