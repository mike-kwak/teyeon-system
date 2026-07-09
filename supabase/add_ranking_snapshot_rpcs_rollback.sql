-- =============================================================================
-- ROLLBACK — add_ranking_snapshot_rpcs.sql
--   finalize/reopen RPC 제거. ranking_snapshots 데이터는 유지(테이블 롤백은 별도 파일).
--   제거 후 코드는 RPC 부재를 감지해 안전 실패(기존 snapshot 유지, 앱 무장애 — live 계산 지속).
-- =============================================================================

drop function if exists public.finalize_ranking_season(text,text,uuid,int,jsonb,int,int,text,text,text);
drop function if exists public.reopen_ranking_season(text,text);

notify pgrst, 'reload schema';
