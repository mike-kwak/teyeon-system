-- =============================================================================
-- VERIFY — add_kdk_match_spotlight.sql (v2.2) · 읽기 전용(운영 적용 직후 실행 가능)
--   모든 행의 ok 가 true 여야 한다. 기능 시험은 scripts/verify_match_spotlight_sql.mjs(PGlite 테스트 DB).
-- =============================================================================

select 'A1 tables' as check,
       count(*) = 4 as ok
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('kdk_match_lifecycle','kdk_match_lifecycle_faults','kdk_spotlight_runs','kdk_match_predictions');

-- trigger 3개(insert · status · recert) 존재 + 활성.
select 'A2 triggers enabled' as check, public.kdk_spotlight_ledger_healthy() as ok;

select 'A3 RLS on' as check, bool_and(c.relrowsecurity) as ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('kdk_match_lifecycle','kdk_match_lifecycle_faults','kdk_spotlight_runs','kdk_match_predictions');

select 'A4 no table privileges for anon/authenticated' as check,
       not bool_or(has_table_privilege(g.r, 'public.' || t.t, 'select,insert,update,delete')) as ok
  from (values ('anon'), ('authenticated')) g(r),
       (values ('kdk_match_lifecycle'), ('kdk_match_lifecycle_faults'), ('kdk_spotlight_runs'), ('kdk_match_predictions')) t(t);

select 'A5 write RPC only service_role' as check,
       not bool_or(has_function_privilege(g.r, f.f, 'execute'))
       and bool_and(has_function_privilege('service_role', f.f, 'execute')) as ok
  from (values ('anon'), ('authenticated')) g(r),
       (values ('public.save_kdk_spotlight_run(text,text,uuid,jsonb,jsonb)'),
               ('public.get_kdk_spotlight_run_for_publish(uuid,uuid)'),
               ('public.publish_kdk_spotlight_run(uuid,uuid,jsonb,text[])'),
               ('public.unpublish_kdk_spotlight_run(text,text,uuid)')) f(f);

select 'A6 read RPC grants' as check,
       has_function_privilege('anon', 'public.get_public_kdk_spotlight(text)', 'execute')
       and has_function_privilege('anon', 'public.get_public_kdk_spotlight_link(text)', 'execute')
       and not has_function_privilege('anon', 'public.get_kdk_spotlight_admin(text)', 'execute')
       and has_function_privilege('authenticated', 'public.get_kdk_spotlight_admin(text)', 'execute') as ok;

-- 정합: waiting 이 아닌 LIVE 경기는 모두 이탈 기록이 있어야 한다(0 이어야 정상 — 아니면 잔여 위험 발생).
select 'A7 non-waiting matches without left_waiting record' as check, count(*) = 0 as ok, count(*) as n
  from public.matches m
 where m.status is distinct from 'waiting'
   and not exists (select 1 from public.kdk_match_lifecycle l
                    where l.match_id = m.id::text and l.left_waiting_at is not null);

-- 참고: trigger 내부 오류 기록 수(0 이 정상. 0 이 아니면 원인 확인 — 해당 경기는 예측 차단됨).
select 'A8 ledger faults' as check, count(*) = 0 as ok, count(*) as n from public.kdk_match_lifecycle_faults;

-- 참고: 증명서 없는 LIVE 경기(설치 전 생성분은 uncertifiable 로 있어야 한다).
select 'A9 matches without certificate row' as check, count(*) = 0 as ok, count(*) as n
  from public.matches m
 where not exists (select 1 from public.kdk_match_lifecycle l where l.match_id = m.id::text);

-- 참고: 증명서는 있으나 행 버전 체인이 끊긴 waiting 경기(예측 불가). 0 이 아니어도 오류는 아니다 —
--   시작 후 되돌림 · 기록 실패 · trigger 비활성 중 수정 · 같은 id 재삽입 등. 운영 판단용 수치.
select 'A10 waiting matches with broken version chain (info)' as check, true as ok, count(*) as n
  from public.matches m
  join public.kdk_match_lifecycle l on l.match_id = m.id::text
 where m.status = 'waiting' and l.certified and l.left_waiting_at is null
   and l.certified_xmin is distinct from m.xmin;

-- 설치 직후에만 의미: trigger 3개 외 matches 에 걸린 사용자 trigger 목록(기존 trigger 영향 확인용).
select 'A11 other user triggers on matches (info)' as check, true as ok,
       coalesce(string_agg(t.tgname, ', ' order by t.tgname), '(none)') as n
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'matches' and not t.tgisinternal
   and t.tgname not like 'kdk_match_lifecycle_%';

-- v2.2: 관리 권한 = 기존 KDK 관리자 체계(SQL 30 can_manage_kdk) 재사용
select 'A12 spotlight admin = can_manage_kdk (v2.2)' as check,
       coalesce((select prosrc like '%can_manage_kdk()%' from pg_proc where oid = to_regprocedure('public.kdk_spotlight_is_admin(uuid)')), false) as ok;
