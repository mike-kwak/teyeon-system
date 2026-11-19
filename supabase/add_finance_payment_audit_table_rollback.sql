-- ────────────────────────────────────────────────────────────────────────────
-- [DRAFT · 승인 전 실행 금지] add_finance_payment_audit_table.sql 되돌리기
--   감사 행이 1건이라도 있으면 중단한다(감사 기록 보존 — 이 경우 테이블을 지우지 않는다).
--   빈 테이블일 때만 트리거·함수·테이블을 제거한다. DO 블록 = 1 트랜잭션.
-- ────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.finance_payment_audit') is null then
    raise notice 'NOTHING_TO_ROLLBACK'; return;
  end if;
  if exists (select 1 from public.finance_payment_audit) then
    raise exception 'AUDIT_ROWS_EXIST — 감사 기록이 있어 테이블을 제거하지 않습니다';
  end if;
  drop table public.finance_payment_audit;            -- 트리거는 테이블과 함께 제거
  drop function if exists public.finance_payment_audit_block_mutation();
  raise notice 'AUDIT_TABLE_DROPPED';
end
$$;
notify pgrst, 'reload schema';
