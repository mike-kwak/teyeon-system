-- =============================================================================
-- TEYEON Analytics — analytics_events 운영 migration (최종안)
--
-- 상태(STATUS):
--   * DRAFT / APPLY ONLY AFTER APPROVAL — 사용자 명시 승인 전 실행 금지.
--   * 운영 DB 미적용 — 이 스크립트는 운영 Supabase 에서 실행된 적 없음.
--   * 생성 범위(비파괴, 신규만): 테이블 public.analytics_events(+인덱스 7),
--       RLS 정책 analytics_events_admin_select(SELECT, CEO/ADMIN),
--       함수 public.track_analytics_event()(SECURITY DEFINER), 관련 grant.
--       기존 app_logs/members/profiles 등 변경·삭제 없음.
--   * rollback 파일: supabase/analytics_events_rollback.sql (RPC→정책→테이블 순 제거).
--   * 적용 전후 검증 순서:
--       (적용 전) select to_regclass('public.analytics_events'); -- NULL 이어야 미적용.
--       (적용)    본 파일 전체 실행.
--       (적용 후) 하단 "검증 SQL" 실행 → 앱에서 page_view 수신 + 비관리자 SELECT 차단 확인.
--   * 적용 후 graceful: 적용 전에도 앱은 정상(track 코어가 RPC 부재 시 조용히 비활성화).
--
-- 설계 요약:
--   * 기록은 보호 RPC track_analytics_event() 로만(직접 insert 미허용).
--   * auth_user_id 는 클라이언트가 못 보냄 → 서버가 auth.uid() 로 설정(스푸핑 불가).
--   * anon 은 auth_user_id NULL 만. 비로그인일 때만 anonymous_id 저장.
--   * SELECT 는 CEO/ADMIN 만(profiles.role). INSERT/UPDATE/DELETE 클라이언트 차단.
--   * IP/fingerprint/전화번호/이메일/위치 미저장. 원시 path 는 토큰/UUID 제거 후 저장(클라이언트 sanitizeRawPath).
-- =============================================================================

-- 1) 테이블 -------------------------------------------------------------------
create table if not exists public.analytics_events (
    id              uuid primary key default gen_random_uuid(),
    event_name      text not null,
    path            text,
    normalized_path text,
    auth_user_id    uuid references auth.users(id) on delete set null,
    anonymous_id    uuid,
    user_type       text not null default 'UNKNOWN',
    session_id      uuid not null,
    event_date      date not null default current_date,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now()
);

create index if not exists idx_ae_created_at      on public.analytics_events (created_at desc);
create index if not exists idx_ae_event_date      on public.analytics_events (event_date);
create index if not exists idx_ae_auth_user       on public.analytics_events (auth_user_id);
create index if not exists idx_ae_anon            on public.analytics_events (anonymous_id);
create index if not exists idx_ae_session         on public.analytics_events (session_id);
create index if not exists idx_ae_normalized_path on public.analytics_events (normalized_path);
create index if not exists idx_ae_event_name      on public.analytics_events (event_name);

-- 2) RLS ----------------------------------------------------------------------
alter table public.analytics_events enable row level security;

-- SELECT: CEO/ADMIN 만(profiles.role). id 또는 email 매칭(AuthContext fallback 과 정합).
drop policy if exists analytics_events_admin_select on public.analytics_events;
create policy analytics_events_admin_select
    on public.analytics_events for select to authenticated
    using (
        exists (
            select 1 from public.profiles pr
            where (pr.id = auth.uid() or pr.email = (auth.jwt() ->> 'email'))
              and upper(pr.role) in ('CEO', 'ADMIN')
        )
    );

-- INSERT/UPDATE/DELETE: 클라이언트 정책 없음 → 전면 차단. INSERT 는 SECURITY DEFINER RPC 로만.

-- grant: anon 은 테이블 직접 권한 없음. authenticated 는 RLS 게이트된 select 만.
--   PUBLIC 포함 모든 기본 grant 제거 후 최소 권한만 부여.
revoke all on public.analytics_events from public, anon, authenticated;
grant select on public.analytics_events to authenticated;

-- 3) 기록 RPC -----------------------------------------------------------------
create or replace function public.track_analytics_event(
    p_event_name      text,
    p_path            text,
    p_normalized_path text,
    p_anonymous_id    uuid,
    p_user_type       text,
    p_session_id      uuid,
    p_metadata        jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_type text := upper(coalesce(p_user_type, 'UNKNOWN'));
    v_meta jsonb := p_metadata;
begin
    -- 이벤트 allowlist
    if p_event_name not in (
        'page_view', 'attendance_submit', 'guest_pass_view',
        'kdk_view', 'live_court_view', 'archive_view'
    ) then
        return;
    end if;

    -- 관리자/내부 경로 슬러그 방어(클라이언트가 우회해도 서버에서 제외).
    if coalesce(p_normalized_path, '') in ('excluded', 'display_board') then
        return;
    end if;

    -- user_type allowlist
    if v_type not in ('MEMBER', 'GUEST', 'PUBLIC', 'UNKNOWN', 'INTERNAL') then
        v_type := 'UNKNOWN';
    end if;

    if p_session_id is null then
        return;
    end if;

    -- 크기 가드(남용 방지)
    if length(coalesce(p_path, '')) > 512 then
        p_path := left(p_path, 512);
    end if;
    if v_meta is null or jsonb_typeof(v_meta) <> 'object' then
        v_meta := '{}'::jsonb;
    end if;
    if length(v_meta::text) > 2048 then
        v_meta := '{}'::jsonb;
    end if;

    insert into public.analytics_events (
        event_name, path, normalized_path,
        auth_user_id, anonymous_id, user_type, session_id, metadata
    ) values (
        p_event_name, p_path, p_normalized_path,
        v_uid,                                                  -- 서버 검증 UID(스푸핑 불가)
        case when v_uid is null then p_anonymous_id else null end, -- 로그인 시 anon 미저장
        v_type, p_session_id, v_meta
    );
end;
$$;

-- 함수 기본 grant(PUBLIC EXECUTE)를 제거하고 anon/authenticated 에만 명시 부여.
revoke all on function public.track_analytics_event(text, text, text, uuid, text, uuid, jsonb) from public;
grant execute on function public.track_analytics_event(text, text, text, uuid, text, uuid, jsonb)
    to anon, authenticated;

-- =============================================================================
-- 검증 SQL(적용 후 별도 실행 — 참고용):
--   select count(*) from public.analytics_events;                       -- 0 으로 시작
--   -- anon 세션에서 RPC 호출 후:
--   select event_name, normalized_path, user_type, auth_user_id, anonymous_id
--     from public.analytics_events order by created_at desc limit 20;
--   -- 비관리자 select 차단 확인(권한 오류여야 정상).
--   -- 관리자 계정 select 정상 확인.
-- =============================================================================
