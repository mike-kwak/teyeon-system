-- ============================================================================
--  2026 TEYEON OPEN — 현장 팀 체크인 롤백
--
--  대상: add_hosted_tournament_team_checkin.sql
--
--  ⚠⚠ 체크인 기록(hosted_tournament_team_checkins)이 '전부 삭제'된다.
--    체크인/취소 이력은 hosted_tournament_events(action = team_checkin / team_checkin_cancel)에 남는다.
--  ⚠ 건드리지 않는 것: hosted_tournament_teams · 경기 · 코트 · 조편성 · 감사 로그 · 기존 RPC 전부.
--  ⚠ 화면은 롤백 뒤에도 동작한다 — 체크인 조회가 실패하면 Control Center 는 체크인 표시만 숨긴다.
-- ============================================================================

begin;

drop function if exists public.set_team_checkin(text, uuid, boolean);
drop function if exists public.get_admin_team_checkins(text);
drop table if exists public.hosted_tournament_team_checkins;

notify pgrst, 'reload schema';

commit;
