-- ============================================================================
--  2026 TEYEON OPEN — 공개 본선 대진 실동작 self-test (Batch 4D-2 fixture)
--
--  임시 대회에서 **실제 RPC** 로 공개 계약 전체를 검증한다.
--    publish_bracket · unpublish_bracket · get_public_knockout_bracket
--    + 미반영 qualifier 공개 · 반영 후 출처 보존 · BYE/TBD · 경기 상태 · 우승
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ CALL 인자에는 식을 직접 넣지 않는다. v_ok / v_txt 에 먼저 계산해서 넘긴다.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--  선행: 4A · 4C · 4D-0 · add_hosted_tournament_public_knockout.sql
-- ============================================================================
do $fixture$
declare
    v_uid    uuid;
    v_pass   integer;
    v_fail   integer;
    v_msg    text;
    v_ok     boolean;
    v_r      jsonb;
    v_pub    jsonb;
    v_txt    text;
    v_cnt    integer;
    v_tid    uuid;
    v_bid    uuid;
    v_ver    integer;
    v_mver   integer;
    v_mid    uuid;
    v_prod_before text;
    v_prod_after  text;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug like 'zz-fixture-pk%') then
        raise exception '이전 self-test 잔재가 있다. 먼저 확인·정리하라.';
    end if;
    if to_regprocedure('public.get_public_knockout_bracket(text)') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_public_knockout.sql)이 적용되지 않았다.';
    end if;
    select p.id into v_uid
      from public.profiles p join auth.users u on u.id = p.id
     where p.role in ('CEO', 'ADMIN') order by p.id limit 1;
    if v_uid is null then
        raise exception 'CEO/ADMIN profile 이 없어 운영 RPC 를 호출할 수 없다.';
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);

    select coalesce(string_agg(b.status || '/' || coalesce(b.published_at::text, 'null'), ','), '')
      into v_prod_before
      from public.hosted_tournament_brackets b
      join public.hosted_tournaments t on t.id = b.tournament_id
     where t.slug = '2026-teyeon-open';

    create temp table _pfx (seq integer, name text, ok boolean, info text);
    execute $q$
        create procedure pg_temp.pfx_chk(p_seq integer, p_name text, p_ok boolean, p_info text default null)
        language sql as $p$ insert into pg_temp._pfx values (p_seq, p_name, coalesce(p_ok, false), p_info); $p$;
    $q$;
    execute $q$
        create function pg_temp.pfx_tournament(p_slug text, p_groups integer) returns uuid
        language plpgsql as $f$
        declare v_tid uuid; i integer;
        begin
            insert into public.hosted_tournaments
            select * from jsonb_populate_record(
                null::public.hosted_tournaments,
                (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
                || jsonb_build_object('id', gen_random_uuid()::text, 'slug', p_slug,
                                      'title', 'ZZ ' || p_slug, 'status', 'registration_closed',
                                      'created_at', now()::text, 'updated_at', now()::text))
            returning id into v_tid;
            for i in 1..(p_groups * 3) loop
                insert into public.hosted_tournament_teams
                    (tournament_id, team_no, player1_name, player2_name, source, status)
                values (v_tid, i, 'ZZ선수A' || i, 'ZZ선수B' || i, 'fixture', 'active');
            end loop;
            for i in 1..2 loop
                insert into public.hosted_tournament_courts
                    (tournament_id, court_no, display_order, status)
                values (v_tid, i, i, 'active');
            end loop;
            for i in 1..p_groups loop
                insert into public.hosted_tournament_groups
                    (tournament_id, group_no, group_type, expected_size, display_order)
                values (v_tid, i, 'preliminary', 3, i);
            end loop;
            insert into public.hosted_tournament_group_members (tournament_id, group_id, team_id, slot_no)
            select g.tournament_id, g.id, t.id, ((t.team_no - 1) % 3) + 1
              from public.hosted_tournament_groups g
              join public.hosted_tournament_teams t
                on t.tournament_id = g.tournament_id and ((t.team_no - 1) / 3) + 1 = g.group_no
             where g.tournament_id = v_tid;
            return v_tid;
        end $f$;
    $q$;
    execute $q$
        create function pg_temp.pfx_structure(p_counts integer[], p_names text[]) returns jsonb
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
    -- 조 경기 전부 완료(번호 작은 팀이 이긴다) — 예선 순위 확정용
    execute $q$
        create function pg_temp.pfx_play(p_tid uuid, p_group_no integer) returns void
        language plpgsql as $f$
        declare v_gid uuid; v_base integer; r record; v_seq integer := 0;
        begin
            select id into v_gid from public.hosted_tournament_groups
             where tournament_id = p_tid and group_no = p_group_no;
            select coalesce(max(match_no), 0) into v_base
              from public.hosted_tournament_matches where tournament_id = p_tid;
            for r in
                select a.id a_id, b.id b_id, a.team_no a_no
                  from public.hosted_tournament_group_members ma
                  join public.hosted_tournament_teams a on a.id = ma.team_id
                  join public.hosted_tournament_group_members mb on mb.group_id = ma.group_id
                  join public.hosted_tournament_teams b on b.id = mb.team_id
                 where ma.group_id = v_gid and a.team_no < b.team_no
                 order by a.team_no, b.team_no
            loop
                v_seq := v_seq + 1; v_base := v_base + 1;
                insert into public.hosted_tournament_matches
                    (tournament_id, stage, group_id, sequence_no, match_no, team1_id, team2_id,
                     status, score1, score2, winner_team_id, completed_at)
                values (p_tid, 'preliminary', v_gid, v_seq, v_base, r.a_id, r.b_id,
                        'completed', 6, 2, r.a_id, now());
            end loop;
        end $f$;
    $q$;
    -- 공개 payload 안에 내부 UUID 가 있는가
    execute $q$
        create function pg_temp.pfx_has_uuid(p_json jsonb) returns boolean
        language sql immutable as $f$
            select p_json::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
        $f$;
    $q$;
    -- 공개 자리 한 줄 요약
    execute $q$
        create function pg_temp.pfx_slot(p_json jsonb, p_key text) returns text
        language sql immutable as $f$
            select coalesce((
                select (s ->> 'slotType')
                       || coalesce('(' || (s ->> 'sourceLabel') || ')', '')
                       || coalesce('#' || (s -> 'team' ->> 'teamNo'), '')
                       || case when (s ->> 'resolved') = 'true' then '·반영' else '' end
                  from jsonb_array_elements(p_json -> 'slots') s
                 where s ->> 'publicKey' = p_key), '(없음)')
        $f$;
    $q$;

    -- =====================================================================
    -- 준비 — 2조 6팀 / 1R 4자리(qualifier 2 · BYE 1 · 수동 팀 1)
    -- =====================================================================
    v_tid := pg_temp.pfx_tournament('zz-fixture-pk-main', 2);

    v_r   := public.create_bracket('zz-fixture-pk-main', '본선', 3);
    v_bid := (v_r ->> 'bracketId')::uuid;
    v_ver := (v_r ->> 'version')::integer;
    v_r   := public.set_bracket_structure('zz-fixture-pk-main',
                 pg_temp.pfx_structure(array[4,2,1], array['4강','결승','우승']), v_ver);
    v_ver := (v_r ->> 'version')::integer;

    -- 수동 팀 자리를 쓰려면 진출팀 확정이 선행된다(4A 규칙).
    v_r   := public.set_bracket_entrants('zz-fixture-pk-main',
                 (select jsonb_agg(jsonb_build_object('teamId', t.id, 'source', 'manual'))
                    from public.hosted_tournament_teams t
                   where t.tournament_id = v_tid and t.team_no = 6), v_ver);
    v_ver := (v_r ->> 'version')::integer;

    v_r := public.replace_bracket_slots('zz-fixture-pk-main', jsonb_build_array(
               jsonb_build_object('position', 1, 'type', 'qualifier', 'groupNo', 1, 'rank', 1),
               jsonb_build_object('position', 2, 'type', 'bye'),
               jsonb_build_object('position', 3, 'type', 'qualifier', 'groupNo', 2, 'rank', 1),
               jsonb_build_object('position', 4, 'type', 'team',
                                  'teamId', (select t.id from public.hosted_tournament_teams t
                                              where t.tournament_id = v_tid and t.team_no = 6))), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'qualifiers')::integer = 2
             and (v_r ->> 'byes')::integer = 1 and (v_r ->> 'assigned')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.pfx_chk(1, '준비. 1R 배치(예선 순위 2 · 부전승 1 · 수동 팀 1)', v_ok, v_txt);

    -- =====================================================================
    -- A. 공개 계약
    -- =====================================================================
    v_r   := public.publish_bracket('zz-fixture-pk-main', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_not_locked';
    v_txt := v_r::text;
    call pg_temp.pfx_chk(2, 'A. 경로 확정 전에는 공개할 수 없다', v_ok, v_txt);

    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    v_ok  := (v_pub ->> 'available')::boolean is false and v_pub ->> 'reason' = 'not_published'
             and (v_pub -> 'slots') is null and (v_pub -> 'bracket') is null;
    v_txt := v_pub::text;
    call pg_temp.pfx_chk(3, 'A. 미공개 상태는 내부 구조를 주지 않는다', v_ok, v_txt);

    v_r   := public.lock_bracket('zz-fixture-pk-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.pfx_chk(4, 'A. 본선 경로 확정(lock)', v_ok, v_txt);

    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    v_ok  := (v_pub ->> 'available')::boolean is false;
    v_txt := v_pub::text;
    call pg_temp.pfx_chk(5, 'A. 확정만으로는 공개되지 않는다(자동 공개 없음)', v_ok, v_txt);

    v_r   := public.publish_bracket('zz-fixture-pk-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'publishedAt') is not null
             and (v_r -> 'warnings')::text like '%qualifiers_unresolved%';
    v_txt := v_r::text;
    call pg_temp.pfx_chk(6, 'A. 확정 후 공개 성공(미반영 자리는 경고만)', v_ok, v_txt);

    v_r   := public.publish_bracket('zz-fixture-pk-main', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'already_published';
    v_txt := v_r::text;
    call pg_temp.pfx_chk(7, 'A. 중복 공개 거부', v_ok, v_txt);

    -- =====================================================================
    -- B. 공개 payload — 미반영 qualifier
    -- =====================================================================
    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    v_ok  := (v_pub ->> 'available')::boolean
             and (v_pub -> 'publication' ->> 'published')::boolean
             and (v_pub -> 'publication' ->> 'bracketStatus') = 'locked';
    v_txt := (v_pub -> 'publication')::text;
    call pg_temp.pfx_chk(10, 'B. 공개 상태로 조회된다', v_ok, v_txt);

    v_txt := pg_temp.pfx_slot(v_pub, 'r1p1');
    v_ok  := v_txt = 'qualifier(1조 1위)';
    call pg_temp.pfx_chk(11, 'B. 실제 팀이 없어도 ‘1조 1위’ 를 공개한다', v_ok, v_txt);

    v_txt := pg_temp.pfx_slot(v_pub, 'r1p2');
    v_ok  := v_txt = 'bye';
    call pg_temp.pfx_chk(12, 'B. 부전승 자리 공개', v_ok, v_txt);

    v_txt := pg_temp.pfx_slot(v_pub, 'r1p4');
    v_ok  := v_txt = 'team#6';
    call pg_temp.pfx_chk(13, 'B. 수동 배치 팀 공개', v_ok, v_txt);

    v_txt := pg_temp.pfx_slot(v_pub, 'r2p1');
    v_ok  := v_txt = 'tbd';
    call pg_temp.pfx_chk(14, 'B. 2라운드는 승자 대기(tbd)로 공개', v_ok, v_txt);

    select string_agg(r ->> 'publicKey', ' ' order by (r ->> 'roundNo')::integer) into v_txt
      from jsonb_array_elements(v_pub -> 'rounds') r;
    v_ok := v_txt = 'r1 r2 r3';
    call pg_temp.pfx_chk(15, 'B. 라운드 공개 키(r1 · r2 · r3)', v_ok, v_txt);

    select s ->> 'feedsSlotPublicKey' into v_txt
      from jsonb_array_elements(v_pub -> 'slots') s where s ->> 'publicKey' = 'r1p3';
    v_ok := v_txt = 'r2p2';
    call pg_temp.pfx_chk(16, 'B. 자리 연결도 공개 키로 표현', v_ok, v_txt);

    v_ok  := pg_temp.pfx_has_uuid(v_pub) is false;
    v_txt := 'UUID 포함 여부 ' || pg_temp.pfx_has_uuid(v_pub)::text;
    call pg_temp.pfx_chk(17, 'B. 공개 payload 에 내부 UUID 가 없다', v_ok, v_txt);

    v_ok  := v_pub::text not like '%phone%' and v_pub::text not like '%email%'
             and v_pub::text not like '%depositor%' and v_pub::text not like '%registration%'
             and v_pub::text not like '%validation%' and v_pub::text not like '%entrant%';
    v_txt := '개인정보 · 운영 필드 부재';
    call pg_temp.pfx_chk(18, 'B. 개인정보 · 운영 데이터가 없다', v_ok, v_txt);

    v_ok  := (v_pub -> 'champion') = 'null'::jsonb;
    v_txt := (v_pub -> 'champion')::text;
    call pg_temp.pfx_chk(19, 'B. 본선 완료 전에는 우승자가 없다', v_ok, v_txt);

    v_cnt := jsonb_array_length(v_pub -> 'matches');
    v_ok  := v_cnt = 0;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.pfx_chk(20, 'B. 아직 경기가 없으면 빈 목록', v_ok, v_txt);

    -- =====================================================================
    -- C. 예선 결과 반영 후 — 출처 보존 + 경기 공개
    -- =====================================================================
    perform pg_temp.pfx_play(v_tid, 1);
    perform pg_temp.pfx_play(v_tid, 2);

    v_r   := public.resolve_bracket_qualifiers('zz-fixture-pk-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'resolvedCount')::integer = 2;
    v_txt := v_r::text;
    call pg_temp.pfx_chk(30, 'C. 예선 결과 반영(2자리)', v_ok, v_txt);

    v_r   := public.materialize_bracket_matches('zz-fixture-pk-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'created')::integer = 1
             and (v_r ->> 'byeAdvanced')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.pfx_chk(31, 'C. 경기 생성 + 부전승 진출', v_ok, v_txt);

    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    v_txt := pg_temp.pfx_slot(v_pub, 'r1p1');
    v_ok  := v_txt = 'team(1조 1위)#1·반영';
    call pg_temp.pfx_chk(32, 'C. 반영 뒤에도 출처를 덮어쓰지 않는다(1조 1위 + 팀)', v_ok, v_txt);

    v_txt := pg_temp.pfx_slot(v_pub, 'r2p1');
    v_ok  := v_txt = 'team#1';
    call pg_temp.pfx_chk(33, 'C. 부전승으로 올라간 자리도 공개', v_ok, v_txt);

    select m ->> 'publicKey' || '/' || (m ->> 'status')
           || '/' || (m -> 'team1' ->> 'publicKey') || 'vs' || (m -> 'team2' ->> 'publicKey')
      into v_txt
      from jsonb_array_elements(v_pub -> 'matches') m limit 1;
    v_ok := v_txt = 'r1m2/waiting/t4vst6';
    call pg_temp.pfx_chk(34, 'C. 경기 공개(키 · 상태 · 양 팀)', v_ok, v_txt);

    select m -> 'feederSlotPublicKeys' into v_r
      from jsonb_array_elements(v_pub -> 'matches') m limit 1;
    v_ok  := v_r::text = '["r1p3", "r1p4"]' or v_r::text = '["r1p3","r1p4"]';
    v_txt := v_r::text;
    call pg_temp.pfx_chk(35, 'C. 경기의 출발 자리도 공개 키로', v_ok, v_txt);

    select (m ->> 'score1') is null and (m ->> 'courtNo') is null into v_ok
      from jsonb_array_elements(v_pub -> 'matches') m limit 1;
    v_txt := '대기 경기 — 점수 · 코트 없음';
    call pg_temp.pfx_chk(36, 'C. 시작 전 경기는 점수 · 코트를 주지 않는다', v_ok, v_txt);

    -- 진행 → 코트 공개 / 점수는 아직 없음
    select id, version into v_mid, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout' limit 1;
    v_r := public.call_match(v_mid, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_mid;
    v_r := public.start_match(v_mid, 1, v_mver);

    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    select (m ->> 'status') || '/' || coalesce((m ->> 'courtNo'), 'null')
           || '/' || coalesce((m ->> 'score1'), 'null') into v_txt
      from jsonb_array_elements(v_pub -> 'matches') m where (m ->> 'matchNo')::integer =
           (select match_no from public.hosted_tournament_matches where id = v_mid);
    v_ok := v_txt = 'playing/1/null';
    call pg_temp.pfx_chk(37, 'C. 진행 중에는 코트만(점수는 아직 없음)', v_ok, v_txt);

    -- 완료 → 점수 · 승자 side 공개
    select version into v_mver from public.hosted_tournament_matches where id = v_mid;
    v_r := public.complete_knockout_match(v_mid, 6, 3, v_mver);
    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    select (m ->> 'status') || '/' || (m ->> 'score1') || ':' || (m ->> 'score2')
           || '/W' || (m ->> 'winnerSide') into v_txt
      from jsonb_array_elements(v_pub -> 'matches') m where (m ->> 'matchNo')::integer =
           (select match_no from public.hosted_tournament_matches where id = v_mid);
    v_ok := v_txt = 'completed/6:3/W1';
    call pg_temp.pfx_chk(38, 'C. 완료 경기는 점수 · 승자(side)를 공개', v_ok, v_txt);

    v_ok  := pg_temp.pfx_has_uuid(v_pub) is false;
    v_txt := 'UUID 포함 여부 ' || pg_temp.pfx_has_uuid(v_pub)::text;
    call pg_temp.pfx_chk(39, 'C. 경기까지 있는 payload 에도 UUID 없음', v_ok, v_txt);

    -- =====================================================================
    -- D. 결승 완료 → 우승자 공개
    -- =====================================================================
    select id, version into v_mid, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout' and status = 'waiting' limit 1;
    v_r := public.call_match(v_mid, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_mid;
    v_r := public.start_match(v_mid, 2, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_mid;
    v_r := public.complete_knockout_match(v_mid, 6, 1, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'bracketCompleted')::boolean;
    v_txt := v_r::text;
    call pg_temp.pfx_chk(40, 'D. 결승 완료 → 본선 완료', v_ok, v_txt);

    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    v_ok  := (v_pub ->> 'available')::boolean
             and (v_pub -> 'publication' ->> 'bracketStatus') = 'completed'
             and (v_pub -> 'champion' ->> 'teamNo') is not null;
    v_txt := (v_pub -> 'champion')::text;
    call pg_temp.pfx_chk(41, 'D. 완료 후 우승자 공개(공개 유지)', v_ok, v_txt);

    v_ok  := (v_pub -> 'champion' ->> 'publicKey') like 't%'
             and (v_pub -> 'champion' -> 'teamId') is null;
    v_txt := (v_pub -> 'champion')::text;
    call pg_temp.pfx_chk(42, 'D. 우승자도 공개 키만(UUID 없음)', v_ok, v_txt);

    -- =====================================================================
    -- E. 공개 해제
    -- =====================================================================
    select version into v_ver from public.hosted_tournament_brackets where id = v_bid;
    v_r   := public.unpublish_bracket('zz-fixture-pk-main', ' ', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'reason_required';
    v_txt := v_r::text;
    call pg_temp.pfx_chk(50, 'E. 해제 사유 필수', v_ok, v_txt);

    v_r   := public.unpublish_bracket('zz-fixture-pk-main', '표기 오류 확인', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.pfx_chk(51, 'E. 운영 중에도 공개 해제 가능', v_ok, v_txt);

    v_pub := public.get_public_knockout_bracket('zz-fixture-pk-main');
    v_ok  := (v_pub ->> 'available')::boolean is false and (v_pub -> 'slots') is null;
    v_txt := v_pub::text;
    call pg_temp.pfx_chk(52, 'E. 해제하면 다시 비공개', v_ok, v_txt);

    -- 해제는 공개 상태만 되돌린다 — 구조 · 자리 · 경기 · 결과는 그대로다.
    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout';
    v_ok  := v_cnt = 2;
    v_txt := '본선 경기 ' || v_cnt;
    call pg_temp.pfx_chk(53, 'E. 해제해도 경기는 그대로 남는다', v_ok, v_txt);

    select status into v_txt from public.hosted_tournament_brackets where id = v_bid;
    v_ok := v_txt = 'completed';
    call pg_temp.pfx_chk(54, 'E. 해제해도 본선 상태는 그대로', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid and slot_type = 'team';
    v_ok  := v_cnt >= 4;
    v_txt := '팀이 놓인 자리 ' || v_cnt;
    call pg_temp.pfx_chk(55, 'E. 해제해도 자리 배치는 그대로', v_ok, v_txt);

    v_r   := public.unpublish_bracket('zz-fixture-pk-main', '다시 해제', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'not_published';
    v_txt := v_r::text;
    call pg_temp.pfx_chk(56, 'E. 이미 비공개면 해제할 것이 없다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_events
     where tournament_id = v_tid and action in ('publish_bracket', 'unpublish_bracket');
    v_ok  := v_cnt = 2;
    v_txt := '공개 이벤트 ' || v_cnt || '건';
    call pg_temp.pfx_chk(57, 'E. 공개 · 해제가 기록으로 남는다', v_ok, v_txt);

    -- =====================================================================
    -- F. 권한 · 잔재
    -- =====================================================================
    v_ok  := has_function_privilege('anon', 'public.get_public_knockout_bracket(text)', 'EXECUTE');
    v_txt := 'anon 공개 조회 실행 가능';
    call pg_temp.pfx_chk(60, 'F. anon 은 공개 조회 RPC 를 실행할 수 있다', v_ok, v_txt);

    v_ok  := not has_function_privilege('anon', 'public.publish_bracket(text,integer)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.unpublish_bracket(text,text,integer)', 'EXECUTE')
             and not has_function_privilege('anon', 'public.get_admin_bracket(text)', 'EXECUTE');
    v_txt := 'anon 운영 RPC 불가';
    call pg_temp.pfx_chk(61, 'F. anon 은 공개/운영 관리 RPC 를 실행할 수 없다', v_ok, v_txt);

    v_ok  := not has_table_privilege('anon', 'public.hosted_tournament_bracket_slots', 'SELECT')
             and not has_table_privilege('anon', 'public.hosted_tournament_brackets', 'SELECT');
    v_txt := 'anon 원본 테이블 접근 불가';
    call pg_temp.pfx_chk(62, 'F. anon 은 본선 테이블을 직접 읽을 수 없다', v_ok, v_txt);

    v_pub := public.get_public_knockout_bracket('zz-없는-대회');
    v_ok  := (v_pub ->> 'available')::boolean is false and v_pub ->> 'reason' = 'not_published';
    v_txt := v_pub::text;
    call pg_temp.pfx_chk(63, 'F. 없는 대회도 같은 답(존재 여부를 알려주지 않는다)', v_ok, v_txt);

    select coalesce(string_agg(b.status || '/' || coalesce(b.published_at::text, 'null'), ','), '')
      into v_prod_after
      from public.hosted_tournament_brackets b
      join public.hosted_tournaments t on t.id = b.tournament_id
     where t.slug = '2026-teyeon-open';
    v_ok  := v_prod_before is not distinct from v_prod_after;
    v_txt := coalesce(v_prod_before, '(none)') || ' → ' || coalesce(v_prod_after, '(none)');
    call pg_temp.pfx_chk(90, 'Z. 운영 대회 bracket 공개 상태 불변', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_brackets b
      join public.hosted_tournaments t on t.id = b.tournament_id
     where t.slug not like 'zz-fixture-pk%' and b.published_at is not null;
    v_ok  := v_cnt = 0;
    v_txt := '외부 공개 bracket ' || v_cnt;
    call pg_temp.pfx_chk(91, 'Z. fixture 밖 대회를 공개하지 않았다', v_ok, v_txt);

    v_r   := public.get_public_preliminary_draw('zz-fixture-pk-main');
    v_ok  := v_r is null;
    v_txt := '예선 공개 RPC 회귀 없음(비공개 → null)';
    call pg_temp.pfx_chk(92, 'Z. 예선 공개 RPC 는 영향 없음', v_ok, v_txt);

    -- ── 결과 집계 → 항상 예외로 롤백 ──────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from pg_temp._pfx;
    select coalesce(string_agg('  · #' || seq || ' ' || name || ' → ' || coalesce(info, ''), e'\n'
                               order by seq), '  (없음)')
      into v_msg from pg_temp._pfx where not ok;

    raise exception e'\n==== PUBLIC KNOCKOUT SELF-TEST ====\nPASS=%  FAIL=%  → %\n실패 항목:\n%\n(이 예외는 의도된 롤백이다. 데이터는 남지 않는다.)',
        v_pass, v_fail, case when v_fail = 0 then 'ALL PASS' else 'FAIL 있음' end, v_msg;
end $fixture$;
