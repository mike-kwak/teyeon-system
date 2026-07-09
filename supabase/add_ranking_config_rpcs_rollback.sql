-- =============================================================================
-- ROLLBACK — add_ranking_config_rpcs.sql
--   publish_ranking_config RPC 제거. ranking_config 데이터는 유지된다(테이블 롤백은 별도 파일).
--   제거 후에는 코드가 publish 시 RPC 부재를 감지해 안전 실패(기존 published 유지, 앱 무장애).
-- =============================================================================

drop function if exists public.publish_ranking_config(text,int,int,int,int,int,int,int,text);

notify pgrst, 'reload schema';
