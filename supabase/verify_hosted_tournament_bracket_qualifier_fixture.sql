-- ============================================================================
--  2026 TEYEON OPEN — 본선 Qualifier Slot 실동작 self-test (Batch 4D-0 fixture)
--
--  임시 대회에서 **실제 RPC** 로 TEYEON OPEN 기본 흐름을 그대로 검증한다.
--    Qualifier Map 작성 → 본선 경로 확정(lock) → 예선 진행 → 공식 순위 확정
--    → 예선 결과 반영(resolve) → materialize → 되돌리기(unresolve)
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ CALL 인자에는 식을 직접 넣지 않는다. v_ok / v_txt 에 먼저 계산해서 넘긴다.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--  ⚠ 어느 조 몇 위가 어느 자리로 갈지는 **fixture 가 정한다**. 서버는 저장 · 검증 · 반영만 한다.
--  선행: add_hosted_tournament_bracket.sql · add_hosted_tournament_knockout_engine.sql
--        · add_hosted_tournament_bracket_qualifier.sql
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
    v_tid    uuid;
    v_tid2   uuid;
    v_bid    uuid;
    v_bid2   uuid;
    v_ver    integer;
    v_ver2   integer;
    v_mver   integer;
    v_slot   uuid;
    v_mid    uuid;
    v_team   uuid;
    v_prod_before text;
    v_prod_after  text;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug like 'zz-fixture-ql%') then
        raise exception '이전 self-test 잔재가 있다. 먼저 확인·정리하라.';
    end if;
    if to_regprocedure('public.resolve_bracket_qualifiers(text,integer)') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_bracket_qualifier.sql)이 적용되지 않았다.';
    end if;
    select p.id into v_uid
      from public.profiles p join auth.users u on u.id = p.id
     where p.role in ('CEO', 'ADMIN') order by p.id limit 1;
    if v_uid is null then
        raise exception 'CEO/ADMIN profile 이 없어 운영 RPC 를 호출할 수 없다.';
    end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);

    select coalesce(string_agg(s, ','), '') into v_prod_before from (
        select m.stage || '=' || count(*) as s
          from public.hosted_tournament_matches m
          join public.hosted_tournaments t on t.id = m.tournament_id
         where t.slug = '2026-teyeon-open' group by m.stage order by 1) q;

    create temp table _qfx (seq integer, name text, ok boolean, info text);
    execute $q$
        create procedure pg_temp.qfx_chk(p_seq integer, p_name text, p_ok boolean, p_info text default null)
        language sql as $p$ insert into pg_temp._qfx values (p_seq, p_name, coalesce(p_ok, false), p_info); $p$;
    $q$;
    -- 대회 + 팀 + 코트 + 조(3팀씩) + 조 배정
    execute $q$
        create function pg_temp.qfx_tournament(p_slug text, p_groups integer) returns uuid
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

            for i in 1..(p_groups * 3) loop
                insert into public.hosted_tournament_teams
                    (tournament_id, team_no, player1_name, player2_name, source, status)
                values (v_tid, i, 'ZZ선수A' || i, 'ZZ선수B' || i, 'fixture', 'active');
            end loop;
            for i in 1..3 loop
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
    -- 구조 payload(자리 수 배열 → 라운드 + 연결). ⚠ 테스트 입력 쪽 계산이다.
    execute $q$
        create function pg_temp.qfx_structure(p_counts integer[], p_names text[]) returns jsonb
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
    -- 조 경기 생성 + 결과 입력(직접 INSERT — 예선 운영 RPC 는 이 self-test 대상이 아니다)
    --   p_mode: 'win' = 번호 작은 팀이 이긴다 / 'cycle' = 물고 물리는 3자 동률
    execute $q$
        create function pg_temp.qfx_play(p_tid uuid, p_group_no integer, p_mode text) returns void
        language plpgsql as $f$
        declare v_gid uuid; v_base integer; r record; v_no integer; v_seq integer := 0; v_win uuid;
        begin
            select id into v_gid from public.hosted_tournament_groups
             where tournament_id = p_tid and group_no = p_group_no;
            select coalesce(max(match_no), 0) into v_base
              from public.hosted_tournament_matches where tournament_id = p_tid;
            for r in
                select a.id a_id, b.id b_id, a.team_no a_no, b.team_no b_no
                  from public.hosted_tournament_group_members ma
                  join public.hosted_tournament_teams a on a.id = ma.team_id
                  join public.hosted_tournament_group_members mb on mb.group_id = ma.group_id
                  join public.hosted_tournament_teams b on b.id = mb.team_id
                 where ma.group_id = v_gid and a.team_no < b.team_no
                 order by a.team_no, b.team_no
            loop
                v_seq := v_seq + 1;
                v_base := v_base + 1;
                -- cycle: (a,b) 짝 순서가 (1,2) (1,3) (2,3) 이므로
                --   1>2 · 3>1 · 2>3 → 세 팀 모두 1승 1패 · 득실 0(미해결 동률)
                if p_mode = 'cycle' and v_seq = 2 then v_win := r.b_id; else v_win := r.a_id; end if;
                insert into public.hosted_tournament_matches
                    (tournament_id, stage, group_id, sequence_no, match_no, team1_id, team2_id,
                     status, score1, score2, winner_team_id, completed_at)
                values (p_tid, 'preliminary', v_gid, v_seq, v_base, r.a_id, r.b_id, 'completed',
                        case when v_win = r.a_id then 6 else 2 end,
                        case when v_win = r.a_id then 2 else 6 end,
                        v_win, now());
            end loop;
        end $f$;
    $q$;
    -- 자리 요약('1:qualifier(1조1위)' 형태)
    execute $q$
        create function pg_temp.qfx_slots(p_bid uuid) returns text
        language sql as $f$
            select coalesce(string_agg(s.position || ':' || s.slot_type
                       || coalesce('#' || t.team_no::text, '')
                       || coalesce('(' || public.hosted_tournament_qualifier_label(s.source_group_no, s.source_rank)
                                   || case when s.resolved_at is not null then '·반영' else '' end || ')', ''),
                       ' ' order by s.position), '(none)')
              from public.hosted_tournament_bracket_slots s
              left join public.hosted_tournament_teams t on t.id = s.team_id
             where s.bracket_id = p_bid and s.round_no = 1 $f$;
    $q$;

    -- =====================================================================
    -- T1 — Qualifier Map → 확정 → 예선 → 반영 → materialize
    -- =====================================================================
    v_tid := pg_temp.qfx_tournament('zz-fixture-ql-main', 4);

    v_r   := public.create_bracket('zz-fixture-ql-main', '본선', 4);
    v_bid := (v_r ->> 'bracketId')::uuid;
    v_ver := (v_r ->> 'version')::integer;
    v_r   := public.set_bracket_structure('zz-fixture-ql-main',
                 pg_temp.qfx_structure(array[4,2,1], array['4강','결승','우승']), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'slots')::integer = 7;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(1, 'T1. 본선 구조 준비(4강 · 결승 · 우승)', v_ok, v_txt);

    -- ── Qualifier Map: 1조1위 vs 4조2위 / 2조1위 vs 3조2위 ───────────────
    v_r := public.replace_bracket_slots('zz-fixture-ql-main', jsonb_build_array(
               jsonb_build_object('position', 1, 'type', 'qualifier', 'groupNo', 1, 'rank', 1),
               jsonb_build_object('position', 2, 'type', 'qualifier', 'groupNo', 4, 'rank', 2),
               jsonb_build_object('position', 3, 'type', 'qualifier', 'groupNo', 2, 'rank', 1),
               jsonb_build_object('position', 4, 'type', 'qualifier', 'groupNo', 3, 'rank', 2)), v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'qualifiers')::integer = 4
             and (v_r ->> 'assigned')::integer = 0;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(2, 'T1. Qualifier Map 저장(4자리)', v_ok, v_txt);

    v_txt := pg_temp.qfx_slots(v_bid);
    v_ok  := v_txt = '1:qualifier(1조 1위) 2:qualifier(4조 2위) 3:qualifier(2조 1위) 4:qualifier(3조 2위)';
    call pg_temp.qfx_chk(3, 'T1. 자리마다 조 · 순위가 그대로 저장됨', v_ok, v_txt);

    v_r := public.replace_bracket_slots('zz-fixture-ql-main', jsonb_build_array(
               jsonb_build_object('position', 1, 'type', 'qualifier', 'groupNo', 1, 'rank', 1),
               jsonb_build_object('position', 2, 'type', 'qualifier', 'groupNo', 1, 'rank', 1),
               jsonb_build_object('position', 3, 'type', 'qualifier', 'groupNo', 2, 'rank', 1),
               jsonb_build_object('position', 4, 'type', 'qualifier', 'groupNo', 3, 'rank', 2)), v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'duplicate_qualifier';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(4, 'T1. 같은 조 · 순위 두 자리 거부', v_ok, v_txt);

    v_r := public.replace_bracket_slots('zz-fixture-ql-main', jsonb_build_array(
               jsonb_build_object('position', 1, 'type', 'qualifier', 'groupNo', 1),
               jsonb_build_object('position', 2, 'type', 'qualifier', 'groupNo', 4, 'rank', 2),
               jsonb_build_object('position', 3, 'type', 'qualifier', 'groupNo', 2, 'rank', 1),
               jsonb_build_object('position', 4, 'type', 'qualifier', 'groupNo', 3, 'rank', 2)), v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'invalid_qualifier';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(5, 'T1. 순위 없는 qualifier 거부', v_ok, v_txt);

    -- ── 진출팀 0인데도 검증 통과해야 한다(경로를 먼저 짜는 운영) ────────
    v_r  := public.validate_bracket('zz-fixture-ql-main');
    v_ok := (v_r ->> 'ok')::boolean
            and (v_r -> 'summary' ->> 'entrants')::integer = 0
            and (v_r -> 'summary' ->> 'qualifiers')::integer = 4;
    v_txt := v_r ->> 'summary';
    call pg_temp.qfx_chk(6, 'T1. 진출팀 0이어도 검증 통과(qualifier 경로)', v_ok, v_txt);

    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'issues') i where i ->> 'code' = 'no_entrants';
    v_ok  := v_cnt = 0;
    v_txt := 'no_entrants ' || v_cnt || '건';
    call pg_temp.qfx_chk(7, 'T1. no_entrants 오류가 나오지 않는다', v_ok, v_txt);

    -- ── 없는 조를 가리켜도 조편성 전에는 warning ─────────────────────────
    select id into v_slot from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid and round_no = 1 and position = 4;
    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'qualifier', null, 9, 1, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_r   := public.validate_bracket('zz-fixture-ql-main');
    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'issues') i
     where i ->> 'code' = 'qualifier_group_missing' and i ->> 'severity' = 'warning';
    v_ok  := v_cnt = 1 and (v_r ->> 'ok')::boolean;
    v_txt := v_r ->> 'issues';
    call pg_temp.qfx_chk(8, 'T1. 조편성 전 없는 조 지정 → warning(확정 가능)', v_ok, v_txt);

    -- 조편성을 확정하면 같은 상황이 error 가 된다.
    update public.hosted_tournaments set preliminary_draw_status = 'locked' where id = v_tid;
    v_r  := public.validate_bracket('zz-fixture-ql-main');
    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'issues') i
     where i ->> 'code' = 'qualifier_group_missing' and i ->> 'severity' = 'error';
    v_ok  := v_cnt = 1 and (v_r ->> 'ok')::boolean is false;
    v_txt := v_r ->> 'issues';
    call pg_temp.qfx_chk(9, 'T1. 조편성 확정 후 없는 조 → error(확정 불가)', v_ok, v_txt);

    -- 원래 자리로 되돌린다.
    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'qualifier', null, 3, 2, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r -> 'slot' ->> 'label') = '3조 2위';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(10, 'T1. 7인자 assign 으로 자리 교정 + 라벨 생성', v_ok, v_txt);

    -- 조 정원(3)을 넘는 순위
    v_r := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'qualifier', null, 3, 9, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_r  := public.validate_bracket('zz-fixture-ql-main');
    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'issues') i where i ->> 'code' = 'qualifier_rank_out_of_range';
    v_ok  := v_cnt = 1;
    v_txt := v_r ->> 'issues';
    call pg_temp.qfx_chk(11, 'T1. 조 정원을 넘는 순위 검출', v_ok, v_txt);

    -- 진출 인원(2)을 넘는 3위는 저장은 되지만 warning
    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'qualifier', null, 3, 3, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_r   := public.validate_bracket('zz-fixture-ql-main');
    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'issues') i
     where i ->> 'code' = 'qualifier_rank_beyond_qualify' and i ->> 'severity' = 'warning';
    v_ok  := v_cnt = 1 and (v_r ->> 'ok')::boolean;
    v_txt := v_r ->> 'issues';
    call pg_temp.qfx_chk(12, 'T1. 조 3위 지정은 warning(저장은 허용)', v_ok, v_txt);

    -- 구 프런트(5인자)로도 예전처럼 BYE · 팀 배치가 된다 — 4D-1 배포 전 호환.
    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'bye', null, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    select slot_type || '/' || coalesce(source_kind, '-') into v_txt
      from public.hosted_tournament_bracket_slots where id = v_slot;
    v_ok  := (v_r ->> 'ok')::boolean and v_txt = 'bye/bye';
    call pg_temp.qfx_chk(121, 'T1. 구 프런트 5인자 assign 정상 동작(BYE)', v_ok, v_txt);

    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'qualifier', null, 3, 2, v_ver);
    v_ver := (v_r ->> 'version')::integer;
    select slot_type || '/' || coalesce(source_kind, '-') into v_txt
      from public.hosted_tournament_bracket_slots where id = v_slot;
    v_ok  := (v_r ->> 'ok')::boolean and v_txt = 'qualifier/group_rank';
    call pg_temp.qfx_chk(122, 'T1. 7인자 assign 으로 다시 조 · 순위 자리로', v_ok, v_txt);

    -- ── 본선 경로 확정(lock) ────────────────────────────────────────────
    v_r   := public.lock_bracket('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(13, 'T1. 본선 경로 확정(lock)', v_ok, v_txt);

    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'bye', null, v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_locked';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(14, 'T1. 확정 후 5인자 assign(구 프런트) 거부', v_ok, v_txt);

    v_r   := public.assign_bracket_slot('zz-fixture-ql-main', v_slot, 'qualifier', null, 1, 2, v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_locked';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(15, 'T1. 확정 후 7인자 assign 도 거부', v_ok, v_txt);

    -- ── 예선 전 반영 시도 → 전부 보류 ───────────────────────────────────
    v_r   := public.resolve_bracket_qualifiers('zz-fixture-ql-main', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'resolvedCount')::integer = 0
             and (v_r ->> 'skippedCount')::integer = 4;
    v_txt := v_r ->> 'skipped';
    call pg_temp.qfx_chk(16, 'T1. 예선 전 반영 → 4자리 모두 보류', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_bracket_slots
     where bracket_id = v_bid and resolved_at is not null;
    v_ok  := v_cnt = 0;
    v_txt := '반영된 자리 ' || v_cnt;
    call pg_temp.qfx_chk(17, 'T1. 보류는 아무 것도 바꾸지 않는다', v_ok, v_txt);

    -- ── 예선 진행: 1 · 2조 정상 종료 / 3조 동률 / 4조 미완료 ────────────
    perform pg_temp.qfx_play(v_tid, 1, 'win');
    perform pg_temp.qfx_play(v_tid, 2, 'win');
    perform pg_temp.qfx_play(v_tid, 3, 'cycle');

    v_r := public.get_preliminary_standings('zz-fixture-ql-main');
    select string_agg((g ->> 'groupNo') || ':' || (g ->> 'rankingStatus'), ' ' order by (g ->> 'groupNo')::integer)
      into v_txt from jsonb_array_elements(v_r -> 'groups') g;
    v_ok := v_txt = '1:FINAL 2:FINAL 3:AGE_CHECK_REQUIRED 4:PROVISIONAL';
    call pg_temp.qfx_chk(18, 'T1. 예선 상태(확정 · 동률 · 미완료)', v_ok, v_txt);

    v_r   := public.resolve_bracket_qualifiers('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'resolvedCount')::integer = 2;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(19, 'T1. 확정된 조만 반영(2자리)', v_ok, v_txt);

    select string_agg(x ->> 'reason', ' ' order by (x ->> 'position')::integer) into v_txt
      from jsonb_array_elements(v_r -> 'skipped') x;
    -- 자리 순서대로: 2번 자리(4조 2위)=조 미완료, 4번 자리(3조 2위)=동률 미해결
    v_ok := v_txt = 'rank_not_final tie_unresolved';
    call pg_temp.qfx_chk(20, 'T1. 보류 사유 — 조 미완료 / 동률 미해결', v_ok, v_txt);

    v_txt := pg_temp.qfx_slots(v_bid);
    v_ok  := v_txt like '1:team#1(1조 1위·반영)%' and v_txt like '%3:team#4(2조 1위·반영)%'
             and v_txt like '%2:qualifier(4조 2위)%';
    call pg_temp.qfx_chk(21, 'T1. 반영 후에도 조 · 순위 표기가 남는다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_bracket_entrants where bracket_id = v_bid;
    v_ok  := v_cnt = 2;
    v_txt := '진출팀 스냅샷 ' || v_cnt;
    call pg_temp.qfx_chk(22, 'T1. 반영하면 진출팀 스냅샷도 함께 남는다', v_ok, v_txt);

    v_r  := public.validate_bracket('zz-fixture-ql-main');
    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'issues') i
     where i ->> 'code' in ('slot_team_not_entrant', 'entrant_not_placed');
    v_ok  := v_cnt = 0;
    v_txt := v_r ->> 'issues';
    call pg_temp.qfx_chk(23, 'T1. 진출팀 불변식이 깨지지 않는다', v_ok, v_txt);

    -- ── materialize: 양쪽이 실제 팀인 자리만 경기 ───────────────────────
    v_r   := public.materialize_bracket_matches('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'created')::integer = 0;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(24, 'T1. 상대가 미반영이면 경기를 만들지 않는다', v_ok, v_txt);

    -- 3조 동률을 확정 → 3조 2위 자리도 반영 가능
    insert into public.hosted_tournament_group_tie_resolutions
        (tournament_id, group_id, team_id, resolved_order, reason, resolved_by)
    select v_tid, g.id, t.id, row_number() over (order by t.team_no), '합산연령 현장 확인', v_uid
      from public.hosted_tournament_groups g
      join public.hosted_tournament_group_members gm on gm.group_id = g.id
      join public.hosted_tournament_teams t on t.id = gm.team_id
     where g.tournament_id = v_tid and g.group_no = 3;

    v_r   := public.resolve_bracket_qualifiers('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'resolvedCount')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(25, 'T1. 합산연령 확인 후 3조 자리 반영', v_ok, v_txt);

    v_r   := public.materialize_bracket_matches('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'created')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(26, 'T1. 양쪽 반영된 자리에만 경기 생성', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout';
    v_ok  := v_cnt = 1;
    v_txt := '본선 경기 ' || v_cnt;
    call pg_temp.qfx_chk(27, 'T1. 미반영 자리에는 경기가 없다', v_ok, v_txt);

    -- ── 되돌리기(unresolve) ─────────────────────────────────────────────
    select id, match_no into v_mid, v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout' limit 1;

    v_r   := public.unresolve_bracket_qualifier('zz-fixture-ql-main', 3, ' ', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'reason_required';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(28, 'T1. 되돌리기 사유 필수', v_ok, v_txt);

    v_r   := public.unresolve_bracket_qualifier('zz-fixture-ql-main', 2, '순위 정정', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'not_resolved_qualifier';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(29, 'T1. 아직 반영되지 않은 자리는 되돌릴 것이 없다', v_ok, v_txt);

    v_r   := public.unresolve_bracket_qualifier('zz-fixture-ql-main', 3, '예선 순위 정정', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_ok  := (v_r ->> 'ok')::boolean and (v_r ->> 'removedMatches')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(30, 'T1. 되돌리면 대기 경기가 함께 정리된다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout';
    v_ok  := v_cnt = 0;
    v_txt := '본선 경기 ' || v_cnt;
    call pg_temp.qfx_chk(31, 'T1. 대기 경기 삭제 확인', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_events
     where tournament_id = v_tid and action = 'knockout_match_removed' and note is not null;
    v_ok  := v_cnt = 1;
    v_txt := '삭제 기록 ' || v_cnt || '건';
    call pg_temp.qfx_chk(32, 'T1. 삭제는 사유와 함께 기록된다(조용한 삭제 없음)', v_ok, v_txt);

    v_txt := pg_temp.qfx_slots(v_bid);
    v_ok  := v_txt like '%3:qualifier(2조 1위)%';
    call pg_temp.qfx_chk(33, 'T1. 되돌린 자리는 다시 조 · 순위 자리로 남는다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_bracket_entrants where bracket_id = v_bid;
    v_ok  := v_cnt = 2;
    v_txt := '진출팀 스냅샷 ' || v_cnt;
    call pg_temp.qfx_chk(34, 'T1. 되돌린 팀은 진출팀 목록에서도 빠진다', v_ok, v_txt);

    -- 다시 반영 → 경기 복구
    v_r   := public.resolve_bracket_qualifiers('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    v_r   := public.materialize_bracket_matches('zz-fixture-ql-main', v_ver);
    v_ver := (v_r ->> 'version')::integer;
    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout';
    v_ok  := v_cnt = 1;
    v_txt := '본선 경기 ' || v_cnt;
    call pg_temp.qfx_chk(35, 'T1. 다시 반영하면 경기도 다시 생긴다', v_ok, v_txt);

    -- ── 하위 진행 중이면 되돌릴 수 없다 ─────────────────────────────────
    select id, version into v_mid, v_mver from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout' limit 1;
    v_r   := public.call_match(v_mid, v_mver);
    v_r   := public.unresolve_bracket_qualifier('zz-fixture-ql-main', 3, '되돌리기', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'downstream_calling';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(36, 'T1. 하위 경기 호명 중 → 거부', v_ok, v_txt);

    select version into v_mver from public.hosted_tournament_matches where id = v_mid;
    v_r   := public.start_match(v_mid, 1, v_mver);
    v_r   := public.unresolve_bracket_qualifier('zz-fixture-ql-main', 3, '되돌리기', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'downstream_playing';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(37, 'T1. 하위 경기 진행 중 → 거부', v_ok, v_txt);

    select version into v_mver from public.hosted_tournament_matches where id = v_mid;
    v_r   := public.complete_knockout_match(v_mid, 6, 2, v_mver);
    v_ok  := (v_r ->> 'ok')::boolean;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(38, 'T1. 본선 경기 완료(4C 엔진 그대로 동작)', v_ok, v_txt);

    select version into v_ver from public.hosted_tournament_brackets where id = v_bid;
    v_r   := public.unresolve_bracket_qualifier('zz-fixture-ql-main', 3, '되돌리기', v_ver);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'downstream_completed';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(39, 'T1. 하위 경기 완료 → 거부', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout';
    v_ok  := v_cnt = 1;
    v_txt := '본선 경기 ' || v_cnt;
    call pg_temp.qfx_chk(40, 'T1. 거부된 되돌리기는 경기를 건드리지 않는다', v_ok, v_txt);

    -- ── 관리 화면 payload ───────────────────────────────────────────────
    v_r  := public.get_admin_bracket('zz-fixture-ql-main');
    select count(*) into v_cnt
      from jsonb_array_elements(v_r -> 'slots') s
     where s ->> 'sourceLabel' is not null;
    v_ok  := v_cnt = 4 and (v_r -> 'qualifierDrift') is not null;
    v_txt := 'sourceLabel ' || v_cnt || '개';
    call pg_temp.qfx_chk(41, 'T1. 관리 화면에 조 · 순위 라벨이 내려간다', v_ok, v_txt);

    v_ok  := (v_r -> 'matches') is not null and (v_r -> 'entrantDrift') is not null
             and (v_r -> 'validation') is not null and (v_r -> 'entrants') is not null;
    v_txt := (select string_agg(k, ',' order by k) from jsonb_object_keys(v_r) k);
    call pg_temp.qfx_chk(42, 'T1. 4C 반환값이 그대로 유지된다', v_ok, v_txt);

    -- =====================================================================
    -- T2 — 확정 전에는 반영할 수 없다 / 취소 경기 보류 / 중복 팀
    -- =====================================================================
    v_tid2 := pg_temp.qfx_tournament('zz-fixture-ql-draft', 2);
    v_r    := public.create_bracket('zz-fixture-ql-draft', '본선', 2);
    v_bid2 := (v_r ->> 'bracketId')::uuid;
    v_ver2 := (v_r ->> 'version')::integer;
    v_r    := public.set_bracket_structure('zz-fixture-ql-draft',
                  pg_temp.qfx_structure(array[2,1], array['결승','우승']), v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;
    v_r    := public.replace_bracket_slots('zz-fixture-ql-draft', jsonb_build_array(
                  jsonb_build_object('position', 1, 'type', 'qualifier', 'groupNo', 1, 'rank', 1),
                  jsonb_build_object('position', 2, 'type', 'qualifier', 'groupNo', 2, 'rank', 1)), v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;

    perform pg_temp.qfx_play(v_tid2, 1, 'win');
    perform pg_temp.qfx_play(v_tid2, 2, 'win');

    v_r   := public.resolve_bracket_qualifiers('zz-fixture-ql-draft', v_ver2);
    v_ok  := (v_r ->> 'ok')::boolean is false and v_r ->> 'reason' = 'bracket_not_locked';
    v_txt := v_r::text;
    call pg_temp.qfx_chk(50, 'T2. 확정(lock) 전에는 예선 결과를 반영하지 않는다', v_ok, v_txt);

    v_r    := public.lock_bracket('zz-fixture-ql-draft', v_ver2);
    v_ver2 := (v_r ->> 'version')::integer;

    -- 1조 경기 하나를 취소 → 운영 판단이 필요하므로 보류
    update public.hosted_tournament_matches m
       set status = 'cancelled', score1 = null, score2 = null, winner_team_id = null,
           cancelled_at = now()
     where m.id = (select m2.id from public.hosted_tournament_matches m2
                     join public.hosted_tournament_groups g on g.id = m2.group_id
                    where g.tournament_id = v_tid2 and g.group_no = 1 limit 1);

    v_r := public.resolve_bracket_qualifiers('zz-fixture-ql-draft', v_ver2);
    select x ->> 'reason' into v_txt
      from jsonb_array_elements(v_r -> 'skipped') x where (x ->> 'position')::integer = 1;
    v_ok := v_txt = 'cancelled_present';
    call pg_temp.qfx_chk(51, 'T2. 취소 경기가 남은 조는 보류', v_ok, coalesce(v_txt, v_r::text));

    v_ok  := (v_r ->> 'resolvedCount')::integer = 1;
    v_txt := v_r::text;
    call pg_temp.qfx_chk(52, 'T2. 나머지 조는 그대로 반영(부분 반영)', v_ok, v_txt);

    -- =====================================================================
    -- Z. 회귀 · 잔재
    -- =====================================================================
    select count(*) into v_cnt from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_brackets b on b.id = s.bracket_id
      join public.hosted_tournaments t on t.id = b.tournament_id
     where t.slug not like 'zz-fixture-ql%' and (s.slot_type = 'qualifier' or s.source_kind is not null);
    v_ok  := v_cnt = 0;
    v_txt := '외부 qualifier 자리 ' || v_cnt;
    call pg_temp.qfx_chk(90, 'Z. fixture 밖 대회를 건드리지 않았다', v_ok, v_txt);

    select coalesce(string_agg(s, ','), '') into v_prod_after from (
        select m.stage || '=' || count(*) as s
          from public.hosted_tournament_matches m
          join public.hosted_tournaments t on t.id = m.tournament_id
         where t.slug = '2026-teyeon-open' group by m.stage order by 1) q;
    v_ok  := v_prod_before is not distinct from v_prod_after;
    v_txt := coalesce(v_prod_before, '(none)') || ' → ' || coalesce(v_prod_after, '(none)');
    call pg_temp.qfx_chk(91, 'Z. 운영 대회 경기 구성 불변', v_ok, v_txt);

    v_r   := public.get_preliminary_standings('zz-fixture-ql-main');
    v_ok  := v_r is not null and jsonb_array_length(v_r -> 'groups') = 4;
    v_txt := '조 ' || jsonb_array_length(v_r -> 'groups');
    call pg_temp.qfx_chk(92, 'Z. 예선 순위 RPC 정상(회귀 없음)', v_ok, v_txt);

    select count(*) into v_cnt from (
        select bracket_id, source_group_no, source_rank
          from public.hosted_tournament_bracket_slots
         where source_kind = 'group_rank' group by 1, 2, 3 having count(*) > 1) d;
    v_ok  := v_cnt = 0;
    v_txt := '중복 ' || v_cnt;
    call pg_temp.qfx_chk(93, 'Z. 같은 조 · 순위가 두 자리에 있지 않다', v_ok, v_txt);

    select count(*) into v_cnt from public.hosted_tournament_events
     where action in ('resolve_qualifier', 'resolve_qualifiers', 'unresolve_qualifier');
    v_ok  := v_cnt > 0;
    v_txt := '이벤트 ' || v_cnt || '건';
    call pg_temp.qfx_chk(94, 'Z. 반영 · 되돌리기가 기록으로 남는다', v_ok, v_txt);

    -- ── 결과 집계 → 항상 예외로 롤백 ──────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from pg_temp._qfx;
    select coalesce(string_agg('  · #' || seq || ' ' || name || ' → ' || coalesce(info, ''), e'\n'
                               order by seq), '  (없음)')
      into v_msg from pg_temp._qfx where not ok;

    raise exception e'\n==== QUALIFIER SLOT SELF-TEST ====\nPASS=%  FAIL=%  → %\n실패 항목:\n%\n(이 예외는 의도된 롤백이다. 데이터는 남지 않는다.)',
        v_pass, v_fail, case when v_fail = 0 then 'ALL PASS' else 'FAIL 있음' end, v_msg;
end $fixture$;
