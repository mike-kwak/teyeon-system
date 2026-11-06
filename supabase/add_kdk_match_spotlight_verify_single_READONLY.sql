-- =============================================================================
-- VERIFY — MATCH SPOTLIGHT v2.2 · 읽기 전용 · 결과 1개 표(A1~A11)
--   저장소 supabase/add_kdk_match_spotlight_verify.sql 와 같은 항목을 SQL Editor 용으로 한 표로 합친 것.
--   A1~A9 ok 가 모두 true 여야 정상. A10·A11 은 참고(info).
-- =============================================================================
select * from (
  select 1 as o, 'A1 tables' as check,
         (select count(*) = 4 from information_schema.tables
           where table_schema = 'public'
             and table_name in ('kdk_match_lifecycle','kdk_match_lifecycle_faults','kdk_spotlight_runs','kdk_match_predictions')) as ok,
         null::text as n
  union all
  select 2, 'A2 triggers enabled (3)', public.kdk_spotlight_ledger_healthy(), null
  union all
  select 3, 'A3 RLS on',
         (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public'
             and c.relname in ('kdk_match_lifecycle','kdk_match_lifecycle_faults','kdk_spotlight_runs','kdk_match_predictions')), null
  union all
  select 4, 'A4 no table privileges for anon/authenticated',
         (select not bool_or(has_table_privilege(g.r, 'public.' || t.t, 'select,insert,update,delete'))
            from (values ('anon'), ('authenticated')) g(r),
                 (values ('kdk_match_lifecycle'), ('kdk_match_lifecycle_faults'), ('kdk_spotlight_runs'), ('kdk_match_predictions')) t(t)), null
  union all
  select 5, 'A5 write RPC only service_role',
         (select not bool_or(has_function_privilege(g.r, f.f, 'execute'))
                 and bool_and(has_function_privilege('service_role', f.f, 'execute'))
            from (values ('anon'), ('authenticated')) g(r),
                 (values ('public.save_kdk_spotlight_run(text,text,uuid,jsonb,jsonb)'),
                         ('public.get_kdk_spotlight_run_for_publish(uuid,uuid)'),
                         ('public.publish_kdk_spotlight_run(uuid,uuid,jsonb,text[])'),
                         ('public.unpublish_kdk_spotlight_run(text,text,uuid)')) f(f)), null
  union all
  select 6, 'A6 read RPC grants',
         has_function_privilege('anon', 'public.get_public_kdk_spotlight(text)', 'execute')
         and has_function_privilege('anon', 'public.get_public_kdk_spotlight_link(text)', 'execute')
         and not has_function_privilege('anon', 'public.get_kdk_spotlight_admin(text)', 'execute')
         and has_function_privilege('authenticated', 'public.get_kdk_spotlight_admin(text)', 'execute'), null
  union all
  select 7, 'A7 non-waiting matches without left_waiting record', count(*) = 0, count(*)::text
    from public.matches m
   where m.status is distinct from 'waiting'
     and not exists (select 1 from public.kdk_match_lifecycle l where l.match_id = m.id::text and l.left_waiting_at is not null)
  union all
  select 8, 'A8 ledger faults', count(*) = 0, count(*)::text from public.kdk_match_lifecycle_faults
  union all
  select 9, 'A9 matches without certificate row', count(*) = 0, count(*)::text
    from public.matches m
   where not exists (select 1 from public.kdk_match_lifecycle l where l.match_id = m.id::text)
  union all
  select 10, 'A10 waiting matches with broken version chain (info)', true, count(*)::text
    from public.matches m join public.kdk_match_lifecycle l on l.match_id = m.id::text
   where m.status = 'waiting' and l.certified and l.left_waiting_at is null and l.certified_xmin is distinct from m.xmin
  union all
  select 11, 'A11 other user triggers on matches (info)', true,
         coalesce(string_agg(t.tgname::text, ', ' order by t.tgname), '(none)')
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relname = 'matches' and not t.tgisinternal and t.tgname not like 'kdk_match_lifecycle_%'
  union all
  select 12, 'B1 ledger rows (pre_install / certified)', true,
         (select count(*) filter (where note = 'pre_install') || ' / ' || count(*) filter (where certified) from public.kdk_match_lifecycle)
  union all
  select 13, 'A12 관리 권한 = 기존 KDK 관리자 체계(can_manage_kdk 재사용 · v2.2)',
         coalesce((select prosrc like '%can_manage_kdk()%' from pg_proc where oid = to_regprocedure('public.kdk_spotlight_is_admin(uuid)')), false),
         case when to_regprocedure('public.can_manage_kdk()') is null then 'SQL 30 없음 — CEO · ADMIN 만' else 'CEO · ADMIN · KDK 관리자' end
) v order by o;
