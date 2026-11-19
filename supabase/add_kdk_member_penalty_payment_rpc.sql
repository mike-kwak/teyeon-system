-- ────────────────────────────────────────────────────────────────────────────
-- [DRAFT · 승인 전 실행 금지] KDK 회원 벌금 납부 — 원자적 RPC
--
-- 문제:
--   앱이 "최신 청구·납부 조회 → 잔액 계산 → INSERT" 를 클라이언트에서 따로 수행해,
--   다른 탭/운영자 2명이 동시에 [납부 완료]를 누르면 두 요청 모두 같은 잔액을 보고 각각 INSERT → 중복(초과) 납부.
--
-- 해결: pay_kdk_member_penalty(p_receivable_id, p_member_id, p_expected_remaining) — 1 트랜잭션.
--   1) auth.uid() 필수, public.is_finance_manager() 필수 (= finance_dues_payments INSERT RLS 정책과 동일 조건 → 권한 확대 없음)
--   2) 대상 청구 SELECT ... FOR UPDATE — 같은 청구에 대한 이 RPC 호출끼리 직렬화
--   3) 잠금 후 청구 상태·유효 납부 합계(is_voided=false)를 다시 읽어 잔액 계산(READ COMMITTED: 잠금 대기 후 새 스냅샷)
--   4) 잔액 > 0 이고 p_expected_remaining 과 같을 때만 잔액만큼 1행 INSERT
--   5) 어떤 단계든 예외 → 함수 전체 롤백(부분 기록 없음)
--
-- 반환(jsonb):
--   { status: 'paid' | 'already_paid' | 'stale',
--     inserted_amount, payment_id, amount_due, paid_before, paid_after, remaining_before }
--   paid         : 잔액만큼 기록함
--   already_paid : 잔액 0(완납·초과 납부 포함) → 기록 안 함. 같은 요청의 재시도(응답 유실 후)도 여기로 와서 중복 없음
--   stale        : 화면이 본 잔액(p_expected_remaining)과 DB 잔액이 다름(그 사이 다른 납부/취소) → 기록 안 함, 새로고침 후 재시도
-- 예외(raise, errcode):
--   AUTH_REQUIRED(42501) · FORBIDDEN(42501) · INVALID_INPUT(22023) · RECEIVABLE_NOT_FOUND(P0002)
--   NOT_KDK_PENALTY(P0001) · MEMBER_MISMATCH(P0001) · PENALTY_EXEMPT(P0001) · PENALTY_NOT_TARGET(P0001)
--
-- 멱등성 전략(최소 변경 — 신규 테이블/컬럼 없음):
--   이 RPC 는 항상 "남은 금액 전부"를 기록하므로, 성공 후 같은 청구의 잔액은 0 이 된다.
--   → 같은 요청을 재시도하면 already_paid 로 끝나 중복이 생기지 않는다.
--   → 실패(롤백) 후 재시도는 상태가 그대로라 정상 기록된다.
--   → 그 사이 다른 경로로 일부 납부/취소가 생겼으면 expected 불일치로 stale(기록 안 함) — 의도치 않은 금액 기록 방지.
--   요청 ID 테이블은 "같은 청구에 여러 번의 정상 부분 납부"를 이 RPC 로 허용할 때만 필요하다(현재 요구 아님).
--
-- ⚠️ 보호 범위: 이 RPC 를 거치는 쓰기끼리만 직렬화된다. 다음 직접 쓰기 경로는 RLS 상 여전히 가능(우회 경로):
--   · finance_dues_payments 직접 INSERT/UPDATE(금액 변경)/unvoid — /finance/members/[id] PaymentEditModal, REST 직접 호출
--   · /finance/record 의 penalty 납부는 receivable_id NULL 로 기록(청구 합계에 영향 없음)
--   필요 시 별도 단계로 BEFORE INSERT/UPDATE 가드 트리거(청구 잠금 + 합계 ≤ 청구액) 도입을 검토.
--
-- 선행: add_manual_finance_management.sql · add_finance_v2_security_hardening.sql(is_voided)
--       · add_kdk_penalty_finance_link.sql(related_kdk_session_id)
-- 적용 순서: 이 SQL 적용 → notify pgrst → 앱 배포(앱은 이 RPC 가 없으면 납부를 거부하고 안내함 — 구 경로로 fallback 하지 않음)
-- Rollback: ..._rollback.sql (drop function). 데이터 변경 없음.
-- idempotent: create or replace — 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.pay_kdk_member_penalty(
  p_receivable_id      uuid,
  p_member_id          uuid,
  p_expected_remaining integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_recv      public.finance_dues_receivables%rowtype;
  v_paid      integer;
  v_remaining integer;
  v_pay_id    uuid;
  v_today     date := (now() at time zone 'Asia/Seoul')::date;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not public.is_finance_manager() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_receivable_id is null or p_member_id is null
     or p_expected_remaining is null or p_expected_remaining <= 0 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  -- 같은 청구에 대한 동시 호출 직렬화(두 번째 호출은 첫 번째 커밋/롤백까지 대기).
  select r.* into v_recv
    from public.finance_dues_receivables r
   where r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_recv.receivable_type <> 'penalty' or v_recv.related_kdk_session_id is null then
    raise exception 'NOT_KDK_PENALTY';
  end if;
  if v_recv.member_id <> p_member_id then
    raise exception 'MEMBER_MISMATCH';
  end if;
  if v_recv.status = 'exempt' then
    raise exception 'PENALTY_EXEMPT';
  end if;
  if v_recv.status = 'not_target' then
    raise exception 'PENALTY_NOT_TARGET';
  end if;

  -- 잠금 획득 후 유효 납부 합계 재조회(이 문장은 잠금 대기 이후의 최신 커밋을 본다).
  select coalesce(sum(p.amount), 0)::integer into v_paid
    from public.finance_dues_payments p
   where p.receivable_id = v_recv.id
     and p.is_voided = false;

  v_remaining := greatest(v_recv.amount_due - v_paid, 0);

  if v_remaining = 0 then
    return jsonb_build_object(
      'status', 'already_paid', 'inserted_amount', 0, 'payment_id', null,
      'amount_due', v_recv.amount_due, 'paid_before', v_paid, 'paid_after', v_paid, 'remaining_before', 0);
  end if;

  if v_remaining <> p_expected_remaining then
    return jsonb_build_object(
      'status', 'stale', 'inserted_amount', 0, 'payment_id', null,
      'amount_due', v_recv.amount_due, 'paid_before', v_paid, 'paid_after', v_paid, 'remaining_before', v_remaining);
  end if;

  insert into public.finance_dues_payments
    (member_id, receivable_id, payment_type, amount, paid_at, created_by, updated_by)
  values
    (v_recv.member_id, v_recv.id, 'penalty', v_remaining, v_today, v_uid, v_uid)
  returning id into v_pay_id;

  return jsonb_build_object(
    'status', 'paid', 'inserted_amount', v_remaining, 'payment_id', v_pay_id,
    'amount_due', v_recv.amount_due, 'paid_before', v_paid, 'paid_after', v_paid + v_remaining,
    'remaining_before', v_remaining);
end;
$$;

comment on function public.pay_kdk_member_penalty(uuid, uuid, integer) is
  'KDK 회원 벌금 납부(원자적). 청구 행 잠금 후 미납 잔액만 기록. 완납/면제/비대상/불일치 차단. finance manager 전용.';

-- 실행 권한: public·anon 회수(Supabase 기본 권한이 anon 에 EXECUTE 를 줄 수 있으므로 명시 회수), authenticated 만.
revoke all     on function public.pay_kdk_member_penalty(uuid, uuid, integer) from public;
revoke all     on function public.pay_kdk_member_penalty(uuid, uuid, integer) from anon;
grant  execute on function public.pay_kdk_member_penalty(uuid, uuid, integer) to authenticated;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
