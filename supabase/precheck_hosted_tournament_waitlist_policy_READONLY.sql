-- =============================================================================
-- PRECHECK (READ-ONLY) — add_hosted_tournament_waitlist_policy.sql 적용 전 확인
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL 없음. 개인정보(이름·전화·입금자·메모) 미출력.
--   대상: 2026-teyeon-open
--   결과: section · item · value 3열. 마지막 'VERDICT' 행이 적용 가능 여부.
-- =============================================================================

with t as (
    select id, status, registration_open_at, registration_close_at, target_capacity, max_capacity
      from public.hosted_tournaments where slug = '2026-teyeon-open'
),
r as (
    select x.registration_status, x.payment_status, x.sequence_no, x.registration_no
      from public.hosted_tournament_registrations x join t on t.id = x.tournament_id
),
agg as (
    select count(*)                                                                as total,
           count(*) filter (where registration_status in ('applied', 'confirmed'))  as normal_cnt,
           count(*) filter (where registration_status = 'applied')                  as applied_cnt,
           count(*) filter (where registration_status = 'confirmed')                as confirmed_cnt,
           count(*) filter (where registration_status = 'waitlisted')               as waitlisted_cnt,
           count(*) filter (where registration_status = 'cancelled')                as cancelled_cnt,
           count(*) filter (where registration_status = 'rejected')                 as rejected_cnt,
           coalesce(max(sequence_no), 0)                                            as max_seq,
           count(*) - count(distinct registration_no)                               as dup_regno,
           count(*) - count(distinct sequence_no)                                   as dup_seq
      from r
),
rows_out as (
    select 1 as ord, 'tournament' as section, 'status' as item, (select status from t) as value
    union all select 2, 'tournament', 'registration_open_at', coalesce((select registration_open_at::text from t), 'null')
    union all select 3, 'tournament', 'registration_close_at (KST)',
                     (select to_char(registration_close_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') from t)
    union all select 4, 'tournament', 'target / max', (select target_capacity || ' / ' || max_capacity from t)
    union all select 10, 'count', 'total rows', (select total::text from agg)
    union all select 11, 'count', 'NORMAL (applied+confirmed)', (select normal_cnt::text from agg)
    union all select 12, 'count', 'applied', (select applied_cnt::text from agg)
    union all select 13, 'count', 'confirmed', (select confirmed_cnt::text from agg)
    union all select 14, 'count', 'WAITLISTED', (select waitlisted_cnt::text from agg)
    union all select 15, 'count', 'cancelled', (select cancelled_cnt::text from agg)
    union all select 16, 'count', 'rejected', (select rejected_cnt::text from agg)
    union all select 17, 'count', 'max sequence_no', (select max_seq::text from agg)
    union all select 18, 'integrity', 'duplicate registration_no', (select dup_regno::text from agg)
    union all select 19, 'integrity', 'duplicate sequence_no', (select dup_seq::text from agg)
    union all
    select 30 + row_number() over (order by payment_status), 'payment_status (all rows)', payment_status, count(*)::text
      from r group by payment_status
    union all
    select 50 + row_number() over (order by registration_status, payment_status), 'status x payment',
           registration_status || ' / ' || payment_status, count(*)::text
      from r group by registration_status, payment_status
    union all
    select 90, 'VERDICT', 'waitlisted = 0 AND normal <= max AND no duplicates',
           case when (select waitlisted_cnt from agg) = 0
                 and (select normal_cnt from agg) <= (select max_capacity from t)
                 and (select dup_regno from agg) = 0 and (select dup_seq from agg) = 0
                then 'SAFE — 보정 필요 없음' else 'STOP — 적용 전 보고' end
)
select section, item, value from rows_out order by ord;
