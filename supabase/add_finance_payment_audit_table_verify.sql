-- ────────────────────────────────────────────────────────────────────────────
-- [VERIFY · READ-ONLY] finance_payment_audit — 적용 전/후 확인 (블록별 실행)
--   감사 테이블이 없어도 모든 블록이 오류 없이 실행된다(to_regclass 사용, 행 조회는 존재 시에만 동적 실행).
--   테이블이 없으면 status = 'NOT_APPLIED'.  통합 점검은 kdk_penalty_production_preflight_READONLY.sql.
-- ────────────────────────────────────────────────────────────────────────────

-- A1. [적용 전] 선행 조건 · 이름 충돌(guard_fn 은 NULL 기대)
select case when to_regclass('public.finance_payment_audit') is null then 'NOT_APPLIED' else 'EXISTS' end as audit_table_status,
       to_regprocedure('public.is_finance_manager()')                    as is_finance_manager,
       to_regclass('public.finance_dues_payments')                       as payments_table,
       to_regprocedure('auth.uid()')                                     as auth_uid,
       to_regprocedure('public.finance_payment_audit_block_mutation()') as guard_fn;

-- A2. [적용 후] 컬럼 (테이블 없으면 NOT_APPLIED 1행)
select 'NOT_APPLIED' as status, null::text as column_name, null::text as data_type, null::text as is_nullable, null::text as column_default
 where to_regclass('public.finance_payment_audit') is null
union all
select 'EXISTS', column_name::text, data_type::text, is_nullable::text, column_default::text
  from information_schema.columns
 where table_schema = 'public' and table_name = 'finance_payment_audit';

-- A3. [적용 후] RLS · 정책 · 트리거 · FK(payment_id 는 'r' = restrict 기대)
with t as (select to_regclass('public.finance_payment_audit') as oid)
select case when t.oid is null then 'NOT_APPLIED' else 'EXISTS' end as status,
       (select relrowsecurity from pg_class where oid = t.oid)                                        as rls,
       (select string_agg(polname || '[' || polcmd::text || '] ' || coalesce(pg_get_expr(polqual, polrelid),'-'), ' ; ')
          from pg_policy where polrelid = t.oid)                                                       as policies,      -- select 정책 1개 기대
       (select string_agg(tgname, ', ') from pg_trigger where tgrelid = t.oid and not tgisinternal)   as triggers,      -- append_only, no_truncate
       (select string_agg(conname || ':' || confdeltype::text, ', ') from pg_constraint where conrelid = t.oid and contype = 'f') as fks
  from t;

-- A4. [적용 후] 권한 — anon 모두 false, authenticated 는 SELECT 만 true (oid 형 함수 → 테이블 없으면 NULL)
with t as (select to_regclass('public.finance_payment_audit') as oid)
select case when t.oid is null then 'NOT_APPLIED' else 'EXISTS' end as status, r.role,
       has_table_privilege(r.role, t.oid, 'SELECT') as can_select,
       has_table_privilege(r.role, t.oid, 'INSERT') as can_insert,
       has_table_privilege(r.role, t.oid, 'UPDATE') as can_update,
       has_table_privilege(r.role, t.oid, 'DELETE') as can_delete
  from t, (values ('anon'), ('authenticated')) r(role);

-- A5. [적용 후] 행 수(정정 전 0 기대) — 테이블이 있을 때만 동적 조회
select case when to_regclass('public.finance_payment_audit') is null then 'NOT_APPLIED' else 'EXISTS' end as status,
       case when to_regclass('public.finance_payment_audit') is not null then
         query_to_xml('select action, count(*) as n from public.finance_payment_audit group by action order by action', true, true, '')
       end as rows_by_action;
