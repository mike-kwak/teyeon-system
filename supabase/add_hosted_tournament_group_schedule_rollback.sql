-- ============================================================================
--  2026 TEYEON OPEN — 예선 조별 일정 안내 롤백
--
--  대상: add_hosted_tournament_group_schedule.sql
--  ⚠ 새로 만든 함수 4개와 테이블 2개만 삭제한다. 기존 함수 · 테이블은 원래 바뀐 것이 없으므로 복원할 것도 없다.
--  ⚠ 입력해 둔 조별 순서 · 예정 코트 · 공통 신고 안내가 사라진다(변경 이력은 감사 로그에 남는다).
--  ⚠ 조편성 · 경기 · 대진 · 체크인 · 현장 운영자 · DRAW 공개 상태에는 영향이 없다.
-- ============================================================================

begin;

drop function if exists public.get_public_group_schedule(text);
drop function if exists public.set_group_schedule(text, integer, integer, integer);
drop function if exists public.set_schedule_settings(text, text, text, text, text, text, text, text);
drop function if exists public.get_admin_group_schedule(text);
drop table if exists public.hosted_tournament_group_schedules;
drop table if exists public.hosted_tournament_schedule_settings;

notify pgrst, 'reload schema';

commit;
