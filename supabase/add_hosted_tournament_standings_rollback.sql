-- ============================================================================
--  2026 TEYEON OPEN — Batch 3B (예선 순위 / 동률 확정) 롤백
--
--  대상: supabase/add_hosted_tournament_standings.sql
--
--  ⚠ Batch 1 / 2 / 3A 를 되돌리지 않는다. Batch 3B 가 추가한 것만 제거하고,
--    교체한 amend_completed_match_score 를 Batch 3A 원본 정의로 복원한다.
--
--    제거   : get_preliminary_standings / resolve_group_age_tie
--             hosted_tournament_group_results_fingerprint (내부 helper)
--             hosted_tournament_group_tie_resolutions 테이블
--    되돌림 : amend_completed_match_score → Batch 3A 원본(동률 무효화 없음)
--
--  ⚠ 건드리지 않는 것
--      hosted_tournament_matches 와 그 안의 경기 결과   (Batch 3A)
--      hosted_tournament_groups / _group_members        (Batch 2)
--      hosted_tournament_teams / _courts / _events      (Batch 1)
--      hosted_tournament_registrations / _history       (접수 원장)
--
--  ⚠⚠ 이 스크립트는 저장된 '합산연령 동률 확정' 기록을 전부 삭제한다.
--    무효화 이력까지 함께 사라진다. 순위 확정을 이미 사용한 뒤에는 실행하지 않는다.
--    events 에 남은 group_age_tie_resolved 감사 기록은 그대로 보존된다.
--
--  ⚠ 복원되는 amend_completed_match_score 는 동률 확정을 무효화하지 않는다.
--    다만 이 롤백이 확정 테이블을 함께 지우므로 무효화할 대상 자체가 사라진다.
-- ============================================================================

begin;

-- ── 1) 3B RPC 제거 ──────────────────────────────────────────────────────────
drop function if exists public.resolve_group_age_tie(text, integer, uuid[], text, text);
drop function if exists public.get_preliminary_standings(text);

-- ── 2) amend_completed_match_score 를 Batch 3A 원본으로 복원 ────────────────
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
    v_winner uuid;
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

    select team1_id, team2_id, match_no,
           jsonb_build_object('score1', score1, 'score2', score2,
                              'winnerTeamId', winner_team_id)
      into v_t1, v_t2, v_no, v_before
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

    -- ⚠ 3B 에서 합산연령 tie resolution 이 생기면, 여기서 같은 조의 resolution 을
    --   무효화하는 처리를 추가한다(현재는 해당 구조가 없으므로 기록만 남긴다).
    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_score_amended', v_before,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version, 'winnerTeamId', v_winner);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(Supabase 기본 권한 부활 방지).
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from public;
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from anon;
grant  execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) to authenticated;

-- ── 3) 동률 확정 테이블 제거 ────────────────────────────────────────────────
drop table if exists public.hosted_tournament_group_tie_resolutions;  -- index/policy 동반 삭제

-- ── 4) 내부 helper 제거 ─────────────────────────────────────────────────────
drop function if exists public.hosted_tournament_group_results_fingerprint(uuid);

commit;
