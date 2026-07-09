-- =============================================================================
-- ROLLBACK — add_ranking_config.sql
--   ranking_config 테이블(+정책/인덱스)을 제거한다.
--   ⚠️ 데이터 손실: 저장된 산식 버전 이력(draft/published/archived) 전부 삭제된다. 필요 시 백업:
--     -- create table _bak_ranking_config as table public.ranking_config;
--   제거 후 앱은 코드의 현재 고정 산식(기본값)으로 정상 동작한다(config 미존재 폴백).
-- =============================================================================

drop table if exists public.ranking_config;   -- 정책/인덱스는 테이블과 함께 제거됨

notify pgrst, 'reload schema';
