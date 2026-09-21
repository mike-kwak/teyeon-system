-- ============================================================================
--  2026 TEYEON OPEN — Public Preliminary DRAW 실동작 self-test (fixture)
--
--  임시 대회(zz-fixture-public-draw-selftest)에서 **실제 RPC** 로 공개 계약을 검증한다.
--    publish / unpublish / unlock 자동 비공개 / 공개 조건 3개 / 페이로드 최소화 /
--    Admin 과 Public 순위 · 진출 · 상태 완전 일치(Single Source of Truth)
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고 마지막 예외로 전부 롤백한다.
--    ERROR 본문의 `PASS=N  FAIL=0  → ALL PASS` 를 확인하라.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조 복사에만 읽고 수정하지 않는다.
--  선행: add_hosted_tournament_public_draw.sql
-- ============================================================================
do $fixture$
declare
    v_slug  text := 'zz-fixture-public-draw-selftest';
    v_tid   uuid;
    v_uid   uuid;
    v_ver   integer;
    v_r     jsonb;
    v_pub   jsonb;
    v_adm   jsonb;
    v_ok    boolean;   -- ⚠ CALL 인자에는 subquery 를 못 쓴다(0A000). 모든 검사는 v_ok 에 먼저 계산해서 넘긴다.
    v_txt   text;
    v_pass  integer;
    v_fail  integer;
    v_msg   text;
    v_row   record;
    v_cnt   integer;
begin
    -- ── 0. 가드 · 운영진 컨텍스트 ─────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug = v_slug) then
        raise exception '이전 self-test 잔재가 있다(slug=%). 먼저 확인·정리하라.', v_slug;
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

    create temp table _pfx (seq integer, name text, ok boolean);
    execute $q$
        create procedure pg_temp.pfx_chk(p_seq integer, p_name text, p_ok boolean)
        language sql as $p$ insert into pg_temp._pfx values (p_seq, p_name, coalesce(p_ok, false)); $p$;
    $q$;

    -- ── 1. self-test 대회 (조편성 draft · 공개 시각 없음 · 대회 상태는 기준 대회 복사) ──
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
        || jsonb_build_object(
               'id', gen_random_uuid()::text, 'slug', v_slug,
               'title', 'ZZ public draw self-test', 'name', 'ZZ public draw self-test',
               'status', 'registration_closed',
               'created_at', now()::text, 'updated_at', now()::text,
               'preliminary_draw_status', 'draft', 'preliminary_draw_version', 1,
               'preliminary_draw_published_at', null,
               'preliminary_matches_fingerprint', null))
    returning id into v_tid;

    -- 조 7개(3팀) + 순위결정전 1개(2팀) — 3B fixture 와 같은 모양
    insert into public.hosted_tournament_groups (tournament_id, group_no, group_type, expected_size, display_order)
    select v_tid, v.gn, v.gt, v.es, v.gn
      from (values (1,'preliminary',3),(2,'preliminary',3),(3,'preliminary',3),(4,'preliminary',3),
                   (5,'preliminary',3),(6,'preliminary',3),(7,'preliminary',3),(8,'placement',2)) as v(gn, gt, es);
    insert into public.hosted_tournament_teams (tournament_id, team_no, player1_name, player2_name, source)
    select v_tid, v.gn * 10 + sl, 'P' || (v.gn * 10 + sl) || 'A', 'P' || (v.gn * 10 + sl) || 'B', 'fixture'
      from (values (1,3),(2,3),(3,3),(4,3),(5,3),(6,3),(7,3),(8,2)) as v(gn, n), generate_series(1, 3) sl
     where sl <= v.n;
    insert into public.hosted_tournament_group_members (tournament_id, group_id, team_id, slot_no)
    select v_tid, g.id, t.id, t.team_no - g.group_no * 10
      from public.hosted_tournament_groups g
      join public.hosted_tournament_teams t on t.tournament_id = v_tid and t.team_no / 10 = g.group_no
     where g.tournament_id = v_tid;

    -- 경기: 1 완료(분리) · 2 완료(1,1,1 동률 → AGE_CHECK) · 3 진행 중 · 4 경기 전 · 5 CANCELLED 잔존
    --       6 완료(1위 2팀 동률) · 7 완료(분리) · 8 순위결정전 완료
    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, sequence_no, match_no, team1_id, team2_id,
         status, score1, score2, winner_team_id, completed_at, cancelled_at)
    select v_tid, case when d.gn = 8 then 'placement' else 'preliminary' end, g.id, d.seq,
           (row_number() over (order by d.gn, d.seq))::integer, t1.id, t2.id, d.st, d.s1, d.s2,
           case when d.st = 'completed' then case when d.s1 > d.s2 then t1.id else t2.id end end,
           case when d.st = 'completed' then now() end,
           case when d.st = 'cancelled' then now() end
      from (values
            (1,1,1,2,'completed'::text,6::integer,0::integer),(1,2,1,3,'completed',6,3),(1,3,2,3,'completed',6,4),
            (2,1,1,2,'completed',6,0),(2,2,2,3,'completed',6,0),(2,3,3,1,'completed',6,0),
            (3,1,1,2,'completed',6,2),(3,2,1,3,'waiting',null,null),(3,3,2,3,'waiting',null,null),
            (4,1,1,2,'waiting',null,null),(4,2,1,3,'waiting',null,null),(4,3,2,3,'waiting',null,null),
            (5,1,1,2,'completed',6,1),(5,2,1,3,'cancelled',null,null),(5,3,2,3,'waiting',null,null),
            (6,1,1,2,'completed',6,2),(6,2,2,3,'completed',6,0),(6,3,3,1,'completed',6,4),
            (7,1,1,2,'completed',6,1),(7,2,1,3,'completed',6,2),(7,3,2,3,'completed',6,3),
            (8,1,1,2,'completed',6,4)
           ) as d(gn, seq, a, b, st, s1, s2)
      join public.hosted_tournament_groups g on g.tournament_id = v_tid and g.group_no = d.gn
      join public.hosted_tournament_teams t1 on t1.tournament_id = v_tid and t1.team_no = d.gn * 10 + d.a
      join public.hosted_tournament_teams t2 on t2.tournament_id = v_tid and t2.team_no = d.gn * 10 + d.b;

    -- ── 2. 비공개 상태 ─────────────────────────────────────────────────────
    v_ok := (select preliminary_draw_published_at is null from public.hosted_tournaments where id = v_tid);
    call pg_temp.pfx_chk(1, '새 대회는 공개 시각 NULL(비공개로 시작)', v_ok);
    v_ok := public.get_public_preliminary_draw(v_slug) is null;
    call pg_temp.pfx_chk(2, 'draft 조편성 + 비공개 → 공개 RPC null', v_ok);

    select preliminary_draw_version into v_ver from public.hosted_tournaments where id = v_tid;
    v_r := public.publish_preliminary_draw(v_slug, v_ver);
    v_ok := v_r ->> 'reason' = 'draw_not_locked';
    call pg_temp.pfx_chk(3, 'draft 조편성은 공개 거부(draw_not_locked)', v_ok);

    -- ── 3. LOCK 은 공개가 아니다 ───────────────────────────────────────────
    v_r := public.lock_preliminary_draw(v_slug, v_ver);
    v_ok := (v_r ->> 'ok')::boolean;
    call pg_temp.pfx_chk(4, 'lock 성공', v_ok);
    v_ok := (select preliminary_draw_published_at is null from public.hosted_tournaments where id = v_tid);
    call pg_temp.pfx_chk(5, 'lock 후에도 공개 시각 NULL(자동 공개 없음)', v_ok);
    v_ok := public.get_public_preliminary_draw(v_slug) is null;
    call pg_temp.pfx_chk(6, 'locked + 비공개 → 공개 RPC null', v_ok);

    -- ── 4. publish ─────────────────────────────────────────────────────────
    select preliminary_draw_version into v_ver from public.hosted_tournaments where id = v_tid;
    v_r := public.publish_preliminary_draw(v_slug, v_ver - 1);
    v_ok := v_r ->> 'reason' = 'version_conflict';
    call pg_temp.pfx_chk(7, '오래된 version 은 거부(version_conflict)', v_ok);
    v_r := public.publish_preliminary_draw(v_slug, null);
    v_ok := v_r ->> 'reason' = 'version_required';
    call pg_temp.pfx_chk(8, 'version 없으면 거부(version_required)', v_ok);
    v_r := public.publish_preliminary_draw(v_slug, v_ver);
    v_ok := (v_r ->> 'ok')::boolean;
    call pg_temp.pfx_chk(9, 'publish 성공', v_ok);
    v_ok := (v_r ->> 'version')::integer = v_ver + 1;
    call pg_temp.pfx_chk(10, 'publish 가 version +1', v_ok);
    v_ok := (select preliminary_draw_published_at is not null from public.hosted_tournaments where id = v_tid);
    call pg_temp.pfx_chk(11, '공개 시각 기록', v_ok);
    v_ok := (select count(*) = 1 from public.hosted_tournament_events
            where tournament_id = v_tid and action = 'publish_preliminary_draw');
    call pg_temp.pfx_chk(12, 'publish audit 1건', v_ok);
    v_r := public.publish_preliminary_draw(v_slug, (v_r ->> 'version')::integer);
    v_ok := v_r ->> 'reason' = 'draw_already_published';
    call pg_temp.pfx_chk(13, '중복 공개는 오류(draw_already_published)', v_ok);

    -- ── 5. 공개 페이로드 (anon 컨텍스트) ───────────────────────────────────
    v_adm := public.get_preliminary_standings(v_slug);   -- 운영진 컨텍스트에서 먼저 받아 둔다
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    v_ok := not public.can_manage_tournaments();
    call pg_temp.pfx_chk(14, 'anon 컨텍스트에서 can_manage_tournaments = false', v_ok);
    v_ok := public.get_preliminary_standings(v_slug) is null;
    call pg_temp.pfx_chk(15, 'anon 컨텍스트에서 운영 standings 는 null', v_ok);
    v_pub := public.get_public_preliminary_draw(v_slug);
    v_ok := v_pub is not null and (v_pub ->> 'published')::boolean;
    call pg_temp.pfx_chk(16, 'anon 컨텍스트에서 공개 RPC 반환', v_ok);
    v_ok := jsonb_array_length(v_pub -> 'groups') = 7;
    call pg_temp.pfx_chk(17, '예선 조 7개(순위결정전은 groups 에 없음)', v_ok);
    v_ok := jsonb_array_length(v_pub -> 'placement') = 1;
    call pg_temp.pfx_chk(18, '순위결정전 1개 분리 반환', v_ok);
    v_txt := v_pub::text;
    v_ok := v_txt !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    call pg_temp.pfx_chk(19, '페이로드에 uuid 없음', v_ok);
    v_ok := v_txt !~ '"(teamId|groupId|matchId|tournamentId|winnerTeamId|loserTeamId|resultsFingerprint|tieGroups|resolvedReason|resolvedOrder|resolvedAt|autoRank|winRate|version|publishedAt)"';
    call pg_temp.pfx_chk(20, '페이로드에 내부 키 없음(teamId · groupId · matchId · fingerprint · tieGroups · resolved* · version · publishedAt)', v_ok);
    v_ok := v_txt !~* '"[a-z]*(phone|email|depositor|payment|consent|note|birth|dob|age)[a-z]*"';
    call pg_temp.pfx_chk(21, '페이로드에 연락처 · 입금 · 동의 · 나이 계열 키 없음', v_ok);
    v_ok := (select g ->> 'rankingStatus' = 'PROVISIONAL' and (g ->> 'completedMatches')::int = 0
             from jsonb_array_elements(v_pub -> 'groups') g where (g ->> 'groupNo')::int = 4);
    call pg_temp.pfx_chk(22, '경기 전 조(4)는 PROVISIONAL · 완료 0', v_ok);
    v_ok := (select g ->> 'rankingStatus' = 'AGE_CHECK_REQUIRED' and not (g ? 'tieGroups')
             from jsonb_array_elements(v_pub -> 'groups') g where (g ->> 'groupNo')::int = 2);
    call pg_temp.pfx_chk(23, '동률 조(2)는 AGE_CHECK_REQUIRED(상태만, 상세 없음)', v_ok);
    v_ok := (select g ->> 'rankingStatus' = 'AGE_CHECK_REQUIRED'
             from jsonb_array_elements(v_pub -> 'groups') g where (g ->> 'groupNo')::int = 6);
    call pg_temp.pfx_chk(24, '1위 2팀 동률 조(6)도 서버 판정 그대로 AGE_CHECK_REQUIRED', v_ok);
    v_ok := (select g ->> 'rankingStatus' = 'PROVISIONAL' and (g ->> 'cancelledMatches')::int = 1
             from jsonb_array_elements(v_pub -> 'groups') g where (g ->> 'groupNo')::int = 5);
    call pg_temp.pfx_chk(25, 'CANCELLED 조(5)는 PROVISIONAL + 취소 1건', v_ok);
    v_ok := (select g ->> 'rankingStatus' = 'FINAL'
                  and (select string_agg(s ->> 'qualificationStatus', ',' order by (s ->> 'rank')::int)
                         from jsonb_array_elements(g -> 'standings') s) = 'QUALIFIED,QUALIFIED,NOT_QUALIFIED'
             from jsonb_array_elements(v_pub -> 'groups') g where (g ->> 'groupNo')::int = 1);
    call pg_temp.pfx_chk(26, '완료 조(1)는 FINAL · 1·2위 QUALIFIED · 3위 NOT_QUALIFIED', v_ok);
    v_ok := (select bool_and(case when m ->> 'status' = 'completed'
                                then (m ->> 'score1') is not null and (m ->> 'winnerSide') in ('1', '2')
                                else (m ->> 'score1') is null and (m ->> 'winnerSide') is null end)
             from jsonb_array_elements(v_pub -> 'groups') g, jsonb_array_elements(g -> 'matches') m);
    call pg_temp.pfx_chk(27, '경기: 완료만 점수 · 승자 쪽(1|2), 대기는 점수 null', v_ok);
    v_ok := (select bool_and((m -> 'team1') ?& array['teamNo','player1Name','player2Name']
                           and (select count(*) = 3 from jsonb_object_keys(m -> 'team1')))
             from jsonb_array_elements(v_pub -> 'groups') g, jsonb_array_elements(g -> 'matches') m);
    call pg_temp.pfx_chk(28, '경기에 팀 번호 · 선수명만(팀 표시 정보)', v_ok);
    v_ok := (v_pub -> 'placement' -> 0 ->> 'winnerSide') = '1'
          and (v_pub -> 'placement' -> 0 ->> 'score1') = '6';
    call pg_temp.pfx_chk(29, '순위결정전 승자 쪽 = 1(6:4)', v_ok);

    -- ── 6. Single Source of Truth — Admin 과 Public 이 팀 단위로 완전히 같다 ──
    select bool_and(
               (a_s ->> 'rank') is not distinct from (p_s ->> 'rank')
           and (a_s ->> 'wins') = (p_s ->> 'wins') and (a_s ->> 'losses') = (p_s ->> 'losses')
           and (a_s ->> 'gamesFor') = (p_s ->> 'gamesFor') and (a_s ->> 'gamesAgainst') = (p_s ->> 'gamesAgainst')
           and (a_s ->> 'gameDiff') = (p_s ->> 'gameDiff') and (a_s ->> 'played') = (p_s ->> 'played')
           and (a_s ->> 'qualificationStatus') = (p_s ->> 'qualificationStatus')
           and (a_g ->> 'rankingStatus') = (p_g ->> 'rankingStatus')), count(*)
      into v_ok, v_cnt
      from jsonb_array_elements(v_adm -> 'groups') a_g
      join jsonb_array_elements(v_pub -> 'groups') p_g on (a_g ->> 'groupNo') = (p_g ->> 'groupNo')
      join lateral jsonb_array_elements(a_g -> 'standings') a_s on true
      join lateral jsonb_array_elements(p_g -> 'standings') p_s on (a_s ->> 'teamNo') = (p_s ->> 'teamNo');
    v_ok := v_ok and v_cnt = 21;
    call pg_temp.pfx_chk(30, 'Admin = Public (21팀 rank · 승패 · 득실 · 진출 · 조 상태 전부 일치)', v_ok);

    -- ── 7. 대회 draft 면 공개 RPC null (운영진 컨텍스트로 복귀) ─────────────
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);
    update public.hosted_tournaments set status = 'draft' where id = v_tid;
    v_ok := public.get_public_preliminary_draw(v_slug) is null;
    call pg_temp.pfx_chk(31, '대회 draft → 공개 RPC null(공개 시각이 있어도)', v_ok);
    update public.hosted_tournaments set status = 'registration_closed' where id = v_tid;
    v_ok := public.get_public_preliminary_draw(v_slug) is not null;
    call pg_temp.pfx_chk(32, '대회 공개 복귀 → 다시 반환', v_ok);

    -- ── 8. unlock → 자동 비공개 · 자동 재공개 없음 ─────────────────────────
    select preliminary_draw_version into v_ver from public.hosted_tournaments where id = v_tid;
    v_r := public.unlock_preliminary_draw(v_slug, '셀프테스트 unlock', v_ver);
    -- 진행/완료 경기가 있으면 unlock 은 막힌다(3A 계약) → 경기 없는 상태에서 다시 확인한다.
    v_ok := v_r ->> 'reason' = 'matches_in_progress'
          and (select preliminary_draw_published_at is not null from public.hosted_tournaments where id = v_tid);
    call pg_temp.pfx_chk(33, '진행/완료 경기가 있으면 unlock 거부(3A 계약 유지) · 공개 유지', v_ok);
    delete from public.hosted_tournament_matches where tournament_id = v_tid;   -- self-test 대회 한정
    v_r := public.unlock_preliminary_draw(v_slug, '셀프테스트 unlock', v_ver);
    v_ok := (v_r ->> 'ok')::boolean and (v_r ->> 'publicDrawUnpublished')::boolean;
    call pg_temp.pfx_chk(34, 'unlock 성공 + publicDrawUnpublished = true', v_ok);
    v_ok := (select preliminary_draw_published_at is null and preliminary_draw_status = 'draft'
             from public.hosted_tournaments where id = v_tid);
    call pg_temp.pfx_chk(35, 'unlock 과 같은 트랜잭션에서 공개 시각 NULL', v_ok);
    v_ok := public.get_public_preliminary_draw(v_slug) is null;
    call pg_temp.pfx_chk(36, 'unlock 후 공개 RPC null', v_ok);
    v_ok := (select count(*) = 1 from public.hosted_tournament_events
            where tournament_id = v_tid and action = 'unpublish_preliminary_draw'
              and to_value ->> 'cause' = 'draw_unlocked');
    call pg_temp.pfx_chk(37, '자동 비공개 audit(원인 draw_unlocked) 1건', v_ok);
    v_ok := (select count(*) = 1 from public.hosted_tournament_events
            where tournament_id = v_tid and action = 'unlock_preliminary_draw'
              and (to_value ->> 'publicDrawUnpublished')::boolean);
    call pg_temp.pfx_chk(38, 'unlock audit 에 publicDrawUnpublished 기록', v_ok);
    select preliminary_draw_version into v_ver from public.hosted_tournaments where id = v_tid;
    v_r := public.lock_preliminary_draw(v_slug, v_ver);
    v_ok := (v_r ->> 'ok')::boolean
          and (select preliminary_draw_published_at is null from public.hosted_tournaments where id = v_tid)
          and public.get_public_preliminary_draw(v_slug) is null;
    call pg_temp.pfx_chk(39, '재 LOCK 후에도 비공개 유지(자동 재공개 없음)', v_ok);

    -- ── 9. 수동 unpublish ─────────────────────────────────────────────────
    select preliminary_draw_version into v_ver from public.hosted_tournaments where id = v_tid;
    v_r := public.unpublish_preliminary_draw(v_slug, '셀프테스트', v_ver);
    v_ok := v_r ->> 'reason' = 'draw_not_published';
    call pg_temp.pfx_chk(40, '비공개 상태에서 unpublish 는 오류(draw_not_published)', v_ok);
    v_r := public.publish_preliminary_draw(v_slug, v_ver);
    v_ok := (v_r ->> 'ok')::boolean;
    call pg_temp.pfx_chk(41, '재공개(운영진 수동) 성공', v_ok);
    v_r := public.unpublish_preliminary_draw(v_slug, '', null);
    v_ok := v_r ->> 'reason' = 'reason_required';
    call pg_temp.pfx_chk(42, 'unpublish 사유 필수(reason_required)', v_ok);
    v_r := public.unpublish_preliminary_draw(v_slug, '셀프테스트 공개 취소', null);
    v_ok := (v_r ->> 'ok')::boolean and public.get_public_preliminary_draw(v_slug) is null;
    call pg_temp.pfx_chk(43, '수동 unpublish 성공 → 공개 RPC null', v_ok);
    v_ok := (select count(*) = 1 from public.hosted_tournament_events
            where tournament_id = v_tid and action = 'unpublish_preliminary_draw' and to_value ->> 'cause' = 'manual');
    call pg_temp.pfx_chk(44, '수동 unpublish audit(원인 manual)', v_ok);

    -- ── 10. anon 은 운영 RPC 로 공개 상태를 바꿀 수 없다 ────────────────────
    v_ok := not has_function_privilege('anon', 'public.publish_preliminary_draw(text,integer)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.unpublish_preliminary_draw(text,text,integer)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.hosted_tournament_preliminary_standings_core(uuid)', 'EXECUTE');
    call pg_temp.pfx_chk(45, 'anon EXECUTE 없음: publish · unpublish · 코어', v_ok);
    v_ok := (select preliminary_draw_published_at is null from public.hosted_tournaments where slug = '2026-teyeon-open');
    call pg_temp.pfx_chk(46, 'Production(2026-teyeon-open) 공개 시각 무변경(NULL)', v_ok);

    -- ── 결과 출력 + 전체 롤백 ──────────────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from _pfx;
    v_msg := format(E'\n===== Public DRAW fixture =====\nPASS=%s  FAIL=%s  TOTAL=%s  ->  %s\n',
                    v_pass, v_fail, v_pass + v_fail,
                    case when v_fail = 0 then 'ALL PASS' else 'CHECK FAILED' end);
    for v_row in select seq, name from _pfx where not ok order by seq loop
        v_msg := v_msg || format(E'FAIL  %s  %s\n', v_row.seq, v_row.name);
    end loop;
    v_msg := v_msg || E'\n(이 예외는 의도된 것이다 — self-test 데이터는 전부 롤백되어 DB 에 남지 않는다)';
    raise exception '%', v_msg;
end;
$fixture$;
