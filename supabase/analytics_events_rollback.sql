-- =============================================================================
-- TEYEON Analytics — analytics_events rollback
--
-- 상태: DRAFT ONLY · 운영 DB 미적용 · 승인 전 실행 금지.
-- analytics_events_migration.sql 을 되돌린다. 비파괴(다른 테이블 영향 없음).
-- 주의: 테이블 drop 시 수집된 분석 이벤트가 삭제된다. 보존이 필요하면 먼저 백업.
-- =============================================================================

-- 1) RPC 제거
drop function if exists public.track_analytics_event(text, text, text, uuid, text, uuid, jsonb);

-- 2) 정책 제거
drop policy if exists analytics_events_admin_select on public.analytics_events;

-- 3) 테이블 제거(인덱스 동반 삭제)
drop table if exists public.analytics_events;

-- =============================================================================
-- 데이터만 비우고 구조는 유지하려면 위 대신:
--   truncate table public.analytics_events;
-- =============================================================================
