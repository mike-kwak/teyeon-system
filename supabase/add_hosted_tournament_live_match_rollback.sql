-- ============================================================================
--  LIVE 중계 경기 연결 — 되돌리기(이번에 만든 함수 12개 · 테이블 3개만 지운다)
--
--  ⚠ 경기 · 코트 · 이벤트 · 팀 · 조 · 본선표 · DRAW 등 기존 객체는 건드리지 않는다.
--  ⚠ Cloudflare 송출 · 재생 · 녹화에는 영향이 없다(녹화 영상은 Cloudflare 에 그대로 남는다).
--  ⚠ 중계 경기 지정 상태 · 구간 · 녹화 연결 · 보정값 · 확정 상태가 함께 사라진다(되살릴 수 없다).
-- ============================================================================

begin;

drop function if exists public.get_admin_live_clips(text);
drop function if exists public.set_live_clip_status(uuid,text,integer);
drop function if exists public.adjust_live_clip(uuid,numeric,numeric,integer);
drop function if exists public.sync_live_clips(text,jsonb);
drop function if exists public.set_live_match(text,text,uuid,integer);
drop function if exists public.get_admin_live_state(text);
drop function if exists public.get_public_live_replays(text);
drop function if exists public.get_public_live_match(text);
drop function if exists public.hosted_tournament_live_sync_auto(uuid);
drop function if exists public.hosted_tournament_live_on_air(uuid);
drop function if exists public.hosted_tournament_live_stage_is_public(uuid,text);
drop function if exists public.hosted_tournament_live_match_snapshot(uuid,integer);

drop table if exists public.hosted_tournament_live_clips;
drop table if exists public.hosted_tournament_live_segments;
drop table if exists public.hosted_tournament_live_state;

notify pgrst, 'reload schema';

commit;
