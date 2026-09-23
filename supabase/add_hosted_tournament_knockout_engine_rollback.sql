-- =============================================================================
-- ROLLBACK — add_hosted_tournament_knockout_engine.sql (Batch 4C)
--
--   되돌리는 것
--     · 4C 가 새로 만든 RPC 3개 + 내부 helper 2개
--     · complete_match / amend_completed_match_score / cancel_match → 4C 이전 정의(guard 제거)
--     · get_admin_bracket → 4A 정의(경기 목록 확장 제거)
--     · slot 팀 unique 인덱스 → 4A 형태(bracket 전체 unique)
--       ⚠ 단, 이미 승자가 전달돼 같은 팀이 여러 라운드에 있으면 되돌릴 수 없다.
--         그 경우 인덱스 교체를 건너뛰고 NOTICE 를 남긴다(운영 데이터를 지우지 않는다).
--
--   되돌리지 않는 것(데이터 손실 방지)
--     · 이미 만들어진 본선 경기 행 · 자리에 전달된 승자 —
--       지우는 순간 현장 기록이 사라진다. 사람이 직접 판단할 일이다.
--     · 4A 의 테이블 · 컬럼 · 이벤트 CHECK(= add_hosted_tournament_bracket_rollback.sql 소관)
--
--   ⚠ 이 파일에도 기존 행 UPDATE / DELETE 는 없다.
--   ⚠ 되돌린 뒤에는 본선 경기를 완료 · 수정할 RPC 가 없어진다(설계상 당연하다).
--     본선 경기가 이미 진행 중이라면 rollback 하지 말고 앞으로 고쳐라.
-- =============================================================================

begin;

-- ── 1. 4C 전용 함수 제거 ──────────────────────────────────────────────────
drop function if exists public.amend_knockout_match_score(uuid, integer, integer, text, integer);
drop function if exists public.complete_knockout_match(uuid, integer, integer, integer);
drop function if exists public.materialize_bracket_matches(text, integer);
drop function if exists public.hosted_tournament_knockout_advance(uuid, uuid, uuid, uuid);
drop function if exists public.hosted_tournament_knockout_create_match(uuid, uuid, uuid);


-- ── 2. 기존 3개 함수 원복 (add_hosted_tournament_matches.sql · _standings.sql 원문) ──
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

    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    select team1_id, team2_id into v_t1, v_t2
      from public.hosted_tournament_matches where id = p_match_id;
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

create or replace function public.cancel_match(
    p_match_id         uuid,
    p_reason           text,
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
    v_reason text;
    v_rows   integer;
    v_version integer;
    v_no     integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    if v_status = 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'match_already_completed');
    end if;
    if v_status = 'cancelled' then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    update public.hosted_tournament_matches
       set status = 'cancelled', court_id = null, cancelled_at = now(),
           version = version + 1, updated_at = now()
     where id = p_match_id and status <> 'completed' and version = p_expected_version
    returning version, match_no into v_version, v_no;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_cancelled',
        jsonb_build_object('status', v_status),
        jsonb_build_object('matchNo', v_no, 'version', v_version), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.cancel_match(uuid,text,integer) from public;
revoke execute on function public.cancel_match(uuid,text,integer) from anon;
grant  execute on function public.cancel_match(uuid,text,integer) to authenticated;

create or replace function public.amend_completed_match_score(
    p_match_id         uuid,
    p_score1           integer,
    p_score2           integer,
    p_reason           text,
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
    v_reason text;
    v_before jsonb;
    v_t1     uuid;
    v_t2     uuid;
    v_gid    uuid;
    v_gno    integer;
    v_winner uuid;
    v_rows   integer;
    v_version integer;
    v_no     integer;
    v_inval  integer := 0;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
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

    if v_status <> 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'match_not_completed', 'status', v_status);
    end if;

    select team1_id, team2_id, match_no, group_id,
           jsonb_build_object('score1', score1, 'score2', score2,
                              'winnerTeamId', winner_team_id)
      into v_t1, v_t2, v_no, v_gid, v_before
      from public.hosted_tournament_matches where id = p_match_id;

    v_winner := case when p_score1 > p_score2 then v_t1 else v_t2 end;

    update public.hosted_tournament_matches
       set score1 = p_score1, score2 = p_score2, winner_team_id = v_winner,
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'completed' and version = p_expected_version
    returning version into v_version;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    -- ★ 같은 트랜잭션에서 동률 확정 무효화. 클라이언트 후처리에 의존하지 않는다.
    if v_gid is not null then
        update public.hosted_tournament_group_tie_resolutions
           set invalidated_at = now(), invalidated_reason = 'score_amended'
         where group_id = v_gid and invalidated_at is null;
        get diagnostics v_inval = row_count;

        if v_inval > 0 then
            select group_no into v_gno
              from public.hosted_tournament_groups where id = v_gid;
            perform public.hosted_tournament_log_event(
                v_tid, 'group', v_gid, 'group_age_tie_resolution_invalidated', null,
                jsonb_build_object('groupNo', v_gno, 'invalidatedCount', v_inval,
                                   'cause', 'score_amended', 'matchNo', v_no), v_reason);
        end if;
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_score_amended', v_before,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version,
                           'invalidatedResolutions', v_inval), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version, 'winnerTeamId', v_winner,
                              'invalidatedResolutions', v_inval);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(기본 권한 부활 방지).
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from public;
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from anon;
grant  execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) to authenticated;

-- ── 3. get_admin_bracket 원복 (add_hosted_tournament_bracket.sql 원문) ────
create or replace function public.get_admin_bracket(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_b        public.hosted_tournament_brackets%rowtype;
    v_rounds   jsonb;
    v_slots    jsonb;
    v_entrants jsonb;
    v_drift    jsonb := '[]'::jsonb;
    v_stand    jsonb;
    v_qual     jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    select * into v_b from public.hosted_tournament_brackets where tournament_id = v_tid;
    if v_b.id is null then
        return jsonb_build_object('ok', true, 'bracket', null);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', r.id, 'roundNo', r.round_no, 'name', r.name, 'isFinalSlot', r.is_final_slot,
               'slotCount', (select count(*) from public.hosted_tournament_bracket_slots s
                              where s.round_id = r.id)) order by r.round_no), '[]'::jsonb)
      into v_rounds
      from public.hosted_tournament_bracket_rounds r where r.bracket_id = v_b.id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'roundNo', s.round_no, 'position', s.position,
               'slotType', s.slot_type, 'teamId', s.team_id,
               'teamNo', t.team_no, 'player1Name', t.player1_name, 'player2Name', t.player2_name,
               'teamStatus', t.status, 'feedsSlotId', s.feeds_slot_id)
               order by s.round_no, s.position), '[]'::jsonb)
      into v_slots
      from public.hosted_tournament_bracket_slots s
      left join public.hosted_tournament_teams t on t.id = s.team_id
     where s.bracket_id = v_b.id;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'teamId', e.team_id, 'teamNo', t.team_no,
               'player1Name', t.player1_name, 'player2Name', t.player2_name,
               'teamStatus', t.status, 'source', e.source,
               'sourceGroupNo', e.source_group_no, 'sourceRank', e.source_rank,
               'seedNo', e.seed_no, 'note', e.snapshot_note,
               'placed', exists (select 1 from public.hosted_tournament_bracket_slots s
                                  where s.bracket_id = v_b.id and s.team_id = e.team_id))
               order by t.team_no), '[]'::jsonb)
      into v_entrants
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = v_b.id;

    -- 예선 결과와의 차이(표시 전용). standings 를 못 읽어도 화면은 떠야 하므로 실패를 삼킨다.
    --   ⚠ 여기서 읽은 값으로 entrants 를 만들거나 고치지 않는다.
    begin
        v_stand := public.get_preliminary_standings(p_slug);
        select coalesce(jsonb_agg(x.team_id), '[]'::jsonb) into v_qual
          from (select (st ->> 'teamId')::uuid as team_id
                  from jsonb_array_elements(coalesce(v_stand -> 'groups', '[]'::jsonb)) g,
                       jsonb_array_elements(coalesce(g -> 'standings', '[]'::jsonb)) st
                 where st ->> 'qualificationStatus' = 'QUALIFIED') x;

        select coalesce(jsonb_agg(jsonb_build_object('code', 'qualified_not_entrant',
                                                     'teamNo', t.team_no)), '[]'::jsonb)
          into v_drift
          from jsonb_array_elements_text(v_qual) as q(tid)
          join public.hosted_tournament_teams t on t.id = q.tid::uuid
         where not exists (select 1 from public.hosted_tournament_bracket_entrants e
                            where e.bracket_id = v_b.id and e.team_id = q.tid::uuid);

        v_drift := v_drift || coalesce((
            select jsonb_agg(jsonb_build_object('code', 'entrant_not_qualified', 'teamNo', t.team_no))
              from public.hosted_tournament_bracket_entrants e
              join public.hosted_tournament_teams t on t.id = e.team_id
             where e.bracket_id = v_b.id and e.source = 'group_rank'
               and not (v_qual @> to_jsonb(e.team_id::text))), '[]'::jsonb);
    exception when others then
        v_drift := '[]'::jsonb;
    end;

    return jsonb_build_object(
        'ok', true,
        'bracket', jsonb_build_object(
            'id', v_b.id, 'title', v_b.title, 'status', v_b.status, 'version', v_b.version,
            'declaredEntrantCount', v_b.declared_entrant_count,
            'lockedAt', v_b.locked_at, 'publishedAt', v_b.published_at, 'completedAt', v_b.completed_at),
        'rounds', v_rounds,
        'slots', v_slots,
        'entrants', v_entrants,
        'entrantDrift', v_drift,
        'validation', public.hosted_tournament_bracket_validate(v_b.id));
end;
$$;

revoke execute on function public.get_admin_bracket(text) from public;
revoke execute on function public.get_admin_bracket(text) from anon;
grant  execute on function public.get_admin_bracket(text) to authenticated;

-- ── 4. slot 팀 unique 인덱스 원복 ─────────────────────────────────────────
--   승자 전달이 이미 일어났으면(같은 팀이 2개 이상 라운드에 있으면) 되돌릴 수 없다.
do $idx$
declare
    v_dup integer;
begin
    select count(*) into v_dup from (
        select bracket_id, team_id from public.hosted_tournament_bracket_slots
         where team_id is not null group by 1, 2 having count(*) > 1) d;

    if v_dup > 0 then
        raise notice '승자가 전달된 자리가 있어 hosted_tbslot_team_uniq 를 복구하지 않는다(중복 %건). 새 인덱스를 유지한다.', v_dup;
    else
        create unique index if not exists hosted_tbslot_team_uniq
            on public.hosted_tournament_bracket_slots (bracket_id, team_id)
         where team_id is not null;
        drop index if exists public.hosted_tbslot_team_round_uniq;
    end if;
end $idx$;

notify pgrst, 'reload schema';

commit;
