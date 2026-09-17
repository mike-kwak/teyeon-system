-- ============================================================================
--  2026 TEYEON OPEN — 예선 조편성 (Batch 2A)
--
--  선행: events → teams → courts → fixture (Batch 1) 적용 완료
--
--  ⚠⚠ 가장 중요한 원칙
--    시스템은 조를 자동으로 짜지 않는다. 경기이사가 모든 배치를 직접 결정한다.
--    이 파일의 함수들이 하는 일은 딱 네 가지다.
--      (1) 경기이사가 '입력한 개수'만큼 빈 조를 만든다
--      (2) 경기이사가 지정한 팀을 지정한 조에 넣는다
--      (3) 그 배치가 구조적으로 유효한지 '검사만' 한다 (자동 교정 없음)
--      (4) 검사를 통과하면 잠근다
--    조 개수 계산 · seed 분배 · 강팀/클럽 분산 · 본선 배치는 여기 없다. 앞으로도 넣지 않는다.
--
--  ⚠ 개인정보 경계
--    조편성 조회는 hosted_tournament_teams 스냅샷만 읽는다.
--    hosted_tournament_registrations 를 join 하지 않는다(전화·입금·동의 차단).
--
--  ⚠ 50팀 placement 계약 (Batch 3 가 읽을 약속)
--    group_type='placement' 인 조의 멤버 2팀 = 순위결정전 대상.
--    이 경기는 탈락을 가르는 경기가 아니라 '본선 진출 순서/배치'를 정하는 경기이며,
--    두 팀 모두 본선에 진출한다. Batch 2 에서는 Match 를 만들지 않는다.
--
--  ⚠ tournament.status 를 조편성 전제조건으로 강제하지 않는다.
--    접수 마감 전 준비 작업과 fixture(draft) 작업을 막지 않기 위함이다.
--    다만 lock 시점의 status 는 경고와 감사 기록으로 남긴다(아래 lock 함수 참고).
-- ============================================================================

begin;

-- ── 1. 조 ───────────────────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_groups (
    id             uuid        primary key default gen_random_uuid(),
    tournament_id  uuid        not null references public.hosted_tournaments(id) on delete cascade,

    -- 경기이사가 쓰는 조 번호. 1,2,3… 필수·유일.
    group_no       integer     not null check (group_no >= 1),
    -- 표시용 선택값('A조' 같은 별칭). NULL 이면 앱이 'N조'로 표기한다.
    --   ⚠ Batch 2 UI 에서는 편집하지 않는다. 후속 확장 자리.
    label          text        check (label is null or length(btrim(label)) between 1 and 20),

    -- preliminary = 일반 예선 조(3팀 라운드로빈)
    -- placement   = 3의 배수가 아닐 때 남는 2팀. 순위결정전 대상이며 둘 다 본선 진출.
    group_type     text        not null default 'preliminary'
                               check (group_type in ('preliminary', 'placement')),

    -- 조가 스스로 기대 크기를 들고 있게 해서 '3' 을 코드에 하드코딩하지 않는다.
    expected_size  integer     not null check (expected_size between 2 and 6),

    display_order  integer     not null check (display_order >= 1),

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    constraint hosted_tgroup_no_unique     unique (tournament_id, group_no),
    -- 멤버십이 (tournament_id, group_id) 복합 FK 를 걸 수 있게 한다.
    constraint hosted_tgroup_tid_id_unique unique (tournament_id, id),
    -- 표시 순서 재배치(맞바꾸기)를 허용하려면 지연 검사여야 한다(courts 와 동일한 이유).
    constraint hosted_tgroup_order_unique  unique (tournament_id, display_order)
                                           deferrable initially deferred,
    -- Batch 2 정책: preliminary=3 / placement=2 고정.
    --   ⚠ 4팀조 등 다른 운영이 필요해지면 이 제약 하나만 완화하면 된다.
    constraint hosted_tgroup_size_by_type  check (
        (group_type = 'preliminary' and expected_size = 3) or
        (group_type = 'placement'   and expected_size = 2))
);

comment on table public.hosted_tournament_groups is
    '예선 조. ⚠ 시스템이 자동 편성하지 않는다 — 경기이사가 만든 구조를 담기만 한다.';
comment on column public.hosted_tournament_groups.group_type is
    'placement = 3의 배수가 아닐 때 남는 2팀(순위결정전 대상, 둘 다 본선 진출). 일반 2팀 예선조가 아니다.';
comment on column public.hosted_tournament_groups.expected_size is
    '조가 들고 있는 기대 팀 수. 검증이 3을 하드코딩하지 않기 위한 값.';

-- 순위결정전 조는 대회당 최대 1개.
create unique index if not exists hosted_tgroup_placement_uniq
    on public.hosted_tournament_groups (tournament_id)
    where group_type = 'placement';

create index if not exists hosted_tgroup_order_idx
    on public.hosted_tournament_groups (tournament_id, display_order);


-- ── 2. 조 배정(멤버십) ──────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_group_members (
    id             uuid        primary key default gen_random_uuid(),
    tournament_id  uuid        not null,
    group_id       uuid        not null,
    team_id        uuid        not null,
    slot_no        integer     not null check (slot_no >= 1),

    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    -- 복합 FK — 다른 대회의 조/팀이 섞이는 사고를 DB 가 차단한다.
    constraint hosted_tgmember_group_fk foreign key (tournament_id, group_id)
        references public.hosted_tournament_groups (tournament_id, id) on delete cascade,
    constraint hosted_tgmember_team_fk  foreign key (tournament_id, team_id)
        references public.hosted_tournament_teams  (tournament_id, id) on delete cascade,

    -- ★ 한 팀은 대회 안에서 하나의 조에만 속한다. 동시 배정 경쟁의 최종 방어선.
    constraint hosted_tgmember_team_unique unique (tournament_id, team_id),
    -- 두 팀 위치 교환을 한 트랜잭션에서 하려면 지연 검사여야 한다.
    constraint hosted_tgmember_slot_unique unique (group_id, slot_no)
                                           deferrable initially deferred
);

comment on table public.hosted_tournament_group_members is
    '팀↔조 배정. ⚠ 개인정보 없음 — 표시 데이터는 hosted_tournament_teams 스냅샷에서만 읽는다.';

create index if not exists hosted_tgmember_group_idx
    on public.hosted_tournament_group_members (group_id, slot_no);
create index if not exists hosted_tgmember_team_idx
    on public.hosted_tournament_group_members (tournament_id, team_id);


-- ── 3. 대회 단위 조편성 잠금 상태 ───────────────────────────────────────────
--   group 별 lock 을 두지 않는다. 조편성은 전체를 놓고 한 번에 확정하는 작업이고,
--   '미배정 팀 0' 같은 검증이 애초에 대회 전체 범위이기 때문이다.
--   ⚠ 전부 nullable 또는 default 보유 → 기존 행에 영향 없음(테이블 재작성 없음).
alter table public.hosted_tournaments
    add column if not exists preliminary_draw_status text not null default 'draft'
        check (preliminary_draw_status in ('draft', 'locked'));
alter table public.hosted_tournaments
    add column if not exists preliminary_draw_version integer not null default 1
        check (preliminary_draw_version >= 1);
alter table public.hosted_tournaments
    add column if not exists preliminary_draw_locked_at timestamptz;
alter table public.hosted_tournaments
    add column if not exists preliminary_draw_locked_by uuid
        references auth.users(id) on delete set null;

comment on column public.hosted_tournaments.preliminary_draw_status is
    'draft = 조편성 작업 중 / locked = 확정. locked 에서는 unlock 외 모든 조편성 write 가 차단된다.';
comment on column public.hosted_tournaments.preliminary_draw_version is
    '조편성 낙관적 동시성 버전. 모든 write RPC 가 1 증가시킨다.';


-- ── 4. 권한 — 기존 hosted_* 와 동일 정책 ────────────────────────────────────
alter table public.hosted_tournament_groups        enable row level security;
alter table public.hosted_tournament_group_members enable row level security;

revoke all on table public.hosted_tournament_groups        from public, anon, authenticated;
revoke all on table public.hosted_tournament_group_members from public, anon, authenticated;
grant  select on table public.hosted_tournament_groups        to authenticated;
grant  select on table public.hosted_tournament_group_members to authenticated;

drop policy if exists hosted_tgroup_select_manager on public.hosted_tournament_groups;
create policy hosted_tgroup_select_manager on public.hosted_tournament_groups
    for select to authenticated using (public.can_manage_tournaments());

drop policy if exists hosted_tgmember_select_manager on public.hosted_tournament_group_members;
create policy hosted_tgmember_select_manager on public.hosted_tournament_group_members
    for select to authenticated using (public.can_manage_tournaments());
-- INSERT/UPDATE/DELETE 정책 없음 → 직접 쓰기 경로가 존재하지 않는다.


-- ── 5. 내부 helper: 조편성 write 전제조건 ───────────────────────────────────
--   모든 write RPC 가 같은 순서로 검사하도록 한 곳에 모은다.
--     ① 권한  ② 대회 존재  ③ advisory lock  ④ 락 이후 재조회  ⑤ locked 차단  ⑥ 버전 일치
--   ⚠ advisory lock 은 호출한 트랜잭션에 걸리므로 여기서 잡아도 호출부까지 유효하다.
--   ⚠ 네임스페이스 'hosted-tournament-groups:' — 접수/팀/코트 락과 분리되어 서로 막지 않는다.
--     한 RPC 가 두 네임스페이스를 동시에 잡지 않는다(데드락 방지 규칙).
create or replace function public.hosted_tournament_draw_begin(
    p_slug             text,
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
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-groups:' || v_tid::text));

    -- 락 이후 재조회 — 락 전 값은 신뢰하지 않는다.
    select preliminary_draw_status, preliminary_draw_version
      into v_status, v_version
      from public.hosted_tournaments where id = v_tid;

    if v_status = 'locked' then
        return jsonb_build_object('ok', false, 'reason', 'draw_locked', 'version', v_version);
    end if;

    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;

    return jsonb_build_object('ok', true, 'tournamentId', v_tid, 'version', v_version);
end;
$$;

revoke execute on function public.hosted_tournament_draw_begin(text,integer) from public;
revoke execute on function public.hosted_tournament_draw_begin(text,integer) from anon;
revoke execute on function public.hosted_tournament_draw_begin(text,integer) from authenticated;


-- ── 6. 내부 helper: 버전 증가 ───────────────────────────────────────────────
create or replace function public.hosted_tournament_draw_bump(p_tid uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.hosted_tournaments
       set preliminary_draw_version = preliminary_draw_version + 1,
           updated_at = now()
     where id = p_tid
    returning preliminary_draw_version;
$$;

revoke execute on function public.hosted_tournament_draw_bump(uuid) from public;
revoke execute on function public.hosted_tournament_draw_bump(uuid) from anon;
revoke execute on function public.hosted_tournament_draw_bump(uuid) from authenticated;


-- ── 7. 내부 helper: 조편성 검증 (읽기 전용) ─────────────────────────────────
--   ⚠ 절대 자동 교정하지 않는다. 무엇이 왜 틀렸는지만 돌려준다.
create or replace function public.hosted_tournament_draw_validate(p_tid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_issues        jsonb := '[]'::jsonb;
    v_groups        integer;
    v_prelim        integer;
    v_placement     integer;
    v_active        integer;
    v_assigned      integer;
    v_unassigned    jsonb;
    v_bad_size      jsonb;
    v_withdrawn     jsonb;
    v_dup_team      integer;
    v_dup_slot      integer;
    v_cross         integer;
    v_slot_range    jsonb;
begin
    select count(*),
           count(*) filter (where group_type = 'preliminary'),
           count(*) filter (where group_type = 'placement')
      into v_groups, v_prelim, v_placement
      from public.hosted_tournament_groups where tournament_id = p_tid;

    if v_groups = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_groups'));
    end if;

    -- 조 인원 불일치 (preliminary=3 / placement=2 는 expected_size 가 들고 있다)
    select coalesce(jsonb_agg(jsonb_build_object(
               'groupNo', g.group_no, 'groupType', g.group_type,
               'expected', g.expected_size, 'actual', m.cnt) order by g.group_no), '[]'::jsonb)
      into v_bad_size
      from public.hosted_tournament_groups g
      left join lateral (
          select count(*) as cnt from public.hosted_tournament_group_members mm
           where mm.group_id = g.id) m on true
     where g.tournament_id = p_tid and m.cnt <> g.expected_size;

    if jsonb_array_length(v_bad_size) > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'group_size_mismatch', 'groups', v_bad_size));
    end if;

    -- 미배정 active 팀
    select count(*) filter (where t.status = 'active')
      into v_active
      from public.hosted_tournament_teams t where t.tournament_id = p_tid;

    select count(*) into v_assigned
      from public.hosted_tournament_group_members m where m.tournament_id = p_tid;

    select coalesce(jsonb_agg(jsonb_build_object('teamId', t.id, 'teamNo', t.team_no)
                              order by t.team_no), '[]'::jsonb)
      into v_unassigned
      from public.hosted_tournament_teams t
     where t.tournament_id = p_tid and t.status = 'active'
       and not exists (select 1 from public.hosted_tournament_group_members m
                        where m.tournament_id = p_tid and m.team_id = t.id);

    if jsonb_array_length(v_unassigned) > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'unassigned_teams', 'teams', v_unassigned));
    end if;

    -- 배정된 팀 중 기권
    select coalesce(jsonb_agg(jsonb_build_object(
               'teamId', t.id, 'teamNo', t.team_no, 'groupNo', g.group_no)
               order by t.team_no), '[]'::jsonb)
      into v_withdrawn
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_teams  t on t.id = m.team_id
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = p_tid and t.status = 'withdrawn';

    if jsonb_array_length(v_withdrawn) > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'withdrawn_assigned', 'teams', v_withdrawn));
    end if;

    -- slot 범위 초과 (DB 는 slot_no >= 1 만 강제하므로 상한은 여기서 본다)
    select coalesce(jsonb_agg(jsonb_build_object(
               'groupNo', g.group_no, 'slotNo', m.slot_no, 'max', g.expected_size)
               order by g.group_no, m.slot_no), '[]'::jsonb)
      into v_slot_range
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = p_tid and m.slot_no > g.expected_size;

    if jsonb_array_length(v_slot_range) > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'slot_out_of_range', 'slots', v_slot_range));
    end if;

    -- 아래 3개는 DB 제약이 이미 막는다. 0 이 아니면 제약이 사라진 것이므로 확인용으로 남긴다.
    select count(*) into v_dup_team from (
        select 1 from public.hosted_tournament_group_members
         where tournament_id = p_tid group by team_id having count(*) > 1) x;
    if v_dup_team > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'duplicate_membership', 'count', v_dup_team));
    end if;

    select count(*) into v_dup_slot from (
        select 1 from public.hosted_tournament_group_members
         where tournament_id = p_tid group by group_id, slot_no having count(*) > 1) x;
    if v_dup_slot > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'duplicate_slot', 'count', v_dup_slot));
    end if;

    select count(*) into v_cross
      from public.hosted_tournament_group_members m
      left join public.hosted_tournament_groups g
             on g.id = m.group_id and g.tournament_id = m.tournament_id
      left join public.hosted_tournament_teams t
             on t.id = m.team_id  and t.tournament_id = m.tournament_id
     where m.tournament_id = p_tid and (g.id is null or t.id is null);
    if v_cross > 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'cross_tournament_reference', 'count', v_cross));
    end if;

    return jsonb_build_object(
        'ok', jsonb_array_length(v_issues) = 0,
        'summary', jsonb_build_object(
            'groupCount', v_groups, 'preliminaryGroups', v_prelim, 'placementGroups', v_placement,
            'activeTeams', v_active, 'assignedTeams', v_assigned,
            'unassignedTeams', jsonb_array_length(v_unassigned)),
        'issues', v_issues);
end;
$$;

revoke execute on function public.hosted_tournament_draw_validate(uuid) from public;
revoke execute on function public.hosted_tournament_draw_validate(uuid) from anon;
revoke execute on function public.hosted_tournament_draw_validate(uuid) from authenticated;


-- ── 8. RPC: 조 생성 (일괄 + 개별 겸용) ──────────────────────────────────────
--   ⚠ 개수는 '경기이사가 입력한 값'이다. 팀 수로부터 계산하지 않는다.
--     기존 조가 있으면 그 뒤 번호로 이어서 추가한다(개별 추가와 같은 함수로 처리).
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


-- ── 9. RPC: 조 삭제 (빈 조만) ───────────────────────────────────────────────
create or replace function public.delete_tournament_group(
    p_slug             text,
    p_group_no         integer,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_gid     uuid;
    v_type    text;
    v_members integer;
    v_version integer;
begin
    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select id, group_type into v_gid, v_type
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_no = p_group_no;
    if v_gid is null then
        return jsonb_build_object('ok', false, 'reason', 'group_not_found');
    end if;

    select count(*) into v_members
      from public.hosted_tournament_group_members where group_id = v_gid;
    if v_members > 0 then
        return jsonb_build_object('ok', false, 'reason', 'group_not_empty', 'members', v_members);
    end if;

    delete from public.hosted_tournament_groups where id = v_gid;
    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'group', v_gid, 'delete_group',
        jsonb_build_object('groupNo', p_group_no, 'groupType', v_type), null, p_slug);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.delete_tournament_group(text,integer,integer) from public;
revoke execute on function public.delete_tournament_group(text,integer,integer) from anon;
grant  execute on function public.delete_tournament_group(text,integer,integer) to authenticated;


-- ── 10. RPC: 팀 배정 ────────────────────────────────────────────────────────
--   slot 생략 시 그 조의 가장 작은 빈 slot 을 서버가 고른다(클라이언트 값을 신뢰하지 않는다).
create or replace function public.assign_group_team(
    p_slug             text,
    p_group_no         integer,
    p_team_id          uuid,
    p_slot_no          integer default null,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin    jsonb;
    v_tid      uuid;
    v_gid      uuid;
    v_size     integer;
    v_type     text;
    v_tstatus  text;
    v_teamno   integer;
    v_count    integer;
    v_slot     integer;
    v_version  integer;
begin
    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select id, expected_size, group_type into v_gid, v_size, v_type
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_no = p_group_no;
    if v_gid is null then
        return jsonb_build_object('ok', false, 'reason', 'group_not_found');
    end if;

    -- 팀은 반드시 '같은 대회' 소속이어야 한다(복합 FK 가 최종 차단하지만 여기서 먼저 안내).
    select status, team_no into v_tstatus, v_teamno
      from public.hosted_tournament_teams
     where tournament_id = v_tid and id = p_team_id;
    if v_tstatus is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_in_tournament');
    end if;
    if v_tstatus = 'withdrawn' then
        return jsonb_build_object('ok', false, 'reason', 'team_withdrawn');
    end if;

    if exists (select 1 from public.hosted_tournament_group_members
                where tournament_id = v_tid and team_id = p_team_id) then
        return jsonb_build_object('ok', false, 'reason', 'team_already_assigned');
    end if;

    select count(*) into v_count
      from public.hosted_tournament_group_members where group_id = v_gid;
    if v_count >= v_size then
        return jsonb_build_object('ok', false, 'reason', 'group_full',
                                  'capacity', v_size);
    end if;

    if p_slot_no is null then
        select min(s) into v_slot
          from generate_series(1, v_size) as s
         where s not in (select slot_no from public.hosted_tournament_group_members
                          where group_id = v_gid);
    else
        if p_slot_no < 1 or p_slot_no > v_size then
            return jsonb_build_object('ok', false, 'reason', 'slot_out_of_range',
                                      'max', v_size);
        end if;
        if exists (select 1 from public.hosted_tournament_group_members
                    where group_id = v_gid and slot_no = p_slot_no) then
            return jsonb_build_object('ok', false, 'reason', 'slot_taken');
        end if;
        v_slot := p_slot_no;
    end if;

    if v_slot is null then
        return jsonb_build_object('ok', false, 'reason', 'group_full', 'capacity', v_size);
    end if;

    begin
        insert into public.hosted_tournament_group_members
            (tournament_id, group_id, team_id, slot_no)
        values (v_tid, v_gid, p_team_id, v_slot);
    exception
        when unique_violation then
            -- advisory lock 을 우회한 동시 배정 — unique 제약이 최종 방어선이다.
            return jsonb_build_object('ok', false, 'reason', 'team_already_assigned');
    end;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'membership', p_team_id, 'assign_group_team', null,
        jsonb_build_object('groupNo', p_group_no, 'slotNo', v_slot,
                           'teamNo', v_teamno, 'version', v_version), p_slug);

    return jsonb_build_object('ok', true, 'groupNo', p_group_no, 'slotNo', v_slot,
                              'version', v_version);
end;
$$;

revoke execute on function public.assign_group_team(text,integer,uuid,integer,integer) from public;
revoke execute on function public.assign_group_team(text,integer,uuid,integer,integer) from anon;
grant  execute on function public.assign_group_team(text,integer,uuid,integer,integer) to authenticated;


-- ── 11. RPC: 배정 해제 ──────────────────────────────────────────────────────
create or replace function public.unassign_group_team(
    p_slug             text,
    p_team_id          uuid,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_gno     integer;
    v_slot    integer;
    v_teamno  integer;
    v_version integer;
begin
    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select g.group_no, m.slot_no, t.team_no into v_gno, v_slot, v_teamno
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_groups g on g.id = m.group_id
      join public.hosted_tournament_teams  t on t.id = m.team_id
     where m.tournament_id = v_tid and m.team_id = p_team_id;

    if v_gno is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_assigned');
    end if;

    delete from public.hosted_tournament_group_members
     where tournament_id = v_tid and team_id = p_team_id;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'membership', p_team_id, 'unassign_group_team',
        jsonb_build_object('groupNo', v_gno, 'slotNo', v_slot, 'teamNo', v_teamno),
        jsonb_build_object('version', v_version), p_slug);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.unassign_group_team(text,uuid,integer) from public;
revoke execute on function public.unassign_group_team(text,uuid,integer) from anon;
grant  execute on function public.unassign_group_team(text,uuid,integer) to authenticated;


-- ── 12. RPC: 팀 이동 (조 간 이동 / 같은 조 slot 변경) ───────────────────────
create or replace function public.move_group_team(
    p_slug             text,
    p_team_id          uuid,
    p_to_group_no      integer,
    p_to_slot_no       integer default null,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin    jsonb;
    v_tid      uuid;
    v_mid      uuid;
    v_from_gid uuid;
    v_from_gno integer;
    v_from_slot integer;
    v_to_gid   uuid;
    v_size     integer;
    v_count    integer;
    v_slot     integer;
    v_teamno   integer;
    v_version  integer;
begin
    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select m.id, m.group_id, g.group_no, m.slot_no, t.team_no
      into v_mid, v_from_gid, v_from_gno, v_from_slot, v_teamno
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_groups g on g.id = m.group_id
      join public.hosted_tournament_teams  t on t.id = m.team_id
     where m.tournament_id = v_tid and m.team_id = p_team_id;
    if v_mid is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_assigned');
    end if;

    select id, expected_size into v_to_gid, v_size
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_no = p_to_group_no;
    if v_to_gid is null then
        return jsonb_build_object('ok', false, 'reason', 'group_not_found');
    end if;

    -- 다른 조로 가는 경우에만 정원을 본다(같은 조 안 slot 변경은 정원과 무관).
    if v_to_gid <> v_from_gid then
        select count(*) into v_count
          from public.hosted_tournament_group_members where group_id = v_to_gid;
        if v_count >= v_size then
            return jsonb_build_object('ok', false, 'reason', 'group_full', 'capacity', v_size);
        end if;
    end if;

    if p_to_slot_no is null then
        select min(s) into v_slot
          from generate_series(1, v_size) as s
         where s not in (select slot_no from public.hosted_tournament_group_members
                          where group_id = v_to_gid and id <> v_mid);
    else
        if p_to_slot_no < 1 or p_to_slot_no > v_size then
            return jsonb_build_object('ok', false, 'reason', 'slot_out_of_range', 'max', v_size);
        end if;
        if exists (select 1 from public.hosted_tournament_group_members
                    where group_id = v_to_gid and slot_no = p_to_slot_no and id <> v_mid) then
            return jsonb_build_object('ok', false, 'reason', 'slot_taken');
        end if;
        v_slot := p_to_slot_no;
    end if;

    if v_slot is null then
        return jsonb_build_object('ok', false, 'reason', 'group_full', 'capacity', v_size);
    end if;

    update public.hosted_tournament_group_members
       set group_id = v_to_gid, slot_no = v_slot, updated_at = now()
     where id = v_mid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'membership', p_team_id, 'move_group_team',
        jsonb_build_object('groupNo', v_from_gno, 'slotNo', v_from_slot, 'teamNo', v_teamno),
        jsonb_build_object('groupNo', p_to_group_no, 'slotNo', v_slot, 'version', v_version),
        p_slug);

    return jsonb_build_object('ok', true, 'groupNo', p_to_group_no, 'slotNo', v_slot,
                              'version', v_version);
end;
$$;

revoke execute on function public.move_group_team(text,uuid,integer,integer,integer) from public;
revoke execute on function public.move_group_team(text,uuid,integer,integer,integer) from anon;
grant  execute on function public.move_group_team(text,uuid,integer,integer,integer) to authenticated;


-- ── 13. RPC: 두 팀 위치 교환 ────────────────────────────────────────────────
--   slot unique 가 지연 검사라 한 트랜잭션 안에서 자리를 맞바꿀 수 있다.
create or replace function public.swap_group_teams(
    p_slug             text,
    p_team_a_id        uuid,
    p_team_b_id        uuid,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin  jsonb;
    v_tid    uuid;
    a_mid uuid; a_gid uuid; a_gno integer; a_slot integer; a_teamno integer;
    b_mid uuid; b_gid uuid; b_gno integer; b_slot integer; b_teamno integer;
    v_version integer;
begin
    if p_team_a_id = p_team_b_id then
        return jsonb_build_object('ok', false, 'reason', 'same_team');
    end if;

    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select m.id, m.group_id, g.group_no, m.slot_no, t.team_no
      into a_mid, a_gid, a_gno, a_slot, a_teamno
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_groups g on g.id = m.group_id
      join public.hosted_tournament_teams  t on t.id = m.team_id
     where m.tournament_id = v_tid and m.team_id = p_team_a_id;

    select m.id, m.group_id, g.group_no, m.slot_no, t.team_no
      into b_mid, b_gid, b_gno, b_slot, b_teamno
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_groups g on g.id = m.group_id
      join public.hosted_tournament_teams  t on t.id = m.team_id
     where m.tournament_id = v_tid and m.team_id = p_team_b_id;

    if a_mid is null or b_mid is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_assigned');
    end if;

    update public.hosted_tournament_group_members
       set group_id = b_gid, slot_no = b_slot, updated_at = now() where id = a_mid;
    update public.hosted_tournament_group_members
       set group_id = a_gid, slot_no = a_slot, updated_at = now() where id = b_mid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'membership', p_team_a_id, 'swap_group_teams',
        jsonb_build_object('teamNoA', a_teamno, 'groupNoA', a_gno, 'slotNoA', a_slot,
                           'teamNoB', b_teamno, 'groupNoB', b_gno, 'slotNoB', b_slot),
        jsonb_build_object('teamNoA', a_teamno, 'groupNoA', b_gno, 'slotNoA', b_slot,
                           'teamNoB', b_teamno, 'groupNoB', a_gno, 'slotNoB', a_slot,
                           'version', v_version), p_slug);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.swap_group_teams(text,uuid,uuid,integer) from public;
revoke execute on function public.swap_group_teams(text,uuid,uuid,integer) from anon;
grant  execute on function public.swap_group_teams(text,uuid,uuid,integer) to authenticated;


-- ── 14. RPC: 조 내 순서 일괄 재배치 ─────────────────────────────────────────
create or replace function public.reorder_group_slots(
    p_slug             text,
    p_group_no         integer,
    p_team_ids         uuid[],
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_gid     uuid;
    v_size    integer;
    v_members integer;
    v_given   integer;
    v_version integer;
begin
    if p_team_ids is null or array_length(p_team_ids, 1) is null then
        return jsonb_build_object('ok', false, 'reason', 'empty_team_list');
    end if;
    v_given := array_length(p_team_ids, 1);
    -- 중복 입력 방지
    if v_given <> (select count(distinct x) from unnest(p_team_ids) as x) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_team_in_list');
    end if;

    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    select id, expected_size into v_gid, v_size
      from public.hosted_tournament_groups
     where tournament_id = v_tid and group_no = p_group_no;
    if v_gid is null then
        return jsonb_build_object('ok', false, 'reason', 'group_not_found');
    end if;
    if v_given > v_size then
        return jsonb_build_object('ok', false, 'reason', 'slot_out_of_range', 'max', v_size);
    end if;

    select count(*) into v_members
      from public.hosted_tournament_group_members where group_id = v_gid;
    if v_members <> v_given then
        return jsonb_build_object('ok', false, 'reason', 'member_list_mismatch',
                                  'members', v_members, 'given', v_given);
    end if;
    -- 목록의 팀이 전부 이 조 소속이어야 한다.
    if exists (select 1 from unnest(p_team_ids) as x
                where not exists (select 1 from public.hosted_tournament_group_members
                                   where group_id = v_gid and team_id = x)) then
        return jsonb_build_object('ok', false, 'reason', 'team_not_in_group');
    end if;

    update public.hosted_tournament_group_members m
       set slot_no = p.ord, updated_at = now()
      from (select x as team_id, ord from unnest(p_team_ids) with ordinality as u(x, ord)) p
     where m.group_id = v_gid and m.team_id = p.team_id;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'group', v_gid, 'reorder_group_slots', null,
        jsonb_build_object('groupNo', p_group_no, 'slots', v_given, 'version', v_version),
        p_slug);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.reorder_group_slots(text,integer,uuid[],integer) from public;
revoke execute on function public.reorder_group_slots(text,integer,uuid[],integer) from anon;
grant  execute on function public.reorder_group_slots(text,integer,uuid[],integer) to authenticated;


-- ── 15. RPC: 검증 (읽기 전용) ───────────────────────────────────────────────
create or replace function public.validate_preliminary_draw(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    return public.hosted_tournament_draw_validate(v_tid);
end;
$$;

revoke execute on function public.validate_preliminary_draw(text) from public;
revoke execute on function public.validate_preliminary_draw(text) from anon;
grant  execute on function public.validate_preliminary_draw(text) to authenticated;


-- ── 16. RPC: 조편성 잠금 ────────────────────────────────────────────────────
--   ⚠ 화면에서 validate 를 통과했더라도 여기서 '다시' 검증한다(그 사이 상태가 바뀔 수 있다).
--   ⚠ tournament.status 를 전제조건으로 강제하지 않는다. 다만 접수가 아직 열려 있으면
--     팀이 더 늘어날 수 있으므로 경고를 반환하고 감사 로그에 남긴다.
create or replace function public.lock_preliminary_draw(
    p_slug             text,
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
    v_result   jsonb;
    v_status   text;
    v_warnings jsonb := '[]'::jsonb;
    v_version  integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;

    v_begin := public.hosted_tournament_draw_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    v_result := public.hosted_tournament_draw_validate(v_tid);
    if not (v_result ->> 'ok')::boolean then
        return jsonb_build_object('ok', false, 'reason', 'validation_failed',
                                  'validation', v_result);
    end if;

    select status into v_status from public.hosted_tournaments where id = v_tid;
    if v_status = 'registration_open' then
        v_warnings := v_warnings || jsonb_build_array('registration_still_open');
    end if;

    update public.hosted_tournaments
       set preliminary_draw_status    = 'locked',
           preliminary_draw_locked_at = now(),
           preliminary_draw_locked_by = auth.uid(),
           updated_at                 = now()
     where id = v_tid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'lock_preliminary_draw', null,
        jsonb_build_object('version', v_version,
                           'tournamentStatus', v_status,
                           'warnings', v_warnings,
                           'summary', v_result -> 'summary'), p_slug);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'warnings', v_warnings, 'summary', v_result -> 'summary');
end;
$$;

revoke execute on function public.lock_preliminary_draw(text,integer) from public;
revoke execute on function public.lock_preliminary_draw(text,integer) from anon;
grant  execute on function public.lock_preliminary_draw(text,integer) to authenticated;


-- ── 17. RPC: 조편성 잠금 해제 ───────────────────────────────────────────────
--   ⚠ 확정된 대진을 흔드는 동작이라 사유가 없으면 거부한다.
--     draw_begin 은 locked 를 막으므로 여기서는 쓰지 않고 직접 처리한다.
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


-- ── 18. RPC: 조편성 전체 조회 (Admin) ───────────────────────────────────────
--   ⚠ 반환 화이트리스트. hosted_tournament_registrations 를 join 하지 않는다.
--     표시 데이터는 전부 hosted_tournament_teams 스냅샷에서만 읽는다.
create or replace function public.get_admin_preliminary_draw(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid       uuid;
    v_status    text;
    v_dstatus   text;
    v_version   integer;
    v_locked_at timestamptz;
    v_groups    jsonb;
    v_unassign  jsonb;
begin
    if not public.can_manage_tournaments() then
        return null;   -- 권한 없음은 '빈 목록'이 아니라 null 로 구분한다
    end if;

    select id, status, preliminary_draw_status, preliminary_draw_version, preliminary_draw_locked_at
      into v_tid, v_status, v_dstatus, v_version, v_locked_at
      from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return null;
    end if;

    select coalesce(jsonb_agg(x order by x_order, x_group_no), '[]'::jsonb)
      into v_groups
      from (
        select g.display_order as x_order, g.group_no as x_group_no,
               jsonb_build_object(
                   'groupId',      g.id,
                   'groupNo',      g.group_no,
                   'label',        g.label,
                   'groupType',    g.group_type,
                   'expectedSize', g.expected_size,
                   'displayOrder', g.display_order,
                   'members', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                  'slotNo',          m.slot_no,
                                  'teamId',          t.id,
                                  'teamNo',          t.team_no,
                                  'player1Name',     t.player1_name,
                                  'player2Name',     t.player2_name,
                                  'player1ClubName', t.player1_club_name,
                                  'player2ClubName', t.player2_club_name,
                                  'teamStatus',      t.status
                              ) order by m.slot_no)
                         from public.hosted_tournament_group_members m
                         join public.hosted_tournament_teams t on t.id = m.team_id
                        where m.group_id = g.id), '[]'::jsonb)
               ) as x
          from public.hosted_tournament_groups g
         where g.tournament_id = v_tid
      ) s;

    select coalesce(jsonb_agg(jsonb_build_object(
               'teamId',          t.id,
               'teamNo',          t.team_no,
               'player1Name',     t.player1_name,
               'player2Name',     t.player2_name,
               'player1ClubName', t.player1_club_name,
               'player2ClubName', t.player2_club_name,
               'teamStatus',      t.status
           ) order by t.team_no), '[]'::jsonb)
      into v_unassign
      from public.hosted_tournament_teams t
     where t.tournament_id = v_tid
       and not exists (select 1 from public.hosted_tournament_group_members m
                        where m.tournament_id = v_tid and m.team_id = t.id);

    return jsonb_build_object(
        'slug',             p_slug,
        'tournamentStatus', v_status,
        'drawStatus',       v_dstatus,
        'version',          v_version,
        'lockedAt',         v_locked_at,
        'groups',           v_groups,
        'unassigned',       v_unassign,
        'validation',       public.hosted_tournament_draw_validate(v_tid)
    );
end;
$$;

revoke execute on function public.get_admin_preliminary_draw(text) from public;
revoke execute on function public.get_admin_preliminary_draw(text) from anon;
grant  execute on function public.get_admin_preliminary_draw(text) to authenticated;

commit;
