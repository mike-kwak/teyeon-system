-- =============================================================================
-- 검증 SQL — add_guest_application_notifications.sql 적용 후 확인.
--   A 부: 읽기 전용 구조 점검(그대로 실행).
--   B 부: claim 상태 머신 실검증 — BEGIN … ROLLBACK 으로 운영 데이터를 남기지 않는다.
-- =============================================================================

-- ── A-1. 테이블/유니크/CHECK ──────────────────────────────────────────────────
select table_name from information_schema.tables
 where table_schema = 'public' and table_name = 'guest_application_notifications';  -- 기대 1행

select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid = 'public.guest_application_notifications'::regclass and contype = 'u';
-- 기대: unique (application_id, notification_type)

select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid = 'public.guest_application_notifications'::regclass and contype = 'c'
 order by conname;
-- 기대: status(pending/sent/failed) · notification_type(public_guest_application_created)
--       · attempts between 0 and 10

-- ── A-2. RLS 활성 + anon/authenticated 직접 쓰기 불가 ─────────────────────────
select relrowsecurity from pg_class where relname = 'guest_application_notifications';  -- true
select grantee, privilege_type from information_schema.role_table_grants
 where table_name = 'guest_application_notifications' and grantee in ('anon', 'authenticated')
 order by grantee, privilege_type;
-- 기대: anon 0행 · authenticated 는 SELECT 만(정책으로 운영진 한정)

select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'guest_application_notifications'
 order by policyname;
-- 기대: guest_app_notifications_select_manager (SELECT) 1건 — INSERT/UPDATE/DELETE 정책 없음

-- ── A-3. RPC 2종 — SECURITY DEFINER + search_path + 실행 권한 ─────────────────
select p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_pending_guest_application_count', 'claim_guest_application_notification')
 order by p.proname;
-- 기대: prosecdef=true, search_path=public,pg_temp (2행)

select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated','service_role')) r
 where n.nspname = 'public'
   and p.proname in ('get_pending_guest_application_count', 'claim_guest_application_notification')
 order by p.proname, r.rolname;
-- 기대: get_pending_...  → anon=f, authenticated=t, service_role=t(멤버십에 따라 t)
--       claim_...        → anon=f, authenticated=f, service_role=t

-- ── A-4. 실계정 확인(수동 · 각 세션에서) ─────────────────────────────────────
--   · CEO/ADMIN/OPERATOR: select public.get_pending_guest_application_count(); → 실제 pending 수
--   · MEMBER:             같은 호출 → 0 / guest_application_notifications 직접 SELECT → 0행
--   · FINANCE_MANAGER 단독: 같은 호출 → 0
--   · anon:               두 RPC 모두 실행 오류(permission denied)
--   · authenticated 로 claim_... 호출 → permission denied

-- =============================================================================
-- B. claim 상태 머신 실검증 — 전체가 ROLLBACK 되어 운영 데이터가 남지 않는다.
--    아래 블록을 통째로 실행(BEGIN~ROLLBACK). NOTICE 로 PASS/FAIL 출력.
-- =============================================================================
begin;

do $verify$
declare
    v_schedule uuid;
    v_rec      uuid;
    v_app      uuid;
    r          jsonb;
    fail_cnt   int := 0;
begin
    -- 테스트용 신청 체인(기존 정모 1건 재사용, 전부 rollback 됨)
    select id into v_schedule from public.club_schedules limit 1;
    if v_schedule is null then
        raise notice 'SKIP: club_schedules 가 비어 있어 상태 머신 테스트를 건너뜁니다.';
        return;
    end if;
    select id into v_rec from public.guest_recruitments where schedule_id = v_schedule;
    if v_rec is null then
        insert into public.guest_recruitments (public_token, schedule_id, status)
        values ('VERIFY_TEST_TOKEN_' || substr(md5(random()::text), 1, 8), v_schedule, 'open')
        returning id into v_rec;
    end if;
    insert into public.guest_applications
        (recruitment_id, schedule_id, name, phone, phone_normalized, region,
         affiliation_type, club_name, tennis_experience, privacy_consent, status, source_type)
    values (v_rec, v_schedule, 'VERIFY테스트', '010-0000-0000', '0100000' || substr(md5(random()::text), 1, 4),
            '검증', 'independent', '무소속', '검증', true, 'pending', 'public_application')
    returning id into v_app;

    -- 1) 최초 claim → claimed=true, attempts=1
    r := public.claim_guest_application_notification(v_app);
    if (r->>'claimed')::boolean and (r->>'attempts')::int = 1 then
        raise notice 'PASS 1: 최초 claim 성공(attempts=1)';
    else fail_cnt := fail_cnt + 1; raise notice 'FAIL 1: %', r; end if;

    -- 2) 최근 pending 재claim → 실패(recently_claimed)
    r := public.claim_guest_application_notification(v_app);
    if not (r->>'claimed')::boolean and r->>'reason' = 'recently_claimed' then
        raise notice 'PASS 2: 최근 pending 재claim 차단';
    else fail_cnt := fail_cnt + 1; raise notice 'FAIL 2: %', r; end if;

    -- 3) 오래된 pending(>5분) → 재claim 가능, attempts=2
    update public.guest_application_notifications
       set updated_at = now() - interval '10 minutes' where application_id = v_app;
    r := public.claim_guest_application_notification(v_app);
    if (r->>'claimed')::boolean and (r->>'attempts')::int = 2 then
        raise notice 'PASS 3: 오래된 pending 재claim(attempts=2)';
    else fail_cnt := fail_cnt + 1; raise notice 'FAIL 3: %', r; end if;

    -- 4) failed(attempts<3) → 재claim 가능, attempts=3
    update public.guest_application_notifications
       set status = 'failed', last_error = 'resend_500', updated_at = now() - interval '1 minute'
     where application_id = v_app;
    r := public.claim_guest_application_notification(v_app);
    if (r->>'claimed')::boolean and (r->>'attempts')::int = 3 then
        raise notice 'PASS 4: failed(attempts<3) 재claim(attempts=3)';
    else fail_cnt := fail_cnt + 1; raise notice 'FAIL 4: %', r; end if;

    -- 5) attempts>=3 → 재claim 실패(max_attempts) — stale 상태로 만들어도 차단되어야 함
    update public.guest_application_notifications
       set status = 'failed', updated_at = now() - interval '10 minutes' where application_id = v_app;
    r := public.claim_guest_application_notification(v_app);
    if not (r->>'claimed')::boolean and r->>'reason' = 'max_attempts' then
        raise notice 'PASS 5: attempts>=3 재claim 차단(max_attempts)';
    else fail_cnt := fail_cnt + 1; raise notice 'FAIL 5: %', r; end if;

    -- 6) sent → 재claim 실패(already_sent)
    update public.guest_application_notifications
       set status = 'sent', attempts = 1, sent_at = now(), last_error = null,
           updated_at = now() - interval '10 minutes'
     where application_id = v_app;
    r := public.claim_guest_application_notification(v_app);
    if not (r->>'claimed')::boolean and r->>'reason' = 'already_sent' then
        raise notice 'PASS 6: sent 재claim 차단(재발송 금지)';
    else fail_cnt := fail_cnt + 1; raise notice 'FAIL 6: %', r; end if;

    if fail_cnt = 0 then raise notice '=== 상태 머신 6/6 PASS (전부 rollback 예정) ===';
    else raise notice '=== FAIL % 건 — 운영 적용 중단 후 보고 ===', fail_cnt; end if;
end;
$verify$;

rollback;  -- 테스트 데이터(정모 재사용분 포함 신청/알림) 전부 취소 — 운영 데이터 무변경
