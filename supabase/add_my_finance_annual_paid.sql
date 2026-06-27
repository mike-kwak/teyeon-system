-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance — 본인 전용 RPC get_my_finance_year 확장: annualFeePaid 추가
--
-- 목적: 일반 회원 화면(MemberFinanceView)이 "연회비 납부 완료" 배지를 안전하게 표시하도록
--       본인 데이터만으로 연회비(월회비 12개월) 완료 여부를 서버에서 계산해 응답에 포함한다.
--       (클라이언트가 fee rule/role/leave 를 따로 조회하지 않아도 되도록 서버 권위 판정)
--
-- 판정 기준(관리자 computeAnnualFeeStatus 와 동일):
--   - 월 1~12 점검. 해당 월 monthly_fee 청구가 있으면 exempt/not_target 은 의무에서 제외,
--     그 외는 의무(남은 금액 = max(0, amount_due - 유효납부합계)).
--   - 청구가 없으면: 준회원/게스트(비대상) 또는 그 달 휴회 → 제외 /
--     활성 fee rule 존재 → 의무(미납, 남은 금액 = 기준액) / fee rule 없음 → blocked.
--   - annualFeePaid = (blocked 없음) AND (의무 월 ≥ 1) AND (모든 의무 월 남은 금액 = 0).
--   - payment 는 is_voided=false 만 합산(취소/초기화 제외). memo 문구로 판정하지 않음.
--
-- 보안: 기존과 동일하게 auth.uid() → 본인 members.id 매핑분만 조회. 다른 회원 데이터 미반환.
--       security definer + search_path 고정. admin_memo/created_by/updated_by 미포함 유지.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행(create or replace 라 재실행 안전).
--    이 파일은 add_finance_v2_security_hardening.sql 의 get_my_finance_year 를 "덮어쓰지 않고"
--    동일 시그니처로 재정의(확장)한다. 적용 후: notify pgrst, 'reload schema';
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.get_my_finance_year(p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id   uuid;
  v_receivables jsonb;
  v_payments    jsonb;
  v_leaves      jsonb;
  -- 연회비 완료 판정용.
  v_role        text;
  v_m           int;
  v_rid         uuid;
  v_due         integer;
  v_status      text;
  v_paid        bigint;
  v_fr_amt      integer;
  v_fr_active   boolean;
  v_obligation  int    := 0;
  v_remaining   bigint := 0;
  v_blocked     boolean := false;
  v_annual_paid boolean := false;
begin
  -- 호출자의 members.id 매핑. 없으면 빈 응답(회원 연결 없음).
  select m.id, m.role into v_member_id, v_role
    from public.members m
   where m.auth_user_id = auth.uid()
   limit 1;
  if v_member_id is null then
    return jsonb_build_object(
      'memberFound',   false,
      'receivables',   '[]'::jsonb,
      'payments',      '[]'::jsonb,
      'leaves',        '[]'::jsonb,
      'annualFeePaid', false
    );
  end if;

  -- 회원 공개 필드만 직렬화. admin_memo / created_by / updated_by 미포함.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',              r.id,
    'member_id',       r.member_id,
    'receivable_type', r.receivable_type,
    'title',           r.title,
    'target_year',     r.target_year,
    'target_month',    r.target_month,
    'amount_due',      r.amount_due,
    'due_date',        to_char(r.due_date, 'YYYY-MM-DD'),
    'status',          r.status,
    'exemption_reason', r.exemption_reason,
    'memo',            r.memo,
    'created_at',      to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at',      to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) order by r.target_year asc nulls last, r.target_month asc nulls last), '[]'::jsonb)
    into v_receivables
    from public.finance_dues_receivables r
   where r.member_id = v_member_id
     and (r.target_year is null or r.target_year = p_year);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',            p.id,
    'member_id',     p.member_id,
    'receivable_id', p.receivable_id,
    'payment_type',  p.payment_type,
    'amount',        p.amount,
    'paid_at',       to_char(p.paid_at, 'YYYY-MM-DD'),
    'memo',          p.memo,
    'created_at',    to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at',    to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) order by p.paid_at desc), '[]'::jsonb)
    into v_payments
    from public.finance_dues_payments p
   where p.member_id = v_member_id
     and p.is_voided = false
     and p.paid_at between (p_year::text || '-01-01')::date
                       and (p_year::text || '-12-31')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',         l.id,
    'start_date', to_char(l.start_date, 'YYYY-MM-DD'),
    'end_date',   to_char(l.end_date, 'YYYY-MM-DD'),
    'reason',     l.reason
  ) order by l.start_date desc), '[]'::jsonb)
    into v_leaves
    from public.finance_member_leaves l
   where l.member_id = v_member_id;

  -- ── 연회비(월회비 12개월) 완료 여부 — 본인 데이터만으로 서버 판정 ──────────────
  for v_m in 1..12 loop
    v_rid := null;
    select r.id, r.amount_due, r.status
      into v_rid, v_due, v_status
      from public.finance_dues_receivables r
     where r.member_id = v_member_id
       and r.target_year = p_year
       and r.target_month = v_m
       and r.receivable_type = 'monthly_fee'
     limit 1;

    if v_rid is not null then
      -- 청구 있음. exempt/not_target 은 의무에서 제외.
      if v_status not in ('exempt', 'not_target') then
        select coalesce(sum(amount), 0) into v_paid
          from public.finance_dues_payments
         where receivable_id = v_rid and is_voided = false;
        v_obligation := v_obligation + 1;
        v_remaining  := v_remaining + greatest(0, v_due - v_paid);
      end if;
    else
      -- 청구 없음.
      if btrim(coalesce(v_role, '')) in ('준회원', '게스트') then
        null; -- 월회비 비대상.
      elsif exists (
        select 1 from public.finance_member_leaves l
         where l.member_id = v_member_id
           and l.start_date <= (make_date(p_year, v_m, 1) + interval '1 month' - interval '1 day')
           and (l.end_date is null or l.end_date >= make_date(p_year, v_m, 1))
      ) then
        null; -- 해당 월 휴회 제외.
      else
        select default_amount, is_active
          into v_fr_amt, v_fr_active
          from public.finance_fee_rules
         where year = p_year and month = v_m;
        if found and v_fr_active is true then
          -- 활성 fee rule 있는데 청구 없음 → 의무(미납, 남은 금액 = 기준액).
          v_obligation := v_obligation + 1;
          v_remaining  := v_remaining + greatest(0, coalesce(v_fr_amt, 0));
        else
          -- 회비 기준 없음(또는 비활성) → 월별 데이터 불완전 → 완료로 보지 않음.
          v_blocked := true;
        end if;
      end if;
    end if;
  end loop;

  v_annual_paid := (not v_blocked) and v_obligation > 0 and v_remaining = 0;

  return jsonb_build_object(
    'memberFound',   true,
    'receivables',   v_receivables,
    'payments',      v_payments,
    'leaves',        v_leaves,
    'annualFeePaid', v_annual_paid
  );
end;
$$;

revoke execute on function public.get_my_finance_year(integer) from public;
grant  execute on function public.get_my_finance_year(integer) to anon, authenticated;

comment on function public.get_my_finance_year(integer) is
    '본인 1년치 납부 현황 + 연회비 완료 여부(annualFeePaid). auth.uid() 매핑 회원 데이터만. admin_memo/내부컬럼 미포함, is_voided 제외.';
