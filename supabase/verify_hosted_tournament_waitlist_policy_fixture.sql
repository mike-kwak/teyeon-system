-- ============================================================================
--  2026 TEYEON OPEN — 정원 / 대기팀 정책 실동작 self-test (fixture)
--
--  임시 대회 2개(zz-fixture-waitlist-selftest / -small)에서 **실제 RPC** 로 검증한다.
--    submit_tournament_registration · set_tournament_registration_status ·
--    promote_waitlisted_tournament_registration · get_public_tournament ·
--    get_public_tournament_teams · get_admin_tournament_registrations
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--    (마지막에 2026-teyeon-open 의 행 수 · 상태 분포가 시작 시점과 같은지도 확인한다.)
--  ⚠ 가짜 선수 이름은 'ZZ…', 전화는 010-9xxx / 010-8xxx 대역의 fixture 값이다.
--  선행: add_hosted_tournament_waitlist_policy.sql
-- ============================================================================
do $fixture$
declare
    v_slug   text := 'zz-fixture-waitlist-selftest';
    v_slug2  text := 'zz-fixture-waitlist-selftest-small';
    v_tid    uuid;
    v_tid2   uuid;
    v_uid    uuid;
    v_r      jsonb;
    v_r2     jsonb;
    v_ok     boolean;   -- ⚠ CALL 인자에는 subquery 를 못 쓴다(0A000). 모든 검사는 v_ok 에 먼저 계산해서 넘긴다.
    v_txt    text;
    v_err    text;
    v_i      integer;
    v_cnt    integer;
    v_pass   integer;
    v_fail   integer;
    v_msg    text;
    v_prod_before text;
    v_prod_after  text;
    id61 uuid; id62 uuid; id63 uuid; id64 uuid; id65 uuid;
    id1  uuid; id5 uuid; id6 uuid;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug in (v_slug, v_slug2)) then
        raise exception '이전 self-test 잔재가 있다(slug=%). 먼저 확인·정리하라.', v_slug;
    end if;
    if to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_waitlist_policy.sql)이 적용되지 않았다.';
    end if;
    select p.id into v_uid
      from public.profiles p join auth.users u on u.id = p.id
     where p.role in ('CEO', 'ADMIN') order by p.id limit 1;
    if v_uid is null then
        raise exception 'CEO/ADMIN profile 이 없어 운영 RPC 를 호출할 수 없다.';
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);
    if not public.can_manage_tournaments() then
        raise exception 'can_manage_tournaments() 가 false 다 — self-test 를 진행할 수 없다.';
    end if;

    -- Production 대회 스냅샷(개인정보 없음: 상태 분포 · 최대 순번만)
    select coalesce(string_agg(s, ','), '') into v_prod_before from (
        select r.registration_status || '/' || r.payment_status || '=' || count(*) || '/max' || max(r.sequence_no) as s
          from public.hosted_tournament_registrations r
          join public.hosted_tournaments t on t.id = r.tournament_id
         where t.slug = '2026-teyeon-open'
         group by r.registration_status, r.payment_status
         order by 1) q;

    create temp table _wfx (seq integer, name text, ok boolean, info text);
    execute $q$
        create procedure pg_temp.wfx_chk(p_seq integer, p_name text, p_ok boolean, p_info text default null)
        language sql as $p$ insert into pg_temp._wfx values (p_seq, p_name, coalesce(p_ok, false), p_info); $p$;
    $q$;
    -- fixture 신청 1건. i 로 서로 다른 가짜 번호쌍을 만든다.
    execute $q$
        create function pg_temp.wfx_submit(p_slug text, i integer) returns jsonb
        language sql as $f$
            select public.submit_tournament_registration(
                p_slug, 'ZZ선수A' || i, '010' || lpad((90000000 + i)::text, 8, '0'),
                        'ZZ선수B' || i, '010' || lpad((80000000 + i)::text, 8, '0'),
                null, 'ZZ입금' || i, null, true, true, true, true, 'ZZ클럽', 'ZZ클럽');
        $f$;
    $q$;
    -- 실패를 문자열로 받는다(예외는 서브트랜잭션으로 되돌려진다 — 실제 실패와 같다).
    execute $q$
        create function pg_temp.wfx_try(p_sql text) returns text
        language plpgsql as $f$
        begin
            execute p_sql;
            return 'OK';
        exception when others then
            return sqlerrm;
        end $f$;
    $q$;
    execute $q$
        create function pg_temp.wfx_id(p_tid uuid, p_seq integer) returns uuid
        language sql as $f$ select id from public.hosted_tournament_registrations
                             where tournament_id = p_tid and sequence_no = p_seq $f$;
    $q$;
    execute $q$
        create function pg_temp.wfx_status(p_id uuid) returns text
        language sql as $f$ select registration_status from public.hosted_tournament_registrations where id = p_id $f$;
    $q$;
    -- Admin RPC 가 계산한 대기 순번
    execute $q$
        create function pg_temp.wfx_admin_pos(p_slug text, p_id uuid) returns integer
        language sql as $f$
            select (e->>'waitlistPosition')::integer
              from jsonb_array_elements(public.get_admin_tournament_registrations(p_slug)) e
             where (e->>'id')::uuid = p_id $f$;
    $q$;
    -- 공개 RPC 가 계산한 대기 순번(공개 RPC 에는 id 가 없으므로 sequenceNo 로 찾는다)
    execute $q$
        create function pg_temp.wfx_public_pos(p_slug text, p_seq integer) returns integer
        language sql as $f$
            select (e->>'waitlistPosition')::integer
              from jsonb_array_elements(public.get_public_tournament_teams(p_slug)) e
             where (e->>'sequenceNo')::integer = p_seq $f$;
    $q$;
    execute $q$
        create function pg_temp.wfx_counts(p_tid uuid) returns text
        language sql as $f$
            select 'normal=' || count(*) filter (where registration_status in ('applied', 'confirmed'))
                || ' wait=' || count(*) filter (where registration_status = 'waitlisted')
              from public.hosted_tournament_registrations where tournament_id = p_tid $f$;
    $q$;

    -- ── 1. self-test 대회 (접수 중 · 48 / 60 · 기준 대회 컬럼 구조 복사) ─────
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
        || jsonb_build_object(
               'id', gen_random_uuid()::text, 'slug', v_slug,
               'title', 'ZZ waitlist self-test', 'name', 'ZZ waitlist self-test',
               'status', 'registration_open',
               'registration_open_at', null,
               'registration_close_at', (now() + interval '1 day')::text,
               'target_capacity', 48, 'max_capacity', 60,
               'bank_name', 'ZZ은행', 'bank_account', '000-0000-FIXTURE', 'bank_holder', 'ZZ예금주',
               'published_at', now()::text,
               'created_at', now()::text, 'updated_at', now()::text))
    returning id into v_tid;

    -- ── 2. 1~59 신청 → 전부 applied (48 이후도 정상 접수) ──────────────────
    for v_i in 1..59 loop
        v_r := pg_temp.wfx_submit(v_slug, v_i);
        if v_i = 1 then
            v_ok := v_r->>'registrationStatus' = 'applied'
                    and v_r ? 'bankName' and v_r ? 'bankAccount' and v_r ? 'bankHolder'
                    and v_r->'waitlistPosition' = 'null'::jsonb;
            call pg_temp.wfx_chk(1, 'L. applied 응답에 계좌 3종 유지 · waitlistPosition null', v_ok, v_r::text);
        end if;
    end loop;
    v_ok := (select count(*) from public.hosted_tournament_registrations
              where tournament_id = v_tid and registration_status = 'applied') = 59;
    call pg_temp.wfx_chk(2, '1~59번째 신청 전부 applied', v_ok, pg_temp.wfx_counts(v_tid));
    v_ok := pg_temp.wfx_status(pg_temp.wfx_id(v_tid, 49)) = 'applied';
    call pg_temp.wfx_chk(3, '49번째 신청 = applied (target 48 은 판정에 쓰지 않음)', v_ok);

    -- ── A. 정상59 + 대기0 + 신규1 → applied ────────────────────────────────
    v_r := pg_temp.wfx_submit(v_slug, 60);
    v_ok := v_r->>'registrationStatus' = 'applied' and v_r ? 'bankAccount';
    call pg_temp.wfx_chk(10, 'A. 정상59/대기0 + 신규 → applied (60번째)', v_ok, v_r->>'registrationStatus');
    v_ok := pg_temp.wfx_counts(v_tid) = 'normal=60 wait=0';
    call pg_temp.wfx_chk(11, 'A. 결과 정상60/대기0', v_ok, pg_temp.wfx_counts(v_tid));

    -- ── B. 정상60 + 대기0 + 신규1 → waitlisted 대기1 (차단 아님) ─────────────
    v_r := pg_temp.wfx_submit(v_slug, 61);
    v_ok := v_r->>'registrationStatus' = 'waitlisted' and (v_r->>'waitlistPosition')::int = 1;
    call pg_temp.wfx_chk(20, 'B. 정상60/대기0 + 신규 → waitlisted · 대기1 (61번째 차단 없음)', v_ok, v_r::text);
    -- K. 대기 응답에는 계좌 없음
    v_ok := not (v_r ? 'bankName' or v_r ? 'bankAccount' or v_r ? 'bankHolder');
    call pg_temp.wfx_chk(21, 'K. waitlisted 응답에 계좌 정보 없음', v_ok, v_r::text);
    v_ok := v_r->>'paymentStatus' = 'pending' and v_r->>'registrationNo' like '%-0061';
    call pg_temp.wfx_chk(22, 'B. 대기 응답 paymentStatus=pending · 접수번호 0061', v_ok, v_r->>'registrationNo');
    v_r := pg_temp.wfx_submit(v_slug, 62);
    v_r2 := pg_temp.wfx_submit(v_slug, 63);
    v_ok := (v_r->>'waitlistPosition')::int = 2 and (v_r2->>'waitlistPosition')::int = 3;
    call pg_temp.wfx_chk(23, 'B. 62 · 63번째 → 대기2 · 대기3 (상한 없음)', v_ok);
    id1 := pg_temp.wfx_id(v_tid, 1);  id5 := pg_temp.wfx_id(v_tid, 5);  id6 := pg_temp.wfx_id(v_tid, 6);
    id61 := pg_temp.wfx_id(v_tid, 61); id62 := pg_temp.wfx_id(v_tid, 62); id63 := pg_temp.wfx_id(v_tid, 63);
    v_ok := (select to_value from public.hosted_tournament_registration_history
              where registration_id = id61 and action = 'submit') = 'waitlisted';
    call pg_temp.wfx_chk(24, 'B. submit 이력 to_value = waitlisted', v_ok);
    -- 대기 중인 같은 팀 재신청 → 중복 차단
    v_err := pg_temp.wfx_try(format('select pg_temp.wfx_submit(%L, 61)', v_slug));
    call pg_temp.wfx_chk(25, '중복 차단 유지 — 대기 중인 같은 팀 재신청 → DUPLICATE_REGISTRATION',
                         v_err like '%DUPLICATE_REGISTRATION%', v_err);

    -- ── J. 정상 60 이어도 접수 기간이면 공개 신청 가능 · 다음 신청은 대기 ─────
    v_r := public.get_public_tournament(v_slug);
    v_ok := (v_r->>'isRegistrationOpen')::boolean and (v_r->>'nextRegistrationWaitlisted')::boolean
            and (v_r->>'normalCount')::int = 60 and (v_r->>'waitlistedCount')::int = 3
            and (v_r->>'remaining')::int = 0 and (v_r->>'appliedCount')::int = 63;
    call pg_temp.wfx_chk(30, 'J. 정상60 · 접수 기간 → isRegistrationOpen=true · nextRegistrationWaitlisted=true', v_ok, v_r::text);

    -- ── G. 정상60 에서 대기팀 승격 → 서버 차단 (모든 경로) ─────────────────
    v_err := pg_temp.wfx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, null)', id61));
    call pg_temp.wfx_chk(40, 'G. 정상60 · promote(대기1) → NORMAL_CAPACITY_FULL', v_err like '%NORMAL_CAPACITY_FULL%', v_err);
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, ''applied'', null, null)', id61));
    call pg_temp.wfx_chk(41, 'G. 정상60 · set_status(waitlisted→applied) → NORMAL_CAPACITY_FULL', v_err like '%NORMAL_CAPACITY_FULL%', v_err);
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, ''confirmed'', null, null)', id61));
    call pg_temp.wfx_chk(42, 'G. 정상60 · set_status(waitlisted→confirmed) → NORMAL_CAPACITY_FULL', v_err like '%NORMAL_CAPACITY_FULL%', v_err);
    v_ok := pg_temp.wfx_status(id61) = 'waitlisted' and pg_temp.wfx_counts(v_tid) = 'normal=60 wait=3';
    call pg_temp.wfx_chk(43, 'G. 차단 후 상태 불변(정상60/대기3)', v_ok, pg_temp.wfx_counts(v_tid));
    -- 정상 슬롯 안의 이동(applied→confirmed)은 60 에서도 가능 + 기존 입금 흐름
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, ''confirmed'', ''paid'', null)', id1));
    v_ok := v_err = 'OK' and pg_temp.wfx_status(id1) = 'confirmed';
    call pg_temp.wfx_chk(44, 'G. 정상60 에서도 applied→confirmed + pending→paid 가능', v_ok, v_err);
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, null, ''refunded'', null)', id1));
    call pg_temp.wfx_chk(45, '입금 전이 matrix 유지 — paid→refunded 직접 이동 차단', v_err like '%INVALID_PAYMENT_TRANSITION%', v_err);

    -- ── C. 정상60 + 대기3 에서 정상1 취소 → 정상59 / 대기3 유지 (자동 승격 없음) ──
    perform public.set_tournament_registration_status(id5, 'cancelled', null, null);
    v_ok := pg_temp.wfx_counts(v_tid) = 'normal=59 wait=3'
            and pg_temp.wfx_status(id61) = 'waitlisted'
            and pg_temp.wfx_admin_pos(v_slug, id61) = 1 and pg_temp.wfx_admin_pos(v_slug, id63) = 3;
    call pg_temp.wfx_chk(50, 'C. 정상1 취소 → 정상59/대기3 · 자동 승격 없음 · 대기 순번 유지', v_ok, pg_temp.wfx_counts(v_tid));

    -- ── D. C 상태에서 신규1 → waitlisted 대기4 (빈 슬롯을 앞지르지 않음) ────
    v_r := pg_temp.wfx_submit(v_slug, 64);
    id64 := pg_temp.wfx_id(v_tid, 64);
    v_ok := v_r->>'registrationStatus' = 'waitlisted' and (v_r->>'waitlistPosition')::int = 4
            and not (v_r ? 'bankAccount');
    call pg_temp.wfx_chk(60, 'D. 정상59/대기3 + 신규 → waitlisted · 대기4', v_ok, v_r::text);
    v_r := public.get_public_tournament(v_slug);
    v_ok := (v_r->>'nextRegistrationWaitlisted')::boolean and (v_r->>'remaining')::int = 1;
    call pg_temp.wfx_chk(61, 'D. 공개: 빈 슬롯 1 이어도 대기팀이 있으면 다음 신청은 대기', v_ok, v_r::text);

    -- ── E. C 상태에서 대기1 승격 → 정상60 · 기존 대기2 가 새 대기1 ────────────
    v_r := public.promote_waitlisted_tournament_registration(id61, null);
    v_ok := v_r->>'registrationStatus' = 'applied' and v_r->>'paymentStatus' = 'pending'
            and (v_r->>'previousWaitlistPosition')::int = 1 and not (v_r->>'exceptional')::boolean;
    call pg_temp.wfx_chk(70, 'E. 대기1 승격(사유 없이) → applied · payment pending 유지', v_ok, v_r::text);
    v_ok := pg_temp.wfx_counts(v_tid) = 'normal=60 wait=3'
            and pg_temp.wfx_admin_pos(v_slug, id62) = 1 and pg_temp.wfx_admin_pos(v_slug, id63) = 2
            and pg_temp.wfx_admin_pos(v_slug, id64) = 3 and pg_temp.wfx_admin_pos(v_slug, id61) is null;
    call pg_temp.wfx_chk(71, 'E. 정상60 · 기존 대기2/3/4 → 새 대기1/2/3', v_ok, pg_temp.wfx_counts(v_tid));
    v_ok := (select registration_no = v_r->>'registrationNo' and sequence_no = 61 and registration_no like '%-0061'
               from public.hosted_tournament_registrations where id = id61);
    call pg_temp.wfx_chk(72, 'E. 승격 후 sequence_no / registration_no 불변', v_ok);
    v_ok := exists (select 1 from public.hosted_tournament_registration_history
                     where registration_id = id61 and action = 'registration_status'
                       and from_value = 'waitlisted' and to_value = 'applied'
                       and actor_type = 'admin' and actor_user_id = v_uid
                       and note like '대기 1번 승격%');
    call pg_temp.wfx_chk(73, 'E. 승격 이력(waitlisted→applied · admin · note=대기 1번 승격)', v_ok);
    -- 승격 후 기존 입금 흐름 그대로
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, null, ''paid'', null)', id61));
    call pg_temp.wfx_chk(74, 'E. 승격 팀 pending→paid 기존 흐름', v_err = 'OK', v_err);
    -- 이미 applied 인 팀은 다시 승격할 수 없다
    v_err := pg_temp.wfx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, null)', id61));
    call pg_temp.wfx_chk(75, 'E. 대기팀이 아니면 promote → NOT_WAITLISTED', v_err like '%NOT_WAITLISTED%', v_err);
    -- 취소 팀을 정상 슬롯으로 되돌리는 경로도 60 에서 차단
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, ''applied'', null, null)', id5));
    call pg_temp.wfx_chk(76, 'G. 정상60 · 취소 팀 cancelled→applied → NORMAL_CAPACITY_FULL', v_err like '%NORMAL_CAPACITY_FULL%', v_err);

    -- ── H. 대기2 예외 승격 → 사유 없으면 거부, 사유 있으면 정원 안에서 허용 ────
    perform public.set_tournament_registration_status(id6, 'cancelled', null, null);   -- 정상 59
    v_err := pg_temp.wfx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, null)', id63));
    call pg_temp.wfx_chk(80, 'H. 대기2 승격 · 사유 없음 → PROMOTION_REASON_REQUIRED', v_err like '%PROMOTION_REASON_REQUIRED%', v_err);
    v_err := pg_temp.wfx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, ''   '')', id63));
    call pg_temp.wfx_chk(81, 'H. 대기2 승격 · 공백 사유 → PROMOTION_REASON_REQUIRED', v_err like '%PROMOTION_REASON_REQUIRED%', v_err);
    v_ok := pg_temp.wfx_status(id63) = 'waitlisted';
    call pg_temp.wfx_chk(82, 'H. 거부 후 대기2 상태 불변', v_ok);
    v_r := public.promote_waitlisted_tournament_registration(id63, 'ZZ 대기1 연락 두절 — 예외 승격');
    v_ok := v_r->>'registrationStatus' = 'applied' and (v_r->>'exceptional')::boolean
            and (v_r->>'previousWaitlistPosition')::int = 2;
    call pg_temp.wfx_chk(83, 'H. 대기2 승격 · 사유 있음 → applied (exceptional=true)', v_ok, v_r::text);
    v_ok := exists (select 1 from public.hosted_tournament_registration_history
                     where registration_id = id63 and action = 'registration_status' and to_value = 'applied'
                       and note like '대기 2번 승격 (예외%' and note like '%ZZ 대기1 연락 두절%');
    call pg_temp.wfx_chk(84, 'H. 예외 승격 사유가 이력 note 에 남음', v_ok);
    v_ok := pg_temp.wfx_counts(v_tid) = 'normal=60 wait=2'
            and pg_temp.wfx_admin_pos(v_slug, id62) = 1 and pg_temp.wfx_admin_pos(v_slug, id64) = 2;
    call pg_temp.wfx_chk(85, 'H. 정상60/대기2 · 남은 대기 순번 1/2', v_ok, pg_temp.wfx_counts(v_tid));
    v_err := pg_temp.wfx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, ''사유 있음'')', id64));
    call pg_temp.wfx_chk(86, 'H. 사유가 있어도 정상60 이면 → NORMAL_CAPACITY_FULL', v_err like '%NORMAL_CAPACITY_FULL%', v_err);

    -- ── I. 대기1 취소 → 기존 대기2/3 의 표시 순번이 1/2 로 재계산 ─────────────
    v_r := pg_temp.wfx_submit(v_slug, 65);
    id65 := pg_temp.wfx_id(v_tid, 65);
    v_ok := (v_r->>'waitlistPosition')::int = 3;
    call pg_temp.wfx_chk(90, 'I. 준비: 신규 → 대기3', v_ok, v_r::text);
    perform public.set_tournament_registration_status(id62, 'cancelled', null, null);
    v_ok := pg_temp.wfx_admin_pos(v_slug, id64) = 1 and pg_temp.wfx_admin_pos(v_slug, id65) = 2
            and pg_temp.wfx_admin_pos(v_slug, id62) is null;
    call pg_temp.wfx_chk(91, 'I. 대기1 취소 → Admin 순번 대기2/3 → 1/2', v_ok);
    v_ok := pg_temp.wfx_public_pos(v_slug, 64) = 1 and pg_temp.wfx_public_pos(v_slug, 65) = 2
            and pg_temp.wfx_public_pos(v_slug, 62) is null and pg_temp.wfx_public_pos(v_slug, 60) is null;
    call pg_temp.wfx_chk(92, 'I. 공개 참가팀 순번도 1/2 · 취소 팀은 목록에서 빠짐', v_ok);
    v_ok := (select count(*) = count(distinct registration_no) and count(*) = 65 and max(sequence_no) = 65
               from public.hosted_tournament_registrations where tournament_id = v_tid);
    call pg_temp.wfx_chk(93, '접수번호 65개 모두 고유 · 번호 재사용/재정렬 없음', v_ok);
    v_ok := not exists (select 1 from public.hosted_tournament_registrations
                         where tournament_id = v_tid
                           and registration_no <> 'TO-' || to_char(
                                   (select event_date from public.hosted_tournaments where id = v_tid), 'YYYY')
                                   || '-' || lpad(sequence_no::text, 4, '0'))
            or (select registration_no_prefix from public.hosted_tournaments where id = v_tid) <> 'TO';
    call pg_temp.wfx_chk(94, '접수번호 = prefix-연도-순번 그대로', v_ok);
    v_ok := (select count(*) from public.hosted_tournament_registration_history h
               join public.hosted_tournament_registrations r on r.id = h.registration_id
              where r.tournament_id = v_tid and h.action = 'submit') = 65;
    call pg_temp.wfx_chk(95, 'submit 이력 65건(성공한 신청마다 1건)', v_ok);

    -- ── 접수 마감은 status / 기간으로만 ────────────────────────────────────
    update public.hosted_tournaments set registration_close_at = now() - interval '1 minute' where id = v_tid;
    v_err := pg_temp.wfx_try(format('select pg_temp.wfx_submit(%L, 66)', v_slug));
    v_ok := v_err like '%REGISTRATION_CLOSED%'
            and not (public.get_public_tournament(v_slug)->>'isRegistrationOpen')::boolean;
    call pg_temp.wfx_chk(100, '마감 시각 경과 → REGISTRATION_CLOSED · isRegistrationOpen=false', v_ok, v_err);
    update public.hosted_tournaments set registration_close_at = now() + interval '1 day', status = 'registration_closed'
     where id = v_tid;
    v_err := pg_temp.wfx_try(format('select pg_temp.wfx_submit(%L, 66)', v_slug));
    call pg_temp.wfx_chk(101, 'status ≠ registration_open → TOURNAMENT_NOT_OPEN', v_err like '%TOURNAMENT_NOT_OPEN%', v_err);
    update public.hosted_tournaments set status = 'registration_open' where id = v_tid;

    -- ── F. 정상 max-1 에서 신청 2건(동일 lock 직렬화 결과) → max 초과 불가 ────
    --   같은 트랜잭션이라 두 호출은 순서대로 lock 을 잡는다. 실제 동시 호출도 같은 lock 에서
    --   이 순서로 직렬화된다(verify 9 · 23 · 33: lock 이 집계보다 먼저).
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.id = v_tid)
        || jsonb_build_object('id', gen_random_uuid()::text, 'slug', v_slug2,
                              'title', 'ZZ waitlist self-test small', 'name', 'ZZ waitlist self-test small',
                              'target_capacity', 1, 'max_capacity', 3))
    returning id into v_tid2;
    perform pg_temp.wfx_submit(v_slug2, 1);
    v_r := pg_temp.wfx_submit(v_slug2, 2);
    v_ok := v_r->>'registrationStatus' = 'applied';
    call pg_temp.wfx_chk(110, 'F. 준비: target=1 이어도 2번째 applied (정상2/max3)', v_ok, v_r::text);
    v_r  := pg_temp.wfx_submit(v_slug2, 3);
    v_r2 := pg_temp.wfx_submit(v_slug2, 4);
    v_ok := v_r->>'registrationStatus' = 'applied' and v_r2->>'registrationStatus' = 'waitlisted'
            and (v_r2->>'waitlistPosition')::int = 1;
    call pg_temp.wfx_chk(111, 'F. 정상 max-1 + 신청 2건 → 1건 applied · 1건 대기1', v_ok, v_r2::text);
    v_ok := pg_temp.wfx_counts(v_tid2) = 'normal=3 wait=1';
    call pg_temp.wfx_chk(112, 'F. 정상 슬롯 max(3) 초과 없음', v_ok, pg_temp.wfx_counts(v_tid2));
    v_err := pg_temp.wfx_try(format('select public.set_tournament_registration_status(%L::uuid, ''applied'', null, null)',
                                    pg_temp.wfx_id(v_tid2, 4)));
    call pg_temp.wfx_chk(113, 'F. 이어서 들어온 승격 시도 → NORMAL_CAPACITY_FULL', v_err like '%NORMAL_CAPACITY_FULL%', v_err);

    -- ── N. 공개 RPC 개인정보 추가 노출 없음 ──────────────────────────────
    v_ok := not exists (select 1 from jsonb_object_keys(public.get_public_tournament(v_slug)) k
                         where k not in ('slug','title','subtitle','status','eventDate','eventStartTime',
                                         'registrationOpenAt','registrationCloseAt','venueName','organizerName',
                                         'sponsorName','entryFee','targetCapacity','maxCapacity','appliedCount',
                                         'normalCount','waitlistedCount','remaining','nextRegistrationWaitlisted',
                                         'bankName','bankAccount','bankHolder','isRegistrationOpen'));
    call pg_temp.wfx_chk(120, 'N. get_public_tournament 키 화이트리스트', v_ok);
    v_ok := not exists (select 1 from jsonb_array_elements(public.get_public_tournament_teams(v_slug)) e,
                                      jsonb_object_keys(e) k
                         where k not in ('sequenceNo','player1Name','player2Name','clubName',
                                         'player1ClubName','player2ClubName','publicStatus','waitlistPosition'));
    call pg_temp.wfx_chk(121, 'N. get_public_tournament_teams 키 화이트리스트(전화·입금·메모·입금상태 없음)', v_ok);
    v_txt := public.get_public_tournament_teams(v_slug)::text;
    v_ok := v_txt not like '%01090000%' and v_txt not like '%01080000%' and v_txt not like '%ZZ입금%';
    call pg_temp.wfx_chk(122, 'N. 공개 참가팀 응답에 fixture 전화 · 입금자명 값 없음', v_ok);
    v_ok := (select count(*) from jsonb_array_elements(public.get_public_tournament_teams(v_slug))) = 62;
    call pg_temp.wfx_chk(123, 'N. 공개 참가팀 = 활성 62팀(정상60 + 대기2) · 취소 3팀 제외', v_ok);

    -- ── M. anon raw table 접근 차단 유지 ───────────────────────────────────
    execute 'set local role anon';
    begin
        execute 'select count(*) from public.hosted_tournament_registrations' into v_cnt;
        v_err := 'SELECTED';
    exception when insufficient_privilege then v_err := 'DENIED'; end;
    begin
        execute format('select public.submit_tournament_registration(%L, ''a'', ''01011112222'', ''b'', ''01033334444'', null, ''c'', null, true, true, true, true, ''x'', ''y'')', v_slug);
        v_txt := 'CALLED';
    exception when insufficient_privilege then v_txt := 'DENIED'; end;
    begin
        execute format('select public.promote_waitlisted_tournament_registration(%L::uuid, ''x'')', id64);
        v_msg := 'CALLED';
    exception when insufficient_privilege then v_msg := 'DENIED'; end;
    begin
        execute format('select public.get_public_tournament(%L) ? ''slug''', v_slug) into v_ok;
    exception when others then v_ok := false; end;
    execute 'reset role';
    call pg_temp.wfx_chk(130, 'M. anon raw registrations SELECT → 권한 없음', v_err = 'DENIED', v_err);
    call pg_temp.wfx_chk(131, 'M. anon submit 직접 호출 → 권한 없음(lockdown 유지)', v_txt = 'DENIED', v_txt);
    call pg_temp.wfx_chk(132, 'M. anon promote 호출 → 권한 없음', v_msg = 'DENIED', v_msg);
    call pg_temp.wfx_chk(133, 'M. anon 공개 get_public_tournament 호출 가능', v_ok);
    -- 운영진이 아닌 로그인 사용자: promote → FORBIDDEN
    perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid()::text)::text, true);
    v_err := pg_temp.wfx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, ''x'')', id64));
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);
    call pg_temp.wfx_chk(134, 'M. 운영진 아닌 사용자 promote → FORBIDDEN', v_err like '%FORBIDDEN%', v_err);

    -- ── Production 대회 불변 ──────────────────────────────────────────────
    select coalesce(string_agg(s, ','), '') into v_prod_after from (
        select r.registration_status || '/' || r.payment_status || '=' || count(*) || '/max' || max(r.sequence_no) as s
          from public.hosted_tournament_registrations r
          join public.hosted_tournaments t on t.id = r.tournament_id
         where t.slug = '2026-teyeon-open'
         group by r.registration_status, r.payment_status
         order by 1) q;
    call pg_temp.wfx_chk(140, '2026-teyeon-open 행 수 · 상태 분포 · 최대 순번 불변', v_prod_before = v_prod_after);

    -- ── 결과 → 전량 롤백 ──────────────────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from pg_temp._wfx;
    select coalesce(string_agg(seq || ' ' || name || coalesce(' <' || left(info, 160) || '>', ''), ' | ' order by seq), '')
      into v_msg from pg_temp._wfx where not ok;
    raise exception 'WAITLIST FIXTURE (전량 롤백)  PASS=%  FAIL=%  → %', v_pass, v_fail,
        case when v_fail = 0 then 'ALL PASS' else 'FAIL: ' || v_msg end;
end
$fixture$;
