-- ────────────────────────────────────────────────────────────────────────────
-- [DRAFT · 승인 전 실행 금지] add_kdk_member_penalty_payment_rpc.sql 되돌리기
--   함수만 제거한다. 이 RPC 로 기록된 납부 행(finance_dues_payments)은 정상 납부 기록이므로 삭제하지 않는다.
-- ⚠️ 앱이 이 RPC 를 쓰는 버전으로 배포돼 있으면 회원 벌금 [납부 완료]가 "DB 업데이트 필요" 안내로 실패한다.
--    → 앱을 이전 버전으로 되돌린 뒤 실행할 것.
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.pay_kdk_member_penalty(uuid, uuid, integer);
notify pgrst, 'reload schema';
