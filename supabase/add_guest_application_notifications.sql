-- =============================================================================
-- PUBLIC_GUEST 신규 신청 알림 — (1) 검토대기 count RPC + (2) 알림 outbox + (3) 원자적 claim RPC.
--
--   목적: 운영진이 관리 화면을 열지 않아도 신규 신청을 인지.
--     · Admin 배지: 검토 대기(status='pending') 건수 — count 전용 RPC(개인정보 미반환, 숫자만).
--     · 이메일 알림: 신청 저장과 분리된 outbox + 원자적 claim 으로 idempotent 발송
--       (실제 발송은 Supabase Edge Function guest-application-notify, Database Webhook 트리거).
--
--   상태 머신(최대 3회):
--     row 없음                          → pending/attempts=1 생성 + claim
--     sent                              → claim 실패(재발송 금지)
--     attempts >= 3                     → claim 실패(최종 상태 유지)
--     pending & 최근(5분 이내)          → claim 실패(다른 실행이 처리 중일 수 있음)
--     pending & 오래됨(5분 초과)        → attempts+1 후 claim(이전 실행 중단 복구)
--     failed  & attempts < 3            → pending 전환·attempts+1 후 claim(웹훅 재호출/수동 복구)
--
--   보안: 원본 guest_applications anon 차단은 변경하지 않는다. outbox 는 운영진 SELECT 만,
--         쓰기·claim 은 Edge Function(service_role)만. 공개 사용자는 알림 상태 조회 불가.
--
--   선행 의존: guest_applications, can_manage_guest_applications()
--             (supabase/add_guest_recruitments_applications.sql 적용 필요).
--
--   ⚠️ 사용자 승인 후 Supabase SQL Editor 에서 1회 실행. 앱은 이 객체 없이도 동작한다
--      (배지 숨김, 알림 미기록). Edge Function/Webhook/secret 은 별도 적용(함수 README 참조).
--   rollback: supabase/add_guest_application_notifications_rollback.sql
--   verify  : supabase/add_guest_application_notifications_verify.sql
-- =============================================================================

-- ── 1. 검토 대기 건수 RPC (Admin 배지) ─────────────────────────────────────────
--   · can_manage_guest_applications() 서버 재검증 → 운영진(CEO/ADMIN/OPERATOR)만 실제 count.
--   · 그 외(MEMBER, FINANCE_MANAGER 단독)는 0. anon 은 실행 자체 불가(revoke).
--   · 개인정보 미반환 — 정수 하나만.
create or replace function public.get_pending_guest_application_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case
        when public.can_manage_guest_applications()
            then (select count(*)::int from public.guest_applications where status = 'pending')
        else 0
    end;
$$;
revoke execute on function public.get_pending_guest_application_count() from public;
revoke execute on function public.get_pending_guest_application_count() from anon;
grant  execute on function public.get_pending_guest_application_count() to authenticated;

-- ── 2. 알림 outbox 테이블 ──────────────────────────────────────────────────────
--   idempotency = unique(application_id, notification_type). 같은 신청·같은 타입 알림 1건.
create table if not exists public.guest_application_notifications (
    id                uuid        primary key default gen_random_uuid(),
    application_id    uuid        not null references public.guest_applications(id) on delete cascade,
    notification_type text        not null default 'public_guest_application_created'
                                  check (notification_type in ('public_guest_application_created')),
    status            text        not null default 'pending'
                                  check (status in ('pending', 'sent', 'failed')),
    attempts          int         not null default 0 check (attempts between 0 and 10),
    sent_at           timestamptz,
    last_error        text,       -- 민감정보 제외한 짧은 오류 코드만(resend_500 / network_error 등)
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (application_id, notification_type)
);
comment on table public.guest_application_notifications is
    'PUBLIC_GUEST 신규 신청 이메일 알림 outbox(idempotent). claim/쓰기는 Edge Function(service_role)만.';
create index if not exists guest_app_notifications_status_idx
    on public.guest_application_notifications (status);

-- ── 3. RLS — 운영진 SELECT 만. 쓰기는 service_role(Edge Function, RLS bypass)만. ──
alter table public.guest_application_notifications enable row level security;
revoke all on table public.guest_application_notifications from anon;
revoke all on table public.guest_application_notifications from authenticated;
grant  select on table public.guest_application_notifications to authenticated;   -- 정책으로 운영진 한정
grant  select, insert, update, delete on table public.guest_application_notifications to service_role;

drop policy if exists guest_app_notifications_select_manager on public.guest_application_notifications;
create policy guest_app_notifications_select_manager on public.guest_application_notifications
    for select to authenticated
    using (public.can_manage_guest_applications());
-- INSERT/UPDATE/DELETE 정책 없음 → authenticated 직접 쓰기 불가. service_role 만 기록(RLS bypass).

-- ── 4. 원자적 claim RPC (Edge Function 전용) ──────────────────────────────────
--   동시 Webhook 2건이 같은 알림을 중복 발송하지 않도록 INSERT ON CONFLICT + row lock(FOR UPDATE)
--   으로 단일 문/단일 트랜잭션 안에서 판정한다. 클라이언트 select→판단→update 경쟁조건 금지.
create or replace function public.claim_guest_application_notification(
    p_application_id    uuid,
    p_notification_type text default 'public_guest_application_created'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row           public.guest_application_notifications%rowtype;
    c_stale         constant interval := interval '5 minutes';  -- 최근 pending 기준(문서화된 상수)
    c_max_attempts  constant int      := 3;                     -- 최대 발송 시도
begin
    if p_application_id is null then
        return jsonb_build_object('claimed', false, 'reason', 'missing_application_id');
    end if;

    -- 1) 최초 알림: 생성 + claim(attempts=1). 동시 INSERT 는 한쪽만 성공(on conflict do nothing).
    insert into public.guest_application_notifications (application_id, notification_type, status, attempts)
    values (p_application_id, p_notification_type, 'pending', 1)
    on conflict (application_id, notification_type) do nothing
    returning * into v_row;
    if v_row.id is not null then
        return jsonb_build_object('claimed', true, 'notification_id', v_row.id,
                                  'status', v_row.status, 'attempts', v_row.attempts);
    end if;

    -- 2) 기존 행: row lock 으로 동시 claim 직렬화 후 상태 판정.
    select * into v_row
      from public.guest_application_notifications
     where application_id = p_application_id and notification_type = p_notification_type
       for update;

    if v_row.id is null then
        -- 극단적 경합(동시 삭제 등) — 발송하지 않는 쪽으로 fail closed.
        return jsonb_build_object('claimed', false, 'reason', 'not_found');
    end if;
    if v_row.status = 'sent' then
        return jsonb_build_object('claimed', false, 'reason', 'already_sent',
                                  'notification_id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts);
    end if;
    if v_row.attempts >= c_max_attempts then
        return jsonb_build_object('claimed', false, 'reason', 'max_attempts',
                                  'notification_id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts);
    end if;
    if v_row.status = 'pending' and v_row.updated_at > now() - c_stale then
        -- 다른 함수 실행이 처리 중일 수 있음 — 중복 실행 금지.
        return jsonb_build_object('claimed', false, 'reason', 'recently_claimed',
                                  'notification_id', v_row.id, 'status', v_row.status, 'attempts', v_row.attempts);
    end if;

    -- 3) 복구 claim: 오래된 pending(중단 복구) 또는 failed(attempts<3) → attempts+1.
    update public.guest_application_notifications
       set status = 'pending', attempts = v_row.attempts + 1, updated_at = now()
     where id = v_row.id
    returning * into v_row;
    return jsonb_build_object('claimed', true, 'notification_id', v_row.id,
                              'status', v_row.status, 'attempts', v_row.attempts);
end;
$$;
revoke execute on function public.claim_guest_application_notification(uuid, text) from public;
revoke execute on function public.claim_guest_application_notification(uuid, text) from anon;
revoke execute on function public.claim_guest_application_notification(uuid, text) from authenticated;
grant  execute on function public.claim_guest_application_notification(uuid, text) to service_role;

-- ── 5. 발송 결과 기록 ─────────────────────────────────────────────────────────
--   Edge Function 이 service_role 로 직접 UPDATE 한다(RLS bypass + 위 grant).
--     성공: status='sent',   sent_at=now(), last_error=null, updated_at=now()
--     실패: status='failed', last_error=<짧은 코드>,          updated_at=now()
--   attempts 는 claim 시 증가한 값을 유지(결과 기록에서 변경하지 않음).

notify pgrst, 'reload schema';
