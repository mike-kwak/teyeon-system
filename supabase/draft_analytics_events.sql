-- =============================================================================
-- DRAFT ONLY — 적용하지 마세요 (DO NOT APPLY)
--
-- 상태(STATUS):
--   * DRAFT ONLY — 설계 초안.
--   * 운영 DB 미적용 — 이 스크립트는 운영 DB 에서 실행된 적 없음(실행 금지).
--   * 별도 승인 후 적용 — 적용은 다음 단계에서 별도 승인 후에만 진행.
--   * 현재 Analytics 화면은 기존 app_logs 기반 — /admin/analytics 는 이 테이블이
--     아니라 기존 app_logs + members.age 로만 동작(이 파일과 무관하게 작동).
--
-- TEYEON Analytics 정확 집계를 위한 이벤트 수집 구조 초안.
-- 현재 app_logs 는 관리자 감사 + 일부 콘텐츠 행동만 담고 페이지 방문이 없어
-- 방문자/방문수/인기 메뉴/재방문율을 신뢰성 있게 집계할 수 없음.
-- 아래는 "보고용 초안"이며 승인 전 운영 DB 에 실행하지 않는다.
-- 기존 app_logs / 데이터에는 영향 없음(신규 테이블 추가 방식, 비파괴).
-- =============================================================================

-- 1) 일반 사용 분석 이벤트 (페이지 방문 + 행동) ------------------------------------
create table if not exists public.analytics_events (
    id          bigint generated always as identity primary key,
    occurred_at timestamptz not null default now(),
    user_id     uuid,                 -- 로그인 사용자(auth uid). 공개 사용자는 null.
    anon_id     text,                 -- 익명 세션 식별자(쿠키/localStorage UUID). IP/fingerprint 금지.
    user_type   text,                 -- 'MEMBER' | 'GUEST' | 'PUBLIC' | 'UNKNOWN'
    event       text not null,        -- 'page_view' | 'attendance_done' | 'kdk_view' ...
    path        text,                 -- 정규화 전 원시 경로(서버에서 메뉴 정규화)
    menu        text,                 -- 정규화된 메뉴명(선택)
    metadata    jsonb default '{}'::jsonb
);
create index if not exists idx_analytics_events_time on public.analytics_events (occurred_at desc);
create index if not exists idx_analytics_events_user on public.analytics_events (user_id);
create index if not exists idx_analytics_events_event on public.analytics_events (event);

-- 2) 관리자 감사 로그 분리 ----------------------------------------------------------
--    role_changed / profile_role_changed 등은 일반 사용 분석과 섞이면 안 됨.
create table if not exists public.admin_audit_logs (
    id          bigint generated always as identity primary key,
    occurred_at timestamptz not null default now(),
    actor_id    uuid,                 -- 행위자(관리자)
    action      text not null,        -- 'role_changed' | 'profile_role_changed' | ...
    target      text,                 -- 대상(닉네임/식별자)
    metadata    jsonb default '{}'::jsonb
);
create index if not exists idx_admin_audit_time on public.admin_audit_logs (occurred_at desc);

-- 3) RLS — CEO/ADMIN 만 읽기. insert 는 클라이언트(익명 포함) 허용하되 select 는 제한.
--    (실제 정책 문구는 기존 profiles role 판정 함수와 정합되게 별도 검토 필요)
-- alter table public.analytics_events enable row level security;
-- alter table public.admin_audit_logs enable row level security;
-- (정책 예시는 승인 후 finance RLS 패턴에 맞춰 작성)

-- 4) 회원 성별(선택) — 성별 분포가 필요할 경우에만.
-- alter table public.members add column if not exists gender text; -- 'M' | 'F' | 'OTHER' | null

-- =============================================================================
-- 마이그레이션 시 앱 변경(별도):
--   * lib/logging.ts → page_view 등 analytics_events insert 추가(no-await, 무영향)
--   * 익명 세션 식별자(anon_id) 발급(쿠키/localStorage). IP·fingerprint 사용 안 함.
--   * 감사 액션은 admin_audit_logs 로 분리 기록.
--   * lib/analytics/analyticsService.ts → 소스 테이블을 analytics_events 로 전환.
-- =============================================================================
