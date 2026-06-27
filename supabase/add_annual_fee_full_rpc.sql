-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance — 연회비 일괄 납부(누락 청구 생성 + 잔액 납부) RPC
--
-- 목적: 연회비 처리 시 선택 연도의 누락된 월회비 청구를 먼저 생성하고, 이어서 해당 연도
--       monthly_fee 청구의 남은 금액만큼 월별 payment 를 한 트랜잭션에서 생성한다.
--       (예: 1~6월 청구만 있고 7~12월이 없던 회원도 7~12월 청구 생성 후 전체 완납 처리)
--
-- 입력:
--   p_member_id : 대상 회원
--   p_year      : 대상 연도
--   p_paid_at   : 실제 납부일(모든 생성 payment 공통)
--   p_memo      : payment 메모(예: '2026년 연회비 일괄 납부')
--   p_months    : 생성 후보 월 번호 배열(예: {7,8,9,10,11,12}). ★ 월 번호만 받는다.
--                 금액/기준일은 클라이언트를 신뢰하지 않고 RPC 가 DB(finance_fee_rules)에서 직접 조회한다.
--
-- 서버 기준 검증(클라이언트 미리보기는 UX용, 최종 쓰기 판단은 서버):
--   - 각 월 1~12 범위, p_months 내 중복 금지(중복 시 전체 중단).
--   - 이미 (member, year, month) monthly_fee 청구가 있으면 생성하지 않음(중복/수정 없음).
--   - 회원 role 이 '준회원'/'게스트'(월회비 비대상)면 해당 월 생성하지 않음.
--   - 해당 월 휴회면 생성하지 않음.
--   - fee rule(year, month)이 없거나 비활성(is_active<>true)이면 전체 처리 중단(롤백).
--   - 생성 금액/기준일은 반드시 DB fee rule 의 default_amount / due_date 사용(클라이언트 금액 미사용).
--
-- 원자성/안전(기존 유지):
--   - 함수 본문 = 단일 트랜잭션. 청구 일부만 생성되고 payment 가 빠지는 중간 상태 없음.
--   - 각 monthly_fee 청구 FOR UPDATE 잠금 + 최신 유효 납부 합계 재계산 → 남은 금액만 INSERT
--     (이미 완납 월 0건, 초과/중복 방지). exempt/not_target 청구는 건너뜀. is_voided 제외.
--
-- 결과: { createdCount, paymentCount, totalAmount }.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행(create or replace / if not exists 라 재실행 안전).
--    선행: add_finance_v2_security_hardening.sql(is_finance_manager(), is_voided) 필요.
--    적용 후: notify pgrst, 'reload schema';
-- ────────────────────────────────────────────────────────────────────────────

-- 이전(테스트)에서 jsonb 시그니처로 적용했을 수 있어 안전하게 제거 후 재정의.
drop function if exists public.pay_annual_fee_full(uuid, integer, date, text, jsonb);

create or replace function public.pay_annual_fee_full(
    p_member_id uuid,
    p_year      integer,
    p_paid_at   date,
    p_memo      text,
    p_months    integer[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_created   int    := 0;
    v_count     int    := 0;
    v_total     bigint := 0;
    v_role      text;
    v_months    int[];
    v_month     int;
    v_rule      record;
    v_onleave   boolean;
    r           record;
    v_paid      bigint;
    v_remaining bigint;
begin
    -- 권한.
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    if not public.is_finance_manager() then
        raise exception 'permission denied';
    end if;

    -- 입력.
    if p_member_id is null or p_year is null or p_paid_at is null then
        raise exception 'invalid arguments';
    end if;
    if p_year < 2020 or p_year > 2100 then
        raise exception 'invalid target_year: %', p_year;
    end if;

    -- 회원 실존 + 역할(월회비 대상 판정용).
    select role into v_role from public.members where id = p_member_id;
    if not found then
        raise exception 'member not found: %', p_member_id;
    end if;

    -- 1) 누락 청구 생성 — 월 번호만 신뢰, 금액/기준은 DB(finance_fee_rules)에서 재확인.
    if p_months is not null and array_length(p_months, 1) is not null then
        -- 중복 입력 거부(distinct 결과 길이가 다르면 중복).
        select array_agg(distinct m order by m) into v_months from unnest(p_months) as t(m);
        if array_length(v_months, 1) <> array_length(p_months, 1) then
            raise exception 'duplicate month in request';
        end if;

        foreach v_month in array v_months
        loop
            if v_month < 1 or v_month > 12 then
                raise exception 'invalid month: %', v_month;
            end if;

            -- 이미 청구가 있으면 생성 건너뜀(중복/수정 없음).
            if exists (
                select 1 from public.finance_dues_receivables
                 where member_id = p_member_id and target_year = p_year
                   and target_month = v_month and receivable_type = 'monthly_fee'
            ) then
                continue;
            end if;

            -- 월회비 비대상 역할(준회원/게스트)이면 생성하지 않음(잘못된 청구 방지).
            if btrim(coalesce(v_role, '')) in ('준회원', '게스트') then
                continue;
            end if;

            -- 해당 월 휴회면 생성하지 않음.
            select exists (
                select 1 from public.finance_member_leaves l
                 where l.member_id = p_member_id
                   and l.start_date <= (make_date(p_year, v_month, 1) + interval '1 month' - interval '1 day')
                   and (l.end_date is null or l.end_date >= make_date(p_year, v_month, 1))
            ) into v_onleave;
            if v_onleave then
                continue;
            end if;

            -- fee rule 필수 + 활성. 없거나 비활성이면 전체 처리 중단(롤백).
            select default_amount, due_date, is_active
              into v_rule
              from public.finance_fee_rules
             where year = p_year and month = v_month;
            if not found then
                raise exception 'no fee rule for %-%', p_year, v_month;
            end if;
            if v_rule.is_active is distinct from true then
                raise exception 'inactive fee rule for %-%', p_year, v_month;
            end if;

            -- 금액/기준일은 DB fee rule 값만 사용(클라이언트 금액 미사용).
            insert into public.finance_dues_receivables
                (member_id, receivable_type, title, target_year, target_month,
                 amount_due, due_date, status, created_by)
            values
                (p_member_id, 'monthly_fee', p_year || '년 ' || v_month || '월 회비',
                 p_year, v_month, greatest(0, v_rule.default_amount), v_rule.due_date, 'pending', auth.uid());
            v_created := v_created + 1;
        end loop;
    end if;

    -- 2) 선택 연도 monthly_fee 청구의 남은 금액만큼 payment 생성(잠금 + 재계산). 기존 로직 유지.
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

    return jsonb_build_object('createdCount', v_created, 'paymentCount', v_count, 'totalAmount', v_total);
end;
$$;

revoke execute on function public.pay_annual_fee_full(uuid, integer, date, text, integer[]) from public;
grant  execute on function public.pay_annual_fee_full(uuid, integer, date, text, integer[]) to authenticated;

comment on function public.pay_annual_fee_full(uuid, integer, date, text, integer[]) is
    '연회비 일괄 납부 — 월 번호만 받아 DB fee rule 기준으로 누락 월회비 청구 생성 + 선택 연도 잔액 일괄 납부. 단일 트랜잭션, 금액 서버 결정, 중복/초과/비대상/휴회 방지.';
