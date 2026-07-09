-- =============================================================================
-- ROLLBACK — add_ranking_snapshots.sql
--   ranking_snapshots 테이블(+정책/인덱스) 제거. RPC 는 별도 rollback 파일.
--   ⚠️ 데이터 손실: 저장된 시즌 동결 snapshot(finalized/superseded) 전부 삭제된다. 필요 시 백업:
--     -- create table _bak_ranking_snapshots as table public.ranking_snapshots;
--   제거 후 앱은 finalized snapshot 부재 → 전 시즌 live 계산으로 정상 동작(무장애 폴백).
-- =============================================================================

drop table if exists public.ranking_snapshots;

notify pgrst, 'reload schema';
