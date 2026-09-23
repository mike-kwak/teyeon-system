-- ============================================================================
--  2026 TEYEON OPEN — 본선 Bracket DB Foundation 실동작 self-test (Batch 4A fixture)
--
--  임시 대회 3개에서 **실제 RPC** 로 검증한다.
--    create_bracket · set_bracket_entrants · set_bracket_structure ·
--    assign_bracket_slot · replace_bracket_slots · validate_bracket ·
--    lock_bracket · unlock_bracket · get_admin_bracket
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ CALL 인자에는 식을 직접 넣지 않는다. 모든 검사는 v_ok / v_txt 에 먼저 계산해서 넘긴다
--    (plpgsql CALL 파서 제약 — 기존 fixture 들과 같은 규칙).
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--  ⚠ 구조 payload(라운드 · 연결)는 **fixture 가 만든다**. 서버 함수는 payload 를 검증만 하고
--    라운드 · 자리 · BYE · 연결을 스스로 만들어내지 않는다(그것이 이 self-test 의 확인 대상이다).
--  선행: add_hosted_tournament_bracket.sql
-- ============================================================================
do $fixture$
declare
    v_uid    uuid;
    v_pass   integer;
    v_fail   integer;
    v_msg    text;
    v_ok     boolean;
    v_err    text;
    v_r      jsonb;
    v_v      jsonb;
    v_i      integer;
    v_cnt    integer;
    v_tid1   uuid;  v_tid2 uuid;  v_tid3 uuid;
    v_bid1   uuid;  v_bid2 uuid;  v_bid3 uuid;
    v_ver    integer;
    v_slot   uuid;
    v_slot2  uuid;
    v_team   uuid;
    v_team_other uuid;
    v_txt    text;
    v_in_byes  text;
    v_out_byes text;
    v_prod_before text;
    v_prod_after  text;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug like 'zz-fixture-bracket%') then
        raise exception '이전 self-test 잔재가 있다. 먼저 확인·정리하라.';
    end if;
    if to_regclass('public.hosted_tournament_brackets') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_bracket.sql)이 적용되지 않았다.';
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
        select r.registration_status || '=' || count(*) as s
          from public.hosted_tournament_registrations r
          join public.hosted_tournaments t on t.id = r.tournament_id
         where t.slug = '2026-teyeon-open' group by r.registration_status order by 1) q;

    create temp table _bfx (seq integer, name text, ok boolean, info text);
    execute $q$
        create procedure pg_temp.bfx_chk(p_seq integer, p_name text, p_ok boolean, p_info text default null)
        language sql as $p$ insert into pg_temp._bfx values (p_seq, p_name, coalesce(p_ok, false), p_info); $p$;
    $q$;
    execute $q$
        create function pg_temp.bfx_tournament(p_slug text, p_teams integer) returns uuid
        language plpgsql as $f$
        declare v_tid uuid; i integer;
        begin
            insert into public.hosted_tournaments
            select * from jsonb_populate_record(
                null::public.hosted_tournaments,
                (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
                || jsonb_build_object('id', gen_random_uuid()::text, 'slug', p_slug,
                                      'title', 'ZZ ' || p_slug, 'name', 'ZZ ' || p_slug,
                                      'status', 'registration_closed',
                                      'created_at', now()::text, 'updated_at', now()::text))
            returning id into v_tid;
            for i in 1..p_teams loop
                insert into public.hosted_tournament_teams
                    (tournament_id, team_no, player1_name, player2_name, source, status)
                values (v_tid, i, 'ZZ선수A' || i, 'ZZ선수B' || i, 'fixture', 'active');
            end loop;
            return v_tid;
        end $f$;
    $q$;
    execute $q$
        create function pg_temp.bfx_entrants(p_tid uuid, p_n integer) returns jsonb
        language sql as $f$
            select coalesce(jsonb_agg(jsonb_build_object('teamId', t.id, 'source', 'manual')
                                      order by t.team_no), '[]'::jsonb)
              from public.hosted_tournament_teams t
             where t.tournament_id = p_tid and t.team_no <= p_n $f$;
    $q$;
    -- 구조 payload — 자리 수 배열을 라운드 + 연결로 바꾼다.
    --   ⚠ 이 계산은 fixture(테스트 입력) 쪽이다. 서버는 payload 를 검증만 한다.
    execute $q$
        create function pg_temp.bfx_structure(p_counts integer[], p_names text[]) returns jsonb
        language sql as $f$
            select jsonb_build_object(
                'rounds', (select jsonb_agg(jsonb_build_object(
                                'roundNo', i, 'name', p_names[i], 'slots', p_counts[i],
                                'isFinalSlot', i = array_length(p_counts, 1)) order by i)
                             from generate_series(1, array_length(p_counts, 1)) i),
                'connections', (select jsonb_agg(jsonb_build_object(
                                    'roundNo', i, 'position', pos,
                                    'feedsPosition', ((pos + 1) / 2)) order by i, pos)
                                  from generate_series(1, array_length(p_counts, 1) - 1) i,
                                       generate_series(1, p_counts[i]) pos))
        $f$;
    $q$;
    execute $q$
        create function pg_temp.bfx_assign_simple(p_tid uuid, p_slots integer) returns jsonb
        language sql as $f$
            select jsonb_agg(jsonb_build_object('position', t.team_no, 'type', 'team', 'teamId', t.id)
                             order by t.team_no)
              from public.hosted_tournament_teams t
             where t.tournament_id = p_tid and t.team_no <= p_slots $f$;
    $q$;

    -- =====================================================================
    -- T1 — 32 entrants 정상 bracket
    -- =====================================================================
    v_tid1 := pg_temp.bfx_tournament('zz-fixture-bracket-32', 32);

    v_r := public.create_bracket('zz-fixture-bracket-32', '본선', 32);
    v_bid1 := (v_r ->> 'bracketId')::uuid;
    v_ok := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.bfx_chk(1, 'T1. create_bracket', v_ok, v_txt);

    v_r := public.create_bracket('zz-fixture-bracket-32');
    v_ok := (v_r ->> 'reason') = 'already_exists';
    v_txt := v_r::text;
    call pg_temp.bfx_chk(2, 'T1. bracket 재생성 → already_exists', v_ok, v_txt);

    v_r := public.set_bracket_entrants('zz-fixture-bracket-32', pg_temp.bfx_entrants(v_tid1, 32), 1);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'entrantCount')::int = 32;
    v_txt := v_r::text;
    call pg_temp.bfx_chk(3, 'T1. 진출팀 32팀 스냅샷', v_ok, v_txt);

    v_r := public.set_bracket_structure('zz-fixture-bracket-32',
              pg_temp.bfx_structure(array[32,16,8,4,2,1], array['32강','16강','8강','4강','결승','우승']), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'rounds')::int = 6
            and (v_r ->> 'slots')::int = 63 and (v_r ->> 'connections')::int = 62;
    v_txt := v_r::text;
    call pg_temp.bfx_chk(4, 'T1. 구조 6라운드 · 63자리 · 62연결', v_ok, v_txt);

    v_v := public.validate_bracket('zz-fixture-bracket-32');
    v_ok := not (v_v ->> 'ok')::boolean and v_v::text like '%unassigned_first_round_slot%';
    call pg_temp.bfx_chk(5, 'T1. 1라운드 미배치 tbd → validate 실패', v_ok, null);

    v_ok := (v_v -> 'summary' ->> 'unassigned')::int = 32;
    v_txt := v_v -> 'summary' ->> 'unassigned';
    call pg_temp.bfx_chk(6, 'T1. 2라운드 이상 tbd 는 미배치로 세지 않음(승자 대기)', v_ok, v_txt);

    v_r := public.lock_bracket('zz-fixture-bracket-32', v_ver);
    v_ok := (v_r ->> 'reason') = 'validation_failed';
    call pg_temp.bfx_chk(7, 'T1. 미배치 상태 lock → validation_failed', v_ok, null);

    v_r := public.replace_bracket_slots('zz-fixture-bracket-32', pg_temp.bfx_assign_simple(v_tid1, 32), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'assigned')::int = 32 and (v_r ->> 'byes')::int = 0;
    v_txt := v_r::text;
    call pg_temp.bfx_chk(8, 'T1. 1라운드 32자리 일괄 배치', v_ok, v_txt);

    v_v := public.validate_bracket('zz-fixture-bracket-32');
    v_ok := (v_v ->> 'ok')::boolean
            and (v_v -> 'summary' ->> 'matchesToCreate')::int = 16
            and (v_v -> 'summary' ->> 'byeAdvances')::int = 0;
    v_txt := (v_v -> 'summary')::text;
    call pg_temp.bfx_chk(9, 'T1. validate ok · 만들 경기 16 · BYE 진출 0', v_ok, v_txt);

    v_r := public.lock_bracket('zz-fixture-bracket-32', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'lockedAt') is not null;
    v_txt := v_r::text;
    call pg_temp.bfx_chk(10, 'T1. lock 성공', v_ok, v_txt);

    select (status = 'locked' and locked_by = v_uid) into v_ok
      from public.hosted_tournament_brackets where id = v_bid1;
    call pg_temp.bfx_chk(11, 'T1. status=locked · locked_by 기록', v_ok, null);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid1 and stage = 'knockout';
    v_ok := v_cnt = 0;
    call pg_temp.bfx_chk(12, 'T1. lock 해도 knockout 경기 생성 없음(4C 범위)', v_ok, v_cnt::text);

    -- lock 후 편집 차단
    v_r := public.set_bracket_entrants('zz-fixture-bracket-32', pg_temp.bfx_entrants(v_tid1, 32), v_ver);
    v_ok := (v_r ->> 'reason') = 'bracket_locked';
    call pg_temp.bfx_chk(20, 'T1. lock 후 진출팀 변경 차단', v_ok, v_r::text);

    v_r := public.set_bracket_structure('zz-fixture-bracket-32',
              pg_temp.bfx_structure(array[32,16,8,4,2,1], array['32강','16강','8강','4강','결승','우승']), v_ver);
    v_ok := (v_r ->> 'reason') = 'bracket_locked';
    call pg_temp.bfx_chk(21, 'T1. lock 후 구조 변경 차단', v_ok, v_r::text);

    v_r := public.replace_bracket_slots('zz-fixture-bracket-32', pg_temp.bfx_assign_simple(v_tid1, 32), v_ver);
    v_ok := (v_r ->> 'reason') = 'bracket_locked';
    call pg_temp.bfx_chk(22, 'T1. lock 후 일괄 배치 차단', v_ok, v_r::text);

    select id into v_slot from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid1 and round_no = 1 and position = 1;
    v_r := public.assign_bracket_slot('zz-fixture-bracket-32', v_slot, 'bye', null, v_ver);
    v_ok := (v_r ->> 'reason') = 'bracket_locked';
    call pg_temp.bfx_chk(23, 'T1. lock 후 단일 자리 변경 차단', v_ok, v_r::text);

    -- unlock
    v_r := public.unlock_bracket('zz-fixture-bracket-32', null, v_ver);
    v_ok := (v_r ->> 'reason') = 'reason_required';
    call pg_temp.bfx_chk(30, 'T1. unlock 사유 없음 → reason_required', v_ok, v_r::text);

    v_r := public.unlock_bracket('zz-fixture-bracket-32', 'ZZ 사유', v_ver + 5);
    v_ok := (v_r ->> 'reason') = 'version_conflict';
    call pg_temp.bfx_chk(31, 'T1. version conflict → 거부', v_ok, v_r::text);

    v_r := public.unlock_bracket('zz-fixture-bracket-32', 'ZZ 구조 수정 필요', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    select (status = 'draft' and locked_at is null and published_at is null) into v_ok
      from public.hosted_tournament_brackets where id = v_bid1;
    v_ok := v_ok and (v_r ->> 'ok')::boolean;
    call pg_temp.bfx_chk(32, 'T1. unlock 성공 → draft · locked_at/published_at 해제', v_ok, v_r::text);

    select count(*) into v_cnt from public.hosted_tournament_events
     where tournament_id = v_tid1 and entity_type = 'bracket'
       and action = 'unlock_bracket' and note = 'ZZ 구조 수정 필요';
    v_ok := v_cnt = 1;
    call pg_temp.bfx_chk(33, 'T1. unlock 사유가 이벤트에 기록', v_ok, v_cnt::text);

    v_r := public.set_bracket_structure('zz-fixture-bracket-32',
              pg_temp.bfx_structure(array[32,16,8,4,2,1], array['32강','16강','8강','4강','결승','우승']), v_ver);
    v_ok := (v_r ->> 'reason') = 'slots_in_use';
    call pg_temp.bfx_chk(34, 'T1. 배치 남은 상태 구조 변경 → slots_in_use', v_ok, v_r::text);

    select count(*) into v_cnt from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid1 and round_no = 1 and slot_type = 'team';
    v_ok := v_cnt = 32;
    call pg_temp.bfx_chk(35, 'T1. 거부 후 배치 그대로(자동 초기화 없음)', v_ok, v_cnt::text);

    -- =====================================================================
    -- T2 — 40 entrants + 경기이사가 지정한 BYE (★ 자동 배치 금지 검증)
    -- =====================================================================
    v_tid2 := pg_temp.bfx_tournament('zz-fixture-bracket-40', 40);
    v_r := public.create_bracket('zz-fixture-bracket-40', '본선', 40);
    v_bid2 := (v_r ->> 'bracketId')::uuid;

    v_r := public.set_bracket_entrants('zz-fixture-bracket-40', pg_temp.bfx_entrants(v_tid2, 40), 1);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'entrantCount')::int = 40;
    call pg_temp.bfx_chk(40, 'T2. 진출팀 40팀 스냅샷', v_ok, v_r::text);

    -- 경기이사가 정한 구조: 1라운드 64자리(팀 40 + BYE 24) → 32 → 16 → 8 → 4 → 2 → 우승 1
    v_r := public.set_bracket_structure('zz-fixture-bracket-40',
              pg_temp.bfx_structure(array[64,32,16,8,4,2,1],
                                    array['예선 라운드','32강','16강','8강','4강','결승','우승']), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'slots')::int = 127;
    call pg_temp.bfx_chk(41, 'T2. 7라운드 · 127자리 구조', v_ok, v_r::text);

    -- ★ 경기이사가 직접 정한 배치
    --   position 1..16  = 팀 16개(서로 경기)
    --   position 17..64 = 홀수 자리 팀 24개 / 짝수 자리 BYE 24개
    drop table if exists _bfx_in;
    create temp table _bfx_in (position integer, slot_type text, team_no integer);
    for v_i in 1..16 loop
        insert into _bfx_in values (v_i, 'team', v_i);
    end loop;
    for v_i in 17..64 loop
        if v_i % 2 = 1 then
            insert into _bfx_in values (v_i, 'team', 16 + (v_i - 15) / 2);
        else
            insert into _bfx_in values (v_i, 'bye', null);
        end if;
    end loop;
    select string_agg(position::text, ',' order by position) into v_in_byes
      from _bfx_in where slot_type = 'bye';

    select jsonb_agg(jsonb_build_object('position', i.position, 'type', i.slot_type, 'teamId', t.id)
                     order by i.position)
      into v_r
      from _bfx_in i
      left join public.hosted_tournament_teams t
        on t.tournament_id = v_tid2 and t.team_no = i.team_no;
    v_r := public.replace_bracket_slots('zz-fixture-bracket-40', v_r, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'assigned')::int = 40 and (v_r ->> 'byes')::int = 24;
    call pg_temp.bfx_chk(42, 'T2. 64자리 일괄 배치(팀 40 · BYE 24)', v_ok, v_r::text);

    -- ★★ 시스템이 BYE 위치를 고르지 않았음: 입력 position 집합 == 저장 position 집합
    select string_agg(position::text, ',' order by position) into v_out_byes
      from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid2 and round_no = 1 and slot_type = 'bye';
    v_ok := v_in_byes = v_out_byes;
    v_txt := 'in=' || left(coalesce(v_in_byes, '-'), 50) || ' out=' || left(coalesce(v_out_byes, '-'), 50);
    call pg_temp.bfx_chk(43, 'T2. ★ BYE position 집합이 입력과 완전히 동일(자동 선택 없음)', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid2 and slot_type = 'bye';
    v_ok := v_cnt = 24;
    select count(*) into v_i from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid2 and slot_type = 'bye' and round_no > 1;
    v_ok := v_ok and v_i = 0;
    call pg_temp.bfx_chk(44, 'T2. BYE 수 불변 · 다른 라운드에 BYE 생성 없음', v_ok, v_cnt::text);

    v_v := public.validate_bracket('zz-fixture-bracket-40');
    v_ok := (v_v ->> 'ok')::boolean
            and (v_v -> 'summary' ->> 'matchesToCreate')::int = 8
            and (v_v -> 'summary' ->> 'byeAdvances')::int = 24;
    v_txt := (v_v -> 'summary')::text;
    call pg_temp.bfx_chk(45, 'T2. validate ok · 만들 경기 8 · BYE 진출 24', v_ok, v_txt);

    v_r := public.lock_bracket('zz-fixture-bracket-40', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean;
    v_txt := (v_r -> 'summary')::text;
    call pg_temp.bfx_chk(46, 'T2. 40팀 bracket lock 성공', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid2 and stage = 'knockout';
    select count(*) into v_i from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid2 and slot_type = 'bye';
    v_ok := v_cnt = 0 and v_i = 24;
    call pg_temp.bfx_chk(47, 'T2. lock 후에도 경기 생성 · BYE 전달 없음(4C 범위)', v_ok, v_cnt::text);

    v_ok := v_v::text not like '%declared_count_mismatch%';
    call pg_temp.bfx_chk(48, 'T2. 선언 수와 실제가 같으면 경고 없음', v_ok, null);

    -- =====================================================================
    -- T3 — 실패 케이스 모음
    -- =====================================================================
    v_tid3 := pg_temp.bfx_tournament('zz-fixture-bracket-bad', 8);
    v_r := public.create_bracket('zz-fixture-bracket-bad', '본선', 9);   -- 선언 9 vs 실제 8 → warning
    v_bid3 := (v_r ->> 'bracketId')::uuid;

    select jsonb_agg(x) into v_r from (
        select jsonb_build_object('teamId', t.id, 'source', 'manual') as x
          from public.hosted_tournament_teams t
         where t.tournament_id = v_tid3 and t.team_no <= 2
        union all
        select jsonb_build_object('teamId', t.id, 'source', 'manual')
          from public.hosted_tournament_teams t
         where t.tournament_id = v_tid3 and t.team_no = 1) q;
    v_r := public.set_bracket_entrants('zz-fixture-bracket-bad', v_r, 1);
    v_ok := (v_r ->> 'reason') = 'duplicate_entrant';
    call pg_temp.bfx_chk(50, 'T3. 중복 진출팀 → duplicate_entrant', v_ok, v_r::text);

    select id into v_team_other from public.hosted_tournament_teams
     where tournament_id = v_tid1 and team_no = 1;
    v_r := public.set_bracket_entrants('zz-fixture-bracket-bad',
              jsonb_build_array(jsonb_build_object('teamId', v_team_other, 'source', 'manual')), 1);
    v_ok := (v_r ->> 'reason') = 'team_not_found';
    call pg_temp.bfx_chk(51, 'T3. 다른 대회 팀 → team_not_found', v_ok, v_r::text);

    v_r := public.set_bracket_entrants('zz-fixture-bracket-bad', pg_temp.bfx_entrants(v_tid3, 8), 1);
    v_ver := (v_r ->> 'version')::integer;

    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              jsonb_build_object('rounds', jsonb_build_array(
                  jsonb_build_object('roundNo', 1, 'name', '8강', 'slots', 8))), v_ver);
    v_ok := (v_r ->> 'reason') = 'connections_required';
    call pg_temp.bfx_chk(52, 'T3. connections 없음 → connections_required', v_ok, v_r::text);

    select jsonb_agg(jsonb_build_object('roundNo', 1, 'position', p, 'feedsPosition', (p + 1) / 2))
      into v_v from generate_series(1, 8) p;
    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              jsonb_build_object('rounds', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'name', '8강', 'slots', 8),
                      jsonb_build_object('roundNo', 2, 'name', '4강', 'slots', 4)),
                  'connections', v_v), v_ver);
    v_ok := (v_r ->> 'reason') = 'final_round_invalid';
    call pg_temp.bfx_chk(53, 'T3. 우승 라운드 없음 → final_round_invalid', v_ok, v_r::text);

    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              jsonb_build_object('rounds', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'name', 'A', 'slots', 2),
                      jsonb_build_object('roundNo', 3, 'name', 'B', 'slots', 1, 'isFinalSlot', true)),
                  'connections', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'position', 1, 'feedsPosition', 1),
                      jsonb_build_object('roundNo', 1, 'position', 2, 'feedsPosition', 1))), v_ver);
    v_ok := (v_r ->> 'reason') = 'round_gap';
    call pg_temp.bfx_chk(54, 'T3. 라운드 번호 불연속 → round_gap', v_ok, v_r::text);

    select jsonb_agg(jsonb_build_object('roundNo', 1, 'position', p, 'feedsPosition', 1))
      into v_v from generate_series(1, 5) p;
    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              jsonb_build_object('rounds', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'name', 'A', 'slots', 4),
                      jsonb_build_object('roundNo', 2, 'name', 'B', 'slots', 2),
                      jsonb_build_object('roundNo', 3, 'name', 'C', 'slots', 1, 'isFinalSlot', true)),
                  'connections', v_v), v_ver);
    v_ok := (v_r ->> 'reason') = 'invalid_connection';
    call pg_temp.bfx_chk(55, 'T3. 없는 자리로의 연결 → invalid_connection', v_ok, v_r::text);

    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              jsonb_build_object('rounds', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'name', 'A', 'slots', 4),
                      jsonb_build_object('roundNo', 2, 'name', 'B', 'slots', 2),
                      jsonb_build_object('roundNo', 3, 'name', 'C', 'slots', 1, 'isFinalSlot', true)),
                  'connections', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'position', 1, 'feedsPosition', 1))), v_ver);
    v_ok := (v_r ->> 'reason') = 'connection_count_mismatch';
    call pg_temp.bfx_chk(56, 'T3. 연결 수 부족 → connection_count_mismatch', v_ok, v_r::text);

    -- feeder 수 이상(1라운드 3자리가 같은 destination 으로)
    select jsonb_agg(c) into v_v from (
        select jsonb_build_object('roundNo', 1, 'position', p,
               'feedsPosition', case when p <= 3 then 1 else (p + 1) / 2 end) as c
          from generate_series(1, 8) p
        union all
        select jsonb_build_object('roundNo', 2, 'position', p, 'feedsPosition', (p + 1) / 2)
          from generate_series(1, 4) p
        union all
        select jsonb_build_object('roundNo', 3, 'position', p, 'feedsPosition', 1)
          from generate_series(1, 2) p) q;
    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              jsonb_build_object('rounds', jsonb_build_array(
                      jsonb_build_object('roundNo', 1, 'name', '8강', 'slots', 8),
                      jsonb_build_object('roundNo', 2, 'name', '4강', 'slots', 4),
                      jsonb_build_object('roundNo', 3, 'name', '결승', 'slots', 2),
                      jsonb_build_object('roundNo', 4, 'name', '우승', 'slots', 1, 'isFinalSlot', true)),
                  'connections', v_v), v_ver);
    v_ver := coalesce((v_r ->> 'version')::integer, v_ver);
    v_v := public.validate_bracket('zz-fixture-bracket-bad');
    v_ok := v_v::text like '%feeder_count_invalid%';
    v_txt := (v_v -> 'issues')::text;
    call pg_temp.bfx_chk(57, 'T3. feeder 수 이상 → feeder_count_invalid', v_ok, left(v_txt, 200));

    v_r := public.set_bracket_structure('zz-fixture-bracket-bad',
              pg_temp.bfx_structure(array[8,4,2,1], array['8강','4강','결승','우승']), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean;
    call pg_temp.bfx_chk(58, 'T3. 정상 구조로 재설정', v_ok, v_r::text);

    -- 단일 자리 배치 실패 케이스
    select id into v_slot from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid3 and round_no = 1 and position = 1;
    select id into v_slot2 from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid3 and round_no = 2 and position = 1;

    v_r := public.assign_bracket_slot('zz-fixture-bracket-bad', v_slot2, 'bye', null, v_ver);
    v_ok := (v_r ->> 'reason') = 'slot_not_editable';
    call pg_temp.bfx_chk(60, 'T3. 2라운드 자리 직접 편집 → slot_not_editable', v_ok, v_r::text);

    v_r := public.assign_bracket_slot('zz-fixture-bracket-bad', v_slot, 'team', v_team_other, v_ver);
    v_ok := (v_r ->> 'reason') = 'team_not_entrant';
    call pg_temp.bfx_chk(61, 'T3. 진출팀 아닌 팀 배치 → team_not_entrant', v_ok, v_r::text);

    select id into v_team from public.hosted_tournament_teams
     where tournament_id = v_tid3 and team_no = 1;
    v_r := public.assign_bracket_slot('zz-fixture-bracket-bad', v_slot, 'team', v_team, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean;
    call pg_temp.bfx_chk(62, 'T3. 단일 자리 배치 성공', v_ok, v_r::text);

    select id into v_slot2 from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid3 and round_no = 1 and position = 2;
    v_r := public.assign_bracket_slot('zz-fixture-bracket-bad', v_slot2, 'team', v_team, v_ver);
    v_ok := (v_r ->> 'reason') = 'team_already_placed';
    call pg_temp.bfx_chk(63, 'T3. 같은 팀 두 자리 → team_already_placed', v_ok, v_r::text);

    -- 일괄 배치 원자성: 마지막 항목이 잘못되면 전량 미반영
    select count(*) into v_cnt from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid3 and round_no = 1 and slot_type = 'team';
    select jsonb_agg(jsonb_build_object('position', p, 'type', case when p = 8 then 'team' else 'bye' end,
                                        'teamId', case when p = 8 then v_team_other else null end) order by p)
      into v_v from generate_series(1, 8) p;
    v_r := public.replace_bracket_slots('zz-fixture-bracket-bad', v_v, v_ver);
    v_ok := (v_r ->> 'reason') = 'team_not_entrant';
    call pg_temp.bfx_chk(64, 'T3. 일괄 배치 중 오류 → 거부', v_ok, v_r::text);

    select count(*) into v_i from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid3 and round_no = 1 and slot_type = 'team';
    v_ok := v_i = v_cnt;
    v_txt := 'before=' || v_cnt || ' after=' || v_i;
    call pg_temp.bfx_chk(65, 'T3. 일괄 배치 원자성(부분 반영 없음)', v_ok, v_txt);

    v_r := public.replace_bracket_slots('zz-fixture-bracket-bad',
              jsonb_build_array(jsonb_build_object('position', 1, 'type', 'bye')), v_ver);
    v_ok := (v_r ->> 'reason') = 'position_count_mismatch';
    call pg_temp.bfx_chk(66, 'T3. 자리 수 불일치 → position_count_mismatch', v_ok, v_r::text);

    -- BYE vs BYE + 진출팀 일부 미배치
    select jsonb_agg(jsonb_build_object('position', p,
               'type', case when p <= 2 then 'bye' else 'team' end,
               'teamId', case when p <= 2 then null else
                   (select id from public.hosted_tournament_teams
                     where tournament_id = v_tid3 and team_no = p) end) order by p)
      into v_v from generate_series(1, 8) p;
    v_r := public.replace_bracket_slots('zz-fixture-bracket-bad', v_v, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'byes')::int = 2;
    call pg_temp.bfx_chk(69, 'T3. BYE 2개 배치(경기이사 지정)', v_ok, v_r::text);

    v_v := public.validate_bracket('zz-fixture-bracket-bad');
    v_ok := v_v::text like '%bye_vs_bye%';
    call pg_temp.bfx_chk(70, 'T3. BYE vs BYE → validate 실패', v_ok, null);

    v_ok := v_v::text like '%entrant_not_placed%';
    call pg_temp.bfx_chk(71, 'T3. 진출팀 일부 미배치 → entrant_not_placed', v_ok, null);

    v_ok := v_v::text like '%declared_count_mismatch%';
    call pg_temp.bfx_chk(72, 'T3. 선언 수 불일치 → declared_count_mismatch(warning)', v_ok, null);

    v_r := public.lock_bracket('zz-fixture-bracket-bad', v_ver);
    v_ok := (v_r ->> 'reason') = 'validation_failed';
    call pg_temp.bfx_chk(73, 'T3. BYE vs BYE 상태 lock 차단', v_ok, v_r::text);

    -- =====================================================================
    -- 공통 — 조회 · 권한 · 운영 데이터
    -- =====================================================================
    v_r := public.get_admin_bracket('zz-fixture-bracket-32');
    v_ok := (v_r ->> 'ok')::boolean
            and jsonb_array_length(v_r -> 'rounds') = 6
            and jsonb_array_length(v_r -> 'slots') = 63
            and jsonb_array_length(v_r -> 'entrants') = 32;
    call pg_temp.bfx_chk(80, 'get_admin_bracket: 라운드 6 · 자리 63 · 진출팀 32', v_ok, null);

    v_txt := v_r::text;
    v_ok := v_txt not like '%player1Phone%' and v_txt not like '%depositor%'
            and v_txt not like '%adminNote%' and v_txt not like '%pairKey%';
    call pg_temp.bfx_chk(81, 'get_admin_bracket: 접수 개인정보 없음', v_ok, null);

    execute 'set local role anon';
    begin
        execute 'select count(*) from public.hosted_tournament_brackets' into v_i;
        v_err := 'SELECTED';
    exception when insufficient_privilege then v_err := 'DENIED'; end;
    begin
        execute 'select public.create_bracket(''zz-fixture-bracket-32'')';
        v_txt := 'CALLED';
    exception when insufficient_privilege then v_txt := 'DENIED'; end;
    begin
        execute 'select public.get_admin_bracket(''zz-fixture-bracket-32'')';
        v_msg := 'CALLED';
    exception when insufficient_privilege then v_msg := 'DENIED'; end;
    execute 'reset role';
    v_ok := v_err = 'DENIED';
    call pg_temp.bfx_chk(90, 'anon: bracket 테이블 SELECT 차단', v_ok, v_err);
    v_ok := v_txt = 'DENIED';
    call pg_temp.bfx_chk(91, 'anon: create_bracket 차단', v_ok, v_txt);
    v_ok := v_msg = 'DENIED';
    call pg_temp.bfx_chk(92, 'anon: get_admin_bracket 차단', v_ok, v_msg);

    perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid()::text)::text, true);
    begin
        v_v := public.validate_bracket('zz-fixture-bracket-32');
        v_err := 'CALLED';
    exception when others then v_err := sqlerrm; end;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);
    v_ok := v_err like '%not authorized%';
    call pg_temp.bfx_chk(93, '운영진 아닌 사용자: validate_bracket 거부', v_ok, v_err);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where bracket_id is not null or bracket_target_slot_id is not null;
    v_ok := v_cnt = 0;
    call pg_temp.bfx_chk(95, 'matches 의 bracket 컬럼은 전부 NULL(4A 는 경기를 만들지 않음)', v_ok, v_cnt::text);

    select coalesce(string_agg(s, ','), '') into v_prod_after from (
        select r.registration_status || '=' || count(*) as s
          from public.hosted_tournament_registrations r
          join public.hosted_tournaments t on t.id = r.tournament_id
         where t.slug = '2026-teyeon-open' group by r.registration_status order by 1) q;
    v_ok := v_prod_before = v_prod_after;
    call pg_temp.bfx_chk(96, '2026-teyeon-open 접수 상태 분포 불변', v_ok, null);

    select count(*) into v_cnt from public.hosted_tournament_brackets b
      join public.hosted_tournaments t on t.id = b.tournament_id
     where t.slug = '2026-teyeon-open';
    v_ok := v_cnt = 0;
    call pg_temp.bfx_chk(97, '2026-teyeon-open 에 bracket 생성 없음', v_ok, v_cnt::text);

    -- ── 결과 → 전량 롤백 ──────────────────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from pg_temp._bfx;
    select coalesce(string_agg(seq || ' ' || name || coalesce(' <' || left(info, 140) || '>', ''), ' | ' order by seq), '')
      into v_msg from pg_temp._bfx where not ok;
    raise exception 'BRACKET 4A FIXTURE (전량 롤백)  PASS=%  FAIL=%  → %', v_pass, v_fail,
        case when v_fail = 0 then 'ALL PASS' else 'FAIL: ' || v_msg end;
end
$fixture$;
