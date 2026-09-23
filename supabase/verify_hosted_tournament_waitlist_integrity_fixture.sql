-- ============================================================================
--  2026 TEYEON OPEN — 대기열 순서 · 접수↔운영팀 정합성 실동작 self-test (fixture)
--
--  임시 대회 2개에서 **실제 RPC** 로 검증한다.
--    submit_tournament_registration · set_tournament_registration_status ·
--    promote_waitlisted_tournament_registration · promote_confirmed_registrations ·
--    update_tournament_team · get_public_tournament_teams · get_admin_tournament_registrations ·
--    get_admin_tournament_teams
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--    마지막에 상태 분포가 시작 시점과 같은지도 확인한다.
--  선행: add_hosted_tournament_waitlist_integrity.sql
-- ============================================================================
do $fixture$
declare
    v_slug   text := 'zz-fixture-waitlist-integrity';
    v_slug2  text := 'zz-fixture-waitlist-integrity-cap';
    v_tid    uuid;
    v_tid2   uuid;
    v_uid    uuid;
    v_gid    uuid;
    v_r      jsonb;
    v_ok     boolean;
    v_txt    text;
    v_err    text;
    v_i      integer;
    v_pass   integer;
    v_fail   integer;
    v_msg    text;
    v_snap   text;
    v_snap2  text;
    v_prod_before text;
    v_prod_after  text;
    r1 uuid; r2 uuid; r3 uuid; r4 uuid; r5 uuid; r6 uuid; r7 uuid;
    t1 uuid; t2 uuid; t3 uuid;
    t1_no integer;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug in (v_slug, v_slug2)) then
        raise exception '이전 self-test 잔재가 있다(slug=%). 먼저 확인·정리하라.', v_slug;
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'hosted_tournament_registrations'
                      and column_name = 'waitlisted_at') then
        raise exception '선행 마이그레이션(add_hosted_tournament_waitlist_integrity.sql)이 적용되지 않았다.';
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

    select coalesce(string_agg(s, ','), '') into v_prod_before from (
        select r.registration_status || '/' || r.payment_status || '=' || count(*) || '/max' || max(r.sequence_no) as s
          from public.hosted_tournament_registrations r
          join public.hosted_tournaments t on t.id = r.tournament_id
         where t.slug = '2026-teyeon-open'
         group by r.registration_status, r.payment_status order by 1) q;

    create temp table _ifx (seq integer, name text, ok boolean, info text);
    execute $q$
        create procedure pg_temp.ifx_chk(p_seq integer, p_name text, p_ok boolean, p_info text default null)
        language sql as $p$ insert into pg_temp._ifx values (p_seq, p_name, coalesce(p_ok, false), p_info); $p$;
    $q$;
    execute $q$
        create function pg_temp.ifx_submit(p_slug text, i integer) returns jsonb
        language sql as $f$
            select public.submit_tournament_registration(
                p_slug, 'ZZ선수A' || i, '010' || lpad((93000000 + i)::text, 8, '0'),
                        'ZZ선수B' || i, '010' || lpad((83000000 + i)::text, 8, '0'),
                null, 'ZZ입금' || i, null, true, true, true, true, 'ZZ클럽', 'ZZ클럽');
        $f$;
    $q$;
    execute $q$
        create function pg_temp.ifx_try(p_sql text) returns text
        language plpgsql as $f$
        begin execute p_sql; return 'OK';
        exception when others then return sqlerrm; end $f$;
    $q$;
    execute $q$
        create function pg_temp.ifx_id(p_tid uuid, p_seq integer) returns uuid
        language sql as $f$ select id from public.hosted_tournament_registrations
                             where tournament_id = p_tid and sequence_no = p_seq $f$;
    $q$;
    execute $q$
        create function pg_temp.ifx_rstatus(p_id uuid) returns text
        language sql as $f$ select registration_status from public.hosted_tournament_registrations where id = p_id $f$;
    $q$;
    execute $q$
        create function pg_temp.ifx_team(p_rid uuid) returns text
        language sql as $f$
            select t.status || '/' || coalesce(t.withdrawn_reason, '-') || '/no' || t.team_no
              from public.hosted_tournament_teams t where t.registration_id = p_rid $f$;
    $q$;
    -- Admin RPC 가 계산한 대기 순번
    execute $q$
        create function pg_temp.ifx_pos(p_slug text, p_id uuid) returns integer
        language sql as $f$
            select (e->>'waitlistPosition')::integer
              from jsonb_array_elements(public.get_admin_tournament_registrations(p_slug)) e
             where (e->>'id')::uuid = p_id $f$;
    $q$;
    execute $q$
        create function pg_temp.ifx_counts(p_tid uuid) returns text
        language sql as $f$
            select 'normal=' || count(*) filter (where registration_status in ('applied', 'confirmed'))
                || ' wait='  || count(*) filter (where registration_status = 'waitlisted')
              from public.hosted_tournament_registrations where tournament_id = p_tid $f$;
    $q$;
    -- 접수번호 · 순번 · 입금상태 스냅샷(불변 확인용)
    execute $q$
        create function pg_temp.ifx_snap(p_tid uuid) returns text
        language sql as $f$
            select coalesce(string_agg(sequence_no || ':' || registration_no || ':' || payment_status, ',' order by sequence_no), '')
              from public.hosted_tournament_registrations where tournament_id = p_tid $f$;
    $q$;

    -- ── 1. self-test 대회 (접수 중 · 48 / 60) ──────────────────────────────
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
        || jsonb_build_object(
               'id', gen_random_uuid()::text, 'slug', v_slug,
               'title', 'ZZ waitlist integrity self-test', 'name', 'ZZ waitlist integrity self-test',
               'status', 'registration_open', 'registration_open_at', null,
               'registration_close_at', (now() + interval '1 day')::text,
               'target_capacity', 48, 'max_capacity', 60,
               'published_at', now()::text, 'created_at', now()::text, 'updated_at', now()::text))
    returning id into v_tid;

    -- 접수 6건 → 전부 applied (정상 슬롯 여유)
    for v_i in 1..6 loop perform pg_temp.ifx_submit(v_slug, v_i); end loop;
    r1 := pg_temp.ifx_id(v_tid, 1); r2 := pg_temp.ifx_id(v_tid, 2); r3 := pg_temp.ifx_id(v_tid, 3);
    r4 := pg_temp.ifx_id(v_tid, 4); r5 := pg_temp.ifx_id(v_tid, 5); r6 := pg_temp.ifx_id(v_tid, 6);
    v_snap := pg_temp.ifx_snap(v_tid);

    -- 1~3번 참가확정 → 팀 승격
    perform public.set_tournament_registration_status(r1, 'confirmed', null, null);
    perform public.set_tournament_registration_status(r2, 'confirmed', null, null);
    perform public.set_tournament_registration_status(r3, 'confirmed', null, null);
    v_r := public.promote_confirmed_registrations(v_slug);
    v_ok := (v_r->>'inserted')::int = 3;
    call pg_temp.ifx_chk(1, '준비: confirmed 3건 → 팀 3개 승격', v_ok, v_r::text);
    select id, team_no into t1, t1_no from public.hosted_tournament_teams where registration_id = r1;
    select id into t2 from public.hosted_tournament_teams where registration_id = r2;
    select id into t3 from public.hosted_tournament_teams where registration_id = r3;

    -- ── S1. confirmed 팀 접수 취소 → 미사용 팀 자동 기권 ───────────────────
    v_r := public.set_tournament_registration_status(r1, 'cancelled', null, null);
    v_ok := v_r->'teamSync'->>'action' = 'withdrawn' and pg_temp.ifx_team(r1) like 'withdrawn/registration_cancelled/%';
    call pg_temp.ifx_chk(10, 'S1. 접수 취소 → 팀 withdrawn + registration_cancelled', v_ok, v_r::text);
    v_ok := (select count(*) = 3 from public.hosted_tournament_teams where tournament_id = v_tid);
    call pg_temp.ifx_chk(11, 'S1. 팀 행 삭제 없음(3개 유지)', v_ok);

    -- ── S2. 같은 접수 confirmed 복구 → 같은 팀 active 복구 ─────────────────
    v_r := public.set_tournament_registration_status(r1, 'confirmed', null, null);
    v_ok := v_r->'teamSync'->>'action' = 'restored' and pg_temp.ifx_team(r1) = 'active/-/no' || t1_no;
    call pg_temp.ifx_chk(20, 'S2. 접수 복구 → 같은 팀 active · 사유 해제', v_ok, pg_temp.ifx_team(r1));
    v_ok := (select id = t1 and team_no = t1_no from public.hosted_tournament_teams where registration_id = r1);
    call pg_temp.ifx_chk(21, 'S2. team id · team_no 불변', v_ok);

    -- ── S3. 승격 재실행 → 중복 팀 없음 ────────────────────────────────────
    v_r := public.promote_confirmed_registrations(v_slug);
    v_ok := (v_r->>'inserted')::int = 0
            and (select count(*) = 3 from public.hosted_tournament_teams where tournament_id = v_tid);
    call pg_temp.ifx_chk(30, 'S3. 승격 재실행 → inserted 0 · 중복 팀 없음', v_ok, v_r::text);

    -- ── S4. 수동 기권 팀은 접수 복구로 자동 복구되지 않는다 ────────────────
    perform public.update_tournament_team(t2, null, null, 'withdrawn', false);
    v_ok := pg_temp.ifx_team(r2) like 'withdrawn/manual/%';
    call pg_temp.ifx_chk(40, 'S4. 운영진 수동 기권 → withdrawn_reason=manual', v_ok, pg_temp.ifx_team(r2));
    v_r := public.set_tournament_registration_status(r2, 'cancelled', null, null);
    v_ok := v_r->'teamSync'->>'action' = 'already_withdrawn' and pg_temp.ifx_team(r2) like 'withdrawn/manual/%';
    call pg_temp.ifx_chk(41, 'S4. 접수 취소 → 수동 기권 사유를 덮어쓰지 않음', v_ok, v_r::text);
    v_r := public.set_tournament_registration_status(r2, 'confirmed', null, null);
    v_ok := v_r->'teamSync'->>'action' = 'blocked_manual' and pg_temp.ifx_team(r2) like 'withdrawn/manual/%';
    call pg_temp.ifx_chk(42, 'S4. 접수 복구 → manual 팀은 자동 복구 안 됨', v_ok, v_r::text);
    -- 수동 복구는 사유를 지운다
    perform public.update_tournament_team(t2, null, null, 'active', false);
    v_ok := pg_temp.ifx_team(r2) like 'active/-/%';
    call pg_temp.ifx_chk(43, 'S4. 수동 복구 → active · 사유 NULL', v_ok, pg_temp.ifx_team(r2));

    -- ── S5. 조편성에 사용된 팀 → 자동 변경 금지 ────────────────────────────
    insert into public.hosted_tournament_groups (tournament_id, group_no, group_type, expected_size, display_order)
    values (v_tid, 1, 'preliminary', 3, 1) returning id into v_gid;
    insert into public.hosted_tournament_group_members (tournament_id, group_id, team_id, slot_no)
    values (v_tid, v_gid, t3, 1);
    v_r := public.set_tournament_registration_status(r3, 'cancelled', null, null);
    v_ok := v_r->'teamSync'->>'action' = 'blocked_in_use' and pg_temp.ifx_team(r3) like 'active/-/%';
    call pg_temp.ifx_chk(50, 'S5. 조편성 사용 팀 → 자동 기권 안 함 · blocked_in_use 경고', v_ok, v_r::text);
    v_ok := (select count(*) = 1 from public.hosted_tournament_group_members
              where tournament_id = v_tid and team_id = t3);
    call pg_temp.ifx_chk(51, 'S5. 조 배정 데이터 자동 수정 없음', v_ok);
    perform public.set_tournament_registration_status(r3, 'confirmed', null, null);

    -- ── S6. 경기에 사용된 팀 → 자동 변경 금지 ─────────────────────────────
    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, sequence_no, match_no, team1_id, team2_id, status)
    values (v_tid, 'preliminary', v_gid, 1, 1, t1, t3, 'waiting');
    v_r := public.set_tournament_registration_status(r1, 'cancelled', null, null);
    v_ok := v_r->'teamSync'->>'action' = 'blocked_in_use' and pg_temp.ifx_team(r1) like 'active/-/%';
    call pg_temp.ifx_chk(60, 'S6. 경기 사용 팀 → 자동 기권 안 함 · blocked_in_use 경고', v_ok, v_r::text);
    v_ok := (select count(*) = 1 from public.hosted_tournament_matches
              where tournament_id = v_tid and (team1_id = t1 or team2_id = t1));
    call pg_temp.ifx_chk(61, 'S6. 경기 데이터 자동 수정 없음', v_ok);
    perform public.set_tournament_registration_status(r1, 'confirmed', null, null);

    -- ── S7. 대기 1/2/3 ────────────────────────────────────────────────────
    -- ⚠ 각 진입 사이에 짧은 간격을 둔다. 대기 순서는 clock_timestamp() 기준이고, 같은 순간에
    --    들어온 경우에만 접수 순번으로 갈린다(운영에서는 호출이 서로 다른 트랜잭션이라 시각이 다르다).
    perform pg_sleep(0.01);
    perform public.set_tournament_registration_status(r4, 'waitlisted', null, null);   -- 대기 1
    perform pg_sleep(0.01);
    v_r := pg_temp.ifx_submit(v_slug, 7);                                              -- 대기 2 (대기가 있으므로)
    r7 := pg_temp.ifx_id(v_tid, 7);
    v_ok := v_r->>'registrationStatus' = 'waitlisted' and (v_r->>'waitlistPosition')::int = 2;
    call pg_temp.ifx_chk(70, 'S7. 대기 존재 → 신규 신청도 대기(대기 2)', v_ok, v_r::text);
    perform pg_sleep(0.01);
    perform public.set_tournament_registration_status(r5, 'waitlisted', null, null);   -- 대기 3
    v_ok := pg_temp.ifx_pos(v_slug, r4) = 1 and pg_temp.ifx_pos(v_slug, r7) = 2 and pg_temp.ifx_pos(v_slug, r5) = 3;
    call pg_temp.ifx_chk(71, 'S7. 대기 순번 1/2/3 = 대기열 진입 순서', v_ok,
                         pg_temp.ifx_pos(v_slug, r4) || '/' || pg_temp.ifx_pos(v_slug, r7) || '/' || pg_temp.ifx_pos(v_slug, r5));
    v_ok := (select count(*) = 3 from public.hosted_tournament_registrations
              where tournament_id = v_tid and registration_status = 'waitlisted' and waitlisted_at is not null);
    call pg_temp.ifx_chk(72, 'S7. 대기 3건 모두 waitlisted_at 기록됨', v_ok);

    -- ── S8. 대기 2 취소 → 남은 순번 1/2 로 재압축 ─────────────────────────
    perform public.set_tournament_registration_status(r7, 'cancelled', null, null);
    v_ok := pg_temp.ifx_pos(v_slug, r4) = 1 and pg_temp.ifx_pos(v_slug, r5) = 2
            and pg_temp.ifx_pos(v_slug, r7) is null;
    call pg_temp.ifx_chk(80, 'S8. 대기 2 취소 → 1/2 로 재압축', v_ok);
    v_ok := (select waitlisted_at is null from public.hosted_tournament_registrations where id = r7);
    call pg_temp.ifx_chk(81, 'S8. 대기 이탈 시 waitlisted_at 해제', v_ok);

    -- ── S9. 오래된 cancelled 접수를 대기로 복구 → 맨 뒤 ────────────────────
    --   r7(순번 7)보다 접수 순번이 작은 r6 을 취소했다가 대기로 되살린다.
    perform public.set_tournament_registration_status(r6, 'cancelled', null, null);
    perform pg_sleep(0.01);
    perform public.set_tournament_registration_status(r6, 'waitlisted', null, null);
    v_ok := pg_temp.ifx_pos(v_slug, r4) = 1 and pg_temp.ifx_pos(v_slug, r5) = 2 and pg_temp.ifx_pos(v_slug, r6) = 3;
    call pg_temp.ifx_chk(90, 'S9. 취소 접수를 대기로 복구 → 기존 대기자 뒤(맨 뒤)', v_ok,
                         'r6 pos=' || pg_temp.ifx_pos(v_slug, r6));
    v_ok := (select sequence_no = 6 from public.hosted_tournament_registrations where id = r6);
    call pg_temp.ifx_chk(91, 'S9. 복구해도 sequence_no 는 그대로(6)', v_ok);

    -- ── S10. applied/confirmed → waitlisted 도 맨 뒤 ──────────────────────
    perform pg_sleep(0.01);
    perform public.set_tournament_registration_status(r2, 'waitlisted', null, null);
    v_ok := pg_temp.ifx_pos(v_slug, r2) = 4;
    call pg_temp.ifx_chk(100, 'S10. 정상 참가 팀을 대기 전환 → 맨 뒤(대기 4)', v_ok, 'pos=' || pg_temp.ifx_pos(v_slug, r2));
    v_ok := pg_temp.ifx_team(r2) like 'active/-/%';
    call pg_temp.ifx_chk(101, 'S10. 대기 전환은 취소가 아니므로 팀 자동 기권 없음', v_ok, pg_temp.ifx_team(r2));

    -- ── S11. 승격 후 다시 대기 → 다시 맨 뒤 ───────────────────────────────
    v_r := public.promote_waitlisted_tournament_registration(r4, null);
    v_ok := (v_r->>'previousWaitlistPosition')::int = 1 and v_r->>'registrationStatus' = 'applied'
            and (select waitlisted_at is null from public.hosted_tournament_registrations where id = r4);
    call pg_temp.ifx_chk(110, 'S11-a. 대기 1번 승격 → applied · waitlisted_at 해제', v_ok, v_r::text);
    perform pg_sleep(0.01);
    perform public.set_tournament_registration_status(r4, 'waitlisted', null, null);
    v_ok := pg_temp.ifx_pos(v_slug, r5) = 1 and pg_temp.ifx_pos(v_slug, r6) = 2
            and pg_temp.ifx_pos(v_slug, r2) = 3 and pg_temp.ifx_pos(v_slug, r4) = 4;
    call pg_temp.ifx_chk(111, 'S11-b. 승격 후 다시 대기 → 맨 뒤(대기 4)', v_ok, 'r4 pos=' || pg_temp.ifx_pos(v_slug, r4));

    -- ── S12. 신규 신청과 복구가 섞여도 진입 시각 순서 ──────────────────────
    perform pg_sleep(0.01);
    v_r := pg_temp.ifx_submit(v_slug, 8);
    v_ok := (v_r->>'waitlistPosition')::int = 5
            and pg_temp.ifx_pos(v_slug, pg_temp.ifx_id(v_tid, 8)) = 5;
    call pg_temp.ifx_chk(120, 'S12. 신규 신청은 복구분보다 뒤(대기 5)', v_ok, v_r::text);
    -- 공개 RPC 도 같은 순서인지
    v_ok := (select (e->>'waitlistPosition')::int = 5
               from jsonb_array_elements(public.get_public_tournament_teams(v_slug)) e
              where (e->>'sequenceNo')::int = 8);
    call pg_temp.ifx_chk(121, 'S12. 공개 참가팀 순번도 동일', v_ok);
    -- 공개 · Admin 두 경로의 순번이 모든 대기팀에서 같아야 한다(한쪽만 정렬 기준이 바뀌는 회귀 차단).
    v_ok := not exists (
        select 1
          from public.hosted_tournament_registrations r
          join jsonb_array_elements(public.get_public_tournament_teams(v_slug)) e
            on (e->>'sequenceNo')::int = r.sequence_no
         where r.tournament_id = v_tid and r.registration_status = 'waitlisted'
           and (e->>'waitlistPosition')::int is distinct from pg_temp.ifx_pos(v_slug, r.id));
    call pg_temp.ifx_chk(122, 'S12. 공개 · Admin 대기 순번 완전 일치', v_ok);
    -- 진입 시각 순서 = 표시 순번 순서 (접수 순번 순서와 일부러 어긋난 상태다)
    v_ok := (select string_agg(sequence_no::text, ',' order by coalesce(waitlisted_at, submitted_at), sequence_no)
               <> string_agg(sequence_no::text, ',' order by sequence_no)
               from public.hosted_tournament_registrations
              where tournament_id = v_tid and registration_status = 'waitlisted');
    call pg_temp.ifx_chk(123, 'S12. 대기열 순서가 접수 순번 순서와 다름(진입 시각 기준임을 확인)', v_ok);

    -- ── S13. 정상 슬롯 만석에서 승격 차단 (max_capacity=3 대회) ────────────
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.id = v_tid)
        || jsonb_build_object('id', gen_random_uuid()::text, 'slug', v_slug2,
                              'title', 'ZZ integrity cap', 'name', 'ZZ integrity cap',
                              'target_capacity', 1, 'max_capacity', 3))
    returning id into v_tid2;
    for v_i in 11..13 loop perform pg_temp.ifx_submit(v_slug2, v_i); end loop;   -- 정상 3
    v_r := pg_temp.ifx_submit(v_slug2, 14);                                      -- 대기 1
    v_ok := v_r->>'registrationStatus' = 'waitlisted' and pg_temp.ifx_counts(v_tid2) = 'normal=3 wait=1';
    call pg_temp.ifx_chk(130, 'S13-a. 정상 max(3) 도달 후 신규는 대기', v_ok, pg_temp.ifx_counts(v_tid2));
    v_err := pg_temp.ifx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, null)',
                                    pg_temp.ifx_id(v_tid2, 4)));
    call pg_temp.ifx_chk(131, 'S13-b. 정상 만석 → 승격 차단(NORMAL_CAPACITY_FULL)',
                         v_err like '%NORMAL_CAPACITY_FULL%', v_err);
    v_err := pg_temp.ifx_try(format('select public.set_tournament_registration_status(%L::uuid, ''applied'', null, null)',
                                    pg_temp.ifx_id(v_tid2, 4)));
    call pg_temp.ifx_chk(132, 'S13-c. set_status 경로도 차단', v_err like '%NORMAL_CAPACITY_FULL%', v_err);

    -- ── S14/S15. 대기 1번 승격 · 예외 승격 사유 ───────────────────────────
    v_r := public.promote_waitlisted_tournament_registration(r5, null);   -- 현재 대기 1
    v_ok := v_r->>'registrationStatus' = 'applied' and (v_r->>'previousWaitlistPosition')::int = 1
            and not (v_r->>'exceptional')::boolean and v_r->>'paymentStatus' = 'pending';
    call pg_temp.ifx_chk(140, 'S14. 대기 1번 승격(사유 없이) 성공 · 입금 미변경', v_ok, v_r::text);
    v_err := pg_temp.ifx_try(format('select public.promote_waitlisted_tournament_registration(%L::uuid, null)', r2));
    call pg_temp.ifx_chk(150, 'S15-a. 대기 1번이 아니면 사유 필수', v_err like '%PROMOTION_REASON_REQUIRED%', v_err);
    v_r := public.promote_waitlisted_tournament_registration(r2, 'ZZ 예외 사유');
    v_ok := (v_r->>'exceptional')::boolean
            and exists (select 1 from public.hosted_tournament_registration_history
                         where registration_id = r2 and to_value = 'applied'
                           and note like '대기 %번 승격 (예외%' and note like '%ZZ 예외 사유%');
    call pg_temp.ifx_chk(151, 'S15-b. 사유 있으면 승격 + 이력 note 기록', v_ok, v_r::text);

    -- ── S16~S18. 번호 · 입금 불변 ─────────────────────────────────────────
    v_snap2 := pg_temp.ifx_snap(v_tid);
    v_ok := (select count(*) = 8 from public.hosted_tournament_registrations where tournament_id = v_tid);
    call pg_temp.ifx_chk(160, 'S16. 접수 8건(1~6 + 7 + 8)', v_ok);
    v_ok := (select count(*) = count(distinct registration_no) and max(sequence_no) = 8
               from public.hosted_tournament_registrations where tournament_id = v_tid);
    call pg_temp.ifx_chk(161, 'S16/S17. 접수번호 고유 · 최대 순번 8(재번호 없음)', v_ok);
    v_ok := v_snap2 like v_snap || '%';
    call pg_temp.ifx_chk(170, 'S17/S18. 기존 1~6번의 접수번호 · 순번 · 입금상태 불변', v_ok,
                         'before=' || left(v_snap, 90) || ' after=' || left(v_snap2, 90));
    v_ok := (select count(*) = 0 from public.hosted_tournament_registrations
              where tournament_id = v_tid and payment_status <> 'pending');
    call pg_temp.ifx_chk(171, 'S18. 전 과정에서 payment_status 변경 없음', v_ok);

    -- ── S19~S21. 공개 페이로드 ────────────────────────────────────────────
    v_ok := not exists (select 1 from jsonb_array_elements(public.get_public_tournament_teams(v_slug)) e,
                                      jsonb_object_keys(e) k
                         where k not in ('sequenceNo','player1Name','player2Name','clubName',
                                         'player1ClubName','player2ClubName','publicStatus','waitlistPosition'));
    call pg_temp.ifx_chk(190, 'S19. 공개 참가팀 키 화이트리스트(PII 없음)', v_ok);
    v_txt := public.get_public_tournament_teams(v_slug)::text;
    v_ok := v_txt not like '%01093%' and v_txt not like '%01083%' and v_txt not like '%ZZ입금%'
            and v_txt not like '%waitlistedAt%' and v_txt not like '%withdrawnReason%';
    call pg_temp.ifx_chk(200, 'S20/S21. 공개 응답에 전화 · 입금자 · waitlisted_at · withdrawn_reason 없음', v_ok);
    v_txt := public.get_public_tournament(v_slug)::text;
    v_ok := v_txt not like '%waitlistedAt%' and v_txt not like '%withdrawnReason%';
    call pg_temp.ifx_chk(201, 'S20/S21. 공개 대회 RPC 에도 내부 값 없음', v_ok);
    -- Admin 에는 보여야 한다(운영 판단용)
    v_ok := (select count(*) > 0 from jsonb_array_elements(public.get_admin_tournament_registrations(v_slug)) e
              where e ? 'waitlistedAt')
            and (select count(*) > 0 from jsonb_array_elements(public.get_admin_tournament_teams(v_slug)) e
                  where e ? 'withdrawnReason');
    call pg_temp.ifx_chk(202, 'Admin RPC 에는 waitlistedAt · withdrawnReason 제공', v_ok);

    -- ── Production 대회 불변 ──────────────────────────────────────────────
    select coalesce(string_agg(s, ','), '') into v_prod_after from (
        select r.registration_status || '/' || r.payment_status || '=' || count(*) || '/max' || max(r.sequence_no) as s
          from public.hosted_tournament_registrations r
          join public.hosted_tournaments t on t.id = r.tournament_id
         where t.slug = '2026-teyeon-open'
         group by r.registration_status, r.payment_status order by 1) q;
    call pg_temp.ifx_chk(210, '2026-teyeon-open 행 수 · 상태 분포 · 최대 순번 불변', v_prod_before = v_prod_after);
    v_ok := (select count(*) = 0 from public.hosted_tournament_teams t
              join public.hosted_tournaments h on h.id = t.tournament_id
             where h.slug = '2026-teyeon-open');
    call pg_temp.ifx_chk(211, '2026-teyeon-open 팀 데이터 생성/변경 없음', v_ok);

    -- ── 결과 → 전량 롤백 ──────────────────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from pg_temp._ifx;
    select coalesce(string_agg(seq || ' ' || name || coalesce(' <' || left(info, 160) || '>', ''), ' | ' order by seq), '')
      into v_msg from pg_temp._ifx where not ok;
    raise exception 'WAITLIST INTEGRITY FIXTURE (전량 롤백)  PASS=%  FAIL=%  → %', v_pass, v_fail,
        case when v_fail = 0 then 'ALL PASS' else 'FAIL: ' || v_msg end;
end
$fixture$;
