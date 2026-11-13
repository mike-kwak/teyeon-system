-- ============================================================================
-- TEYEON KDK FINAL REPORT V4.1 — 적용 후 확인 v2(READ-ONLY · SELECT 만 · 집계만 출력 · V15 = search_path 정확 값 비교)
--   기대: 모든 행 result = 'OK'. 이름 · 금액 · id 를 출력하지 않는다.
-- ============================================================================
with
t(name) as (values ('kdk_final_report_revisions'), ('kdk_final_report_settlements'), ('kdk_settlement_reviews'), ('kdk_final_report_settings')),
f(sig) as (values ('public.kdk_can_view_settlement(uuid)'), ('public.kdk_fr_settlement_problem(jsonb)'),
                  ('public.get_kdk_final_report_v41_context(text,uuid)'),
                  ('public.publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)'),
                  ('public.get_kdk_final_report_settlement(text)'),
                  ('public.kdk_fr_capture_revision()'), ('public.kdk_fr_append_only_guard()'))
select 'V01' as check_id, 'tables present (4)' as item,
       case when (select count(*) from t where to_regclass('public.' || t.name) is not null) = 4 then 'OK' else 'FAIL' end as result
union all select 'V02', 'functions present (7)',
       case when (select count(*) from f where to_regprocedure(f.sig) is not null) = 7 then 'OK' else 'FAIL' end
union all select 'V03', 'RLS enabled on new tables',
       case when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname in (select name from t) and c.relrowsecurity) = 4 then 'OK' else 'FAIL' end
union all select 'V04', 'anon/authenticated have no table privilege',
       case when not exists (select 1 from t, (values ('anon'), ('authenticated')) r(role), (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
                              where has_table_privilege(r.role, 'public.' || t.name, p.priv)) then 'OK' else 'FAIL' end
union all select 'V05', 'settlement read: anon NO / authenticated YES',
       case when not has_function_privilege('anon', 'public.get_kdk_final_report_settlement(text)', 'EXECUTE')
             and has_function_privilege('authenticated', 'public.get_kdk_final_report_settlement(text)', 'EXECUTE') then 'OK' else 'FAIL' end
union all select 'V06', 'server-only functions: anon/authenticated NO, service_role YES',
       case when not has_function_privilege('anon', 'public.publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)', 'EXECUTE')
             and has_function_privilege('service_role', 'public.publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.get_kdk_final_report_v41_context(text,uuid)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.get_kdk_final_report_v41_context(text,uuid)', 'EXECUTE')
             and has_function_privilege('service_role', 'public.get_kdk_final_report_v41_context(text,uuid)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.kdk_can_view_settlement(uuid)', 'EXECUTE')
             and not has_function_privilege('authenticated', 'public.kdk_can_view_settlement(uuid)', 'EXECUTE') then 'OK' else 'FAIL' end
union all select 'V07', 'capture trigger on kdk_final_reports',
       case when exists (select 1 from pg_trigger where tgname = 'kdk_fr_capture_revision' and tgrelid = 'public.kdk_final_reports'::regclass and not tgisinternal) then 'OK' else 'FAIL' end
union all select 'V08', 'append-only triggers (6)',
       case when (select count(*) from pg_trigger where not tgisinternal and tgname in
                   ('kdk_fr_revisions_no_update', 'kdk_fr_revisions_no_truncate', 'kdk_fr_settlements_no_update',
                    'kdk_fr_settlements_no_truncate', 'kdk_settlement_reviews_no_update', 'kdk_settlement_reviews_no_truncate')) = 6 then 'OK' else 'FAIL' end
union all select 'V09', 'every published report has its current revision archived',
       case when not exists (select 1 from public.kdk_final_reports r
                              where r.public_payload is not null and r.revision >= 1
                                and not exists (select 1 from public.kdk_final_report_revisions v
                                                 where v.report_id = r.id and v.revision = r.revision and v.public_payload = r.public_payload)) then 'OK' else 'FAIL' end
union all select 'V10', 'reports by status/revision (info)',
       coalesce((select string_agg(k || '=' || n, ', ' order by k) from
                 (select status || '/rev' || revision as k, count(*) n from public.kdk_final_reports group by 1) x), '(none)')
union all select 'V11', 'archived revisions by edition (info)',
       coalesce((select string_agg('edition' || edition || '=' || n, ', ' order by edition) from
                 (select edition, count(*) n from public.kdk_final_report_revisions group by 1) x), '(none)')
union all select 'V12', 'settlement snapshots (info)', (select count(*)::text from public.kdk_final_report_settlements)
union all select 'V14', 'settlement_live_from_info_unset_means_hidden',
       coalesce((select to_char(value_date, 'YYYY-MM-DD') from public.kdk_final_report_settings where key = 'settlement_live_from'), '(unset)')
union all select 'V15', 'definer functions search_path exactly public, pg_temp (5)',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosecdef
                     and p.proname in ('kdk_fr_capture_revision', 'kdk_can_view_settlement', 'get_kdk_final_report_v41_context',
                                       'publish_kdk_final_report_v41', 'get_kdk_final_report_settlement')
                     and p.proconfig = array['search_path=public, pg_temp']::text[]) = 5 then 'OK' else 'FAIL' end
union all select 'V13', 'existing publish function still present',
       case when to_regprocedure('public.publish_kdk_final_report(text,uuid,jsonb,text,integer)') is not null then 'OK' else 'FAIL' end
order by 1;
