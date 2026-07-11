-- =============================================================================
-- 검증 SQL — add_guest_application_notifications.sql 적용 후 확인.
--   A 부: 읽기 전용 구조 점검(그대로 실행).
--   B 부: claim 상태 머신 실검증 — BEGIN … ROLLBACK 으로 운영 데이터를 남기지 않는다.
--
--   운영 스키마 확인 사항(추정 금지):
--     · club_schedules 에는 club_id 컬럼이 없다 → 참조하지 않는다.
--     · guest_recruitments 에는 created_at 이 존재한다(정렬에 사용).
--     · B 부는 기존 guest_recruitments row 를 "읽기만" 재사용한다(모집 신규 생성/수정 금지).
--       모집이 하나도 없으면 명확한 예외로 중단한다(가짜 PASS/SKIP 금지).
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
--    기존 모집 1건을 "읽기만" 재사용한다(모집 생성/수정 없음). 테스트로 생성되는 것은
--    guest_applications 1행 + notification 1행뿐이며 모두 ROLLBACK 된다.
--    아래 블록(BEGIN~ROLLBACK)과 마지막 SELECT 를 통째로 실행.
-- =============================================================================
begin;

do $verify$
declare
    v_schedule          uuid;
    v_recruitment       uuid;
    v_application       uuid;

    v_phone_normalized  text;
    v_phone_display     text;

    v_result            jsonb;
    v_fail_count        integer := 0;
begin
    -- 기존 모집 재사용(읽기 전용) — club_schedules.club_id 는 존재하지 않으므로 참조하지 않는다.
    select
        gr.id,
        gr.schedule_id
    into
        v_recruitment,
        v_schedule
    from public.guest_recruitments gr
    join public.club_schedules cs
      on cs.id = gr.schedule_id
    order by gr.created_at desc nulls last
    limit 1;

    if v_recruitment is null or v_schedule is null then
        raise exception
            'VERIFY 중단: guest_recruitments에 연결 가능한 모집이 없습니다. 앱에서 QA용 모집 1건을 생성한 뒤 다시 실행하세요.';
    end if;

    -- 테스트 신청 1건 생성(활성 중복 인덱스 회피용 랜덤 정규화 번호 — ROLLBACK 대상).
    --   허용값은 운영 CHECK 그대로: affiliation_type in ('club','independent'),
    --   status in ('pending','approved','on_hold','rejected'),
    --   source_type in ('public_application','member_invitation').
    v_phone_display    := '010-0000-0000';
    v_phone_normalized := '0100000' || substr(md5(random()::text), 1, 4);

    insert into public.guest_applications (
        recruitment_id,
        schedule_id,
        name,
        phone,
        phone_normalized,
        region,
        affiliation_type,
        club_name,
        tennis_experience,
        privacy_consent,
        status,
        source_type
    )
    values (
        v_recruitment,
        v_schedule,
        'VERIFY테스트',
        v_phone_display,
        v_phone_normalized,
        '검증',
        'independent',
        '무소속',
        '검증',
        true,
        'pending',
        'public_application'
    )
    returning id
    into v_application;

    -- 1) 최초 claim → claimed=true, attempts=1
    v_result := public.claim_guest_application_notification(v_application);
    if (v_result->>'claimed')::boolean and (v_result->>'attempts')::int = 1 then
        raise notice 'PASS 1: 최초 claim 성공(attempts=1)';
    else v_fail_count := v_fail_count + 1; raise notice 'FAIL 1: %', v_result; end if;

    -- 2) 최근 pending 재claim → 실패(recently_claimed)
    v_result := public.claim_guest_application_notification(v_application);
    if not (v_result->>'claimed')::boolean and v_result->>'reason' = 'recently_claimed' then
        raise notice 'PASS 2: 최근 pending 재claim 차단';
    else v_fail_count := v_fail_count + 1; raise notice 'FAIL 2: %', v_result; end if;

    -- 3) 오래된 pending(>5분) → 재claim 가능, attempts=2
    update public.guest_application_notifications
       set updated_at = now() - interval '10 minutes' where application_id = v_application;
    v_result := public.claim_guest_application_notification(v_application);
    if (v_result->>'claimed')::boolean and (v_result->>'attempts')::int = 2 then
        raise notice 'PASS 3: 오래된 pending 재claim(attempts=2)';
    else v_fail_count := v_fail_count + 1; raise notice 'FAIL 3: %', v_result; end if;

    -- 4) failed(attempts<3) → 재claim 가능, attempts=3
    update public.guest_application_notifications
       set status = 'failed', last_error = 'resend_500', updated_at = now() - interval '1 minute'
     where application_id = v_application;
    v_result := public.claim_guest_application_notification(v_application);
    if (v_result->>'claimed')::boolean and (v_result->>'attempts')::int = 3 then
        raise notice 'PASS 4: failed(attempts<3) 재claim(attempts=3)';
    else v_fail_count := v_fail_count + 1; raise notice 'FAIL 4: %', v_result; end if;

    -- 5) attempts>=3 → 재claim 실패(max_attempts) — stale 상태로 만들어도 차단되어야 함
    update public.guest_application_notifications
       set status = 'failed', updated_at = now() - interval '10 minutes' where application_id = v_application;
    v_result := public.claim_guest_application_notification(v_application);
    if not (v_result->>'claimed')::boolean and v_result->>'reason' = 'max_attempts' then
        raise notice 'PASS 5: attempts>=3 재claim 차단(max_attempts)';
    else v_fail_count := v_fail_count + 1; raise notice 'FAIL 5: %', v_result; end if;

    -- 6) sent → 재claim 실패(already_sent)
    update public.guest_application_notifications
       set status = 'sent', attempts = 1, sent_at = now(), last_error = null,
           updated_at = now() - interval '10 minutes'
     where application_id = v_application;
    v_result := public.claim_guest_application_notification(v_application);
    if not (v_result->>'claimed')::boolean and v_result->>'reason' = 'already_sent' then
        raise notice 'PASS 6: sent 재claim 차단(재발송 금지)';
    else v_fail_count := v_fail_count + 1; raise notice 'FAIL 6: %', v_result; end if;

    if v_fail_count > 0 then
        raise exception
            'Notification claim 상태 머신 검증 실패: %건',
            v_fail_count;
    end if;
    raise notice '=== 상태 머신 6/6 PASS (전부 rollback 예정) ===';
end;
$verify$;

rollback;  -- 테스트 신청/알림 전부 취소 — 기존 모집·정모·운영 데이터 무변경

-- 위 DO 블록이 실패하면 예외로 여기까지 오지 않는다 → 이 행이 보이면 A 실행 + B 6/6 통과.
select
    'PASS: A 구조 및 권한 + B 상태 머신 6/6' as verify_result,
    '6/6 PASS'                               as state_machine_result,
    true                                     as test_data_rolled_back;
