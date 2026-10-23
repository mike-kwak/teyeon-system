-- =============================================================================
-- 되돌리기 — add_hosted_tournament_live_source.sql 이 추가한 것만 지운다.
--   ⚠ 저장된 YouTube 주소 · 소스 선택이 사라진다(감사 로그 hosted_tournament_events 는 남는다).
--   ⚠ 앱은 함수가 없으면 서버 환경변수(TEYEON_YOUTUBE_LIVE_URL)로 돌아간다 — 화면이 깨지지 않는다.
-- =============================================================================

begin;

drop function if exists public.set_live_source(text, text, text, text, integer);
drop function if exists public.get_admin_live_source(text);
drop function if exists public.get_public_live_source(text);
drop table    if exists public.hosted_tournament_live_source;

notify pgrst, 'reload schema';

commit;
