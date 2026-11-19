-- ────────────────────────────────────────────────────────────────────────────
-- [PRECHECK · READ-ONLY] 2026-11-10 KDK 게스트 벌금 오매칭 청구 이관 — 실행 전 확인
--
-- 대상: 공식 Archive 상 게스트(is_guest=true)인데 동명 회원 앞으로 생성된 KDK penalty 청구 1건
--       (D2 결과: 2026-11-10, 3,000원, 유효 납부 3,000원 연결).
-- SELECT 전용. 결과가 정확히 1행이고 아래가 모두 만족돼야 본 SQL 을 실행한다.
--   ok_member_not_in_settlement = true    그 회원은 세션 참가자(player_id)가 아님
--   member_name_unique          = 1       동일 정규화 닉네임 회원이 1명(앱 매칭 조건과 동일)
--   guest_match_count           = 1       같은 이름의 게스트 벌금 항목 정확히 1개
--   guest_pid_is_member         = false   게스트 participant_id 가 회원 id 가 아님
--   guest_archive_amt           = 3000
--   amount_due                  = 3000
--   valid_payment_count = 1 and valid_payment_sum = 3000
--   paid_date_matches_created   = true    회원 납부 paid_at(date) = created_at 의 KST 날짜
--                                          (false 면 납부일이 사후 수정된 것 → 본 SQL 이 중단함. 수동 판단 필요)
--   guest_row_status            = NULL(행 없음) 또는 'cancelled' 또는 'paid'
--       'paid' 이면 guest_row_amount = 3000 이어야 함(본 SQL 은 기존 게스트 납부를 보존하고 회원 납부만 취소)
--   already_applied             = 'NOT_APPLIED'(감사 테이블 생성 전) 또는 'false'
-- recv_id(전체 uuid) 를 본 SQL 의 c_recv_id 에 넣는다.
-- ⚠️ finance_payment_audit 는 운영에 없다(READ-ONLY 확인). add_finance_payment_audit_table.sql 적용 후에 이 본문을 실행할 것.
--    적용 전에는 이 본문 쿼리가 'relation does not exist' 로 실패하고, 본 SQL 도 AUDIT_TABLE_MISSING 으로 중단된다.
-- ────────────────────────────────────────────────────────────────────────────
with norm as (
  select m.id, m.nickname,
         lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(m.nickname,''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) as name_key
    from public.members m
), rv as (
  select rv.*, n.name_key,
         coalesce(nullif(a.raw_data->>'date',''), a.created_at::date::text) as kdk_date,
         a.raw_data->'settlement_data' as sd
    from public.finance_dues_receivables rv
    join norm n on n.id = rv.member_id
    join public.teyeon_archive_v1 a on a.id = rv.related_kdk_session_id
   where rv.receivable_type = 'penalty'
     and a.is_official is true and a.is_test is not true
     and jsonb_typeof(a.raw_data->'settlement_data') = 'array'
), g as (
  select rv.id as recv_id, e as entry
    from rv, jsonb_array_elements(rv.sd) e
   where coalesce((e->>'is_guest')::boolean,false)
     and coalesce((e->>'penalty_amount')::int,0) < 0
     and lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(e->>'player_name',''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) = rv.name_key
), p as (
  select p.receivable_id, count(*) as cnt, sum(p.amount) as total,
         min(p.paid_at) as paid_at, min(p.created_at) as created_at,
         bool_and(p.paid_at = (p.created_at at time zone 'Asia/Seoul')::date) as date_ok
    from public.finance_dues_payments p
   where p.is_voided = false
   group by p.receivable_id
)
select rv.id as recv_id,
       rv.related_kdk_session_id as session_id, rv.kdk_date, rv.amount_due, rv.status as recv_status,
       not exists (select 1 from jsonb_array_elements(rv.sd) e where e->>'player_id' = rv.member_id::text) as ok_member_not_in_settlement,
       (select count(*) from norm n2 where n2.name_key = rv.name_key) as member_name_unique,
       (select count(*) from g where g.recv_id = rv.id) as guest_match_count,
       (select left(g.entry->>'player_id',12) from g where g.recv_id = rv.id limit 1) as guest_pid12,
       exists (select 1 from g join public.members m2 on m2.id::text = g.entry->>'player_id' where g.recv_id = rv.id) as guest_pid_is_member,
       (select abs((g.entry->>'penalty_amount')::int) from g where g.recv_id = rv.id limit 1) as guest_archive_amt,
       coalesce(p.cnt,0) as valid_payment_count,
       coalesce(p.total,0) as valid_payment_sum,
       p.paid_at  as payment_paid_at,
       p.created_at as payment_created_at,
       p.date_ok  as paid_date_matches_created,
       gp.status  as guest_row_status,
       gp.amount  as guest_row_amount,
       gp.paid_at as guest_row_paid_at,
       -- 감사 테이블이 없으면 'NOT_APPLIED'(오류 없음). 있으면 롤백되지 않은 적용 행 존재 여부 'true'/'false'.
       case when to_regclass('public.finance_payment_audit') is null then 'NOT_APPLIED'
            else ((xpath('/row/n/text()', query_to_xml(format($q$
              select count(*) as n from public.finance_payment_audit au
               where au.action = 'KDK_GUEST_MISMATCH_TRANSFER_V1' and au.old_receivable_id = %L::uuid
                 and not exists (select 1 from public.finance_payment_audit r
                                  where r.action = 'KDK_GUEST_MISMATCH_TRANSFER_V1_ROLLBACK'
                                    and r.payment_id = au.payment_id and r.changed_at > au.changed_at)
            $q$, rv.id), true, true, '')))[1]::text::int > 0)::text
       end as already_applied
  from rv
  left join p on p.receivable_id = rv.id
  left join public.kdk_guest_penalty_payments gp
    on gp.session_id = rv.related_kdk_session_id and gp.charge_type = 'penalty'
   and gp.participant_id = (select g.entry->>'player_id' from g where g.recv_id = rv.id limit 1)
 where rv.kdk_date = '2026-11-10'
   and not exists (select 1 from jsonb_array_elements(rv.sd) e where e->>'player_id' = rv.member_id::text);

-- ── 운영 스키마 확인(READ-ONLY) — 본 SQL 이 가정하는 컬럼/제약 (블록별로 주석 해제 후 실행) ─────────
-- 모두 to_regclass 사용 → 감사 테이블이 없어도 오류 없음(해당 항목은 NOT_APPLIED 또는 0행).
-- 통합 점검(PASS/FAIL/NOT_APPLIED/REVIEW 판정)은 kdk_penalty_production_preflight_READONLY.sql 권장.
-- S1. finance_payment_audit 존재·컬럼
-- select case when to_regclass('public.finance_payment_audit') is null then 'NOT_APPLIED' else 'EXISTS' end as status;
-- select column_name, data_type, is_nullable, column_default from information_schema.columns
--  where table_schema='public' and table_name='finance_payment_audit' order by ordinal_position;
-- S2. 감사 테이블 제약 · 4개 테이블 사용자 트리거
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.finance_payment_audit');
-- select tgrelid::regclass, tgname from pg_trigger where not tgisinternal
--    and tgrelid in (to_regclass('public.finance_payment_audit'), to_regclass('public.finance_dues_payments'),
--                    to_regclass('public.finance_dues_receivables'), to_regclass('public.kdk_guest_penalty_payments'));
-- S3. finance_dues_payments: is_voided/voided_at/voided_by/void_reason/created_at/paid_at(date) 존재
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='finance_dues_payments' order by ordinal_position;
-- S4. finance_dues_receivables.status CHECK 에 'not_target' 포함, exemption_reason 존재
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.finance_dues_receivables');
-- S5. kdk_guest_penalty_payments: UNIQUE(session_id, participant_id, charge_type), status CHECK ('paid','cancelled'), paid_at timestamptz
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.kdk_guest_penalty_payments');
-- S6. 감사 테이블 action 별 행 수(테이블 있을 때만 동적 조회)
-- select case when to_regclass('public.finance_payment_audit') is null then 'NOT_APPLIED' else 'EXISTS' end as status,
--        case when to_regclass('public.finance_payment_audit') is not null then
--          query_to_xml('select action, count(*) as n from public.finance_payment_audit group by action', true, true, '') end as rows_by_action;
