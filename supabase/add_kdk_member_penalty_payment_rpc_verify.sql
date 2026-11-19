-- ────────────────────────────────────────────────────────────────────────────
-- [VERIFY · READ-ONLY] KDK 회원 벌금 납부 RPC — 블록별 실행
--   V1~V6 = 적용 전(현재 운영 상태 확인).  V7 = RPC 생성 후 확인.
--   객체가 없어도 오류 없이 상태를 표시한다(to_regclass/to_regprocedure + oid 형 권한 함수).
--   통합 점검은 kdk_penalty_production_preflight_READONLY.sql.
--
-- 2026-11-19 운영 확인 기록: is_finance_manager 존재 · RPC 없음 · payments/receivables 존재 ·
--   V6(초과 납부) 0건 · public 기본 함수 권한에 anon/authenticated/service_role EXECUTE 부여 설정 있음
--   → RPC SQL 의 'revoke all ... from anon' 이 반드시 필요(포함돼 있음). 적용 후 V7 로 anon=false 확인.
-- ────────────────────────────────────────────────────────────────────────────

-- V1. [적용 전] 선행 객체·컬럼
select to_regprocedure('public.is_finance_manager()') is not null                          as has_is_finance_manager,
       to_regprocedure('auth.uid()') is not null                                           as has_auth_uid,
       to_regclass('public.finance_dues_payments') is not null                             as has_payments,
       to_regclass('public.finance_dues_receivables') is not null                          as has_receivables,
       exists (select 1 from information_schema.columns where table_schema='public'
                and table_name='finance_dues_payments' and column_name='is_voided')         as has_is_voided,
       exists (select 1 from information_schema.columns where table_schema='public'
                and table_name='finance_dues_receivables' and column_name='related_kdk_session_id') as has_kdk_link,
       (select prosecdef from pg_proc where oid = to_regprocedure('public.is_finance_manager()')) as is_finance_manager_secdef,
       case when to_regprocedure('public.pay_kdk_member_penalty(uuid,uuid,integer)') is null then 'NOT_APPLIED' else 'EXISTS' end as rpc_status;

-- V2. [적용 전] is_finance_manager 본문 — 앱 canManageFinance(CEO/ADMIN/FINANCE_MANAGER) 와 같은지 눈으로 확인
select coalesce(pg_get_functiondef(to_regprocedure('public.is_finance_manager()')), 'NOT_FOUND') as is_finance_manager_def;

-- V3. [적용 전] RLS 활성 · payments 정책(INSERT/UPDATE/DELETE 조건이 is_finance_manager() 인지)
select c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c
 where c.oid in (to_regclass('public.finance_dues_payments'), to_regclass('public.finance_dues_receivables'));
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy where polrelid = to_regclass('public.finance_dues_payments') order by polname;

-- V4. [적용 전] 사용자 트리거(0행 기대 — 있으면 RPC 동작 영향 검토)
select tgrelid::regclass as table_name, tgname
  from pg_trigger
 where not tgisinternal
   and tgrelid in (to_regclass('public.finance_dues_payments'), to_regclass('public.finance_dues_receivables'));

-- V5. [적용 전] public 기본 함수 권한 — anon=X 가 있으면 신규 함수에 anon EXECUTE 자동 부여(운영: 있음 확인됨)
select defaclrole::regrole as owner_role, defaclnamespace::regnamespace as schema, defaclobjtype, defaclacl
  from pg_default_acl where defaclobjtype = 'f';

-- V6. [적용 전] 이미 초과 납부된 KDK 벌금 청구(운영 2026-11-19: 0건 확인)
select r.id, r.related_kdk_session_id, r.amount_due, sum(p.amount) as valid_paid
  from public.finance_dues_receivables r
  join public.finance_dues_payments p on p.receivable_id = r.id and p.is_voided = false
 where r.receivable_type = 'penalty'
 group by r.id, r.related_kdk_session_id, r.amount_due
having sum(p.amount) > r.amount_due;

-- V7. [RPC 생성 후] 존재 · SECURITY DEFINER · search_path · 권한(anon=false, authenticated=true 기대)
--     생성 전에는 status=NOT_APPLIED 1행(오류 없음)
with f as (select to_regprocedure('public.pay_kdk_member_penalty(uuid,uuid,integer)') as oid)
select case when f.oid is null then 'NOT_APPLIED' else 'EXISTS' end      as status,
       p.prosecdef                                                       as security_definer,
       p.proconfig                                                       as config,
       has_function_privilege('anon',          f.oid, 'EXECUTE')         as anon_can_execute,
       has_function_privilege('authenticated', f.oid, 'EXECUTE')         as authenticated_can_execute,
       (select count(*) from pg_proc where proname = 'pay_kdk_member_penalty'
           and pronamespace = 'public'::regnamespace)                    as overload_count            -- 1 기대
  from f left join pg_proc p on p.oid = f.oid;
