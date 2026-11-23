-- [CLOSING SPRINT K1] 롤백 — play_epoch trigger · 함수 · 열 제거. 점수 · 상태 · 승패 데이터는 그대로.
--   ⚠ 화면 되돌리기 불필요: 화면은 행에 play_epoch 가 없으면 조건을 보내지 않고(P1 보호만 유지), 롤백 직전에 열려 있던
--     점수 창이 epoch 조건으로 "열 없음" 오류를 받으면 epoch 조건만 빼고 1회 다시 저장한다(P1 조건 유지).
--     그래도 경기 중이 아닐 때 실행하고 운영진에게 새로고침을 안내한다.
--   사라지는 보호: "복귀 → 재투입 뒤 이전 점수 창 저장" 차단만. P1(점수 창을 연 시점 상태 · 점수 조건부 UPDATE)은 화면 코드라 유지.
--   주의: 열을 지우면 투입 주기 이력(값)은 복구할 수 없다. 다시 적용하면 모든 행이 0 에서 시작한다.
begin;
set local lock_timeout = '3s';
drop trigger if exists kdk_play_epoch_trg on public.matches;
drop function if exists public.kdk_play_epoch_guard();
alter table public.matches drop column if exists play_epoch;
commit;
notify pgrst, 'reload schema';
