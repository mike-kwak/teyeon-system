-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance — 월 납부 초기화 RPC (월회비 payment soft-cancel)
--
-- 목적: 특정 (year, month) 의 월회비 "납부 기록"만 일괄 취소(soft-cancel)해 그 달을 미납 상태로
--       되돌린다. 청구(receivable)는 삭제/수정하지 않으며 amount_due 도 그대로 유지된다.
--       (예: 2026년 6월 → 6월 monthly_fee receivable 에 연결된 유효 payment 만 취소)
--
-- 처리 대상(엄격):
--   - 선택 (year, month) 의 receivable_type='monthly_fee' 청구에 연결되고
--   - payment_type='monthly_fee' 이며
--   - is_voided=false 인 payment 만.
--   → 다른 월/타입(penalty·guest_fee·event_fee·KDK 벌금), 5월로 귀속 변경된 payment(=5월 청구에 연결),
--     이미 취소된 payment 는 자동 제외. receivable/fee rule 은 건드리지 않는다.
--
-- 방식:
--   - 물리 DELETE 금지 — 기존 soft-cancel 컬럼(is_voided/voided_at/voided_by/void_reason) 재사용.
--   - paid_at/amount/memo 원본 보존(감사 이력 유지). void_reason='월 납부 초기화'.
--   - 단일 UPDATE = 원자적. is_voided=false 필터라 재실행해도 이미 취소된 건 중복 처리 없음(idempotent).
--
-- 결과: { voidedCount, totalAmount }.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행(create or replace 라 재실행 안전).
--    선행: add_finance_v2_security_hardening.sql(is_finance_manager(), is_voided) 필요.
--    적용 후: notify pgrst, 'reload schema';
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.reset_monthly_payments(
    p_year  integer,
    p_month integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_count int    := 0;
    v_total bigint := 0;
begin
    -- 권한.
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    if not public.is_finance_manager() then
        raise exception 'permission denied';
    end if;

    -- 입력.
    if p_year is null or p_year < 2020 or p_year > 2100 then
        raise exception 'invalid target_year: %', p_year;
    end if;
    if p_month is null or p_month < 1 or p_month > 12 then
        raise exception 'invalid target_month: %', p_month;
    end if;

    -- 선택 월의 monthly_fee 청구에 연결된 유효 monthly_fee payment 만 soft-cancel(단일 원자 UPDATE).
    with upd as (
        update public.finance_dues_payments p
           set is_voided   = true,
               voided_at   = now(),
               voided_by   = auth.uid(),
               void_reason = '월 납부 초기화',
               updated_by  = auth.uid(),
               updated_at  = now()
         where p.is_voided = false
           and p.payment_type = 'monthly_fee'
           and p.receivable_id in (
               select r.id
                 from public.finance_dues_receivables r
                where r.target_year = p_year
                  and r.target_month = p_month
                  and r.receivable_type = 'monthly_fee'
           )
        returning p.amount
    )
    select count(*), coalesce(sum(amount), 0) into v_count, v_total from upd;

    return jsonb_build_object('voidedCount', v_count, 'totalAmount', v_total);
end;
$$;

revoke execute on function public.reset_monthly_payments(integer, integer) from public;
grant  execute on function public.reset_monthly_payments(integer, integer) to authenticated;

comment on function public.reset_monthly_payments(integer, integer) is
    '월 납부 초기화 — 선택 (year,month) monthly_fee 청구에 연결된 유효 monthly_fee payment 만 soft-cancel. 청구/금액 유지, 물리삭제 없음, 재실행 안전.';
