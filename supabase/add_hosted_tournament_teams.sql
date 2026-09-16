-- ============================================================================
--  2026 TEYEON OPEN — Tournament Team layer (Batch 1 / 2of4)
--
--  적용 순서: events → **teams** → courts → fixture
--
--  왜 registrations 를 그대로 쓰지 않는가 (설계 근거)
--    1. 개인정보 방화벽 — registrations 에는 전화번호·입금·동의·admin_note 가 있다.
--       공개 DRAW/Match/Bracket 경로가 그 테이블을 join 하면 컬럼 하나만 실수해도 유출된다.
--    2. 생명주기 불일치 — 접수는 cancelled/rejected 로 되돌아가고 선수교체도 가능하다.
--       경기가 끝난 뒤 선수명이 바뀌면 지난 경기 기록이 소급 변조된다.
--       → 경기용 팀은 '승격 시점의 스냅샷'이어야 한다.
--    3. Fixture — 허수 데이터로 개발하려면 운영 접수 테이블에 가짜 행을 넣어야 한다.
--    4. hosted_treg_active_pair 가 활성 상태에만 걸려 있어 팀 정체성 키로 쓸 수 없다.
--
--  ⚠ 이 테이블에는 전화번호·입금·동의·관리자 메모 컬럼을 두지 않는다. 앞으로도 추가하지 않는다.
--  ⚠ 기존 hosted_tournament_registrations 스키마·RPC·RLS 를 일절 변경하지 않는다.
-- ============================================================================

begin;

create table if not exists public.hosted_tournament_teams (
    id                 uuid        primary key default gen_random_uuid(),
    tournament_id      uuid        not null references public.hosted_tournaments(id) on delete cascade,

    -- 경기이사가 쓰는 대회 내 팀 번호. 접수 순번(sequence_no)과 같을 필요가 없다.
    team_no            integer     not null check (team_no >= 1),

    -- 승격 시점 스냅샷. 이후 접수쪽 선수교체가 있어도 여기 값은 따라 바뀌지 않는다.
    player1_name       text        not null check (length(btrim(player1_name)) between 1 and 40),
    player2_name       text        not null check (length(btrim(player2_name)) between 1 and 40),
    player1_club_name  text,
    player2_club_name  text,
    club_name          text,       -- legacy 팀 단위 클럽(있으면 원본 그대로)

    -- 출처 추적. fixture 팀은 registration_id 가 NULL 이다.
    registration_id    uuid        references public.hosted_tournament_registrations(id)
                                   on delete set null,
    source             text        not null check (source in ('registration', 'fixture', 'manual')),

    status             text        not null default 'active'
                                   check (status in ('active', 'withdrawn')),
    -- 경기이사가 부여하는 선택값. ⚠ 시스템이 계산하지 않는다.
    seed_no            integer     check (seed_no is null or seed_no >= 1),

    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),

    constraint hosted_tteam_no_unique unique (tournament_id, team_no),
    -- 후속 Batch 의 group_members / matches 가 (tournament_id, team_id) 복합 FK 로
    -- '다른 대회 팀이 섞이는 사고'를 차단할 수 있게 지금 열어 둔다.
    constraint hosted_tteam_tid_id_unique unique (tournament_id, id)
);

comment on table public.hosted_tournament_teams is
    '경기 운영용 팀 스냅샷. ⚠ 개인정보 미포함 — 전화·입금·동의·메모는 registrations 에만 둔다.';
comment on column public.hosted_tournament_teams.registration_id is
    'confirmed 접수에서 승격된 경우에만 채워진다. fixture/manual 은 NULL.';
comment on column public.hosted_tournament_teams.seed_no is
    '경기이사가 부여하는 선택값. 시스템이 자동 계산하지 않는다.';

-- 한 접수는 한 번만 승격된다(멱등성의 최종 방어선). NULL 다수를 허용해야 하므로 partial.
create unique index if not exists hosted_tteam_registration_uniq
    on public.hosted_tournament_teams (tournament_id, registration_id)
    where registration_id is not null;

create index if not exists hosted_tteam_status_idx
    on public.hosted_tournament_teams (tournament_id, status);


-- ── 권한 — 기존 hosted_* 와 동일 정책(공개 경로는 RPC 화이트리스트로만) ──────
alter table public.hosted_tournament_teams enable row level security;

revoke all on table public.hosted_tournament_teams from public, anon, authenticated;
grant  select on table public.hosted_tournament_teams to authenticated;

drop policy if exists hosted_tteam_select_manager on public.hosted_tournament_teams;
create policy hosted_tteam_select_manager on public.hosted_tournament_teams
    for select to authenticated
    using (public.can_manage_tournaments());
-- INSERT/UPDATE/DELETE 정책 없음 → 직접 쓰기 경로 없음.


-- ── RPC 1: confirmed 접수 → Team 승격 (멱등) ─────────────────────────────────
--   멱등인 이유: 접수가 계속 들어오므로 운영자가 여러 번 실행하게 된다.
--   이미 승격된 접수는 not exists 로 걸러지고, 경쟁 상황에서도 partial unique index 가 막는다.
--
--   ⚠ registration_status = 'confirmed' 만 승격한다. applied/waitlisted 는 대상이 아니다.
--   ⚠ 팀을 삭제하거나 접수 데이터를 수정하지 않는다. 오직 INSERT 만 한다.
create or replace function public.promote_confirmed_registrations(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid       uuid;
    v_inserted  integer := 0;
    v_confirmed integer := 0;
    v_existing  integer := 0;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    -- 같은 대회에 대한 동시 승격 직렬화. 접수 RPC 와 다른 네임스페이스라 서로 막지 않는다.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-teams:' || v_tid::text));

    select count(*) into v_confirmed
      from public.hosted_tournament_registrations
     where tournament_id = v_tid and registration_status = 'confirmed';

    with candidate as (
        select r.id, r.sequence_no, r.player1_name, r.player2_name,
               r.player1_club_name, r.player2_club_name, r.club_name
          from public.hosted_tournament_registrations r
         where r.tournament_id = v_tid
           and r.registration_status = 'confirmed'
           and not exists (
                 select 1 from public.hosted_tournament_teams t
                  where t.tournament_id = v_tid and t.registration_id = r.id)
    ), numbered as (
        select c.*,
               coalesce((select max(t2.team_no) from public.hosted_tournament_teams t2
                          where t2.tournament_id = v_tid), 0)
               + row_number() over (order by c.sequence_no) as new_team_no
          from candidate c
    )
    insert into public.hosted_tournament_teams
        (tournament_id, team_no, player1_name, player2_name,
         player1_club_name, player2_club_name, club_name, registration_id, source)
    select v_tid, n.new_team_no, n.player1_name, n.player2_name,
           n.player1_club_name, n.player2_club_name, n.club_name, n.id, 'registration'
      from numbered n;

    get diagnostics v_inserted = row_count;
    v_existing := v_confirmed - v_inserted;

    if v_inserted > 0 then
        perform public.hosted_tournament_log_event(
            v_tid, 'tournament', v_tid, 'promote_teams', null,
            jsonb_build_object('inserted', v_inserted, 'alreadyPromoted', v_existing),
            p_slug);
    end if;

    return jsonb_build_object(
        'ok', true,
        'inserted', v_inserted,          -- 이번 호출에서 새로 만든 팀 수
        'alreadyPromoted', v_existing,   -- 이미 승격돼 건너뛴 수
        'confirmedTotal', v_confirmed    -- 현재 confirmed 접수 총수
    );
end;
$$;

revoke execute on function public.promote_confirmed_registrations(text) from public;
revoke execute on function public.promote_confirmed_registrations(text) from anon;
grant  execute on function public.promote_confirmed_registrations(text) to authenticated;


-- ── RPC 2: Team 목록 (Admin) ─────────────────────────────────────────────────
--   ⚠ 반환 화이트리스트. registrations 를 join 하지 않는다(개인정보 경로 차단).
create or replace function public.get_admin_tournament_teams(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case when not public.can_manage_tournaments() then null else
        coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id',              t.id,
                       'teamNo',          t.team_no,
                       'player1Name',     t.player1_name,
                       'player2Name',     t.player2_name,
                       'player1ClubName', t.player1_club_name,
                       'player2ClubName', t.player2_club_name,
                       'clubName',        t.club_name,
                       'source',          t.source,
                       'status',          t.status,
                       'seedNo',          t.seed_no,
                       'fromRegistration', (t.registration_id is not null),
                       'createdAt',       t.created_at
                   ) order by t.team_no)
              from public.hosted_tournament_teams t
              join public.hosted_tournaments h on h.id = t.tournament_id
             where h.slug = p_slug
        ), '[]'::jsonb)
    end;
$$;

revoke execute on function public.get_admin_tournament_teams(text) from public;
revoke execute on function public.get_admin_tournament_teams(text) from anon;
grant  execute on function public.get_admin_tournament_teams(text) to authenticated;


-- ── RPC 3: Team 수정 (번호 / 시드 / 상태) ────────────────────────────────────
--   ⚠ 선수 이름은 이 RPC 로 바꾸지 않는다. 스냅샷을 임의 편집하면 기록 신뢰가 깨진다.
--     접수쪽 선수교체는 기존 set_tournament_registration_players 경로를 그대로 쓴다.
--   NULL 인자는 '변경하지 않음'을 뜻한다.
create or replace function public.update_tournament_team(
    p_team_id uuid,
    p_team_no integer default null,
    p_seed_no integer default null,
    p_status  text    default null,
    p_clear_seed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_before jsonb;
    v_rows integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    if p_status is not null and p_status not in ('active', 'withdrawn') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if p_team_no is not null and p_team_no < 1 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_team_no');
    end if;

    select tournament_id,
           jsonb_build_object('teamNo', team_no, 'seedNo', seed_no, 'status', status)
      into v_tid, v_before
      from public.hosted_tournament_teams
     where id = p_team_id;

    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-teams:' || v_tid::text));

    begin
        update public.hosted_tournament_teams
           set team_no    = coalesce(p_team_no, team_no),
               seed_no    = case when p_clear_seed then null else coalesce(p_seed_no, seed_no) end,
               status     = coalesce(p_status, status),
               updated_at = now()
         where id = p_team_id;
        get diagnostics v_rows = row_count;
    exception
        when unique_violation then
            -- team_no 중복 — 운영자가 이미 쓰는 번호를 넣은 경우.
            return jsonb_build_object('ok', false, 'reason', 'team_no_taken');
    end;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'team_not_found');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'team', p_team_id, 'update_team', v_before,
        jsonb_build_object('teamNo', p_team_no, 'seedNo', p_seed_no,
                           'status', p_status, 'clearSeed', p_clear_seed),
        null);

    return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.update_tournament_team(uuid,integer,integer,text,boolean) from public;
revoke execute on function public.update_tournament_team(uuid,integer,integer,text,boolean) from anon;
grant  execute on function public.update_tournament_team(uuid,integer,integer,text,boolean) to authenticated;

commit;
