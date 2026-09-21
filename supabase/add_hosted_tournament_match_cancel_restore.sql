-- ============================================================================
--  2026 TEYEON OPEN — 취소 경기 복구 (Batch 3C-2)
--
--  선행: Batch 1 4종 + Batch 2A + bulk follow-up + 3A matches + 3B standings
--
--  왜 필요한가
--    운영진이 실수로 취소했거나, 재경기를 해야 할 때 CANCELLED 경기를 되살릴
--    경로가 없었다. 3A 는 의도적으로 넣지 않았고(조용한 되돌리기 방지) 3B 에서도
--    미루었다. 여기서 **CANCELLED → WAITING 하나만** 연다.
--
--  ⚠ 상태 전이는 CANCELLED → WAITING 하나뿐이다.
--    COMPLETED · PLAYING · CALLING · WAITING 은 이 함수로 바꿀 수 없다.
--    완료된 경기의 결과를 고치는 경로는 여전히 amend_completed_match_score 뿐이다.
--
--  ⚠ 기권 · 노쇼는 이 기능의 대상이 아니다. 처음부터 상대팀 6:0 COMPLETED 다.
--
--  ⚠ 복구는 '경기를 처음 상태로 되돌리는 것'이다. 코트 · 호명/시작/완료 시각 ·
--    점수 · 승자를 전부 비운다(취소 시점에 이미 비어 있어야 하지만 확인하고 지운다).
--
--  ⚠ 3A 원본 SQL(add_hosted_tournament_matches.sql)을 수정하지 않는다.
--    이 파일은 함수 1개만 **추가**한다. 테이블 · 컬럼 · RLS · 기존 RPC 변경 없음.
--
--  ⚠ standings 는 건드리지 않는다.
--    복구로 CANCELLED 가 사라지면 그 조의 policyRequired 도 자연히 없어지고,
--    경기가 아직 안 끝났으므로 rankingStatus 는 PROVISIONAL 로 남는다.
--    이는 3B get_preliminary_standings 가 매번 다시 계산하는 결과이지,
--    여기서 따로 보정하는 값이 아니다.
-- ============================================================================

begin;

-- ── RPC: 취소 경기 복구 ─────────────────────────────────────────────────────
--   ⚠ 인자 모양을 cancel_match(uuid, text, integer) 와 똑같이 맞춘다.
--     운영 화면에서 취소/복구가 대칭으로 보이는 편이 실수를 줄인다.
create or replace function public.restore_cancelled_match(
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
    v_begin   jsonb;
    v_tid     uuid;
    v_status  text;
    v_reason  text;
    v_rows    integer;
    v_version integer;
    v_no      integer;
    v_dirty   boolean;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    -- 권한 검증 · advisory lock · 락 이후 재조회 · version 대조를 한 번에 한다.
    --   ⚠ 3A 의 다른 lifecycle RPC 와 같은 진입점이므로 락 네임스페이스가 하나로 유지된다.
    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    -- ★ 복구 대상은 CANCELLED 하나뿐이다.
    if v_status <> 'cancelled' then
        return jsonb_build_object('ok', false, 'reason', 'match_not_cancelled',
                                  'status', v_status);
    end if;

    -- 취소 경기에 결과가 남아 있을 수 없지만(3A check 제약), 되돌리기 전에 확인한다.
    --   여기 걸린다면 데이터가 이미 이상한 것이므로 조용히 덮어쓰지 않고 거부한다.
    select (score1 is not null or score2 is not null
            or winner_team_id is not null or court_id is not null)
      into v_dirty
      from public.hosted_tournament_matches where id = p_match_id;
    if v_dirty then
        return jsonb_build_object('ok', false, 'reason', 'cancelled_match_has_result');
    end if;

    update public.hosted_tournament_matches
       set status         = 'waiting',
           cancelled_at   = null,
           called_at      = null,
           started_at     = null,
           completed_at   = null,
           court_id       = null,
           score1         = null,
           score2         = null,
           winner_team_id = null,
           version        = version + 1,
           updated_at     = now()
     where id = p_match_id and status = 'cancelled' and version = p_expected_version
    returning version, match_no into v_version, v_no;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    -- ⚠ 운영 식별자만 남긴다. 선수명 · 연락처 · 나이를 기록하지 않는다.
    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_cancel_restored',
        jsonb_build_object('status', 'cancelled'),
        jsonb_build_object('matchNo', v_no, 'fromStatus', 'cancelled',
                           'toStatus', 'waiting', 'version', v_version), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'matchNo', v_no, 'status', 'waiting');
end;
$$;

revoke execute on function public.restore_cancelled_match(uuid,text,integer) from public;
revoke execute on function public.restore_cancelled_match(uuid,text,integer) from anon;
grant  execute on function public.restore_cancelled_match(uuid,text,integer) to authenticated;

comment on function public.restore_cancelled_match(uuid,text,integer) is
    '취소된 예선 경기를 WAITING 으로 되돌린다. CANCELLED → WAITING 전이만 허용한다.';

commit;
