-- =============================================================================
-- TEYEON KDK FINAL REPORT — rollback   [승인 전 운영 실행 금지]
--   add_kdk_final_report.sql 이 만든 신규 객체만 제거한다. Archive · Ranking · Finance · SPOTLIGHT 무영향.
--   ⚠ kdk_final_reports 의 운영진 문구 · 발행본도 함께 삭제된다(필요하면 먼저 백업).
-- =============================================================================
drop function if exists public.get_public_kdk_final_report(text);
drop function if exists public.unpublish_kdk_final_report(text, uuid);
drop function if exists public.publish_kdk_final_report(text, uuid, jsonb, text, integer);
drop function if exists public.save_kdk_final_report_draft(text, text, uuid, jsonb, text);
drop function if exists public.get_kdk_final_report_source(text, uuid);
drop function if exists public.kdk_final_report_signature(jsonb);
drop function if exists public.kdk_fr_key(text, text);
drop function if exists public.kdk_fr_group(text);
drop function if exists public.kdk_fr_int(jsonb);
drop table if exists public.kdk_final_reports;
