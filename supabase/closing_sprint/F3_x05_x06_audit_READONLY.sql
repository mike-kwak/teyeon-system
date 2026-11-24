-- ════════════════════════════════════════════════════════════════════════════
-- [CLOSING SPRINT F3 · READ-ONLY · 선택] X05 · X06 관련 정정 감사 기록 조회
--   실행 조건: F3_x05_x06_trace_READONLY.sql 의 Q06 이 "있음 · 있음"일 때만(테이블이 없으면 42P01 오류 — 무해, 변경 없음).
--   SELECT 1문장 · 쓰기 없음. id 는 앞 8자, 사유(reason) 원문은 출력하지 않는다(action · 날짜 · 연결만).
--   X05/X06 의 id 앞 8자를 trace 결과(Q01 · P01)와 대조한다.
-- ════════════════════════════════════════════════════════════════════════════
with
x06 as (
  select p.id from public.finance_dues_payments p
   where p.payment_type = 'penalty' and p.receivable_id is null and p.is_voided is not true
),
pen_recv as (select r.id, r.status::text as st, r.related_kdk_session_id::text as sid from public.finance_dues_receivables r where r.receivable_type = 'penalty'),
au as (
  select a.action, a.changed_at, a.payment_id, a.old_receivable_id, a.new_receivable_id,
         a.payment_id in (select id from x06) as is_x06_payment,
         (select st from pen_recv r where r.id = a.old_receivable_id) as old_recv_status,
         (select sid from pen_recv r where r.id = a.old_receivable_id) as old_recv_sid
    from public.finance_payment_audit a
   where a.payment_id in (select id from x06)
      or a.old_receivable_id in (select id from pen_recv) or a.new_receivable_id in (select id from pen_recv)
)
select 'A' || row_number() over (order by changed_at) as k,
       action,
       to_char(changed_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as changed_at_utc,
       left(payment_id::text, 8) as payment8,
       case when is_x06_payment then 'X06 납부' else '-' end as x06,
       left(old_receivable_id::text, 8) as old_recv8, coalesce(old_recv_status, '-') as old_recv_status, coalesce(old_recv_sid, '-') as old_recv_session,
       left(new_receivable_id::text, 8) as new_recv8
  from au
union all
select 'C' || row_number() over (order by archive_id), 'ARCHIVE_SCORE_CORRECTION(세션별 건수)', max(to_char(corrected_at at time zone 'UTC', 'YYYY-MM-DD')), count(*)::text,
       '-', '-', '-', archive_id, '-'
  from public.kdk_archive_corrections
 where archive_id in (select distinct sid from pen_recv where sid is not null)
 group by archive_id
order by 1;
