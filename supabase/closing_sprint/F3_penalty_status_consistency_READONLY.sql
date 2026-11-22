-- ════════════════════════════════════════════════════════════════════════════
-- [CLOSING SPRINT F3 · READ-ONLY] 과거 KDK 벌금 납부 상태 정합성 점검
--   SELECT 만. INSERT/UPDATE/DELETE/DDL 없음. Supabase SQL Editor 에서 실행(서비스 권한 — 앱 RLS 와 무관).
--   개인정보 최소화: 이름 미출력, 내부 id 는 앞 8자. 결과를 보고 사람이 판단한다(자동 정정 없음).
--   검증: scripts/verify_closing_sprint_f3_sql.mjs — 격리된 PGlite 가상 데이터로 문법 · 판정 확인(운영 DB 미검증).
--
-- 판정(issue)
--   member · STATUS_UNPAID_BUT_PAID   : 저장 상태 pending/partial 인데 유효 납부 합계 ≥ 청구액(실제 수납됐지만 미납으로 남음 후보)
--   member · STATUS_PAID_BUT_NO_PAYMENT: 저장 상태 paid 인데 유효 납부 합계 < 청구액
--   member · OVERPAID                 : 유효 납부 합계 > 청구액(중복 납부 의심)
--   member · DUPLICATE_RECEIVABLE     : 같은 회원 · 같은 세션 벌금 청구가 2건 이상
--   guest  · GUEST_UNPAID             : 공식 정산 스냅샷의 게스트 벌금에 유효(paid) 납부 기록 없음(실제 미납인지 현장 확인 필요)
--   guest  · GUEST_PAYMENT_ORPHAN     : 게스트 납부(paid)가 공식 정산 스냅샷의 게스트 벌금 대상과 맞지 않음
-- ════════════════════════════════════════════════════════════════════════════
with
arch as (
  select a.id::text as session_id,
         coalesce(a.raw_data ->> 'date', to_char(a.created_at, 'YYYY-MM-DD')) as session_date,
         a.raw_data -> 'settlement_data' as settlement
    from public.teyeon_archive_v1 a
   where a.is_official = true and coalesce(a.is_test, false) = false
),
recv as (
  select r.id, r.member_id, r.related_kdk_session_id as session_id, r.amount_due, r.status::text as stored_status,
         coalesce((select sum(p.amount) from public.finance_dues_payments p
                    where p.receivable_id = r.id and coalesce(p.is_voided, false) = false), 0) as valid_paid,
         count(*) over (partition by r.member_id, r.related_kdk_session_id) as same_session_count
    from public.finance_dues_receivables r
   where r.receivable_type = 'penalty' and r.related_kdk_session_id is not null
),
member_issues as (
  select 'member'::text as side, rc.session_id, a.session_date, left(rc.member_id::text, 8) as who,
         rc.amount_due as charged, rc.stored_status, rc.valid_paid as paid,
         case
           when rc.same_session_count > 1 then 'DUPLICATE_RECEIVABLE'
           when rc.stored_status in ('pending', 'partial') and rc.amount_due > 0 and rc.valid_paid >= rc.amount_due then 'STATUS_UNPAID_BUT_PAID'
           when rc.stored_status = 'paid' and rc.valid_paid < rc.amount_due then 'STATUS_PAID_BUT_NO_PAYMENT'
           when rc.valid_paid > rc.amount_due then 'OVERPAID'
         end as issue
    from recv rc left join arch a on a.session_id = rc.session_id
),
guest_entries as (
  select a.session_id, a.session_date, e ->> 'player_id' as participant_id,
         abs(coalesce((e ->> 'penalty_amount')::numeric, 0)) as charged
    from arch a, jsonb_array_elements(case when jsonb_typeof(a.settlement) = 'array' then a.settlement else '[]'::jsonb end) e
   where coalesce((e ->> 'is_guest')::boolean, false) = true
     and coalesce((e ->> 'penalty_amount')::numeric, 0) < 0
     and coalesce(e ->> 'player_id', '') <> ''
),
guest_paid as (
  select g.session_id, g.participant_id, sum(g.amount) as paid
    from public.kdk_guest_penalty_payments g
   where g.status = 'paid' and coalesce(g.charge_type, 'penalty') = 'penalty'
   group by 1, 2
),
guest_issues as (
  select 'guest'::text, ge.session_id, ge.session_date, left(ge.participant_id, 8), ge.charged, 'unpaid'::text, coalesce(gp.paid, 0),
         'GUEST_UNPAID'::text
    from guest_entries ge left join guest_paid gp on gp.session_id = ge.session_id and gp.participant_id = ge.participant_id
   where gp.participant_id is null
  union all
  select 'guest', gp.session_id, a.session_date, left(gp.participant_id, 8), null::numeric, 'paid', gp.paid, 'GUEST_PAYMENT_ORPHAN'
    from guest_paid gp left join arch a on a.session_id = gp.session_id
   where not exists (select 1 from guest_entries ge where ge.session_id = gp.session_id and ge.participant_id = gp.participant_id)
)
select side, session_id, session_date, who, charged, stored_status, paid, issue
  from member_issues where issue is not null
union all
select * from guest_issues
order by session_date nulls last, side, issue, who;
