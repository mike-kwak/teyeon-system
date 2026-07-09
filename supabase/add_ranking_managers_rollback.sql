-- =============================================================================
-- ROLLBACK — add_ranking_managers.sql
--   can_manage_ranking() helper + ranking_managers 테이블 제거.
--   ⚠️ 데이터 손실: ranking_managers 등재 행(부여 이력)이 삭제된다. 필요 시 먼저 백업:
--     -- create table _bak_ranking_managers as table public.ranking_managers;
--   profiles.role 은 이 마이그레이션이 건드린 적 없으므로 원복 대상 아님(무변경 보존).
-- =============================================================================

drop function if exists public.can_manage_ranking();
drop table if exists public.ranking_managers;

notify pgrst, 'reload schema';
