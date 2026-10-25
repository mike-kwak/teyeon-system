-- 코트별 NEXT UP 서버 저장 되돌리기 — 추가한 함수 2 · 테이블 1 만 지운다(경기 · 대진 데이터와 무관).
begin;
drop function if exists public.get_court_next_ups(text);
drop function if exists public.set_court_next_ups(text, jsonb);
drop table if exists public.hosted_tournament_court_next_ups;
commit;
