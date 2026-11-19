-- ────────────────────────────────────────────────────────────────────────────
-- [VERIFY · READ-ONLY] fix_kdk_guest_penalty_mismatch_20261110.sql(v2) 적용 후 / rollback 후 확인
--
-- 적용 직후 기대값(가장 최근 audit 행 기준):
--   recv_status = 'not_target' · payment_is_voided = true · other_valid_payments = 0
--   guest_status = 'paid' · guest_amount = 3000 = archive_amt
--   guest_paid_at = original_payment_created_at (guest_prev 가 none/cancelled 일 때) · guest_row_created_at ≈ audit_changed_at
--   rolled_back = false
--   세션 합계: session_member_valid_paid 는 이관 전보다 3,000 감소,
--             session_guest_paid 는 3,000 증가(guest_prev='paid' 였다면 증가 없음 — 이미 계산돼 있던 금액)
-- rollback 직후 기대값: rolled_back = true · recv_status = recv_prev_status · payment_is_voided = false
--   guest_status = 'cancelled'(guest_prev=none) / 이전 상태(guest_prev=cancelled) / 'paid'(guest_prev=paid)
-- ────────────────────────────────────────────────────────────────────────────
with au as (
  select au.*, au.reason::jsonb as j
    from public.finance_payment_audit au
   where au.action = 'KDK_GUEST_MISMATCH_TRANSFER_V1'
)
select au.changed_at                 as audit_changed_at,
       au.j->>'operator'             as operator,
       exists (select 1 from public.finance_payment_audit r
                where r.action = 'KDK_GUEST_MISMATCH_TRANSFER_V1_ROLLBACK'
                  and r.payment_id = au.payment_id and r.changed_at > au.changed_at) as rolled_back,
       au.old_receivable_id          as recv_id,
       au.j->>'session'              as session_id,
       rv.status                     as recv_status,
       au.j->'recv_prev'->>'status'  as recv_prev_status,
       rv.exemption_reason           as recv_reason,
       p.is_voided                   as payment_is_voided,
       p.amount                      as payment_amount,
       p.paid_at                     as payment_paid_at,
       p.created_at                  as original_payment_created_at,
       p.voided_at                   as payment_voided_at,
       (select count(*) from public.finance_dues_payments q
         where q.receivable_id = au.old_receivable_id and q.is_voided = false and q.id <> au.payment_id) as other_valid_payments,
       left(au.j->>'participant',12) as guest_pid12,
       au.j->>'guest_prev'           as guest_prev,
       g.status                      as guest_status,
       g.amount                      as guest_amount,
       g.paid_at                     as guest_paid_at,
       g.created_at                  as guest_row_created_at,
       g.updated_at                  as guest_row_updated_at,
       (select abs((e->>'penalty_amount')::int)
          from public.teyeon_archive_v1 a, jsonb_array_elements(a.raw_data->'settlement_data') e
         where a.id = au.j->>'session' and e->>'player_id' = au.j->>'participant' limit 1) as archive_amt,
       (select coalesce(sum(pp.amount),0)
          from public.finance_dues_payments pp
          join public.finance_dues_receivables r2 on r2.id = pp.receivable_id
         where r2.related_kdk_session_id = au.j->>'session' and r2.receivable_type = 'penalty' and pp.is_voided = false) as session_member_valid_paid,
       (select coalesce(sum(gg.amount),0) from public.kdk_guest_penalty_payments gg
         where gg.session_id = au.j->>'session' and gg.charge_type = 'penalty' and gg.status = 'paid') as session_guest_paid,
       (select coalesce(sum(abs((e->>'penalty_amount')::int)),0)
          from public.teyeon_archive_v1 a, jsonb_array_elements(a.raw_data->'settlement_data') e
         where a.id = au.j->>'session' and coalesce((e->>'penalty_amount')::int,0) < 0) as session_archive_total
  from au
  left join public.finance_dues_receivables rv on rv.id = au.old_receivable_id
  left join public.finance_dues_payments p     on p.id  = au.payment_id
  left join public.kdk_guest_penalty_payments g on g.id = (au.j->>'guest_row')::uuid
 order by au.changed_at desc;

-- 전체 이력(적용/롤백 순서) 확인
-- select action, changed_at, reason::jsonb->>'operator' as operator, reason
--   from public.finance_payment_audit
--  where action like 'KDK_GUEST_MISMATCH_TRANSFER_V1%' order by changed_at;
