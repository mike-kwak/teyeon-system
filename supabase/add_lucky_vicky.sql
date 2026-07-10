-- =============================================================================
-- TEYEON 클럽 문화 — 러키비키(LUCKY VICKY) 관계형 저장 + RLS
--
-- 구조: lucky_vicky_rounds(회차) 1 : N lucky_vicky_teams(팀). 팀은 정확히 회원 2명.
--   · 읽기: 클럽 회원/운영진만(can_access_tennis_log()) — 게스트/anon 불가. /lucky-vicky 읽기 게이트와 동일.
--   · 쓰기: CEO / ADMIN 만(profiles.role). 직접 테이블 CRUD + RLS(club_schedules 선례와 동일).
--   · 단일 active: 클럽당 status='active' 회차 최대 1개(부분 unique). spotlight_enabled 는 active 에서만 true.
--   · 중복 참여 차단: member_1<>member_2(CHECK) + 같은 회차 다른 팀 중복 참여 차단(trigger).
--   · 회원 삭제 보존: member FK ON DELETE RESTRICT(기록 보존 — 회원 탈퇴는 상태 변경 전제).
--
-- 앱 호환: 이 테이블이 없으면(마이그레이션 전) 앱은 빈 결과로 폴백해 메인/‑lucky-vicky 가 깨지지 않는다.
--
-- ⚠️ 초안. 사용자 승인 후 Supabase SQL Editor 에서 1회 실행. 선행: profiles, members,
--     can_access_tennis_log()(add_tennis_log_tournaments.sql).
-- rollback: supabase/add_lucky_vicky_rollback.sql
-- =============================================================================

-- ── 1. 회차 ───────────────────────────────────────────────────────────────────
create table if not exists public.lucky_vicky_rounds (
    id                  uuid        primary key default gen_random_uuid(),
    -- 단일 클럽 기준(NEXT_PUBLIC_CLUB_ID). 멀티클럽 확장 시 RLS 에 club_id 조건 추가 지점.
    club_id             uuid        not null default '512d047d-a076-4080-97e5-6bb5a2c07819',
    round_number        int         not null check (round_number >= 1),
    title               text        not null,
    status              text        not null default 'waiting'
                                    check (status in ('waiting', 'active', 'completed')),
    selection_method    text,
    expected_team_count int         check (expected_team_count is null or expected_team_count >= 0),
    note                text,
    spotlight_enabled   boolean     not null default false,
    created_by          uuid        references auth.users(id) on delete set null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (club_id, round_number),
    -- spotlight 는 진행 중(active) 회차에서만 켤 수 있다(비-active 에 spotlight_enabled=true 저장 금지).
    constraint lucky_vicky_spotlight_active_only
        check (spotlight_enabled = false or status = 'active')
);
comment on table public.lucky_vicky_rounds is
    '러키비키 회차. 클럽당 active 최대 1개. spotlight_enabled 는 active 에서만 true.';

-- 클럽당 active 회차 최대 1개(메인 Spotlight 단일성 보장 — 부분 unique).
create unique index if not exists lucky_vicky_rounds_single_active
    on public.lucky_vicky_rounds (club_id) where status = 'active';

-- ── 2. 팀(정확히 회원 2명) ────────────────────────────────────────────────────
create table if not exists public.lucky_vicky_teams (
    id              uuid        primary key default gen_random_uuid(),
    round_id        uuid        not null references public.lucky_vicky_rounds(id) on delete cascade,
    -- 정확한 members.id 만 저장(부분일치·email fallback·가상 id 금지). 기록 보존 위해 RESTRICT.
    member_1_id     uuid        not null references public.members(id) on delete restrict,
    member_2_id     uuid        not null references public.members(id) on delete restrict,
    tournament_name text,
    tournament_date date,
    target_result   text,       -- 회차/팀별로 다름 — 기본값 하드코딩 없음(null 허용).
    actual_result   text,
    team_status     text        not null default 'selecting_tournament'
                                check (team_status in ('selecting_tournament', 'preparing', 'registered', 'completed')),
    -- 지원 대상(eligible) 과 지원 완료(supported) 는 분리된 상태.
    support_status  text        not null default 'pending_result'
                                check (support_status in ('pending_result', 'eligible', 'supported', 'not_eligible')),
    note            text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- 한 팀에 같은 회원 2번 금지.
    constraint lucky_vicky_team_distinct_members check (member_1_id <> member_2_id)
);
comment on table public.lucky_vicky_teams is
    '러키비키 팀(정확히 회원 2명). 같은 회차 내 회원 중복 참여는 trigger 로 차단.';
create index if not exists lucky_vicky_teams_round_idx on public.lucky_vicky_teams (round_id);

-- ── 3. 같은 회차 중복 참여 차단(cross-row) — trigger ─────────────────────────────
--   CHECK 는 cross-row 를 볼 수 없으므로 BEFORE INSERT/UPDATE trigger 로 강제한다.
--   직접 테이블 CRUD + RLS 패턴을 유지하면서(모든 write 를 RPC 로 강제하지 않고) DB 수준 불변식을 보장.
--   SECURITY DEFINER 로 RLS 우회해 같은 회차 전체 팀을 확인(회원 정보는 노출하지 않음).
create or replace function public.lucky_vicky_teams_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if new.member_1_id = new.member_2_id then
        raise exception 'a team must have two different members' using errcode = '23514';
    end if;
    if exists (
        select 1
          from public.lucky_vicky_teams t
         where t.round_id = new.round_id
           and t.id <> new.id
           and (t.member_1_id in (new.member_1_id, new.member_2_id)
             or t.member_2_id in (new.member_1_id, new.member_2_id))
    ) then
        raise exception 'member already participates in another team of this round'
            using errcode = '23505';
    end if;
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists lucky_vicky_teams_guard_trg on public.lucky_vicky_teams;
create trigger lucky_vicky_teams_guard_trg
    before insert or update on public.lucky_vicky_teams
    for each row execute function public.lucky_vicky_teams_guard();

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
alter table public.lucky_vicky_rounds enable row level security;
alter table public.lucky_vicky_teams  enable row level security;
-- 방어적: anon 역할 테이블 권한 회수(정책상으로도 차단되지만 이중 보호).
revoke all on table public.lucky_vicky_rounds from anon;
revoke all on table public.lucky_vicky_teams  from anon;
grant select, insert, update, delete on table public.lucky_vicky_rounds to authenticated;
grant select, insert, update, delete on table public.lucky_vicky_teams  to authenticated;

-- 읽기: 클럽 회원/운영진(can_access_tennis_log). 게스트/anon 불가.
drop policy if exists lucky_vicky_rounds_select on public.lucky_vicky_rounds;
create policy lucky_vicky_rounds_select on public.lucky_vicky_rounds
    for select to authenticated using (public.can_access_tennis_log());
drop policy if exists lucky_vicky_teams_select on public.lucky_vicky_teams;
create policy lucky_vicky_teams_select on public.lucky_vicky_teams
    for select to authenticated using (public.can_access_tennis_log());

-- 쓰기: CEO / ADMIN 만(profiles.role).
drop policy if exists lucky_vicky_rounds_insert on public.lucky_vicky_rounds;
create policy lucky_vicky_rounds_insert on public.lucky_vicky_rounds
    for insert to authenticated
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')));
drop policy if exists lucky_vicky_rounds_update on public.lucky_vicky_rounds;
create policy lucky_vicky_rounds_update on public.lucky_vicky_rounds
    for update to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')));
drop policy if exists lucky_vicky_rounds_delete on public.lucky_vicky_rounds;
create policy lucky_vicky_rounds_delete on public.lucky_vicky_rounds
    for delete to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')));

drop policy if exists lucky_vicky_teams_insert on public.lucky_vicky_teams;
create policy lucky_vicky_teams_insert on public.lucky_vicky_teams
    for insert to authenticated
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')));
drop policy if exists lucky_vicky_teams_update on public.lucky_vicky_teams;
create policy lucky_vicky_teams_update on public.lucky_vicky_teams
    for update to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')));
drop policy if exists lucky_vicky_teams_delete on public.lucky_vicky_teams;
create policy lucky_vicky_teams_delete on public.lucky_vicky_teams
    for delete to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')));

notify pgrst, 'reload schema';
