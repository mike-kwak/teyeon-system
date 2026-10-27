-- 입상 사진 ↔ 입상팀 연결 되돌리기. ⚠ 새 화면(팀 지정 판)이 배포된 뒤에는 먼저 코드를 되돌린 다음 실행한다.
--   team_no 칸과 10개 인자 저장 함수를 지운다. 조회 두 개는 teamNo 를 내보내지 않던 원래 정의로 add_hosted_tournament_result_archive.sql 의
--   get_public_tournament_result · get_admin_tournament_result 부분을 다시 실행해 되돌린다(이 파일만으로는 team_no 를 참조하는 조회가 깨지므로 아래 순서 지킬 것).
--   1) 아래 drop function 2) archive SQL 의 두 조회 함수 정의 재실행 3) 아래 alter table.
drop function if exists public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer, integer);
-- (2 단계 후)
-- alter table public.hosted_tournament_result_media drop constraint if exists result_media_team_no;
-- alter table public.hosted_tournament_result_media drop column if exists team_no;
