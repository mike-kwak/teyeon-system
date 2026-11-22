-- [CLOSING SPRINT B1] 롤백 — 추가한 함수 2개만 제거. 기존 권한(KDK 관리자 이상 직접 복귀)은 영향 없음.
--   앱은 kdk_can_return_court 호출 실패(함수 없음) 시 같은 페이지·계정 동안 재호출하지 않고 임원진 복귀 버튼을 숨기므로(기존 화면) 롤백 후에도 안전하다.
begin;
drop function if exists public.return_kdk_match_to_waiting(text, text);
drop function if exists public.kdk_can_return_court(text);
drop function if exists public.kdk_can_return_court();  -- 초안 시그니처(있으면)
commit;
