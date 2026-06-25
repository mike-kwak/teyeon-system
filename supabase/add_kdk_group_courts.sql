-- ────────────────────────────────────────────────────────────────────────────
-- KDK 조별 전용 코트 운영 — kdk_session_meta.group_courts (jsonb)
--
-- 목적:
--   세션별로 A/B(이상) 조마다 사용할 코트를 지정한다. 지정이 있으면 경기 투입 시
--   start_kdk_match RPC 가 그 조의 코트 목록 안에서만 빈 최저 코트를 배정한다.
--   지정이 없거나 비활성이면 기존처럼 전체 코트에서 빈 최저 코트를 자동 배정한다.
--
-- 저장 구조(래핑형) — 활성 플래그로 "비활성(fallback)" 과 "활성인데 특정 조 누락(차단)"
-- 을 명확히 구분한다:
--   { "enabled": true, "groups": { "A": [1,2], "B": [3,4] } }
--   - enabled=false 또는 {} (빈 객체) → 전체 코트 자동 배정 fallback
--   - enabled=true 인데 해당 조 배열이 없으면 → RPC 가 group_court_config_missing 반환
--
-- 기본값 {} → 기존 세션은 설정 없음으로 동작(영향 없음).
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행. idempotent — 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.kdk_session_meta
  add column if not exists group_courts jsonb not null default '{}'::jsonb;

comment on column public.kdk_session_meta.group_courts is
$$KDK 세션 조별 전용 코트 설정. 래핑형 jsonb: {"enabled": true, "groups": {"A": [int...], "B": [int...]}}. 기본값 {} = 미설정(전체 코트 자동 배정). start_kdk_match RPC가 참조.$$;
