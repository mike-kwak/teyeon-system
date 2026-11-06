-- =============================================================================
-- ROLLBACK — add_kdk_match_spotlight.sql (v2.1)
-- ⚠️ 초안. 승인 후 실행. trigger 를 가장 먼저 제거해 KDK matches 를 원상태로 되돌린다.
--    matches 의 데이터·컬럼·기존 trigger/RPC 는 건드리지 않는다.
--    예측·공개 기록은 삭제된다 — 보존이 필요하면 실행 전 백업:
--      create table backup_kdk_spotlight_runs as table public.kdk_spotlight_runs;
--      create table backup_kdk_match_predictions as table public.kdk_match_predictions;
-- =============================================================================
begin;

set local lock_timeout = '3s';   -- matches 잠금을 오래 기다리며 KDK 쓰기를 막지 않는다(실패 시 재실행)

drop trigger if exists kdk_match_lifecycle_recert_trg on public.matches;
drop trigger if exists kdk_match_lifecycle_status_trg on public.matches;
drop trigger if exists kdk_match_lifecycle_insert_trg on public.matches;
drop function if exists public.kdk_match_lifecycle_recert();
drop function if exists public.kdk_match_lifecycle_capture();

drop function if exists public.get_public_kdk_spotlight_link(text);
drop function if exists public.get_public_kdk_spotlight(text);
drop function if exists public.get_kdk_spotlight_admin(text);
drop function if exists public.unpublish_kdk_spotlight_run(text, text, uuid);
drop function if exists public.publish_kdk_spotlight_run(uuid, uuid, jsonb, text[]);
drop function if exists public.get_kdk_spotlight_run_for_publish(uuid, uuid);
drop function if exists public.save_kdk_spotlight_run(text, text, uuid, jsonb, jsonb);
drop function if exists public.kdk_spotlight_match_block_reason(text, text);
drop function if exists public.kdk_spotlight_match_block_reason(text, text, xid);
drop function if exists public.kdk_spotlight_ledger_healthy();
drop function if exists public.kdk_spotlight_is_admin(uuid);

drop table if exists public.kdk_match_predictions;
drop table if exists public.kdk_spotlight_runs;
drop table if exists public.kdk_match_lifecycle_faults;
drop table if exists public.kdk_match_lifecycle;

commit;
