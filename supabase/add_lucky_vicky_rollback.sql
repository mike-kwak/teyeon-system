-- =============================================================================
-- ROLLBACK — add_lucky_vicky.sql 되돌리기.
--   정책 → trigger → 함수 → 인덱스 → 테이블(teams 먼저: rounds 를 FK 참조) 순으로 제거.
-- ⚠ 주의: 실제 러키비키 데이터가 입력된 상태에서 실행하면 회차/팀 데이터가 모두 삭제된다.
-- =============================================================================

-- 정책
drop policy if exists lucky_vicky_teams_delete  on public.lucky_vicky_teams;
drop policy if exists lucky_vicky_teams_update  on public.lucky_vicky_teams;
drop policy if exists lucky_vicky_teams_insert  on public.lucky_vicky_teams;
drop policy if exists lucky_vicky_teams_select  on public.lucky_vicky_teams;
drop policy if exists lucky_vicky_rounds_delete on public.lucky_vicky_rounds;
drop policy if exists lucky_vicky_rounds_update on public.lucky_vicky_rounds;
drop policy if exists lucky_vicky_rounds_insert on public.lucky_vicky_rounds;
drop policy if exists lucky_vicky_rounds_select on public.lucky_vicky_rounds;

-- trigger + 함수
drop trigger  if exists lucky_vicky_teams_guard_trg on public.lucky_vicky_teams;
drop function if exists public.lucky_vicky_teams_guard();

-- 테이블(teams → rounds)
drop table if exists public.lucky_vicky_teams;
drop table if exists public.lucky_vicky_rounds;

notify pgrst, 'reload schema';
