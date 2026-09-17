-- ============================================================================
--  2026 TEYEON OPEN — Batch 2B-2 (일괄 조편성 + 조 번호 보정) 롤백
--
--  대상: supabase/add_hosted_tournament_group_bulk_assignment.sql
--
--  ⚠ 이 롤백은 Batch 2A(add_hosted_tournament_groups.sql)를 되돌리지 않는다.
--    Batch 2B-2 가 '추가한 것'을 제거하고, '교체한 것'을 원래대로 되돌린다.
--
--    제거   : replace_preliminary_group_assignments
--             hosted_tournament_draw_normalize_order
--    되돌림 : create_tournament_groups → Batch 2A 원본 정의로 복원
--
--  ⚠ 건드리지 않는 것
--      hosted_tournament_groups / _group_members (테이블·데이터)
--      hosted_tournaments 의 preliminary_draw_* 컬럼
--      Batch 1 (teams / courts / events)
--      접수 도메인 전체 (registrations / history / RPC / RLS / submit lockdown)
--
--  ⚠ 이미 일괄 반영으로 저장된 조편성 데이터는 그대로 남는다.
--    되돌리는 것은 '기능'이지 '데이터'가 아니다.
--
--  ⚠ 복원되는 create_tournament_groups 는 조 번호를 max(group_no)+1 로 매긴다
--    (빈 번호를 채우지 않는 원래 동작). 이 점을 알고 실행한다.
-- ============================================================================

begin;

-- ── 1) 신규 RPC 제거 ────────────────────────────────────────────────────────
drop function if exists public.replace_preliminary_group_assignments(text, jsonb, integer);

-- ── 2) create_tournament_groups 를 Batch 2A 원본으로 복원 ───────────────────
--   ⚠ 아래는 add_hosted_tournament_groups.sql 의 정의를 그대로 옮긴 것이다.
--     재생성이므로 revoke/grant 도 함께 다시 적용한다(기본 권한 부활 방지).
create or replace function public.create_tournament_groups(
    p_slug              text,
    p_preliminary_count integer default 0,
    p_with_placement    boolean default false,
    p_expected_version  integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin      jsonb;
    v_tid        uuid;
    v_max_no     integer;   -- 현재 최대 group_no (번호 이어붙이기용)
    v_max_prelim integer;   -- 현재 preliminary 중 최대 display_order
    v_place_id   uuid;      -- 기존 placement 조
    v_next_ord   integer;
    v_created    integer := 0;
    v_place      integer := 0;
    v_version    integer;
begin
    if p_preliminary_count is null or p_preliminary_count < 0 or p_preliminary_count > 40 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_group_count');
    end if;
    if p_preliminary_count = 0 and not coalesce(p_with_placement, false) then
        return jsonb_build_object('ok', false, 'reason', 'nothing_to_create');
    end if;

    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select coalesce(max(group_no), 0) into v_max_no
      from public.hosted_tournament_groups where tournament_id = v_tid;

    -- 새 preliminary 는 '기존 preliminary 뒤'에 붙인다(placement 자리를 침범해도 무방하다 —
    -- display_order unique 가 지연 검사라 아래에서 placement 를 밀어내면 COMMIT 시 해소된다).
    select coalesce(max(display_order), 0) into v_max_prelim
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_type = 'preliminary';

    if p_preliminary_count > 0 then
        insert into public.hosted_tournament_groups
            (tournament_id, group_no, group_type, expected_size, display_order)
        select v_tid, v_max_no + i, 'preliminary', 3, v_max_prelim + i
          from generate_series(1, p_preliminary_count) as i;
        get diagnostics v_created = row_count;
        v_max_no := v_max_no + p_preliminary_count;
    end if;

    -- placement 는 화면에서 항상 preliminary 뒤에 온다.
    --   ⚠ 고정된 magic number 를 저장하지 않는다. 그때그때 '다음 정상 순번'을 계산한다.
    select id into v_place_id
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_type = 'placement';

    if coalesce(p_with_placement, false) and v_place_id is null then
        -- 신규 생성 — 전체 조 중 가장 뒤 순번.
        select coalesce(max(display_order), 0) + 1 into v_next_ord
          from public.hosted_tournament_groups where tournament_id = v_tid;

        insert into public.hosted_tournament_groups
            (tournament_id, group_no, group_type, expected_size, display_order)
        values (v_tid, v_max_no + 1, 'placement', 2, v_next_ord);
        v_place := 1;

    elsif v_place_id is not null and v_created > 0 then
        -- 이미 있는 placement 를 새 preliminary 뒤로 다시 민다.
        --   (p_with_placement 가 true 여도 대회당 1개이므로 새로 만들지 않고 순서만 조정한다)
        select coalesce(max(display_order), 0) + 1 into v_next_ord
          from public.hosted_tournament_groups
         where tournament_id = v_tid and group_type = 'preliminary';

        update public.hosted_tournament_groups
           set display_order = v_next_ord, updated_at = now()
         where id = v_place_id;
    end if;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'create_groups', null,
        jsonb_build_object('preliminaryCreated', v_created, 'placementCreated', v_place,
                           'version', v_version), p_slug);

    return jsonb_build_object('ok', true, 'preliminaryCreated', v_created,
                              'placementCreated', v_place, 'version', v_version);
end;
$$;

revoke execute on function public.create_tournament_groups(text,integer,boolean,integer) from public;
revoke execute on function public.create_tournament_groups(text,integer,boolean,integer) from anon;
grant  execute on function public.create_tournament_groups(text,integer,boolean,integer) to authenticated;

-- ── 3) 정규화 helper 제거 ───────────────────────────────────────────────────
--   ⚠ 2)에서 복원한 원본 create_tournament_groups 는 이 helper 를 쓰지 않으므로
--     순서상 뒤에서 지워도 안전하다.
drop function if exists public.hosted_tournament_draw_normalize_order(uuid);

commit;


-- ============================================================================
--  롤백 후 확인 (읽기 전용)
--
--    select 'bulk rpc' as obj,
--           coalesce(to_regprocedure(
--             'public.replace_preliminary_group_assignments(text,jsonb,integer)')::text,
--             'REMOVED') as state
--    union all
--    select 'normalize helper',
--           coalesce(to_regprocedure(
--             'public.hosted_tournament_draw_normalize_order(uuid)')::text, 'REMOVED')
--    union all
--    select 'create_tournament_groups',
--           coalesce(to_regprocedure(
--             'public.create_tournament_groups(text,integer,boolean,integer)')::text, 'MISSING')
--    union all
--    select 'anon 실행 불가(복원 후)',
--           case when has_function_privilege('anon',
--                  'public.create_tournament_groups(text,integer,boolean,integer)', 'EXECUTE')
--                then 'LEAKED' else 'OK' end;
-- ============================================================================
