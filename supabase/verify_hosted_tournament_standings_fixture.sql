-- ============================================================================
--  2026 TEYEON OPEN — Batch 3B 순위 알고리즘 실동작 self-test (fixture)
--
--  무엇을 하나
--    임시 대회(zz-fixture-standings-selftest)를 만들고, 조·팀·경기를 심은 뒤
--    **실제 RPC**(get_preliminary_standings / resolve_group_age_tie /
--    amend_completed_match_score)를 호출해서 60개 계약을 검증한다.
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고, 마지막에 일부러 예외를 던져
--    심어 둔 데이터를 전부 롤백한다. 운영 DB 에 단 한 행도 남지 않는다.
--    ERROR 메시지 본문이 곧 검증 결과다. `PASS=60  FAIL=0  → ALL PASS` 를 확인하라.
--
--  ⚠ 부분 실행이 불가능하다(단일 DO 블록). 통째로 붙여넣고 1회 실행한다.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조를 복사하는 데만 읽고,
--    그 대회의 행은 수정하지 않는다.
--
--  선행: Batch 1 4종 + Batch 2A + bulk follow-up + 3A matches
--        + add_hosted_tournament_standings.sql
-- ============================================================================

do $fixture$
declare
    v_slug  text := 'zz-fixture-standings-selftest';
    v_tid   uuid;
    v_uid   uuid;
    v_r3    jsonb;
    v_r4    jsonb;
    v_r5    jsonb;
    v_r4b   jsonb;
    v_ramd  jsonb;
    v_rej   jsonb;
    v_mid   uuid;
    v_ok    boolean;   -- ⚠ CALL 인자에는 subquery 를 못 쓴다(0A000). 먼저 계산해서 넘긴다.
    v_pass  integer;
    v_fail  integer;
    v_msg   text;
    -- ⚠ 모든 DECLARE 변수를 v_ 접두로 통일한다.
    --   짧은 SQL alias(r · g · t · m …)와 이름이 겹치면 plpgsql 이 그쪽을
    --   변수로 먼저 해석해 55000(record not assigned) 이 난다.
    v_row   record;
begin
    -- ── 0. 가드 ────────────────────────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug = v_slug) then
        raise exception '이전 self-test 잔재가 있다(slug=%). 먼저 확인·정리하라.', v_slug;
    end if;
    if not exists (select 1 from public.hosted_tournaments where slug = '2026-teyeon-open') then
        raise exception '기준 대회(2026-teyeon-open)가 없어 self-test 대회를 만들 수 없다.';
    end if;

    select p.id into v_uid
      from public.profiles p join auth.users u on u.id = p.id
     where p.role in ('CEO', 'ADMIN') order by p.id limit 1;
    if v_uid is null then
        raise exception 'CEO/ADMIN profile 이 없어 운영 RPC 를 호출할 수 없다.';
    end if;

    -- 트랜잭션 한정으로만 auth.uid() 를 세운다(is_local = true). 롤백과 함께 사라진다.
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);
    if not public.can_manage_tournaments() then
        raise exception 'can_manage_tournaments() 가 false 다 — self-test 를 진행할 수 없다.';
    end if;

    -- ── 1. 작업 테이블 ─────────────────────────────────────────────────────
    create temp table _sfx  (seq integer, name text, ok boolean);
    create temp table _tm   (team_no integer, team_id uuid);
    create temp table _meta (k text, v text);
    create temp table _gsnap(group_no integer, status text, policy text, complete boolean,
                             generated integer, completed integer, cancelled integer,
                             tie_count integer, fp text,
                             tie_rank integer, tie_size integer, tie_resolved boolean);
    create temp table _snap (group_no integer, team_no integer, rank_j jsonb, auto_rank integer,
                             qual text, played integer, wins integer, losses integer,
                             gf integer, ga integer, gd integer, win_rate jsonb,
                             resolved_order jsonb);

    execute $q$
        create procedure pg_temp.sfx_chk(p_seq integer, p_name text, p_ok boolean)
        language sql as $p$
            insert into pg_temp._sfx values (p_seq, p_name, coalesce(p_ok, false));
        $p$;
    $q$;

    execute $q$
        create procedure pg_temp.sfx_refresh(p_slug text)
        language plpgsql as $p$
        declare v_res jsonb;
        begin
            v_res := public.get_preliminary_standings(p_slug);
            if v_res is null then
                raise exception 'get_preliminary_standings 가 null 을 반환했다(권한/슬러그 확인).';
            end if;
            delete from pg_temp._snap;
            delete from pg_temp._gsnap;
            delete from pg_temp._meta;

            insert into pg_temp._meta(k, v) values
                ('qualifyPerGroup', v_res ->> 'qualifyPerGroup'),
                ('groupsLen',       jsonb_array_length(v_res -> 'groups')::text),
                ('placementLen',    jsonb_array_length(v_res -> 'placement')::text),
                ('placementWinner', v_res -> 'placement' -> 0 ->> 'winnerTeamId');

            insert into pg_temp._gsnap
            select (g ->> 'groupNo')::integer, g ->> 'rankingStatus', g ->> 'policyRequired',
                   (g ->> 'groupComplete')::boolean, (g ->> 'generatedMatches')::integer,
                   (g ->> 'completedMatches')::integer, (g ->> 'cancelledMatches')::integer,
                   jsonb_array_length(g -> 'tieGroups'), g ->> 'resultsFingerprint',
                   (g -> 'tieGroups' -> 0 ->> 'rank')::integer,
                   (g -> 'tieGroups' -> 0 ->> 'size')::integer,
                   (g -> 'tieGroups' -> 0 ->> 'resolved')::boolean
              from jsonb_array_elements(v_res -> 'groups') g;

            insert into pg_temp._snap
            select (g ->> 'groupNo')::integer, (s ->> 'teamNo')::integer, s -> 'rank',
                   (s ->> 'autoRank')::integer, s ->> 'qualificationStatus',
                   (s ->> 'played')::integer, (s ->> 'wins')::integer, (s ->> 'losses')::integer,
                   (s ->> 'gamesFor')::integer, (s ->> 'gamesAgainst')::integer,
                   (s ->> 'gameDiff')::integer, s -> 'winRate', s -> 'resolvedOrder'
              from jsonb_array_elements(v_res -> 'groups') g,
                   jsonb_array_elements(g -> 'standings') s;
        end $p$;
    $q$;

    -- ── 2. self-test 대회 ──────────────────────────────────────────────────
    --   컬럼 구성을 모른 채로도 복제되도록 jsonb 로 옮겨 담는다.
    --   존재하지 않는 키(title/name)는 jsonb_populate_record 가 조용히 무시한다.
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
        || jsonb_build_object(
               'id',    gen_random_uuid()::text,
               'slug',  v_slug,
               'title', 'ZZ standings self-test',
               'name',  'ZZ standings self-test',
               'created_at', now()::text,
               'updated_at', now()::text,
               'preliminary_draw_status',  'locked',
               'preliminary_draw_version', 1,
               'preliminary_matches_fingerprint', null))
    returning id into v_tid;

    -- ── 3. 조 / 팀 / 멤버 ──────────────────────────────────────────────────
    --   1 완전분리 · 2 승률동률→득실분리 · 3 완전동률(1,1,1) · 4 (1,2,2)
    --   5 (1,1,3) · 6 진행중 · 7 CANCELLED 잔존 · 8 placement
    insert into public.hosted_tournament_groups
        (tournament_id, group_no, group_type, expected_size, display_order)
    select v_tid, v.gn, v.gt, v.es, v.gn
      from (values (1, 'preliminary', 3), (2, 'preliminary', 3), (3, 'preliminary', 3),
                   (4, 'preliminary', 3), (5, 'preliminary', 3), (6, 'preliminary', 3),
                   (7, 'preliminary', 3), (8, 'placement',   2)) as v(gn, gt, es);

    insert into public.hosted_tournament_teams
        (tournament_id, team_no, player1_name, player2_name, source)
    select v_tid, v.gn * 10 + sl,
           'P' || (v.gn * 10 + sl) || 'A', 'P' || (v.gn * 10 + sl) || 'B', 'fixture'
      from (values (1, 3), (2, 3), (3, 3), (4, 3), (5, 3), (6, 3), (7, 3), (8, 2)) as v(gn, n),
           generate_series(1, 3) sl
     where sl <= v.n;

    insert into _tm select team_no, id from public.hosted_tournament_teams
     where tournament_id = v_tid;

    insert into public.hosted_tournament_group_members
        (tournament_id, group_id, team_id, slot_no)
    select v_tid, g.id, t.id, t.team_no - g.group_no * 10
      from public.hosted_tournament_groups g
      join public.hosted_tournament_teams t
        on t.tournament_id = v_tid and t.team_no / 10 = g.group_no
     where g.tournament_id = v_tid;

    -- ── 4. 경기 ────────────────────────────────────────────────────────────
    --   slot1 이 항상 승자 쪽이다(점수 s1 > s2). 6:0 은 기권승과 같은 모양이며
    --   별도 분기 없이 일반 결과로 집계돼야 한다.
    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, sequence_no, match_no,
         team1_id, team2_id, status, score1, score2, winner_team_id,
         completed_at, cancelled_at)
    select v_tid,
           case when d.gn = 8 then 'placement' else 'preliminary' end,
           g.id, d.seq,
           (row_number() over (order by d.gn, d.seq))::integer,
           t1.id, t2.id, d.st, d.s1, d.s2,
           case when d.st = 'completed'
                then case when d.s1 > d.s2 then t1.id else t2.id end end,
           case when d.st = 'completed' then now() end,
           case when d.st = 'cancelled' then now() end
      from (values
            -- gn, seq, slot1, slot2, status, score1, score2
            (1, 1, 1, 2, 'completed'::text, 6::integer, 0::integer),
            (1, 2, 1, 3, 'completed', 6, 3),
            (1, 3, 2, 3, 'completed', 6, 4),

            (2, 1, 1, 2, 'completed', 6, 0),
            (2, 2, 2, 3, 'completed', 6, 1),
            (2, 3, 3, 1, 'completed', 6, 3),

            (3, 1, 1, 2, 'completed', 6, 0),
            (3, 2, 2, 3, 'completed', 6, 0),
            (3, 3, 3, 1, 'completed', 6, 0),

            (4, 1, 1, 2, 'completed', 6, 0),
            (4, 2, 2, 3, 'completed', 6, 2),
            (4, 3, 3, 1, 'completed', 6, 4),

            (5, 1, 1, 2, 'completed', 6, 2),
            (5, 2, 2, 3, 'completed', 6, 0),
            (5, 3, 3, 1, 'completed', 6, 4),

            (6, 1, 1, 2, 'completed', 6, 0),
            (6, 2, 2, 3, 'waiting',   null, null),
            (6, 3, 3, 1, 'waiting',   null, null),

            (7, 1, 1, 2, 'completed', 6, 0),
            (7, 2, 2, 3, 'completed', 6, 0),
            (7, 3, 3, 1, 'cancelled', null, null),

            (8, 1, 1, 2, 'completed', 6, 4)
           ) as d(gn, seq, sl1, sl2, st, s1, s2)
      join public.hosted_tournament_groups g
        on g.tournament_id = v_tid and g.group_no = d.gn
      join public.hosted_tournament_teams t1
        on t1.tournament_id = v_tid and t1.team_no = d.gn * 10 + d.sl1
      join public.hosted_tournament_teams t2
        on t2.tournament_id = v_tid and t2.team_no = d.gn * 10 + d.sl2;

    -- ══ PHASE A — 확정 전 순위 ════════════════════════════════════════════
    call pg_temp.sfx_refresh(v_slug);

    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 1) = '[1,2,3]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(1, 'G1 완전분리 — rank [1,2,3]', v_ok);
    select (
        (select status = 'FINAL' and complete and policy is null and tie_count = 0
           from _gsnap where group_no = 1)
    ) into v_ok;
    call pg_temp.sfx_chk(2, 'G1 rankingStatus FINAL / groupComplete / policyRequired 없음', v_ok);
    select (
        (select jsonb_agg(to_jsonb(qual) order by team_no) from _snap where group_no = 1)
        = '["QUALIFIED","QUALIFIED","NOT_QUALIFIED"]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(3, 'G1 진출 [QUALIFIED, QUALIFIED, NOT_QUALIFIED]', v_ok);
    select (
        (select played = 2 and wins = 2 and losses = 0 and gf = 12 and ga = 3 and gd = 9
           from _snap where group_no = 1 and team_no = 11)
    ) into v_ok;
    call pg_temp.sfx_chk(4, 'G1 6:0(기권승과 동일 모양)이 일반 결과로 집계됨', v_ok);

    select (
        (select count(distinct win_rate) = 1 and bool_and(win_rate = '0.5000'::jsonb)
           from _snap where group_no = 2)
    ) into v_ok;
    call pg_temp.sfx_chk(5, 'G2 세 팀 승률이 모두 동일(0.5)', v_ok);
    select (
        (select jsonb_agg(to_jsonb(gd) order by team_no) from _snap where group_no = 2)
        = '[3,-1,-2]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(6, 'G2 게임 득실 [3,-1,-2]', v_ok);
    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 2) = '[1,2,3]'::jsonb
        and (select status = 'FINAL' and tie_count = 0 from _gsnap where group_no = 2)
    ) into v_ok;
    call pg_temp.sfx_chk(7, 'G2 승률 동률 → 득실로 분리되어 rank [1,2,3] / FINAL', v_ok);

    select (
        (select jsonb_agg(to_jsonb(auto_rank) order by team_no) from _snap where group_no = 3)
        = '[1,1,1]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(8, 'G3 완전동률 — autoRank [1,1,1]', v_ok);
    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 3)
        = '[null,null,null]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(9, 'G3 확정 전에는 rank 를 만들어내지 않음(전부 null)', v_ok);
    select (
        (select status = 'AGE_CHECK_REQUIRED' and complete from _gsnap where group_no = 3)
    ) into v_ok;
    call pg_temp.sfx_chk(10, 'G3 rankingStatus AGE_CHECK_REQUIRED', v_ok);
    select (
        (select bool_and(qual = 'PENDING') from _snap where group_no = 3)
    ) into v_ok;
    call pg_temp.sfx_chk(11, 'G3 진출 판정 전부 PENDING', v_ok);
    select (
        (select tie_count = 1 and tie_rank = 1 and tie_size = 3 and not tie_resolved
           from _gsnap where group_no = 3)
    ) into v_ok;
    call pg_temp.sfx_chk(12, 'G3 tieGroups 1개 / rank=1 / size=3 / resolved=false', v_ok);

    select (
        (select jsonb_agg(to_jsonb(auto_rank) order by team_no) from _snap where group_no = 4)
        = '[1,2,2]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(13, 'G4 (1,2,2) autoRank', v_ok);
    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 4)
        = '[1,null,null]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(14, 'G4 1위만 rank 확정, 동률 2팀은 null', v_ok);
    select (
        (select jsonb_agg(to_jsonb(qual) order by team_no) from _snap where group_no = 4)
        = '["QUALIFIED","PENDING","PENDING"]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(15, 'G4 진출 [QUALIFIED, PENDING, PENDING] — 경계에 걸친 동률', v_ok);
    select (
        (select status = 'AGE_CHECK_REQUIRED' and tie_rank = 2 and tie_size = 2
           from _gsnap where group_no = 4)
    ) into v_ok;
    call pg_temp.sfx_chk(16, 'G4 rankingStatus AGE_CHECK_REQUIRED / tie rank=2 size=2', v_ok);

    select (
        (select jsonb_agg(to_jsonb(auto_rank) order by team_no) from _snap where group_no = 5)
        = '[1,1,3]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(17, 'G5 (1,1,3) autoRank', v_ok);
    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 5)
        = '[null,null,3]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(18, 'G5 동률 2팀 rank null, 3위는 확정', v_ok);
    select (
        (select jsonb_agg(to_jsonb(qual) order by team_no) from _snap where group_no = 5)
        = '["QUALIFIED","QUALIFIED","NOT_QUALIFIED"]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(19, 'G5 진출 [QUALIFIED, QUALIFIED, NOT_QUALIFIED] — 동률이 진출권 안쪽', v_ok);
    select (
        (select status = 'AGE_CHECK_REQUIRED' and tie_rank = 1 and tie_size = 2
           from _gsnap where group_no = 5)
    ) into v_ok;
    call pg_temp.sfx_chk(20, 'G5 rankingStatus AGE_CHECK_REQUIRED / tie rank=1 size=2', v_ok);

    select (
        (select status = 'PROVISIONAL' and not complete and policy is null
           from _gsnap where group_no = 6)
    ) into v_ok;
    call pg_temp.sfx_chk(21, 'G6 진행중 — PROVISIONAL / groupComplete false', v_ok);
    select (
        (select bool_and(qual = 'PENDING') from _snap where group_no = 6)
    ) into v_ok;
    call pg_temp.sfx_chk(22, 'G6 진행중 조는 진출 판정 전부 PENDING', v_ok);
    select (
        (select count(*) filter (where rank_j = 'null'::jsonb) = 0 from _snap where group_no = 6)
    ) into v_ok;
    call pg_temp.sfx_chk(23, 'G6 진행중에는 잠정 rank 를 그대로 노출(null 아님)', v_ok);

    select (
        (select status = 'PROVISIONAL' and not complete from _gsnap where group_no = 7)
    ) into v_ok;
    call pg_temp.sfx_chk(24, 'G7 CANCELLED 잔존 — PROVISIONAL', v_ok);
    select (
        (select policy = 'cancelled_matches_present' from _gsnap where group_no = 7)
    ) into v_ok;
    call pg_temp.sfx_chk(25, 'G7 policyRequired = cancelled_matches_present', v_ok);
    select (
        (select generated = 3 and completed = 2 and cancelled = 1 from _gsnap where group_no = 7)
    ) into v_ok;
    call pg_temp.sfx_chk(26, 'G7 경기수 generated=3 / completed=2 / cancelled=1', v_ok);
    select (
        (select played = 1 and wins = 0 and losses = 1 and gf = 0 and ga = 6
           from _snap where group_no = 7 and team_no = 73)
    ) into v_ok;
    call pg_temp.sfx_chk(27, 'G7 CANCELLED 는 집계에서 완전 제외(T73 played=1, 0:6 만 반영)', v_ok);
    select (
        (select played = 1 and wins = 1 and losses = 0 from _snap where group_no = 7
          and team_no = 71)
    ) into v_ok;
    call pg_temp.sfx_chk(28, 'G7 CANCELLED 상대(T71)도 그 경기를 승수로 얻지 않음', v_ok);

    select (
        (select v = '7' from _meta where k = 'groupsLen')
    ) into v_ok;
    call pg_temp.sfx_chk(29, 'placement 조는 standings groups 배열에서 제외(7개)', v_ok);
    select (
        (select (select v from _meta where k = 'placementLen') = '1'
            and (select v from _meta where k = 'placementWinner') is not null)
    ) into v_ok;
    call pg_temp.sfx_chk(30, 'placement 는 별도 배열로 1건, 승자 존재', v_ok);
    select (
        (select v = '2' from _meta where k = 'qualifyPerGroup')
    ) into v_ok;
    call pg_temp.sfx_chk(31, 'qualifyPerGroup = 2 (요강값이 응답에 명시됨)', v_ok);

    -- ══ PHASE B — resolve 거부 계약 ══════════════════════════════════════
    v_rej := public.resolve_group_age_tie(v_slug, 6,
        array[(select team_id from _tm where team_no = 61),
              (select team_id from _tm where team_no = 62)],
        '자체검증', (select fp from _gsnap where group_no = 6));
    select (
        v_rej ->> 'reason' = 'group_not_complete' and (v_rej ->> 'ok')::boolean is false
    ) into v_ok;
    call pg_temp.sfx_chk(32, '미완료 조는 순위 확정 거부(group_not_complete)', v_ok);

    v_rej := public.resolve_group_age_tie(v_slug, 3,
        array[(select team_id from _tm where team_no = 31),
              (select team_id from _tm where team_no = 32),
              (select team_id from _tm where team_no = 33)],
        '자체검증', 'deadbeefdeadbeefdeadbeefdeadbeef');
    select (
        v_rej ->> 'reason' = 'standings_changed'
    ) into v_ok;
    call pg_temp.sfx_chk(33, '결과 지문 불일치 시 거부(standings_changed)', v_ok);

    v_rej := public.resolve_group_age_tie(v_slug, 1,
        array[(select team_id from _tm where team_no = 11),
              (select team_id from _tm where team_no = 12)],
        '자체검증', (select fp from _gsnap where group_no = 1));
    select (
        v_rej ->> 'reason' = 'tie_set_mismatch'
    ) into v_ok;
    call pg_temp.sfx_chk(34, '동률이 아닌 팀 집합은 거부(tie_set_mismatch)', v_ok);

    v_rej := public.resolve_group_age_tie(v_slug, 8,
        array[(select team_id from _tm where team_no = 81),
              (select team_id from _tm where team_no = 82)],
        '자체검증', 'x');
    select (
        v_rej ->> 'reason' = 'placement_not_rankable'
    ) into v_ok;
    call pg_temp.sfx_chk(35, 'placement 조는 순위 확정 대상이 아님(placement_not_rankable)', v_ok);

    v_rej := public.resolve_group_age_tie(v_slug, 3,
        array[(select team_id from _tm where team_no = 31),
              (select team_id from _tm where team_no = 31)],
        '자체검증', (select fp from _gsnap where group_no = 3));
    select (
        v_rej ->> 'reason' = 'duplicate_team_in_list'
    ) into v_ok;
    call pg_temp.sfx_chk(36, '입력에 같은 팀이 두 번 오면 거부(duplicate_team_in_list)', v_ok);

    v_rej := public.resolve_group_age_tie(v_slug, 3,
        array[(select team_id from _tm where team_no = 31)], '  ', null);
    select (
        v_rej ->> 'reason' = 'reason_required'
    ) into v_ok;
    call pg_temp.sfx_chk(37, '사유 없이 확정 불가(reason_required)', v_ok);

    -- ══ PHASE C — 확정 ═══════════════════════════════════════════════════
    --   1,1,1 → 1,2,3 / 1,2,2 → 1,2,3 / 1,1,3 → 1,2,3
    v_r3 := public.resolve_group_age_tie(v_slug, 3,
        array[(select team_id from _tm where team_no = 33),
              (select team_id from _tm where team_no = 31),
              (select team_id from _tm where team_no = 32)],
        '합산연령 현장 확인', (select fp from _gsnap where group_no = 3));
    v_r4 := public.resolve_group_age_tie(v_slug, 4,
        array[(select team_id from _tm where team_no = 43),
              (select team_id from _tm where team_no = 42)],
        '합산연령 현장 확인', (select fp from _gsnap where group_no = 4));
    v_r5 := public.resolve_group_age_tie(v_slug, 5,
        array[(select team_id from _tm where team_no = 52),
              (select team_id from _tm where team_no = 51)],
        '합산연령 현장 확인', (select fp from _gsnap where group_no = 5));

    select (
        (v_r3 ->> 'ok')::boolean and (v_r3 ->> 'tieRank')::integer = 1
        and (v_r3 ->> 'tieSize')::integer = 3
    ) into v_ok;
    call pg_temp.sfx_chk(38, 'G3(1,1,1) 확정 ok / tieRank=1 / tieSize=3', v_ok);
    select (
        (v_r4 ->> 'ok')::boolean and (v_r4 ->> 'tieRank')::integer = 2
        and (v_r4 ->> 'tieSize')::integer = 2
    ) into v_ok;
    call pg_temp.sfx_chk(39, 'G4(1,2,2) 확정 ok / tieRank=2 / tieSize=2', v_ok);
    select (
        (v_r5 ->> 'ok')::boolean and (v_r5 ->> 'tieRank')::integer = 1
        and (v_r5 ->> 'tieSize')::integer = 2
    ) into v_ok;
    call pg_temp.sfx_chk(40, 'G5(1,1,3) 확정 ok / tieRank=1 / tieSize=2', v_ok);

    call pg_temp.sfx_refresh(v_slug);

    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 3) = '[2,3,1]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(41, 'G3 확정 후 rank = [2,3,1] (33→1위, 31→2위, 32→3위)', v_ok);
    select (
        (select status = 'FINAL' and tie_resolved from _gsnap where group_no = 3)
    ) into v_ok;
    call pg_temp.sfx_chk(42, 'G3 rankingStatus FINAL / tieGroup resolved', v_ok);
    select (
        (select jsonb_agg(to_jsonb(qual) order by team_no) from _snap where group_no = 3)
        = '["QUALIFIED","NOT_QUALIFIED","QUALIFIED"]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(43, 'G3 진출 재계산 [QUALIFIED, NOT_QUALIFIED, QUALIFIED]', v_ok);

    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 4) = '[1,3,2]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(44, 'G4 확정 후 rank = [1,3,2] (43→2위, 42→3위)', v_ok);
    select (
        (select jsonb_agg(to_jsonb(qual) order by team_no) from _snap where group_no = 4)
        = '["QUALIFIED","NOT_QUALIFIED","QUALIFIED"]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(45, 'G4 진출 재계산 [QUALIFIED, NOT_QUALIFIED, QUALIFIED]', v_ok);
    select (
        (select status = 'FINAL' from _gsnap where group_no = 4)
    ) into v_ok;
    call pg_temp.sfx_chk(46, 'G4 rankingStatus FINAL', v_ok);

    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 5) = '[2,1,3]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(47, 'G5 확정 후 rank = [2,1,3] (52→1위, 51→2위)', v_ok);
    select (
        (select jsonb_agg(to_jsonb(qual) order by team_no) from _snap where group_no = 5)
        = '["QUALIFIED","QUALIFIED","NOT_QUALIFIED"]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(48, 'G5 진출 재계산 [QUALIFIED, QUALIFIED, NOT_QUALIFIED]', v_ok);
    select (
        (select status = 'FINAL' from _gsnap where group_no = 5)
    ) into v_ok;
    call pg_temp.sfx_chk(49, 'G5 rankingStatus FINAL', v_ok);

    select (
        (select bool_and(ranks = '[1,2,3]'::jsonb) from (
            select group_no, jsonb_agg(rank_j order by (rank_j #>> '{}')::integer) as ranks
              from _snap where group_no in (3, 4, 5) group by group_no) x)
    ) into v_ok;
    call pg_temp.sfx_chk(50, '1,2,2 / 1,1,3 / 1,1,1 세 경우 모두 확정 후 정확히 1,2,3', v_ok);

    -- ══ PHASE D — 재확정(무효화 + 재삽입) ════════════════════════════════
    v_r4b := public.resolve_group_age_tie(v_slug, 4,
        array[(select team_id from _tm where team_no = 42),
              (select team_id from _tm where team_no = 43)],
        '합산연령 재확인', (select fp from _gsnap where group_no = 4));
    select (
        (v_r4b ->> 'ok')::boolean and (v_r4b ->> 'replacedResolutions')::integer = 2
    ) into v_ok;
    call pg_temp.sfx_chk(51, 'G4 재확정 ok / 이전 확정 2건 무효화', v_ok);

    call pg_temp.sfx_refresh(v_slug);
    select (
        (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 4) = '[1,2,3]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(52, 'G4 재확정 반영 rank = [1,2,3]', v_ok);
    select (
        (select count(*) = 4 and count(*) filter (where tr.invalidated_at is null) = 2
           from public.hosted_tournament_group_tie_resolutions tr
           join public.hosted_tournament_groups grp on grp.id = tr.group_id
          where tr.tournament_id = v_tid and grp.group_no = 4)
    ) into v_ok;
    call pg_temp.sfx_chk(53, 'G4 확정 이력 보존 — 총 4행(무효 2 + 유효 2), 삭제 없음', v_ok);

    -- ══ PHASE E — 결과 수정 → 확정 원자적 무효화 ═════════════════════════
    --   같은 점수로 수정해도 무효화한다(보수적 정책). 동률 구조가 그대로이므로
    --   AGE_CHECK_REQUIRED 로 정확히 되돌아가야 한다.
    select m.id into v_mid
      from public.hosted_tournament_matches m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = v_tid and g.group_no = 3 and m.sequence_no = 1;

    v_ramd := public.amend_completed_match_score(v_mid, 6, 0, '자체검증 — 결과 재확인', 1);
    select (
        (v_ramd ->> 'ok')::boolean and (v_ramd ->> 'invalidatedResolutions')::integer = 3
    ) into v_ok;
    call pg_temp.sfx_chk(54, 'amend 성공 시 같은 조 확정 3건을 함께 무효화', v_ok);
    select (
        (select count(*) filter (where tr.invalidated_at is null) = 0
            and count(*) filter (where tr.invalidated_reason = 'score_amended') = 3
           from public.hosted_tournament_group_tie_resolutions tr
           join public.hosted_tournament_groups grp on grp.id = tr.group_id
          where tr.tournament_id = v_tid and grp.group_no = 3)
    ) into v_ok;
    call pg_temp.sfx_chk(55, 'G3 유효 확정 0건 / 무효 사유 score_amended 3건', v_ok);

    call pg_temp.sfx_refresh(v_slug);
    select (
        (select status = 'AGE_CHECK_REQUIRED' and not tie_resolved from _gsnap where group_no = 3)
        and (select jsonb_agg(rank_j order by team_no) from _snap where group_no = 3)
            = '[null,null,null]'::jsonb
    ) into v_ok;
    call pg_temp.sfx_chk(56, 'G3 순위가 AGE_CHECK_REQUIRED 로 되돌아가고 rank 전부 null', v_ok);
    select (
        (select bool_and(status = 'FINAL') from _gsnap where group_no in (4, 5))
    ) into v_ok;
    call pg_temp.sfx_chk(57, '다른 조(G4·G5)의 확정은 영향받지 않음 — 여전히 FINAL', v_ok);

    select (
        (select count(*) = 4 from public.hosted_tournament_events
          where tournament_id = v_tid and action = 'group_age_tie_resolved')
    ) into v_ok;
    call pg_temp.sfx_chk(58, '감사 로그 — group_age_tie_resolved 4건(확정 3 + 재확정 1)', v_ok);
    select (
        (select count(*) = 1 from public.hosted_tournament_events
          where tournament_id = v_tid and action = 'group_age_tie_resolution_invalidated')
    ) into v_ok;
    call pg_temp.sfx_chk(59, '감사 로그 — group_age_tie_resolution_invalidated 1건', v_ok);
    select (
        (select count(*) = 0 from public.hosted_tournament_matches mt
           join public.hosted_tournaments ht on ht.id = mt.tournament_id
          where ht.slug = '2026-teyeon-open')
        and (select count(*) = 0 from public.hosted_tournament_group_tie_resolutions tr
               join public.hosted_tournaments ht on ht.id = tr.tournament_id
              where ht.slug = '2026-teyeon-open')
    ) into v_ok;
    call pg_temp.sfx_chk(60, 'Production(2026-teyeon-open) 무영향 — 경기·확정 0건 유지', v_ok);

    -- ── 결과 출력 + 전체 롤백 ──────────────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok)
      into v_pass, v_fail from _sfx;

    v_msg := format(E'\n===== Batch 3B standings fixture =====\nPASS=%s  FAIL=%s  TOTAL=%s  ->  %s\n',
                    v_pass, v_fail, v_pass + v_fail,
                    case when v_fail = 0 then 'ALL PASS' else 'CHECK FAILED' end);
    for v_row in select seq, name from _sfx where not ok order by seq loop
        v_msg := v_msg || format(E'FAIL  %s  %s\n', v_row.seq, v_row.name);
    end loop;
    v_msg := v_msg ||
        E'\n(이 예외는 의도된 것이다 — self-test 데이터는 전부 롤백되어 DB 에 남지 않는다)';

    raise exception '%', v_msg;
end;
$fixture$;
