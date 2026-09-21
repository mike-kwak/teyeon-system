-- ============================================================================
--  2026 TEYEON OPEN — 취소 경기 복구 (Batch 3C-2) 실동작 self-test
--
--  무엇을 하나
--    임시 대회(zz-fixture-restore-selftest)를 만들고 조·팀·코트·경기를 심은 뒤
--    **실제 RPC**(restore_cancelled_match / get_preliminary_standings)를 호출해
--    상태 전이 계약 28개를 검증한다.
--
--  ⚠⚠ 이 스크립트는 **항상 ERROR 로 끝난다. 그게 정상이다.**
--    전체가 하나의 DO 블록(=하나의 트랜잭션)이고, 마지막에 일부러 예외를 던져
--    심어 둔 데이터를 전부 롤백한다. 운영 DB 에 단 한 행도 남지 않는다.
--    ERROR 메시지 본문이 곧 검증 결과다. `PASS=28  FAIL=0  → ALL PASS` 를 확인하라.
--
--  ⚠ 부분 실행이 불가능하다(단일 DO 블록). 통째로 붙여넣고 1회 실행한다.
--  ⚠ Production 대회(2026-teyeon-open)는 컬럼 구조를 복사하는 데만 읽고,
--    그 대회의 행은 수정하지 않는다.
--
--  ⚠ harness 규칙 (3B fixture 에서 배운 것)
--    · PL/pgSQL 의 CALL 인자에는 subquery 를 쓸 수 없다(0A000)
--      → 모든 검사는 `select ( … ) into v_ok;` 로 먼저 계산한 뒤 넘긴다.
--    · DECLARE 변수와 SQL alias 가 겹치면 55000 이 난다
--      → DECLARE 변수는 전부 v_ 접두로 통일한다.
--
--  선행: Batch 3A matches + Batch 3B standings
--        + add_hosted_tournament_match_cancel_restore.sql
-- ============================================================================

do $fixture$
declare
    v_slug  text := 'zz-fixture-restore-selftest';
    v_tid   uuid;
    v_uid   uuid;
    v_ok    boolean;
    v_res   jsonb;
    v_r     jsonb;
    v_m_can uuid;   -- G1 seq1 · cancelled  (복구 대상)
    v_m_don uuid;   -- G1 seq2 · completed
    v_m_wat uuid;   -- G1 seq3 · waiting
    v_m_cal uuid;   -- G2 seq1 · calling
    v_m_ply uuid;   -- G2 seq2 · playing
    v_ver   integer;
    v_denied boolean := false;
    v_pass  integer;
    v_fail  integer;
    v_msg   text;
    v_row   record;
begin
    -- ── 0. 가드 ────────────────────────────────────────────────────────────
    if exists (select 1 from public.hosted_tournaments where slug = v_slug) then
        raise exception '이전 self-test 잔재가 있다(slug=%). 먼저 확인·정리하라.', v_slug;
    end if;
    if not exists (select 1 from public.hosted_tournaments where slug = '2026-teyeon-open') then
        raise exception '기준 대회(2026-teyeon-open)가 없어 self-test 대회를 만들 수 없다.';
    end if;
    if to_regprocedure('public.restore_cancelled_match(uuid,text,integer)') is null then
        raise exception 'restore_cancelled_match 가 없다. follow-up SQL 을 먼저 적용하라.';
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

    create temp table _sfx (seq integer, name text, ok boolean);

    execute $q$
        create procedure pg_temp.sfx_chk(p_seq integer, p_name text, p_ok boolean)
        language sql as $p$
            insert into pg_temp._sfx values (p_seq, p_name, coalesce(p_ok, false));
        $p$;
    $q$;

    -- ── 1. self-test 대회 / 조 / 팀 / 코트 ─────────────────────────────────
    insert into public.hosted_tournaments
    select * from jsonb_populate_record(
        null::public.hosted_tournaments,
        (select to_jsonb(t) from public.hosted_tournaments t where t.slug = '2026-teyeon-open')
        || jsonb_build_object(
               'id',    gen_random_uuid()::text,
               'slug',  v_slug,
               'title', 'ZZ cancel-restore self-test',
               'name',  'ZZ cancel-restore self-test',
               'created_at', now()::text,
               'updated_at', now()::text,
               'preliminary_draw_status',  'locked',
               'preliminary_draw_version', 1,
               'preliminary_matches_fingerprint', null))
    returning id into v_tid;

    insert into public.hosted_tournament_groups
        (tournament_id, group_no, group_type, expected_size, display_order)
    values (v_tid, 1, 'preliminary', 3, 1),
           (v_tid, 2, 'preliminary', 3, 2);

    insert into public.hosted_tournament_teams
        (tournament_id, team_no, player1_name, player2_name, source)
    select v_tid, v.gn * 10 + sl,
           'P' || (v.gn * 10 + sl) || 'A', 'P' || (v.gn * 10 + sl) || 'B', 'fixture'
      from (values (1), (2)) as v(gn), generate_series(1, 3) sl;

    insert into public.hosted_tournament_group_members
        (tournament_id, group_id, team_id, slot_no)
    select v_tid, g.id, t.id, t.team_no - g.group_no * 10
      from public.hosted_tournament_groups g
      join public.hosted_tournament_teams t
        on t.tournament_id = v_tid and t.team_no / 10 = g.group_no
     where g.tournament_id = v_tid;

    insert into public.hosted_tournament_courts
        (tournament_id, court_no, display_order, status)
    values (v_tid, 1, 1, 'active');

    -- ── 2. 경기 ────────────────────────────────────────────────────────────
    --   G1: 취소 · 완료 · 대기      G2: 호명 · 진행중 · 대기
    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, sequence_no, match_no,
         team1_id, team2_id, status, score1, score2, winner_team_id,
         court_id, called_at, started_at, completed_at, cancelled_at)
    select v_tid, 'preliminary', g.id, d.seq,
           (row_number() over (order by d.gn, d.seq))::integer,
           t1.id, t2.id, d.st, d.s1, d.s2,
           case when d.st = 'completed'
                then case when d.s1 > d.s2 then t1.id else t2.id end end,
           case when d.st = 'playing' then (select id from public.hosted_tournament_courts
                                             where tournament_id = v_tid and court_no = 1) end,
           case when d.st in ('calling', 'playing') then now() end,
           case when d.st = 'playing'   then now() end,
           case when d.st = 'completed' then now() end,
           case when d.st = 'cancelled' then now() end
      from (values
            (1, 1, 1, 2, 'cancelled'::text, null::integer, null::integer),
            (1, 2, 2, 3, 'completed', 6, 0),
            (1, 3, 3, 1, 'waiting',   null, null),
            (2, 1, 1, 2, 'calling',   null, null),
            (2, 2, 2, 3, 'playing',   null, null),
            (2, 3, 3, 1, 'waiting',   null, null)
           ) as d(gn, seq, sl1, sl2, st, s1, s2)
      join public.hosted_tournament_groups g
        on g.tournament_id = v_tid and g.group_no = d.gn
      join public.hosted_tournament_teams t1
        on t1.tournament_id = v_tid and t1.team_no = d.gn * 10 + d.sl1
      join public.hosted_tournament_teams t2
        on t2.tournament_id = v_tid and t2.team_no = d.gn * 10 + d.sl2;

    select m.id into v_m_can from public.hosted_tournament_matches m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = v_tid and g.group_no = 1 and m.sequence_no = 1;
    select m.id into v_m_don from public.hosted_tournament_matches m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = v_tid and g.group_no = 1 and m.sequence_no = 2;
    select m.id into v_m_wat from public.hosted_tournament_matches m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = v_tid and g.group_no = 1 and m.sequence_no = 3;
    select m.id into v_m_cal from public.hosted_tournament_matches m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = v_tid and g.group_no = 2 and m.sequence_no = 1;
    select m.id into v_m_ply from public.hosted_tournament_matches m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = v_tid and g.group_no = 2 and m.sequence_no = 2;

    -- ══ 복구 전 standings (CANCELLED 정책이 걸려 있어야 한다) ═════════════
    v_res := public.get_preliminary_standings(v_slug);

    select ((v_res -> 'groups' -> 0 ->> 'policyRequired') = 'cancelled_matches_present'
            and (v_res -> 'groups' -> 0 ->> 'rankingStatus') = 'PROVISIONAL'
            and (v_res -> 'groups' -> 0 ->> 'cancelledMatches')::integer = 1)
      into v_ok;
    call pg_temp.sfx_chk(1, '복구 전 1조 — PROVISIONAL + cancelled_matches_present + 취소 1건', v_ok);

    select ((v_res -> 'groups' -> 0 ->> 'groupComplete')::boolean = false
            and (v_res -> 'groups' -> 0 ->> 'completedMatches')::integer = 1
            and (v_res -> 'groups' -> 0 ->> 'generatedMatches')::integer = 3)
      into v_ok;
    call pg_temp.sfx_chk(2, '복구 전 1조 — generated 3 / completed 1 / 미완료', v_ok);

    -- ══ G. 입력 검증 — 사유 ══════════════════════════════════════════════
    v_r := public.restore_cancelled_match(v_m_can, '', 1);
    select (v_r ->> 'reason') = 'reason_required' into v_ok;
    call pg_temp.sfx_chk(3, 'G 사유 없음 → reason_required', v_ok);

    v_r := public.restore_cancelled_match(v_m_can, ' x ', 1);
    select (v_r ->> 'reason') = 'reason_required' into v_ok;
    call pg_temp.sfx_chk(4, 'G 사유 1자 → reason_required', v_ok);

    v_r := public.restore_cancelled_match(v_m_can, '오취소 복구', null);
    select (v_r ->> 'reason') = 'version_required' into v_ok;
    call pg_temp.sfx_chk(5, 'expected_version 없음 → version_required', v_ok);

    -- ══ F. version mismatch ══════════════════════════════════════════════
    v_r := public.restore_cancelled_match(v_m_can, '오취소 복구', 99);
    select (v_r ->> 'reason') = 'version_conflict' into v_ok;
    call pg_temp.sfx_chk(6, 'F version 불일치 → version_conflict', v_ok);

    select (v_r ->> 'ok')::boolean = false into v_ok;
    call pg_temp.sfx_chk(7, 'F 거부는 예외가 아니라 ok=false 로 온다', v_ok);

    select (status = 'cancelled') into v_ok
      from public.hosted_tournament_matches where id = v_m_can;
    call pg_temp.sfx_chk(8, 'F 거부 후에도 상태가 그대로 cancelled', v_ok);

    -- ══ B~E. CANCELLED 아닌 상태는 전부 거부 ═════════════════════════════
    v_r := public.restore_cancelled_match(v_m_wat, '복구 시도', 1);
    select (v_r ->> 'reason') = 'match_not_cancelled' and (v_r ->> 'status') = 'waiting' into v_ok;
    call pg_temp.sfx_chk(9, 'B WAITING → 거부(match_not_cancelled)', v_ok);

    v_r := public.restore_cancelled_match(v_m_cal, '복구 시도', 1);
    select (v_r ->> 'reason') = 'match_not_cancelled' and (v_r ->> 'status') = 'calling' into v_ok;
    call pg_temp.sfx_chk(10, 'C CALLING → 거부(match_not_cancelled)', v_ok);

    v_r := public.restore_cancelled_match(v_m_ply, '복구 시도', 1);
    select (v_r ->> 'reason') = 'match_not_cancelled' and (v_r ->> 'status') = 'playing' into v_ok;
    call pg_temp.sfx_chk(11, 'D PLAYING → 거부(match_not_cancelled)', v_ok);

    v_r := public.restore_cancelled_match(v_m_don, '복구 시도', 1);
    select (v_r ->> 'reason') = 'match_not_cancelled' and (v_r ->> 'status') = 'completed' into v_ok;
    call pg_temp.sfx_chk(12, 'E COMPLETED → 거부(match_not_cancelled)', v_ok);

    select (status = 'playing' and court_id is not null) into v_ok
      from public.hosted_tournament_matches where id = v_m_ply;
    call pg_temp.sfx_chk(13, 'D 거부 후 진행 중 경기의 코트 점유가 풀리지 않음', v_ok);

    select (status = 'completed' and score1 = 6 and score2 = 0 and winner_team_id is not null)
      into v_ok from public.hosted_tournament_matches where id = v_m_don;
    call pg_temp.sfx_chk(14, 'E 거부 후 완료 경기의 결과가 그대로', v_ok);

    -- ══ M. 권한 없는 사용자 ══════════════════════════════════════════════
    perform set_config('request.jwt.claims',
                       jsonb_build_object('sub', gen_random_uuid()::text)::text, true);
    begin
        v_r := public.restore_cancelled_match(v_m_can, '권한 없는 시도', 1);
        v_denied := false;
    exception when insufficient_privilege then
        v_denied := true;
    end;
    select v_denied into v_ok;
    call pg_temp.sfx_chk(15, 'M 권한 없는 authenticated → 42501 예외', v_ok);

    select (status = 'cancelled') into v_ok
      from public.hosted_tournament_matches where id = v_m_can;
    call pg_temp.sfx_chk(16, 'M 권한 거부 후에도 상태 변화 없음', v_ok);

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid::text)::text, true);

    -- ══ L. anon 실행 불가 ════════════════════════════════════════════════
    select (not has_function_privilege('anon',
            to_regprocedure('public.restore_cancelled_match(uuid,text,integer)'), 'EXECUTE'))
      into v_ok;
    call pg_temp.sfx_chk(17, 'L anon 에게 EXECUTE 권한 없음', v_ok);

    -- ══ A. CANCELLED → WAITING 성공 ══════════════════════════════════════
    select version into v_ver from public.hosted_tournament_matches where id = v_m_can;
    v_r := public.restore_cancelled_match(v_m_can, '잘못된 취소 복구 — 재경기 진행', v_ver);

    select (v_r ->> 'ok')::boolean and (v_r ->> 'status') = 'waiting' into v_ok;
    call pg_temp.sfx_chk(18, 'A CANCELLED → WAITING 복구 성공', v_ok);

    select (v_r ->> 'version')::integer = v_ver + 1 into v_ok;
    call pg_temp.sfx_chk(19, 'H 반환 version 이 +1', v_ok);

    -- ══ H~J. 복구된 행 상태 ══════════════════════════════════════════════
    select (status = 'waiting' and version = v_ver + 1) into v_ok
      from public.hosted_tournament_matches where id = v_m_can;
    call pg_temp.sfx_chk(20, 'H 저장된 상태 waiting / version +1', v_ok);

    select (cancelled_at is null) into v_ok
      from public.hosted_tournament_matches where id = v_m_can;
    call pg_temp.sfx_chk(21, 'I cancelled_at 이 null 로 비워짐', v_ok);

    select (score1 is null and score2 is null and winner_team_id is null and court_id is null)
      into v_ok from public.hosted_tournament_matches where id = v_m_can;
    call pg_temp.sfx_chk(22, 'J score / winner / court 가 전부 null', v_ok);

    select (called_at is null and started_at is null and completed_at is null) into v_ok
      from public.hosted_tournament_matches where id = v_m_can;
    call pg_temp.sfx_chk(23, 'J 호명·시작·완료 시각도 전부 null', v_ok);

    -- ══ K. audit ═════════════════════════════════════════════════════════
    select (count(*) = 1) into v_ok
      from public.hosted_tournament_events
     where tournament_id = v_tid and action = 'match_cancel_restored'
       and entity_type = 'match' and entity_id = v_m_can;
    call pg_temp.sfx_chk(24, 'K audit match_cancel_restored 1건 생성', v_ok);

    select (to_value ->> 'fromStatus' = 'cancelled' and to_value ->> 'toStatus' = 'waiting'
            and to_value ->> 'matchNo' is not null and coalesce(note, '') <> '') into v_ok
      from public.hosted_tournament_events
     where tournament_id = v_tid and action = 'match_cancel_restored' limit 1;
    call pg_temp.sfx_chk(25, 'K audit payload 에 fromStatus/toStatus/matchNo/사유', v_ok);

    -- ══ 재복구 방지 ══════════════════════════════════════════════════════
    select version into v_ver from public.hosted_tournament_matches where id = v_m_can;
    v_r := public.restore_cancelled_match(v_m_can, '두 번째 시도', v_ver);
    select (v_r ->> 'reason') = 'match_not_cancelled' into v_ok;
    call pg_temp.sfx_chk(26, '이미 복구된 경기를 다시 복구할 수 없음', v_ok);

    -- ══ 16. 복구 후 standings 연동 ═══════════════════════════════════════
    v_res := public.get_preliminary_standings(v_slug);
    select ((v_res -> 'groups' -> 0 ->> 'policyRequired') is null
            and (v_res -> 'groups' -> 0 ->> 'cancelledMatches')::integer = 0
            and (v_res -> 'groups' -> 0 ->> 'rankingStatus') = 'PROVISIONAL'
            and (v_res -> 'groups' -> 0 ->> 'groupComplete')::boolean = false)
      into v_ok;
    call pg_temp.sfx_chk(27, '복구 후 1조 — policyRequired 해소, PROVISIONAL 유지', v_ok);

    -- ══ N. Production 무영향 ═════════════════════════════════════════════
    select ((select count(*) = 0 from public.hosted_tournament_matches mt
               join public.hosted_tournaments ht on ht.id = mt.tournament_id
              where ht.slug = '2026-teyeon-open')
            and (select count(*) = 0 from public.hosted_tournament_events ev
                   join public.hosted_tournaments ht on ht.id = ev.tournament_id
                  where ht.slug = '2026-teyeon-open' and ev.action = 'match_cancel_restored'))
      into v_ok;
    call pg_temp.sfx_chk(28, 'N Production(2026-teyeon-open) 무영향 — 경기·복구 0건', v_ok);

    -- ── 결과 출력 + 전체 롤백 ──────────────────────────────────────────────
    select count(*) filter (where ok), count(*) filter (where not ok)
      into v_pass, v_fail from _sfx;

    v_msg := format(E'\n===== Batch 3C-2 cancel-restore fixture =====\nPASS=%s  FAIL=%s  TOTAL=%s  ->  %s\n',
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
