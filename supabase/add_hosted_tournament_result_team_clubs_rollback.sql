-- 되돌림: 입상팀 소속 클럽 기록 제거(공식 스냅샷 · 사진 · 기존 함수는 그대로). 화면은 클럽 줄 없이 이전처럼 보인다.
begin;
drop function if exists public.get_public_tournament_result_clubs(text);
drop function if exists public.capture_tournament_result_clubs(text);
drop function if exists public.hosted_tournament_result_capture_clubs(uuid, uuid);
drop table if exists public.hosted_tournament_result_team_clubs;
drop function if exists public.hosted_tournament_result_team_clubs_guard();
commit;
notify pgrst, 'reload schema';
