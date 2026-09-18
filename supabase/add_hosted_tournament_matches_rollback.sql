-- ============================================================================
--  2026 TEYEON OPEN — Batch 3A (예선 경기 엔진) 롤백
--
--  대상: supabase/add_hosted_tournament_matches.sql
--
--  ⚠ Batch 1 / Batch 2 를 되돌리지 않는다. Batch 3A 가 추가한 것만 제거하고,
--    교체한 unlock_preliminary_draw 를 Batch 2A 원본 정의로 복원한다.
--
--    제거   : 경기 lifecycle RPC 7 + 조회 RPC 1 + 내부 helper 2
--             hosted_tournament_matches 테이블
--             hosted_tournaments.preliminary_matches_fingerprint 컬럼
--    되돌림 : unlock_preliminary_draw → Batch 2A 원본
--
--  ⚠ 건드리지 않는 것
--      hosted_tournament_groups / _group_members        (Batch 2)
--      hosted_tournament_teams / _courts / _events      (Batch 1)
--      hosted_tournament_registrations / _history       (접수 원장)
--      기존 RPC · RLS · submit lockdown
--      hosted_tournaments 의 기존 컬럼과 행 데이터
--
--  ⚠⚠ 이 스크립트는 저장된 경기 결과를 전부 삭제한다.
--    경기가 이미 진행된 뒤에는 실행하지 않는다(비상용).
--    events 에 남은 경기 감사 기록은 그대로 보존된다.
--
--  ⚠ 복원되는 unlock_preliminary_draw 에는 경기 보호(matches_in_progress)와
--    CALLING 초기화가 없다. 다만 이 롤백이 matches 테이블을 함께 지우므로
--    보호할 대상 자체가 사라진다.
-- ============================================================================

begin;

-- ── 1) 경기 RPC 제거 ────────────────────────────────────────────────────────
drop function if exists public.get_admin_match_board(text);
drop function if exists public.cancel_match(uuid, text, integer);
drop function if exists public.amend_completed_match_score(uuid, integer, integer, text, integer);
drop function if exists public.complete_match(uuid, integer, integer, integer);
drop function if exists public.start_match(uuid, integer, integer);
drop function if exists public.uncall_match(uuid, integer);
drop function if exists public.call_match(uuid, integer);
drop function if exists public.generate_group_matches(text, integer);

-- ── 2) unlock_preliminary_draw 를 Batch 2A 원본으로 복원 ────────────────────
--   ⚠ 아래는 add_hosted_tournament_groups.sql 의 정의를 그대로 옮긴 것이다.
--     재생성이므로 revoke/grant 도 함께 다시 적용한다(기본 권한 부활 방지).
--   ⚠ 반드시 matches 테이블 삭제(3)보다 먼저 와야 한다 — 복원본은 matches 를
--     참조하지 않으므로 순서 자체는 안전하지만, 교체본이 남아 있는 채로
--     테이블을 지우면 다음 호출에서 42P01 이 난다.
create or replace function public.unlock_preliminary_draw(
    p_slug             text,
    p_reason           text,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_status  text;
    v_version integer;
    v_reason  text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null or length(v_reason) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-groups:' || v_tid::text));

    select preliminary_draw_status, preliminary_draw_version
      into v_status, v_version
      from public.hosted_tournaments where id = v_tid;

    if v_status <> 'locked' then
        return jsonb_build_object('ok', false, 'reason', 'draw_not_locked', 'version', v_version);
    end if;
    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;

    update public.hosted_tournaments
       set preliminary_draw_status    = 'draft',
           preliminary_draw_locked_at = null,
           preliminary_draw_locked_by = null,
           updated_at                 = now()
     where id = v_tid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'unlock_preliminary_draw', null,
        jsonb_build_object('version', v_version), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.unlock_preliminary_draw(text,text,integer) from public;
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from anon;
grant  execute on function public.unlock_preliminary_draw(text,text,integer) to authenticated;

-- ── 3) 경기 테이블 제거 ─────────────────────────────────────────────────────
drop policy if exists hosted_tmatch_select_manager on public.hosted_tournament_matches;
drop table if exists public.hosted_tournament_matches;   -- index/constraint 동반 삭제

-- ── 4) 내부 helper 제거 ─────────────────────────────────────────────────────
drop function if exists public.hosted_tournament_match_begin(uuid, integer);
drop function if exists public.hosted_tournament_membership_fingerprint(uuid);

-- ── 5) 지문 컬럼 제거 ───────────────────────────────────────────────────────
alter table public.hosted_tournaments drop column if exists preliminary_matches_fingerprint;

commit;


-- ============================================================================
--  롤백 후 확인 (읽기 전용)
--
--    select 'matches table' as obj,
--           coalesce(to_regclass('public.hosted_tournament_matches')::text, 'REMOVED') as state
--    union all
--    select 'fingerprint column',
--           coalesce((select column_name from information_schema.columns
--                      where table_schema='public' and table_name='hosted_tournaments'
--                        and column_name='preliminary_matches_fingerprint'), 'REMOVED')
--    union all
--    select 'generate rpc',
--           coalesce(to_regprocedure('public.generate_group_matches(text,integer)')::text, 'REMOVED')
--    union all
--    select 'unlock rpc (복원됨)',
--           coalesce(to_regprocedure(
--             'public.unlock_preliminary_draw(text,text,integer)')::text, 'MISSING')
--    union all
--    select 'unlock anon 차단',
--           case when has_function_privilege('anon',
--                  'public.unlock_preliminary_draw(text,text,integer)', 'EXECUTE')
--                then 'LEAKED' else 'OK' end
--    union all
--    select 'Batch 2 groups 유지',
--           coalesce(to_regclass('public.hosted_tournament_groups')::text, 'MISSING')
--    union all
--    select 'Batch 1 teams 유지',
--           coalesce(to_regclass('public.hosted_tournament_teams')::text, 'MISSING');
-- ============================================================================
