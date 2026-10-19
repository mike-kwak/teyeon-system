-- ============================================================================
--  2026 TEYEON OPEN — 현장 운영자 권한 롤백
--
--  대상: add_hosted_tournament_staff_scoring.sql
--  ⚠ 기존 RPC 3개(start_hosted_match_timer · complete_match · complete_knockout_match)를 적용 전 운영 정의 그대로 복원한다
--    (md5 102e2c5d2dbed3911fb33e32fe2876bc · 0d33b70ee0dd0f0e04f3a921ac58727b · ca42ef267edd9469ae65b9aa226b0615).
--    복원 후 현장 운영자 권한은 즉시 사라진다(CEO/ADMIN 동작은 그대로).
--  ⚠ 허용 목록(hosted_tournament_staff)이 삭제된다. 요청 · 승인 · 회수 이력은 감사 로그에 남는다.
--  ⚠ 건드리지 않는 것: 경기 · 점수 · 대진 · 팀 · 코트 · 체크인 · 감사 로그 · 그 밖의 RPC.
-- ============================================================================

begin;

-- 1) 기존 RPC 3개 원본 복원(먼저 — 새 helper 를 지우기 전에 의존을 끊는다)
create or replace function public.start_hosted_match_timer(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_status  text;
    v_started timestamptz;
    v_play    timestamptz;
    v_no      integer;
begin
    v_begin := public.hosted_tournament_match_begin(p_match_id, null);   -- 권한(42501) · 락 · 존재 확인
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    -- 코트에 투입된(playing) 경기만 시작할 수 있다. 시작 전 완료 · 취소 경기는 거절.
    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'not_playing', 'status', v_status);
    end if;

    select started_at, play_started_at, match_no into v_started, v_play, v_no
      from public.hosted_tournament_matches where id = p_match_id;

    -- 이미 이번 투입에서 시작했다 → 덮어쓰지 않고 기존 값(멱등).
    if v_play is not null and v_started is not null and v_play >= v_started then
        return jsonb_build_object('ok', true, 'reason', 'already_started',
                                  'playStartedAt', v_play, 'serverNow', now());
    end if;

    update public.hosted_tournament_matches
       set play_started_at = clock_timestamp(), updated_at = now()   -- ⚠ version 은 올리지 않는다(원칙 5)
     where id = p_match_id and status = 'playing'
    returning play_started_at into v_play;

    if v_play is null then                                   -- 락 안이라 사실상 오지 않지만 방어
        return jsonb_build_object('ok', false, 'reason', 'already_changed');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_timer_started', null,
        jsonb_build_object('matchNo', v_no, 'playStartedAt', v_play), null);

    return jsonb_build_object('ok', true, 'reason', 'timer_started',
                              'playStartedAt', v_play, 'serverNow', now());
end;
$$;

revoke execute on function public.start_hosted_match_timer(uuid) from public;
revoke execute on function public.start_hosted_match_timer(uuid) from anon;
grant  execute on function public.start_hosted_match_timer(uuid) to authenticated;

create or replace function public.complete_match(
    p_match_id         uuid,
    p_score1           integer,
    p_score2           integer,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin  jsonb;
    v_tid    uuid;
    v_status text;
    v_stage  text;
    v_t1     uuid;
    v_t2     uuid;
    v_winner uuid;
    v_rows   integer;
    v_version integer;
    v_no     integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    -- 6게임 1세트: 승자 6 / 패자 0~5. 6:6 · 7:x · 4:2 불가.
    if p_score1 is null or p_score2 is null
       or greatest(p_score1, p_score2) <> 6
       or least(p_score1, p_score2) < 0
       or least(p_score1, p_score2) > 5 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_score');
    end if;

    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    select stage, team1_id, team2_id into v_stage, v_t1, v_t2
      from public.hosted_tournament_matches where id = p_match_id;

    -- ★ 본선 경기는 complete_knockout_match 로만 완료한다(승자 전달 포함).
    if v_stage = 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'knockout_requires_bracket_rpc');
    end if;

    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    v_winner := case when p_score1 > p_score2 then v_t1 else v_t2 end;

    update public.hosted_tournament_matches
       set status = 'completed', score1 = p_score1, score2 = p_score2,
           winner_team_id = v_winner, court_id = null, completed_at = now(),
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'playing' and version = p_expected_version
    returning version, match_no into v_version, v_no;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_completed', null,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version), null);

    return jsonb_build_object('ok', true, 'version', v_version, 'winnerTeamId', v_winner);
end;
$$;

revoke execute on function public.complete_match(uuid,integer,integer,integer) from public;
revoke execute on function public.complete_match(uuid,integer,integer,integer) from anon;
grant  execute on function public.complete_match(uuid,integer,integer,integer) to authenticated;

create or replace function public.complete_knockout_match(
    p_match_id         uuid,
    p_score1           integer,
    p_score2           integer,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin    jsonb;
    v_tid      uuid;
    v_status   text;
    v_stage    text;
    v_bid      uuid;
    v_target   uuid;
    v_t1       uuid;
    v_t2       uuid;
    v_no       integer;
    v_winner   uuid;
    v_bstatus  text;
    v_dtype    text;
    v_dteam    uuid;
    v_rows     integer;
    v_version  integer;
    v_bversion integer;
    v_res      jsonb;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    -- 6게임 1세트: 승자 6 / 패자 0~5.
    if p_score1 is null or p_score2 is null
       or greatest(p_score1, p_score2) <> 6
       or least(p_score1, p_score2) < 0
       or least(p_score1, p_score2) > 5 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_score');
    end if;

    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    select stage, bracket_id, bracket_target_slot_id, team1_id, team2_id, match_no
      into v_stage, v_bid, v_target, v_t1, v_t2, v_no
      from public.hosted_tournament_matches where id = p_match_id;

    if v_stage <> 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'not_knockout_match');
    end if;
    if v_bid is null or v_target is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_link_missing');
    end if;
    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    -- ★ 잠금 순서: matches(위 match_begin) → bracket.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-bracket:' || v_tid::text));

    select status into v_bstatus from public.hosted_tournament_brackets where id = v_bid;
    if v_bstatus = 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_completed');
    end if;

    v_winner := case when p_score1 > p_score2 then v_t1 else v_t2 end;

    -- 승자를 넣을 자리가 비어 있는지 먼저 본다(쓰기 전에 거부해야 부분 반영이 없다).
    select slot_type, team_id into v_dtype, v_dteam
      from public.hosted_tournament_bracket_slots where id = v_target;
    if v_dtype is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_link_missing');
    end if;
    if v_dtype <> 'tbd' and not (v_dtype = 'team' and v_dteam = v_winner) then
        return jsonb_build_object('ok', false, 'reason', 'slot_occupied');
    end if;

    update public.hosted_tournament_matches
       set status = 'completed', score1 = p_score1, score2 = p_score2,
           winner_team_id = v_winner, court_id = null, completed_at = now(),
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'playing' and version = p_expected_version
    returning version into v_version;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_completed', null,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version,
                           'stage', 'knockout'), null);

    -- 승자 전달. 여기서 실패하면 완료까지 통째로 되돌린다(부분 반영 금지).
    v_res := public.hosted_tournament_knockout_advance(v_tid, v_bid, v_target, v_winner);
    if not (v_res ->> 'ok')::boolean then
        raise exception 'knockout propagation failed: % (match %)', v_res ->> 'reason', v_no;
    end if;

    if (v_res ->> 'championTeamId') is not null then
        update public.hosted_tournament_brackets
           set status = 'completed', completed_at = now(), updated_at = now()
         where id = v_bid;
        perform public.hosted_tournament_log_event(
            v_tid, 'bracket', v_bid, 'bracket_completed', null,
            jsonb_build_object('matchNo', v_no, 'championTeamId', v_res ->> 'championTeamId'), null);
    end if;

    v_bversion := public.hosted_tournament_bracket_bump(v_bid);

    return jsonb_build_object('ok', true, 'version', v_version, 'bracketVersion', v_bversion,
                              'winnerTeamId', v_winner,
                              'createdMatches', (v_res ->> 'created')::integer,
                              'byeAdvances', (v_res ->> 'byeAdvances')::integer,
                              'bracketCompleted', (v_res ->> 'championTeamId') is not null);
end;
$$;

revoke execute on function public.complete_knockout_match(uuid,integer,integer,integer) from public;
revoke execute on function public.complete_knockout_match(uuid,integer,integer,integer) from anon;
grant  execute on function public.complete_knockout_match(uuid,integer,integer,integer) to authenticated;

-- 2) 새 RPC · helper · 테이블 제거
drop function if exists public.revoke_tournament_staff(text, uuid);
drop function if exists public.approve_tournament_staff(text, uuid, timestamptz, text);
drop function if exists public.get_admin_tournament_staff(text);
drop function if exists public.get_staff_match_board(text);
drop function if exists public.get_my_tournament_staff(text);
drop function if exists public.request_tournament_staff(text, text);
drop function if exists public.hosted_tournament_match_begin_score(uuid, integer);
drop function if exists public.hosted_tournament_staff_default_expiry(uuid);
drop function if exists public.hosted_tournament_is_staff_scorer(uuid);
drop table if exists public.hosted_tournament_staff;

notify pgrst, 'reload schema';

commit;
