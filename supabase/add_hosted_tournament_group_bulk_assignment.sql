-- ============================================================================
--  2026 TEYEON OPEN — 예선 조편성 일괄 반영 + 조 번호 보정 (Batch 2B-2)
--
--  선행: Batch 1 4종 + add_hosted_tournament_groups.sql (Batch 2A) 운영 적용 완료
--
--  ⚠ 이미 운영에 적용된 add_hosted_tournament_groups.sql 을 수정하지 않는다.
--    변경이 필요한 함수는 이 follow-up 에서 create or replace 로 덮어쓴다.
--
--  ⚠⚠ Supabase 기본 권한 함정
--    함수를 재생성하면 ALTER DEFAULT PRIVILEGES 때문에 anon/authenticated/PUBLIC 의
--    EXECUTE 가 되살아난다. 그래서 재생성한 함수는 '같은 트랜잭션 안에서' revoke 를
--    다시 적용한다(아래 create_tournament_groups 참고).
--
--  이 파일이 하는 일
--    1. display_order 정규화 helper 추가 (preliminary = group_no, placement = 맨 뒤)
--    2. create_tournament_groups 교체 — '가장 작은 빈 조 번호'를 쓰도록 보정
--       (기존: max(group_no)+1 → 17조를 지우고 추가하면 18조가 생기던 문제)
--       ⚠ 이미 저장된 group_no 를 renumber 하지 않는다. 새로 만드는 번호만 바뀐다.
--    3. replace_preliminary_group_assignments 추가 — 엑셀 붙여넣기 일괄 반영
--       ⚠ 조편성을 '결정'하지 않는다. 경기이사가 붙여넣은 배치를 그대로 저장한다.
--       ⚠ 전체가 유효할 때만 반영한다. 부분 저장이 없다. 중간 상태를 만들지 않는다.
-- ============================================================================

begin;

-- ── 1. 내부 helper: display_order 정규화 ────────────────────────────────────
--   preliminary 는 group_no 와 같게, placement 는 항상 맨 뒤로 맞춘다.
--   display_order unique 가 지연 검사라 트랜잭션 안에서 자유롭게 재배치할 수 있다.
create or replace function public.hosted_tournament_draw_normalize_order(p_tid uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_last integer;
begin
    update public.hosted_tournament_groups
       set display_order = group_no, updated_at = now()
     where tournament_id = p_tid
       and group_type = 'preliminary'
       and display_order is distinct from group_no;

    select coalesce(max(group_no), 0) + 1 into v_last
      from public.hosted_tournament_groups where tournament_id = p_tid;

    update public.hosted_tournament_groups
       set display_order = v_last, updated_at = now()
     where tournament_id = p_tid
       and group_type = 'placement'
       and display_order is distinct from v_last;
end;
$$;

revoke execute on function public.hosted_tournament_draw_normalize_order(uuid) from public;
revoke execute on function public.hosted_tournament_draw_normalize_order(uuid) from anon;
revoke execute on function public.hosted_tournament_draw_normalize_order(uuid) from authenticated;


-- ── 2. create_tournament_groups 교체 — 가장 작은 빈 조 번호 사용 ────────────
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
    v_begin    jsonb;
    v_tid      uuid;
    v_created  integer := 0;
    v_place    integer := 0;
    v_place_no integer;
    v_version  integer;
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

    -- ⚠ 빈 번호를 먼저 채운다. 1~16,18 이 있으면 다음 추가는 17 이다.
    --   이미 저장된 조 번호는 건드리지 않는다(renumber 없음).
    if p_preliminary_count > 0 then
        insert into public.hosted_tournament_groups
            (tournament_id, group_no, group_type, expected_size, display_order)
        select v_tid, c.n, 'preliminary', 3, c.n
          from (
              select s.n
                from generate_series(
                         1,
                         (select coalesce(max(group_no), 0) from public.hosted_tournament_groups
                           where tournament_id = v_tid) + p_preliminary_count
                     ) as s(n)
               where not exists (select 1 from public.hosted_tournament_groups g
                                  where g.tournament_id = v_tid and g.group_no = s.n)
               order by s.n
               limit p_preliminary_count
          ) c;
        get diagnostics v_created = row_count;
    end if;

    -- placement 는 대회당 1개. 이미 있으면 무동작(오류가 아니다).
    if coalesce(p_with_placement, false)
       and not exists (select 1 from public.hosted_tournament_groups
                        where tournament_id = v_tid and group_type = 'placement') then
        select coalesce(max(group_no), 0) + 1 into v_place_no
          from public.hosted_tournament_groups where tournament_id = v_tid;

        insert into public.hosted_tournament_groups
            (tournament_id, group_no, group_type, expected_size, display_order)
        values (v_tid, v_place_no, 'placement', 2, v_place_no);
        v_place := 1;
    end if;

    -- 표시 순서 정리(placement 가 항상 맨 뒤).
    perform public.hosted_tournament_draw_normalize_order(v_tid);

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'create_groups', null,
        jsonb_build_object('preliminaryCreated', v_created, 'placementCreated', v_place,
                           'version', v_version), p_slug);

    return jsonb_build_object('ok', true, 'preliminaryCreated', v_created,
                              'placementCreated', v_place, 'version', v_version);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(기본 권한 부활 방지).
revoke execute on function public.create_tournament_groups(text,integer,boolean,integer) from public;
revoke execute on function public.create_tournament_groups(text,integer,boolean,integer) from anon;
grant  execute on function public.create_tournament_groups(text,integer,boolean,integer) to authenticated;


-- ── 3. 일괄 반영 RPC ────────────────────────────────────────────────────────
--   p_groups 예:
--     [ {"groupNo":1,"groupType":"preliminary","teamIds":["uuid","uuid","uuid"]},
--       {"groupNo":null,"groupType":"placement","teamIds":["uuid","uuid"]} ]
--
--   ⚠ 전체가 유효할 때만 반영한다. 하나라도 걸리면 아무것도 쓰지 않고 사유를 돌려준다.
--   ⚠ '전체 교체'다. 기존 배정은 모두 지워지고, payload 에 없는 조도 제거된다.
--     (삭제 시점에는 모든 조가 비어 있으므로 경기 데이터가 유실될 수 없다)
--   ⚠ payload 의 조 번호는 경기이사가 붙여넣은 값 그대로 쓴다. 시스템이 정하지 않는다.
create or replace function public.replace_preliminary_group_assignments(
    p_slug             text,
    p_groups           jsonb,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin     jsonb;
    v_tid       uuid;
    v_version   integer;
    v_cnt       integer;
    v_place_cnt integer;
    v_prev      integer := 0;
    v_removed   integer := 0;
    v_created   integer := 0;
    v_assigned  integer := 0;
    v_place_no  integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if jsonb_array_length(p_groups) = 0 then
        return jsonb_build_object('ok', false, 'reason', 'empty_payload');
    end if;

    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    -- ── 3-1. 구조 검증 (여기서 걸리면 아무것도 쓰지 않는다) ─────────────────
    if exists (select 1 from jsonb_array_elements(p_groups) e
                where coalesce(e ->> 'groupType', '') not in ('preliminary', 'placement')
                   or jsonb_typeof(e -> 'teamIds') is distinct from 'array') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    select count(*) into v_place_cnt
      from jsonb_array_elements(p_groups) e where e ->> 'groupType' = 'placement';
    if v_place_cnt > 1 then
        return jsonb_build_object('ok', false, 'reason', 'multiple_placement');
    end if;

    if exists (select 1 from jsonb_array_elements(p_groups) e
                where e ->> 'groupType' = 'preliminary'
                  and (e ->> 'groupNo' is null or (e ->> 'groupNo') !~ '^\d{1,2}$'
                       or (e ->> 'groupNo')::integer < 1)) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_group_no');
    end if;

    select count(*) into v_cnt from (
        select e ->> 'groupNo' as g from jsonb_array_elements(p_groups) e
         where e ->> 'groupType' = 'preliminary' group by 1 having count(*) > 1) x;
    if v_cnt > 0 then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_group_no');
    end if;

    -- 인원: preliminary=3 / placement=2 (groups 테이블 expected_size 와 같은 규칙)
    if exists (select 1 from jsonb_array_elements(p_groups) e
                where (e ->> 'groupType' = 'preliminary'
                       and jsonb_array_length(e -> 'teamIds') <> 3)
                   or (e ->> 'groupType' = 'placement'
                       and jsonb_array_length(e -> 'teamIds') <> 2)) then
        return jsonb_build_object('ok', false, 'reason', 'group_size_mismatch');
    end if;

    -- team id 형식(uuid 캐스트 예외 방지)
    if exists (select 1 from jsonb_array_elements(p_groups) e,
                    lateral jsonb_array_elements(e -> 'teamIds') t
                where (t.value #>> '{}') !~*
                      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_team_id');
    end if;

    -- 같은 팀 중복
    select count(*) into v_cnt from (
        select (t.value #>> '{}') as tid
          from jsonb_array_elements(p_groups) e, lateral jsonb_array_elements(e -> 'teamIds') t
         group by 1 having count(*) > 1) x;
    if v_cnt > 0 then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_team', 'count', v_cnt);
    end if;

    -- ── 3-2. 팀 검증 ────────────────────────────────────────────────────────
    select count(*) into v_cnt
      from (select distinct (t.value #>> '{}')::uuid as tid
              from jsonb_array_elements(p_groups) e,
                   lateral jsonb_array_elements(e -> 'teamIds') t) s
     where not exists (select 1 from public.hosted_tournament_teams tt
                        where tt.tournament_id = v_tid and tt.id = s.tid);
    if v_cnt > 0 then
        return jsonb_build_object('ok', false, 'reason', 'team_not_in_tournament', 'count', v_cnt);
    end if;

    select count(*) into v_cnt
      from (select distinct (t.value #>> '{}')::uuid as tid
              from jsonb_array_elements(p_groups) e,
                   lateral jsonb_array_elements(e -> 'teamIds') t) s
      join public.hosted_tournament_teams tt
        on tt.tournament_id = v_tid and tt.id = s.tid
     where tt.status = 'withdrawn';
    if v_cnt > 0 then
        return jsonb_build_object('ok', false, 'reason', 'team_withdrawn', 'count', v_cnt);
    end if;

    -- 빠진 active 팀이 있으면 반영하지 않는다(부분 저장 금지).
    select count(*) into v_cnt
      from public.hosted_tournament_teams tt
     where tt.tournament_id = v_tid and tt.status = 'active'
       and not exists (select 1 from jsonb_array_elements(p_groups) e,
                            lateral jsonb_array_elements(e -> 'teamIds') t
                        where (t.value #>> '{}')::uuid = tt.id);
    if v_cnt > 0 then
        return jsonb_build_object('ok', false, 'reason', 'missing_active_teams', 'count', v_cnt);
    end if;

    -- ── 3-3. 반영 (여기부터는 전부 성공하거나 전부 롤백된다) ────────────────
    select count(*) into v_prev
      from public.hosted_tournament_group_members where tournament_id = v_tid;

    delete from public.hosted_tournament_group_members where tournament_id = v_tid;

    -- payload 에 없는 조 제거. 이 시점에 모든 조는 비어 있다.
    delete from public.hosted_tournament_groups g
     where g.tournament_id = v_tid
       and not exists (
           select 1 from jsonb_array_elements(p_groups) e
            where (e ->> 'groupType' = 'preliminary'
                   and (e ->> 'groupNo')::integer = g.group_no)
               or (e ->> 'groupType' = 'placement' and g.group_type = 'placement'));
    get diagnostics v_removed = row_count;

    -- 없는 preliminary 조 생성 (번호는 payload 값 그대로)
    insert into public.hosted_tournament_groups
        (tournament_id, group_no, group_type, expected_size, display_order)
    select v_tid, (e ->> 'groupNo')::integer, 'preliminary', 3, (e ->> 'groupNo')::integer
      from jsonb_array_elements(p_groups) e
     where e ->> 'groupType' = 'preliminary'
       and not exists (select 1 from public.hosted_tournament_groups g
                        where g.tournament_id = v_tid
                          and g.group_no = (e ->> 'groupNo')::integer);
    get diagnostics v_created = row_count;

    -- placement 조 생성(없을 때만)
    if v_place_cnt = 1
       and not exists (select 1 from public.hosted_tournament_groups
                        where tournament_id = v_tid and group_type = 'placement') then
        select coalesce(max(group_no), 0) + 1 into v_place_no
          from public.hosted_tournament_groups where tournament_id = v_tid;
        insert into public.hosted_tournament_groups
            (tournament_id, group_no, group_type, expected_size, display_order)
        values (v_tid, v_place_no, 'placement', 2, v_place_no);
        v_created := v_created + 1;
    end if;

    -- 배정 삽입. slot_no 는 payload 배열 순서 그대로.
    insert into public.hosted_tournament_group_members
        (tournament_id, group_id, team_id, slot_no)
    select v_tid, g.id, (t.value #>> '{}')::uuid, t.ord
      from jsonb_array_elements(p_groups) e
      join lateral jsonb_array_elements(e -> 'teamIds') with ordinality as t(value, ord) on true
      join public.hosted_tournament_groups g
        on g.tournament_id = v_tid
       and ((e ->> 'groupType' = 'preliminary' and g.group_no = (e ->> 'groupNo')::integer)
         or (e ->> 'groupType' = 'placement'   and g.group_type = 'placement'));
    get diagnostics v_assigned = row_count;

    perform public.hosted_tournament_draw_normalize_order(v_tid);

    v_version := public.hosted_tournament_draw_bump(v_tid);

    -- ⚠ 운영 메타데이터만 기록한다. 선수명·클럽명·전화번호를 넣지 않는다.
    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'bulk_replace_group_assignments',
        jsonb_build_object('previousAssignedTeams', v_prev),
        jsonb_build_object('groupCount', jsonb_array_length(p_groups) - v_place_cnt,
                           'placementCount', v_place_cnt,
                           'assignedTeams', v_assigned,
                           'createdGroups', v_created,
                           'removedGroups', v_removed,
                           'version', v_version), p_slug);

    return jsonb_build_object(
        'ok', true,
        'assignedTeams', v_assigned,
        'previousAssignedTeams', v_prev,
        'createdGroups', v_created,
        'removedGroups', v_removed,
        'version', v_version);
end;
$$;

revoke execute on function public.replace_preliminary_group_assignments(text,jsonb,integer) from public;
revoke execute on function public.replace_preliminary_group_assignments(text,jsonb,integer) from anon;
grant  execute on function public.replace_preliminary_group_assignments(text,jsonb,integer) to authenticated;

commit;
