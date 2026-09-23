-- ============================================================================
--  2026 TEYEON OPEN — 본선 Knockout Match Engine 실동작 self-test (Batch 4C fixture)
--
--  임시 대회 3개에서 **실제 RPC** 로 검증한다.
--    materialize_bracket_matches · complete_knockout_match · amend_knockout_match_score
--    + 기존 complete_match / amend_completed_match_score / cancel_match guard
--    + 예선 경기 회귀(guard 가 예선을 막지 않는지)
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ CALL 인자에는 식을 직접 넣지 않는다. 모든 검사는 v_ok / v_txt 에 먼저 계산해서 넘긴다
--    (plpgsql CALL 파서 제약 — 기존 fixture 들과 같은 규칙).
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--  ⚠ 구조 payload(라운드 · 연결 · BYE 위치)는 **fixture 가 만든다**. 서버는 그것을 옮겨 적을 뿐이다.
--    BYE 는 1라운드에만 놓을 수 있으므로(4A validate) 'BYE 연쇄' 는 구조상 발생하지 않는다.
--    대신 BYE 진출 → 다음 라운드 경기 생성까지를 확인한다.
--  선행: add_hosted_tournament_bracket.sql · add_hosted_tournament_knockout_engine.sql
-- ============================================================================
do $fixture$
declare
    v_uid    uuid;
    v_pass   integer;
    v_fail   integer;
    v_msg    text;
    v_ok     boolean;
    v_r      jsonb;
    v_txt    text;
    v_cnt    integer;
    v_tid1   uuid;  v_tid2 uuid;  v_tid3 uuid;
    v_bid1   uuid;  v_bid2 uuid;
    v_ver    integer;
    v_ver2   integer;
    v_mver   integer;
    v_m1     uuid;  v_m2 uuid;  v_m3 uuid;  v_m4 uuid;  v_m5 uuid;
    v_gid    uuid;
    v_pm     uuid;
    v_team   uuid;
    v_t1     uuid;  v_t2 uuid;
    v_prod_before text;
    v_prod_after  text;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug like 'zz-fixture-ko%') then
        raise exception '이전 self-test 잔재가 있다. 먼저 확인·정리하라.';
    end if;
    if to_regprocedure('public.materialize_bracket_matches(text,integer)') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_knockout_engine.sql)이 적용되지 않았다.';
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
        select m.stage || '=' || count(*) as s
          from public.hosted_tournament_matches m
          join public.hosted_tournaments t on t.id = m.tournament_id
         where t.slug = '2026-teyeon-open' group by m.stage order by 1) q;

    create temp table _kfx (seq integer, name text, ok boolean, info text);
    execute $q$
        create procedure pg_temp.kfx_chk(p_seq integer, p_name text, p_ok boolean, p_info text default null)
        language sql as $p$ insert into pg_temp._kfx values (p_seq, p_name, coalesce(p_ok, false), p_info); $p$;
    $q$;
    execute $q$
        create function pg_temp.kfx_tournament(p_slug text, p_teams integer) returns uuid
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
            for i in 1..3 loop
                insert into public.hosted_tournament_courts
                    (tournament_id, court_no, display_order, status)
                values (v_tid, i, i, 'active');
            end loop;
            return v_tid;
        end $f$;
    $q$;
    execute $q$
        create function pg_temp.kfx_entrants(p_tid uuid, p_n integer) returns jsonb
        language sql as $f$
            select coalesce(jsonb_agg(jsonb_build_object('teamId', t.id, 'source', 'manual')
                                      order by t.team_no), '[]'::jsonb)
              from public.hosted_tournament_teams t
             where t.tournament_id = p_tid and t.team_no <= p_n $f$;
    $q$;
    -- 구조 payload — 자리 수 배열을 라운드 + 연결로 바꾼다(테스트 입력 쪽 계산이다).
    execute $q$
        create function pg_temp.kfx_structure(p_counts integer[], p_names text[]) returns jsonb
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
    -- 자리 표기: 'T3' = 3번 팀 / 'BYE' = 부전승. ⚠ fixture 가 직접 지정한다.
    execute $q$
        create function pg_temp.kfx_assign(p_tid uuid, p_spec text[]) returns jsonb
        language sql as $f$
            select jsonb_agg(jsonb_build_object(
                       'position', i,
                       'type', case when p_spec[i] = 'BYE' then 'bye' else 'team' end,
                       'teamId', (select t.id from public.hosted_tournament_teams t
                                   where t.tournament_id = p_tid
                                     and p_spec[i] <> 'BYE'
                                     and t.team_no = substr(p_spec[i], 2)::integer))
                       order by i)
              from generate_series(1, array_length(p_spec, 1)) i $f$;
    $q$;
    -- 자리 상태 한 줄 요약('2-1:team3' 형태) — 눈으로 대조하기 위한 표기다.
    execute $q$
        create function pg_temp.kfx_slots(p_bid uuid, p_round integer) returns text
        language sql as $f$
            select coalesce(string_agg(s.position || ':' || s.slot_type
                                       || coalesce('#' || t.team_no::text, ''), ' ' order by s.position), '(none)')
              from public.hosted_tournament_bracket_slots s
              left join public.hosted_tournament_teams t on t.id = s.team_id
             where s.bracket_id = p_bid and s.round_no = p_round $f$;
    $q$;

    -- =====================================================================
    -- T1 — 8자리 / 진출 6팀 + BYE 2 (정상 운영 흐름 전체)
    -- =====================================================================
    v_tid1 := pg_temp.kfx_tournament('zz-fixture-ko-8', 8);

    v_r    := public.create_bracket('zz-fixture-ko-8', '본선', 6);
    v_bid1 := (v_r ->> 'bracketId')::uuid;
    v_ver  := (v_r ->> 'version')::integer;
    v_ok   := (v_r ->> 'ok')::boolean;
    v_txt  := v_r::text;
    call pg_temp.kfx_chk(1, 'T1. create_bracket', v_ok, v_txt);

    v_r   := public.set_bracket_entrants('zz-fixture-ko-8', pg_temp.kfx_entrants(v_tid1, 6), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'entrantCount')::integer = 6;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(2, 'T1. 진출팀 6팀 확정', v_ok, v_txt);

    v_r   := public.set_bracket_structure('zz-fixture-ko-8',
                 pg_temp.kfx_structure(array[8,4,2,1], array['8강','4강','결승','우승']), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'slots')::integer = 15;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(3, 'T1. 구조 4라운드 · 자리 15', v_ok, v_txt);

    v_r   := public.replace_bracket_slots('zz-fixture-ko-8',
                 pg_temp.kfx_assign(v_tid1, array['T1','BYE','T2','T3','T4','BYE','T5','T6']), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'byes')::integer = 2;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(4, 'T1. 1라운드 배치(팀6 · BYE2)', v_ok, v_txt);

    -- ── draft 에서는 경기를 만들지 않는다 ─────────────────────────────────
    v_r   := public.materialize_bracket_matches('zz-fixture-ko-8', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_not_locked';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(5, 'T1. draft 상태 materialize 거부', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches where tournament_id = v_tid1;
    v_ok  := v_cnt = 0;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.kfx_chk(6, 'T1. 거부 후 경기 0(부분 생성 없음)', v_ok, v_txt);

    v_r   := public.lock_bracket('zz-fixture-ko-8', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(7, 'T1. lock_bracket', v_ok, v_txt);

    -- ── 경기 생성 + BYE 진출 ──────────────────────────────────────────────
    v_r   := public.materialize_bracket_matches('zz-fixture-ko-8', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'created')::integer = 2
             and (v_r ->> 'byeAdvanced')::integer = 2;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(8, 'T1. materialize — 경기 2 · BYE 진출 2', v_ok, v_txt);

    v_txt := pg_temp.kfx_slots(v_bid1, 2);
    v_ok  := v_txt = '1:team#1 2:tbd 3:team#4 4:tbd';
    call pg_temp.kfx_chk(9, 'T1. BYE 상대만 2라운드로 올라감', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid1 and stage = 'knockout';
    v_ok  := v_cnt = 2;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.kfx_chk(10, 'T1. BYE 자리에는 경기를 만들지 않는다', v_ok, v_txt);

    select string_agg(m.match_no || '→' || s.round_no || '-' || s.position, ' ' order by m.match_no)
      into v_txt
      from public.hosted_tournament_matches m
      join public.hosted_tournament_bracket_slots s on s.id = m.bracket_target_slot_id
     where m.tournament_id = v_tid1;
    v_ok := v_txt = '1→2-2 2→2-4';
    call pg_temp.kfx_chk(11, 'T1. 경기 번호가 대진 순서(라운드 → 자리)', v_ok, v_txt);

    -- ── 멱등 ──────────────────────────────────────────────────────────────
    v_r   := public.materialize_bracket_matches('zz-fixture-ko-8', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'created')::integer = 0
             and (v_r ->> 'existing')::integer = 2;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(12, 'T1. materialize 재실행 — 새 경기 0(멱등)', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches where tournament_id = v_tid1;
    v_ok  := v_cnt = 2;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.kfx_chk(13, 'T1. 재실행 후에도 경기 2개', v_ok, v_txt);

    v_r   := public.materialize_bracket_matches('zz-fixture-ko-8', v_ver + 5);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'version_conflict';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(14, 'T1. materialize version 불일치 거부', v_ok, v_txt);

    -- (seq 141 = 14 다음에 끼워 넣은 검사. 번호는 정렬용일 뿐이다.)
    v_r   := public.unlock_bracket('zz-fixture-ko-8', '구조 수정 시도', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'knockout_matches_exist';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(141, 'T1. 경기가 생긴 뒤 unlock 거부(4A 규칙 유지)', v_ok, v_txt);

    -- ── 기존 RPC guard ────────────────────────────────────────────────────
    select id, version into v_m1, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid1 and match_no = 1;

    v_r   := public.complete_match(v_m1, 6, 3, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'knockout_requires_bracket_rpc';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(15, 'T1. complete_match 로 본선 완료 불가', v_ok, v_txt);

    v_r   := public.amend_completed_match_score(v_m1, 6, 3, '테스트', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'knockout_requires_bracket_rpc';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(16, 'T1. amend_completed_match_score 로 본선 수정 불가', v_ok, v_txt);

    v_r   := public.cancel_match(v_m1, '테스트 취소', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'knockout_cancel_not_supported';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(17, 'T1. 본선 경기 취소 불가', v_ok, v_txt);

    select status into v_txt from public.hosted_tournament_matches where id = v_m1;
    v_ok := v_txt = 'waiting';
    call pg_temp.kfx_chk(18, 'T1. 거부된 호출은 경기 상태를 바꾸지 않음', v_ok, v_txt);

    -- ── 진행 → 완료 ───────────────────────────────────────────────────────
    v_r   := public.complete_knockout_match(v_m1, 6, 3, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'already_changed';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(19, 'T1. WAITING 경기 완료 거부', v_ok, v_txt);

    v_r   := public.call_match(v_m1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.start_match(v_m1, 1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(20, 'T1. 본선 경기도 호명 · 코트 배정은 기존 RPC', v_ok, v_txt);

    v_r   := public.complete_knockout_match(v_m1, 6, 6, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'invalid_score';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(21, 'T1. 6:6 점수 거부(기존 규칙 그대로)', v_ok, v_txt);

    v_r   := public.complete_knockout_match(v_m1, 6, 3, v_mver + 5);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'version_conflict';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(22, 'T1. 완료 version 불일치 거부', v_ok, v_txt);

    v_r   := public.complete_knockout_match(v_m1, 3, 6, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'createdMatches')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(23, 'T1. 완료 + 승자 전달 + 다음 경기 생성(한 번의 호출)', v_ok, v_txt);

    v_txt := pg_temp.kfx_slots(v_bid1, 2);
    v_ok  := v_txt = '1:team#1 2:team#3 3:team#4 4:tbd';
    call pg_temp.kfx_chk(24, 'T1. 승자(3번 팀)가 2라운드 자리에 들어감', v_ok, v_txt);

    select court_id is null into v_ok from public.hosted_tournament_matches where id = v_m1;
    v_txt := '완료 후 코트 반납';
    call pg_temp.kfx_chk(25, 'T1. 완료 즉시 코트 반납', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid1 and stage = 'knockout';
    v_ok  := v_cnt = 3;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.kfx_chk(26, 'T1. 4강 경기 1개 자동 생성(1번 vs 3번)', v_ok, v_txt);

    -- ── amend: 승자 불변 ──────────────────────────────────────────────────
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.amend_knockout_match_score(v_m1, 2, 6, '점수 오기입', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'winnerChanged')::boolean is false;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(27, 'T1. 승자 그대로인 점수 정정 허용', v_ok, v_txt);

    v_r   := public.amend_knockout_match_score(v_m1, 2, 6, ' ', v_mver + 1);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'reason_required';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(28, 'T1. 수정 사유 필수', v_ok, v_txt);

    -- ── amend: 승자 변경 + 하위 WAITING ───────────────────────────────────
    select id into v_m3 from public.hosted_tournament_matches
     where tournament_id = v_tid1 and match_no = 3;
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;

    v_r   := public.amend_knockout_match_score(v_m1, 6, 2, '승자 오기입 정정', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'winnerChanged')::boolean
             and (v_r ->> 'replacedMatch')::boolean
             and (v_r ->> 'rolledBackSlots')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(29, 'T1. 승자 변경 — 하위 WAITING 은 팀 교체', v_ok, v_txt);

    v_txt := pg_temp.kfx_slots(v_bid1, 2);
    v_ok  := v_txt = '1:team#1 2:team#2 3:team#4 4:tbd';
    call pg_temp.kfx_chk(30, 'T1. 2라운드 자리가 새 승자로 교체됨', v_ok, v_txt);

    select t1.team_no || ' vs ' || t2.team_no into v_txt
      from public.hosted_tournament_matches m
      join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      join public.hosted_tournament_teams t2 on t2.id = m.team2_id
     where m.id = v_m3;
    v_ok := v_txt = '1 vs 2';
    call pg_temp.kfx_chk(31, 'T1. 하위 경기는 삭제되지 않고 팀만 바뀜', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid1 and stage = 'knockout';
    v_ok  := v_cnt = 3;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.kfx_chk(32, 'T1. 수정 후에도 경기 수 그대로(재생성 없음)', v_ok, v_txt);

    -- ── amend: 하위 CALLING / PLAYING 거부 ────────────────────────────────
    select version into v_mver from public.hosted_tournament_matches where id = v_m3;
    v_r   := public.call_match(v_m3, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.amend_knockout_match_score(v_m1, 2, 6, '되돌리기', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'downstream_calling';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(33, 'T1. 하위 경기 호명 중이면 승자 변경 거부', v_ok, v_txt);

    select version into v_mver from public.hosted_tournament_matches where id = v_m3;
    v_r   := public.start_match(v_m3, 1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.amend_knockout_match_score(v_m1, 2, 6, '되돌리기', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'downstream_playing';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(34, 'T1. 하위 경기 진행 중이면 승자 변경 거부', v_ok, v_txt);

    select score1 is null into v_ok from public.hosted_tournament_matches where id = v_m3;
    v_txt := '하위 경기 무결';
    call pg_temp.kfx_chk(35, 'T1. 거부된 수정은 하위 경기를 건드리지 않음', v_ok, v_txt);

    -- ── 나머지 진행 → 결승 → 우승 ────────────────────────────────────────
    select id, version into v_m2, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid1 and match_no = 2;
    v_r   := public.call_match(v_m2, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m2;
    v_r   := public.start_match(v_m2, 2, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m2;
    v_r   := public.complete_knockout_match(v_m2, 6, 0, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'createdMatches')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(36, 'T1. 2번 경기 완료 → 4강 두 번째 경기 생성', v_ok, v_txt);

    select version into v_mver from public.hosted_tournament_matches where id = v_m3;
    v_r   := public.complete_knockout_match(v_m3, 6, 1, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(37, 'T1. 4강 1경기 완료', v_ok, v_txt);

    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.amend_knockout_match_score(v_m1, 2, 6, '되돌리기', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'downstream_completed';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(38, 'T1. 하위 경기가 끝났으면 승자 변경 거부', v_ok, v_txt);

    select id, version into v_m4, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid1 and match_no = 4;
    v_r   := public.call_match(v_m4, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m4;
    v_r   := public.start_match(v_m4, 2, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m4;
    v_r   := public.complete_knockout_match(v_m4, 6, 2, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'createdMatches')::integer = 1
             and (v_r ->> 'bracketCompleted')::boolean is false;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(39, 'T1. 4강 2경기 완료 → 결승 생성(아직 우승 아님)', v_ok, v_txt);

    select id, version into v_m5, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid1 and match_no = 5;
    v_r   := public.call_match(v_m5, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m5;
    v_r   := public.start_match(v_m5, 3, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m5;
    v_r   := public.complete_knockout_match(v_m5, 6, 4, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'bracketCompleted')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(40, 'T1. 결승 완료 → bracket 완료', v_ok, v_txt);

    v_txt := pg_temp.kfx_slots(v_bid1, 4);
    v_ok  := v_txt like '1:team#%';
    call pg_temp.kfx_chk(41, 'T1. 우승 자리에 우승팀이 들어감', v_ok, v_txt);

    select status || '/' || (completed_at is not null)::text into v_txt
      from public.hosted_tournament_brackets where id = v_bid1;
    v_ok := v_txt = 'completed/true';
    call pg_temp.kfx_chk(42, 'T1. bracket status=completed · completed_at 기록', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid1 and stage = 'knockout';
    v_ok  := v_cnt = 5;
    v_txt := '경기 ' || v_cnt;
    call pg_temp.kfx_chk(43, 'T1. 총 경기 5개(8강2 · 4강2 · 결승1)', v_ok, v_txt);

    -- ── 완료 이후 ─────────────────────────────────────────────────────────
    select version into v_mver from public.hosted_tournament_matches where id = v_m5;
    v_r   := public.amend_knockout_match_score(v_m5, 4, 6, '우승자 변경', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_completed';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(44, 'T1. 완료된 본선의 우승자 변경 거부(4C 범위 밖)', v_ok, v_txt);

    v_r   := public.amend_knockout_match_score(v_m5, 6, 1, '점수만 정정', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'winnerChanged')::boolean is false;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(45, 'T1. 완료 후에도 승자 불변 점수 정정은 허용', v_ok, v_txt);

    select version into v_ver from public.hosted_tournament_brackets where id = v_bid1;
    v_r   := public.materialize_bracket_matches('zz-fixture-ko-8', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_completed';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(46, 'T1. 완료된 본선 materialize 거부', v_ok, v_txt);

    v_r   := public.unlock_bracket('zz-fixture-ko-8', '구조 수정 시도', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'not_locked';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(47, 'T1. 완료된 본선은 unlock 대상이 아니다', v_ok, v_txt);

    v_r   := public.get_admin_bracket('zz-fixture-ko-8');
    v_ok  := jsonb_array_length(v_r -> 'matches') = 5
             and (v_r -> 'matches' -> 0 ->> 'matchNo') is not null
             and (v_r -> 'matches' -> 0 -> 'team1' ->> 'teamNo') is not null;
    v_txt := 'matches=' || jsonb_array_length(v_r -> 'matches');
    call pg_temp.kfx_chk(48, 'T1. get_admin_bracket 이 경기 목록을 함께 반환', v_ok, v_txt);

    v_ok  := (v_r -> 'matches' -> 0 -> 'team1' ->> 'teamId') is null
             and (v_r -> 'matches' -> 0 ->> 'winnerTeamId') is null;
    v_txt := (v_r -> 'matches' -> 0)::text;
    call pg_temp.kfx_chk(49, 'T1. 경기 목록에 팀 UUID 를 내보내지 않는다', v_ok, v_txt);

    -- =====================================================================
    -- T2 — 4자리 / 3팀 + BYE 1 (BYE 진출이 결승까지 이어지는 최소 구조)
    -- =====================================================================
    v_tid2 := pg_temp.kfx_tournament('zz-fixture-ko-4', 4);

    v_r    := public.create_bracket('zz-fixture-ko-4', '본선', 3);
    v_bid2 := (v_r ->> 'bracketId')::uuid;
    v_ver2 := (v_r ->> 'version')::integer;

    v_r    := public.set_bracket_entrants('zz-fixture-ko-4', pg_temp.kfx_entrants(v_tid2, 3), v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;
    v_r    := public.set_bracket_structure('zz-fixture-ko-4',
                  pg_temp.kfx_structure(array[4,2,1], array['4강','결승','우승']), v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;
    v_r    := public.replace_bracket_slots('zz-fixture-ko-4',
                  pg_temp.kfx_assign(v_tid2, array['T1','BYE','T2','T3']), v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;
    v_ok   := (v_r ->> 'ok')::boolean;
    v_txt  := v_r::text;
    call pg_temp.kfx_chk(50, 'T2. 3팀 + BYE 1 구조 준비', v_ok, v_txt);

    v_r    := public.lock_bracket('zz-fixture-ko-4', v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;
    v_r    := public.materialize_bracket_matches('zz-fixture-ko-4', v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;
    v_ok   := (v_r ->> 'ok')::boolean and (v_r ->> 'created')::integer = 1
              and (v_r ->> 'byeAdvanced')::integer = 1;
    v_txt  := v_r::text;
    call pg_temp.kfx_chk(51, 'T2. materialize — 경기 1 · BYE 진출 1', v_ok, v_txt);

    v_txt := pg_temp.kfx_slots(v_bid2, 2);
    v_ok  := v_txt = '1:team#1 2:tbd';
    call pg_temp.kfx_chk(52, 'T2. BYE 팀만 결승 자리로', v_ok, v_txt);

    select id, version into v_m1, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid2 and match_no = 1;
    v_r   := public.call_match(v_m1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.start_match(v_m1, 1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m1;
    v_r   := public.complete_knockout_match(v_m1, 6, 0, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'createdMatches')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(53, 'T2. 4강 완료 → 결승 경기 생성', v_ok, v_txt);

    select id, version into v_m2, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid2 and match_no = 2;
    v_r   := public.call_match(v_m2, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m2;
    v_r   := public.start_match(v_m2, 1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_m2;
    v_r   := public.complete_knockout_match(v_m2, 6, 3, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'bracketCompleted')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(54, 'T2. 결승 완료 → bracket 완료', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid2 and slot_type = 'team';
    v_ok  := v_cnt = 6;
    v_txt := 'team 자리 ' || v_cnt;
    call pg_temp.kfx_chk(55, 'T2. 같은 팀이 라운드마다 자리를 차지(진출 기록 유지)', v_ok, v_txt);

    -- =====================================================================
    -- T3 — 예선 회귀 (guard 가 예선을 막지 않는지)
    -- =====================================================================
    v_tid3 := pg_temp.kfx_tournament('zz-fixture-ko-prelim', 3);

    insert into public.hosted_tournament_groups
        (tournament_id, group_no, group_type, expected_size, display_order)
    values (v_tid3, 1, 'preliminary', 3, 1) returning id into v_gid;

    select id into v_t1 from public.hosted_tournament_teams
     where tournament_id = v_tid3 and team_no = 1;
    select id into v_t2 from public.hosted_tournament_teams
     where tournament_id = v_tid3 and team_no = 2;

    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, sequence_no, match_no, team1_id, team2_id)
    values (v_tid3, 'preliminary', v_gid, 1, 1, v_t1, v_t2) returning id into v_pm;

    select version into v_mver from public.hosted_tournament_matches where id = v_pm;
    v_r   := public.call_match(v_pm, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_pm;
    v_r   := public.start_match(v_pm, 1, v_mver);
    select version into v_mver from public.hosted_tournament_matches where id = v_pm;
    v_r   := public.complete_match(v_pm, 6, 2, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(56, 'T3. 예선 경기는 complete_match 로 그대로 완료된다', v_ok, v_txt);

    select version into v_mver from public.hosted_tournament_matches where id = v_pm;
    v_r   := public.amend_completed_match_score(v_pm, 6, 1, '예선 정정', v_mver);
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.kfx_chk(57, 'T3. 예선 결과 수정도 그대로 동작', v_ok, v_txt);

    v_r   := public.complete_knockout_match(v_pm, 6, 1, v_mver + 1);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'not_knockout_match';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(58, 'T3. 예선 경기에 본선 RPC 사용 불가', v_ok, v_txt);

    v_r   := public.amend_knockout_match_score(v_pm, 6, 1, '잘못된 경로', v_mver + 1);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'not_knockout_match';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(59, 'T3. 예선 경기에 본선 amend 사용 불가', v_ok, v_txt);

    v_r   := public.materialize_bracket_matches('zz-fixture-ko-prelim', 1);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_not_found';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(60, 'T3. bracket 없는 대회 materialize 거부', v_ok, v_txt);

    v_r   := public.materialize_bracket_matches('zz-없는대회', 1);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'tournament_not_found';
    v_txt := v_r::text;
    call pg_temp.kfx_chk(61, 'T3. 없는 대회 materialize 거부', v_ok, v_txt);

    -- =====================================================================
    -- 마무리 — 잔재 · 운영 데이터 불변
    -- =====================================================================
    select count(*) into v_cnt from public.hosted_tournament_matches m
      join public.hosted_tournaments t on t.id = m.tournament_id
     where t.slug not like 'zz-fixture-ko%' and m.stage = 'knockout';
    v_ok  := v_cnt = 0;
    v_txt := '외부 knockout 경기 ' || v_cnt;
    call pg_temp.kfx_chk(90, 'Z. fixture 밖 대회에 본선 경기를 만들지 않았다', v_ok, v_txt);

    select coalesce(string_agg(s, ','), '') into v_prod_after from (
        select m.stage || '=' || count(*) as s
          from public.hosted_tournament_matches m
          join public.hosted_tournaments t on t.id = m.tournament_id
         where t.slug = '2026-teyeon-open' group by m.stage order by 1) q;
    v_ok  := v_prod_before is not distinct from v_prod_after;
    v_txt := coalesce(v_prod_before, '(none)') || ' → ' || coalesce(v_prod_after, '(none)');
    call pg_temp.kfx_chk(91, 'Z. 운영 대회 경기 구성 불변', v_ok, v_txt);

    select count(*) into v_cnt from (
        select bracket_id, round_no, team_id from public.hosted_tournament_bracket_slots
         where team_id is not null group by 1, 2, 3 having count(*) > 1) d;
    v_ok  := v_cnt = 0;
    v_txt := '라운드 내 중복 ' || v_cnt;
    call pg_temp.kfx_chk(92, 'Z. 한 라운드에 같은 팀이 두 자리를 차지하지 않는다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where stage = 'knockout' and (bracket_id is null or bracket_target_slot_id is null);
    v_ok  := v_cnt = 0;
    v_txt := '연결 없는 본선 경기 ' || v_cnt;
    call pg_temp.kfx_chk(93, 'Z. 본선 경기는 항상 bracket · destination 을 갖는다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_events
     where action in ('knockout_match_created', 'bracket_slot_advanced',
                      'bracket_matches_materialized', 'bracket_completed');
    v_ok  := v_cnt > 0;
    v_txt := '이벤트 ' || v_cnt || '건';
    call pg_temp.kfx_chk(94, 'Z. 진행 기록이 이벤트로 남는다', v_ok, v_txt);

    -- ── 결과 집계 → 항상 예외로 롤백 ──────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from pg_temp._kfx;
    select coalesce(string_agg('  · #' || seq || ' ' || name || ' → ' || coalesce(info, ''), e'\n'
                               order by seq), '  (없음)')
      into v_msg from pg_temp._kfx where not ok;

    raise exception e'\n==== KNOCKOUT ENGINE SELF-TEST ====\nPASS=%  FAIL=%  → %\n실패 항목:\n%\n(이 예외는 의도된 롤백이다. 데이터는 남지 않는다.)',
        v_pass, v_fail, case when v_fail = 0 then 'ALL PASS' else 'FAIL 있음' end, v_msg;
end $fixture$;
