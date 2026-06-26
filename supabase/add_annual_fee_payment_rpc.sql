-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance — 연회비 잔액 일괄 납부 RPC
--
-- 목적: 선택 회원·선택 연도의 monthly_fee 청구 "남은 금액"만큼 월별 payment 를 한 번에 생성.
--       연회비 = 선택 연도 월회비 잔액 전체 납부(벌금/게스트비/행사비는 대상 아님).
--
-- 원자성/동시성/초과납부 방어:
--   - 함수 본문 = 단일 트랜잭션. 일부 월만 저장되고 나머지가 실패하는 상태가 남지 않는다.
--   - 각 monthly_fee receivable 을 FOR UPDATE 로 잠그고, 그 안에서 최신 납부 합계를 다시 계산해
--     남은 금액만큼만 INSERT → 이중 클릭 / 동시 처리 / 미리보기 이후 추가 납부 / 이미 완납 / 초과 납부 방어.
--   - is_voided=true payment 는 합계에서 제외. exempt / not_target 청구는 건너뜀.
--
-- 결과: { paymentCount, totalAmount }.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행. idempotent(create or replace).
--    선행: add_finance_v2_security_hardening.sql(is_finance_manager()) 필요.
--    적용 후: notify pgrst, 'reload schema';
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.pay_annual_fee_remainder(
    p_member_id uuid,
    p_year      integer,
    p_paid_at   date,
    p_memo      text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_count int    := 0;
    v_total bigint := 0;
    r          record;
    v_paid     bigint;
    v_remaining bigint;
    v_member_exists boolean;
begin
    -- 로그인 필수 — 미인증(anon)이면 즉시 거부.
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    -- 운영자(CEO/ADMIN/FINANCE_MANAGER)만.
    if not public.is_finance_manager() then
        raise exception 'permission denied';
    end if;
    if p_member_id is null or p_year is null or p_paid_at is null then
        raise exception 'invalid arguments';
    end if;
    -- target_year 범위 검증(현실적 회비 연도 범위).
    if p_year < 2020 or p_year > 2100 then
        raise exception 'invalid target_year: %', p_year;
    end if;
    -- member_id 실존 검증 — 없는 회원이면 거부.
    select exists(select 1 from public.members where id = p_member_id) into v_member_exists;
    if not v_member_exists then
        raise exception 'member not found: %', p_member_id;
    end if;

    -- 대상 monthly_fee 청구를 잠그고 순회(동시성 직렬화).
    for r in
        select id, amount_due
          from public.finance_dues_receivables
         where member_id = p_member_id
           and target_year = p_year
           and receivable_type = 'monthly_fee'
           and status not in ('exempt', 'not_target')
         order by target_month asc nulls last
         for update
    loop
        -- 최신 납부 합계 재계산(미리보기 이후 변동/초과 방어). 취소 payment 제외.
        select coalesce(sum(amount), 0) into v_paid
          from public.finance_dues_payments
         where receivable_id = r.id
           and is_voided = false;

        v_remaining := greatest(0, r.amount_due - v_paid);
        if v_remaining > 0 then
            insert into public.finance_dues_payments
                (member_id, receivable_id, payment_type, amount, paid_at, memo, created_by, updated_by)
            values
                (p_member_id, r.id, 'monthly_fee', v_remaining, p_paid_at, p_memo, auth.uid(), auth.uid());
            v_count := v_count + 1;
            v_total := v_total + v_remaining;
        end if;
    end loop;

    return jsonb_build_object('paymentCount', v_count, 'totalAmount', v_total);
end;
$$;

revoke execute on function public.pay_annual_fee_remainder(uuid, integer, date, text) from public;
grant  execute on function public.pay_annual_fee_remainder(uuid, integer, date, text) to authenticated;

comment on function public.pay_annual_fee_remainder(uuid, integer, date, text) is
    '연회비 잔액 일괄 납부 — 선택 연도 monthly_fee 남은 금액만큼 월별 payment 생성. 트랜잭션+FOR UPDATE 로 초과/중복 방어.';
