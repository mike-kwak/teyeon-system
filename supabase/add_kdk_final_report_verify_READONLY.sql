-- =============================================================================
-- TEYEON KDK FINAL REPORT — 적용 확인(읽기 전용 · 데이터 무변경)
--   기대값은 각 줄 주석. 하나라도 다르면 적용을 다시 확인한다.
-- =============================================================================
select 'V01 table+RLS' as chk,
       (select relrowsecurity from pg_class where oid = to_regclass('public.kdk_final_reports')) as rls_on;            -- true
select 'V02 anon/auth table privilege' as chk,
       has_table_privilege('anon', 'public.kdk_final_reports', 'SELECT') as anon_select,                               -- false
       has_table_privilege('authenticated', 'public.kdk_final_reports', 'SELECT') as auth_select,                      -- false
       has_table_privilege('authenticated', 'public.kdk_final_reports', 'INSERT') as auth_insert;                      -- false
select 'V03 admin RPC not for anon/auth' as chk,
       has_function_privilege('anon', 'public.publish_kdk_final_report(text,uuid,jsonb,text,integer)', 'EXECUTE') as anon_publish,          -- false
       has_function_privilege('authenticated', 'public.publish_kdk_final_report(text,uuid,jsonb,text,integer)', 'EXECUTE') as auth_publish, -- false
       has_function_privilege('authenticated', 'public.get_kdk_final_report_source(text,uuid)', 'EXECUTE') as auth_source,                       -- false
       has_function_privilege('service_role', 'public.publish_kdk_final_report(text,uuid,jsonb,text,integer)', 'EXECUTE') as svc_publish;   -- true
select 'V04 public RPC' as chk,
       has_function_privilege('anon', 'public.get_public_kdk_final_report(text)', 'EXECUTE') as anon_public,           -- true
       has_function_privilege('anon', 'public.kdk_final_report_signature(jsonb)', 'EXECUTE') as anon_sig;              -- false
select 'V05 definer + search_path' as chk, p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.proname like 'kdk_final_report%' or p.proname like '%kdk_final_report%' or p.proname like 'kdk_fr_%')
 order by p.proname;                                                                                                   -- proconfig 모두 search_path=public, pg_temp
select 'V06 archive anon read still revoked' as chk,
       has_any_column_privilege('anon', 'public.teyeon_archive_v1', 'SELECT') as anon_archive_read;                    -- false(기존 SQL 38 유지)
select 'V07 rows' as chk, status, count(*) from public.kdk_final_reports group by status;                              -- 적용 직후 0행
