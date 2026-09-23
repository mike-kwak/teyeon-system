-- =============================================================================
-- 2026 TEYEON OPEN — 본선 Bracket DB Foundation (Batch 4A)  (2026-09-23)
--
--   ★ 핵심 원칙: 시스템은 본선 구조를 결정하지 않는다.
--     · 진출팀 · 라운드 · 자리 수 · BYE 위치 · 연결은 전부 경기이사가 입력한다.
--     · 이 파일의 어떤 함수도 진출팀을 자동 산출하거나 BYE 를 자동 배치하지 않는다.
--     · 예선 순위(get_preliminary_standings)의 qualify 상수(2)에 구조적으로 종속되지 않는다 —
--       진출팀은 Admin 이 보낸 payload 를 그대로 스냅샷할 뿐이다.
--
--   구조의 단일 출처: rounds + slots + slots.feeds_slot_id
--     · 모든 진행은 '두 feeder → destination slot' 하나의 모양이다.
--     · 마지막 라운드는 자리 1개(우승 destination). 결승도 같은 모양이 된다.
--     · feeds_slot_id 는 반드시 round_no + 1 을 가리킨다 → 구조적으로 cycle 이 불가능하다.
--     · declared_entrant_count 는 경고 대조용 숫자일 뿐 구조를 만들지 않는다.
--
--   이번 Batch 에 없는 것 (뒤 Batch)
--     · 본선 경기 생성 · 승자 전달 · BYE 실제 전달 · amend 보호 (4C)
--     · Admin UI (4B) · Public UI / 공개 RPC (4D) · Arena (4E)
--
--   ⚠ additive 전용
--     · 기존 Preliminary · Match Engine 함수를 하나도 CREATE OR REPLACE 하지 않는다.
--     · hosted_tournament_matches 는 nullable 컬럼 2개 + FK + CHECK + partial unique index 만 추가한다.
--       team1/team2 NOT NULL · distinct teams · score rule · court unique · completed shape 전부 그대로다.
--     · hosted_tournament_events 는 entity_type CHECK 에 'bracket', 'bracket_slot' 만 추가한다(기존 값 유지).
--     · 기존 행을 UPDATE / DELETE 하지 않는다. backfill 없음.
--
--   ⚠ 잠금 순서 (4C 대비 · 반드시 지킬 것)
--       hosted-tournament-matches:<tid>   →   hosted-tournament-bracket:<tid>
--     이 파일의 모든 RPC 는 bracket 잠금만 잡는다. 반대 순서로 잡는 함수를 만들지 않는다.
--
--   검증  : add_hosted_tournament_bracket_verify.sql
--   실동작: verify_hosted_tournament_bracket_fixture.sql (전량 rollback)
--   되돌림: add_hosted_tournament_bracket_rollback.sql (테이블 DROP 하지 않음)
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regclass('public.hosted_tournament_teams') is null
       or to_regclass('public.hosted_tournament_matches') is null
       or to_regclass('public.hosted_tournament_events') is null then
        raise exception 'Tournament 운영 기반(Batch 1/3)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text)') is null then
        raise exception 'hosted_tournament_log_event 가 없습니다.';
    end if;
    if to_regclass('public.hosted_tournament_brackets') is not null then
        raise exception 'hosted_tournament_brackets 가 이미 있습니다. 적용 상태를 먼저 확인하세요.';
    end if;
end $guard$;


-- ── 1. bracket (대회당 1개) ───────────────────────────────────────────────────
create table if not exists public.hosted_tournament_brackets (
    id                     uuid        primary key default gen_random_uuid(),
    tournament_id          uuid        not null references public.hosted_tournaments(id) on delete cascade,
    title                  text        check (title is null or length(btrim(title)) between 1 and 40),
    -- 경기이사가 적어 두는 '이번 본선 진출팀 수' 선언값. ⚠ 경고 대조용 — 구조를 만들지 않는다.
    declared_entrant_count integer     check (declared_entrant_count is null or declared_entrant_count >= 2),
    status                 text        not null default 'draft'
                                       check (status in ('draft', 'locked', 'completed')),
    version                integer     not null default 1 check (version >= 1),
    locked_at              timestamptz,
    locked_by              uuid        references auth.users(id) on delete set null,
    -- 4D 에서 사용. 4A 는 컬럼만 준비하고 항상 NULL 이다(publish RPC 없음).
    published_at           timestamptz,
    completed_at           timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    constraint hosted_tbracket_tournament_uniq unique (tournament_id),
    constraint hosted_tbracket_tid_id_uniq     unique (tournament_id, id),
    constraint hosted_tbracket_locked_shape    check (status <> 'locked' or locked_at is not null),
    -- 공개는 lock 이후에만 의미가 있다(4D 에서 publish RPC 가 지킬 계약을 스키마에도 못박는다).
    constraint hosted_tbracket_publish_shape   check (published_at is null or status <> 'draft')
);

comment on table public.hosted_tournament_brackets is
    '본선 토너먼트(대회당 1개). 구조의 단일 출처는 rounds + slots + feeds_slot_id 다. '
    'status: draft=편집 / locked=확정 / completed=결승 종료. lock 과 publish 는 분리한다.';
comment on column public.hosted_tournament_brackets.declared_entrant_count is
    '경기이사 선언값(예: 40). ⚠ 경고 대조 전용 — 이 값으로 라운드 · 자리 · BYE 를 만들지 않는다.';
comment on column public.hosted_tournament_brackets.published_at is
    '공개 시각. 4A 에서는 항상 NULL(공개 RPC 없음). unlock 시 함께 해제한다.';


-- ── 2. rounds (세로 열) ───────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_bracket_rounds (
    id            uuid        primary key default gen_random_uuid(),
    tournament_id uuid        not null,
    bracket_id    uuid        not null,
    round_no      integer     not null check (round_no >= 1),
    -- 라운드 이름도 시스템이 만들지 않는다('32강' · '결승' · '우승' 전부 입력값).
    name          text        not null check (length(btrim(name)) between 1 and 20),
    -- 마지막 우승 destination 라운드 표시. bracket 당 정확히 1개(validate 가 확인).
    is_final_slot boolean     not null default false,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint hosted_tbround_bracket_fk foreign key (tournament_id, bracket_id)
        references public.hosted_tournament_brackets (tournament_id, id) on delete cascade,
    constraint hosted_tbround_no_uniq     unique (bracket_id, round_no),
    constraint hosted_tbround_name_uniq   unique (bracket_id, name),
    constraint hosted_tbround_tid_id_uniq unique (tournament_id, id)
);

comment on table public.hosted_tournament_bracket_rounds is
    '본선 라운드. 자리 수는 저장하지 않는다(slots 에서 센다 — 중복 저장은 어긋난다).';


-- ── 3. slots (★ 구조의 단일 출처) ─────────────────────────────────────────────
create table if not exists public.hosted_tournament_bracket_slots (
    id            uuid        primary key default gen_random_uuid(),
    tournament_id uuid        not null,
    bracket_id    uuid        not null,
    round_id      uuid        not null,
    -- rounds.round_no 와 같아야 한다(정렬 · 검증 편의를 위한 비정규화. validate 가 일치를 확인).
    round_no      integer     not null check (round_no >= 1),
    position      integer     not null check (position >= 1),

    -- team = 실제 팀이 놓인 자리 / bye = 부전승 자리(1라운드만) / tbd = 아직 미정 또는 승자 대기
    slot_type     text        not null check (slot_type in ('team', 'bye', 'tbd')),
    team_id       uuid,
    entrant_id    uuid,
    -- ★ 이 자리의 승자가 올라갈 '다음 라운드 자리'. 마지막(우승) 라운드만 NULL.
    feeds_slot_id uuid,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint hosted_tbslot_bracket_fk foreign key (tournament_id, bracket_id)
        references public.hosted_tournament_brackets (tournament_id, id) on delete cascade,
    constraint hosted_tbslot_round_fk foreign key (tournament_id, round_id)
        references public.hosted_tournament_bracket_rounds (tournament_id, id) on delete cascade,
    constraint hosted_tbslot_team_fk foreign key (tournament_id, team_id)
        references public.hosted_tournament_teams (tournament_id, id) on delete restrict,
    constraint hosted_tbslot_feeds_fk foreign key (tournament_id, feeds_slot_id)
        references public.hosted_tournament_bracket_slots (tournament_id, id) on delete restrict,

    constraint hosted_tbslot_pos_uniq     unique (bracket_id, round_id, position),
    constraint hosted_tbslot_tid_id_uniq  unique (tournament_id, id),
    constraint hosted_tbslot_team_shape   check ((slot_type = 'team') = (team_id is not null)),
    constraint hosted_tbslot_entrant_shape check (entrant_id is null or slot_type = 'team'),
    constraint hosted_tbslot_self_feed    check (feeds_slot_id is null or feeds_slot_id <> id)
);

-- 한 팀이 같은 bracket 의 두 자리에 있을 수 없다(최종 방어선).
create unique index if not exists hosted_tbslot_team_uniq
    on public.hosted_tournament_bracket_slots (bracket_id, team_id)
 where team_id is not null;

create index if not exists hosted_tbslot_feeds_idx
    on public.hosted_tournament_bracket_slots (bracket_id, feeds_slot_id)
 where feeds_slot_id is not null;

create index if not exists hosted_tbslot_round_idx
    on public.hosted_tournament_bracket_slots (bracket_id, round_no, position);

comment on table public.hosted_tournament_bracket_slots is
    '본선 자리. 경기는 같은 feeds_slot_id 를 가리키는 자리 2개다(별도 경기 노드를 만들지 않는다). '
    '⚠ 1라운드만 team/bye 를 놓는다. 2라운드 이상은 tbd(승자 대기)이며 4C 전달이 채운다.';
comment on column public.hosted_tournament_bracket_slots.feeds_slot_id is
    '이 자리의 승자가 올라갈 다음 라운드 자리. 반드시 round_no + 1 의 자리여야 한다(cycle 구조적 차단).';


-- ── 4. entrants (본선 진출팀 스냅샷) ──────────────────────────────────────────
create table if not exists public.hosted_tournament_bracket_entrants (
    id              uuid        primary key default gen_random_uuid(),
    tournament_id   uuid        not null,
    bracket_id      uuid        not null,
    team_id         uuid        not null,
    -- 확정 당시의 출처. ⚠ 서버가 계산한 값이 아니라 Admin 이 보낸 스냅샷이다.
    source          text        not null check (source in ('group_rank', 'placement', 'manual')),
    source_group_no integer     check (source_group_no is null or source_group_no >= 1),
    source_rank     integer     check (source_rank is null or source_rank >= 1),
    seed_no         integer     check (seed_no is null or seed_no >= 1),
    snapshot_note   text        check (snapshot_note is null or length(btrim(snapshot_note)) between 1 and 200),
    created_at      timestamptz not null default now(),

    constraint hosted_tbentrant_bracket_fk foreign key (tournament_id, bracket_id)
        references public.hosted_tournament_brackets (tournament_id, id) on delete cascade,
    constraint hosted_tbentrant_team_fk foreign key (tournament_id, team_id)
        references public.hosted_tournament_teams (tournament_id, id) on delete restrict,
    constraint hosted_tbentrant_team_uniq unique (bracket_id, team_id),
    constraint hosted_tbentrant_tid_id_uniq unique (tournament_id, id)
);

create unique index if not exists hosted_tbentrant_seed_uniq
    on public.hosted_tournament_bracket_entrants (bracket_id, seed_no)
 where seed_no is not null;

comment on table public.hosted_tournament_bracket_entrants is
    '본선 진출팀 스냅샷. 예선 결과가 이후 바뀌어도 여기 값은 자동으로 바뀌지 않는다(차이는 Admin 경고로만).';

-- slots.entrant_id 는 entrants 생성 뒤에야 걸 수 있다(테이블 생성 순서 때문에 여기서 추가).
alter table public.hosted_tournament_bracket_slots
    add constraint hosted_tbslot_entrant_fk foreign key (tournament_id, entrant_id)
        references public.hosted_tournament_bracket_entrants (tournament_id, id) on delete set null;


-- ── 5. matches 연결 준비 (nullable · 기존 제약 불변) ──────────────────────────
--   ⚠ 기존 컬럼 · CHECK · 인덱스를 하나도 바꾸지 않는다. 추가만 한다.
--   bracket_target_slot_id = '이 경기 승자가 들어갈 destination slot'.
--     같은 destination 을 가리키는 경기는 하나뿐이다 → 4C 경기 생성의 멱등 키가 된다.
alter table public.hosted_tournament_matches
    add column if not exists bracket_id uuid,
    add column if not exists bracket_target_slot_id uuid;

do $mfk$
begin
    if not exists (select 1 from pg_constraint where conname = 'hosted_tmatch_bracket_fk') then
        alter table public.hosted_tournament_matches
            add constraint hosted_tmatch_bracket_fk foreign key (tournament_id, bracket_id)
                references public.hosted_tournament_brackets (tournament_id, id) on delete restrict;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'hosted_tmatch_bracket_slot_fk') then
        alter table public.hosted_tournament_matches
            add constraint hosted_tmatch_bracket_slot_fk foreign key (tournament_id, bracket_target_slot_id)
                references public.hosted_tournament_bracket_slots (tournament_id, id) on delete restrict;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'hosted_tmatch_bracket_shape') then
        -- 예선 · 순위결정전 경기는 두 컬럼이 반드시 NULL 이다(기존 행 전부 통과).
        alter table public.hosted_tournament_matches
            add constraint hosted_tmatch_bracket_shape check (
                stage = 'knockout' or (bracket_id is null and bracket_target_slot_id is null));
    end if;
end $mfk$;

-- ★ 4C 멱등성: 한 destination slot 에 본선 경기는 하나뿐.
create unique index if not exists hosted_tmatch_bracket_target_uniq
    on public.hosted_tournament_matches (bracket_id, bracket_target_slot_id)
 where stage = 'knockout' and bracket_target_slot_id is not null;

comment on column public.hosted_tournament_matches.bracket_target_slot_id is
    '본선 경기 승자가 들어갈 destination slot. 4C 경기 생성 · 승자 전달 · 재생성 방지의 키.';


-- ── 6. events entity_type 확장 (기존 값 유지 · 추가만) ────────────────────────
do $evt$
declare
    v_name text;
begin
    select con.conname into v_name
      from pg_constraint con
      join pg_class     c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'hosted_tournament_events'
       and con.contype = 'c'
       and con.conkey = array[(select a.attnum from pg_attribute a
                                where a.attrelid = c.oid and a.attname = 'entity_type')];
    if v_name is not null then
        execute format('alter table public.hosted_tournament_events drop constraint %I', v_name);
    end if;
end $evt$;

alter table public.hosted_tournament_events
    add constraint hosted_tevent_entity_type_check
    check (entity_type in ('tournament', 'team', 'court', 'group',
                           'membership', 'bracket_round', 'match',
                           'bracket', 'bracket_slot'));


-- ── 7. 권한 · RLS (기존 hosted_* 와 동일 계약) ────────────────────────────────
alter table public.hosted_tournament_brackets         enable row level security;
alter table public.hosted_tournament_bracket_rounds   enable row level security;
alter table public.hosted_tournament_bracket_slots    enable row level security;
alter table public.hosted_tournament_bracket_entrants enable row level security;

revoke all on table public.hosted_tournament_brackets         from public, anon, authenticated;
revoke all on table public.hosted_tournament_bracket_rounds   from public, anon, authenticated;
revoke all on table public.hosted_tournament_bracket_slots    from public, anon, authenticated;
revoke all on table public.hosted_tournament_bracket_entrants from public, anon, authenticated;

grant select on table public.hosted_tournament_brackets         to authenticated;
grant select on table public.hosted_tournament_bracket_rounds   to authenticated;
grant select on table public.hosted_tournament_bracket_slots    to authenticated;
grant select on table public.hosted_tournament_bracket_entrants to authenticated;

drop policy if exists hosted_tbracket_select_manager on public.hosted_tournament_brackets;
create policy hosted_tbracket_select_manager on public.hosted_tournament_brackets
    for select to authenticated using (public.can_manage_tournaments());

drop policy if exists hosted_tbround_select_manager on public.hosted_tournament_bracket_rounds;
create policy hosted_tbround_select_manager on public.hosted_tournament_bracket_rounds
    for select to authenticated using (public.can_manage_tournaments());

drop policy if exists hosted_tbslot_select_manager on public.hosted_tournament_bracket_slots;
create policy hosted_tbslot_select_manager on public.hosted_tournament_bracket_slots
    for select to authenticated using (public.can_manage_tournaments());

drop policy if exists hosted_tbentrant_select_manager on public.hosted_tournament_bracket_entrants;
create policy hosted_tbentrant_select_manager on public.hosted_tournament_bracket_entrants
    for select to authenticated using (public.can_manage_tournaments());
-- INSERT/UPDATE/DELETE 정책 없음 → 직접 쓰기 경로가 존재하지 않는다.


-- ── 8. 내부 helper: 잠금 + 버전 확인 ─────────────────────────────────────────
--   기존 hosted_tournament_draw_begin / match_begin 과 같은 역할.
--   ⚠ 잠금은 bracket 키 하나만 잡는다(matches → bracket 순서를 4C 가 지킬 수 있도록).
create or replace function public.hosted_tournament_bracket_begin(
    p_slug             text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_bid     uuid;
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

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-bracket:' || v_tid::text));

    -- 잠금 이후 재조회 — 잠금 전 값은 신뢰하지 않는다.
    select id, status, version into v_bid, v_status, v_version
      from public.hosted_tournament_brackets where tournament_id = v_tid;
    if v_bid is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_found', 'tournamentId', v_tid);
    end if;
    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;

    return jsonb_build_object('ok', true, 'tournamentId', v_tid, 'bracketId', v_bid,
                              'status', v_status, 'version', v_version);
end;
$$;

revoke execute on function public.hosted_tournament_bracket_begin(text,integer) from public;
revoke execute on function public.hosted_tournament_bracket_begin(text,integer) from anon;
revoke execute on function public.hosted_tournament_bracket_begin(text,integer) from authenticated;


create or replace function public.hosted_tournament_bracket_bump(p_bracket_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.hosted_tournament_brackets
       set version = version + 1, updated_at = now()
     where id = p_bracket_id
    returning version;
$$;

revoke execute on function public.hosted_tournament_bracket_bump(uuid) from public;
revoke execute on function public.hosted_tournament_bracket_bump(uuid) from anon;
revoke execute on function public.hosted_tournament_bracket_bump(uuid) from authenticated;


-- ── 9. 내부 helper: 구조 검증 ────────────────────────────────────────────────
--   반환 {ok, issues:[{code, severity, ...}], summary:{...}}
--   ⚠ 여기서 어떤 것도 고치지 않는다. 읽고 판단만 한다.
create or replace function public.hosted_tournament_bracket_validate(p_bracket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_b        public.hosted_tournament_brackets%rowtype;
    v_issues   jsonb := '[]'::jsonb;
    v_max_round integer;
    v_final_cnt integer;
    v_entrants  integer;
    v_rounds    integer;
    v_slots     integer;
    v_first     integer;
    v_byes      integer;
    v_unassigned integer;
    v_matches   integer;
    v_bye_adv   integer;
    v_tmp       jsonb;
    v_cnt       integer;
begin
    select * into v_b from public.hosted_tournament_brackets where id = p_bracket_id;
    if v_b.id is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_found');
    end if;

    select count(*) into v_entrants from public.hosted_tournament_bracket_entrants where bracket_id = p_bracket_id;
    select count(*) into v_rounds   from public.hosted_tournament_bracket_rounds   where bracket_id = p_bracket_id;
    select count(*) into v_slots    from public.hosted_tournament_bracket_slots    where bracket_id = p_bracket_id;

    if v_entrants = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_entrants', 'severity', 'error'));
    end if;
    if v_rounds = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_rounds', 'severity', 'error'));
    end if;
    if v_slots = 0 then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'no_slots', 'severity', 'error'));
    end if;

    if v_rounds > 0 then
        select max(round_no) into v_max_round
          from public.hosted_tournament_bracket_rounds where bracket_id = p_bracket_id;

        -- 라운드 번호는 1..N 연속이어야 한다.
        if v_max_round <> v_rounds then
            v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                'code', 'round_gap', 'severity', 'error', 'maxRoundNo', v_max_round, 'roundCount', v_rounds));
        end if;

        -- 우승 destination 라운드는 정확히 1개이고, 마지막 라운드이며, 자리가 1개다.
        select count(*) into v_final_cnt
          from public.hosted_tournament_bracket_rounds
         where bracket_id = p_bracket_id and is_final_slot;
        if v_final_cnt <> 1 then
            v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                'code', 'final_round_invalid', 'severity', 'error', 'finalRounds', v_final_cnt));
        else
            select count(*) into v_cnt
              from public.hosted_tournament_bracket_rounds r
              join public.hosted_tournament_bracket_slots s on s.round_id = r.id
             where r.bracket_id = p_bracket_id and r.is_final_slot;
            if v_cnt <> 1 then
                v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                    'code', 'final_round_invalid', 'severity', 'error', 'finalSlots', v_cnt));
            end if;
            if exists (select 1 from public.hosted_tournament_bracket_rounds
                        where bracket_id = p_bracket_id and is_final_slot and round_no <> v_max_round) then
                v_issues := v_issues || jsonb_build_array(jsonb_build_object(
                    'code', 'final_round_invalid', 'severity', 'error', 'reason', 'not_last_round'));
            end if;
        end if;
    end if;

    -- slots.round_no 와 rounds.round_no 불일치
    select coalesce(jsonb_agg(jsonb_build_object('code', 'round_no_mismatch', 'severity', 'error',
                                                 'slotId', s.id, 'slotRoundNo', s.round_no, 'roundNo', r.round_no)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and s.round_no <> r.round_no;
    v_issues := v_issues || v_tmp;

    -- 마지막 라운드가 아닌데 연결이 없다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'missing_feed', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and not r.is_final_slot and s.feeds_slot_id is null;
    v_issues := v_issues || v_tmp;

    -- 마지막(우승) 라운드 자리는 연결을 가질 수 없다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'final_slot_has_feed', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_rounds r on r.id = s.round_id
     where s.bracket_id = p_bracket_id and r.is_final_slot and s.feeds_slot_id is not null;
    v_issues := v_issues || v_tmp;

    -- 연결 대상이 다른 bracket / 다음 라운드가 아님
    select coalesce(jsonb_agg(jsonb_build_object(
               'code', case when tgt.bracket_id is distinct from s.bracket_id
                            then 'feed_other_bracket' else 'feed_not_next_round' end,
               'severity', 'error', 'roundNo', s.round_no, 'position', s.position,
               'targetRoundNo', tgt.round_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
      join public.hosted_tournament_bracket_slots tgt on tgt.id = s.feeds_slot_id
     where s.bracket_id = p_bracket_id
       and (tgt.bracket_id is distinct from s.bracket_id or tgt.round_no <> s.round_no + 1);
    v_issues := v_issues || v_tmp;

    -- destination 별 feeder 수는 정확히 2 (2라운드 이상 모든 자리)
    select coalesce(jsonb_agg(jsonb_build_object('code', 'feeder_count_invalid', 'severity', 'error',
                                                 'roundNo', t.round_no, 'position', t.position,
                                                 'feeders', coalesce(f.cnt, 0))), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots t
      left join (select feeds_slot_id, count(*) as cnt
                   from public.hosted_tournament_bracket_slots
                  where bracket_id = p_bracket_id and feeds_slot_id is not null
                  group by feeds_slot_id) f on f.feeds_slot_id = t.id
     where t.bracket_id = p_bracket_id and t.round_no > 1 and coalesce(f.cnt, 0) <> 2;
    v_issues := v_issues || v_tmp;

    -- BYE 대 BYE (한 destination 의 feeder 둘 다 bye)
    select coalesce(jsonb_agg(jsonb_build_object('code', 'bye_vs_bye', 'severity', 'error',
                                                 'targetRoundNo', t.round_no, 'targetPosition', t.position)),
                    '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots t
      join (select feeds_slot_id,
                   count(*) filter (where slot_type = 'bye') as byes,
                   count(*) as cnt
              from public.hosted_tournament_bracket_slots
             where bracket_id = p_bracket_id and feeds_slot_id is not null
             group by feeds_slot_id) f on f.feeds_slot_id = t.id
     where t.bracket_id = p_bracket_id and f.byes = 2 and f.cnt = 2;
    v_issues := v_issues || v_tmp;

    -- BYE 는 1라운드에만
    select coalesce(jsonb_agg(jsonb_build_object('code', 'bye_outside_first_round', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.slot_type = 'bye' and s.round_no > 1;
    v_issues := v_issues || v_tmp;

    -- 1라운드에 미배치(tbd) 남음 → 운영 시작 불가
    select coalesce(jsonb_agg(jsonb_build_object('code', 'unassigned_first_round_slot', 'severity', 'error',
                                                 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.round_no = 1 and s.slot_type = 'tbd';
    v_issues := v_issues || v_tmp;

    -- 2라운드 이상은 전부 승자 대기(tbd)여야 한다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'non_tbd_future_slot', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position,
                                                 'slotType', s.slot_type)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.round_no > 1 and s.slot_type <> 'tbd';
    v_issues := v_issues || v_tmp;

    -- 배치된 팀이 진출팀 목록에 없다
    select coalesce(jsonb_agg(jsonb_build_object('code', 'slot_team_not_entrant', 'severity', 'error',
                                                 'roundNo', s.round_no, 'position', s.position)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_slots s
     where s.bracket_id = p_bracket_id and s.team_id is not null
       and not exists (select 1 from public.hosted_tournament_bracket_entrants e
                        where e.bracket_id = p_bracket_id and e.team_id = s.team_id);
    v_issues := v_issues || v_tmp;

    -- 확정했는데 자리에 없는 진출팀
    select coalesce(jsonb_agg(jsonb_build_object('code', 'entrant_not_placed', 'severity', 'error',
                                                 'teamNo', t.team_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = p_bracket_id
       and not exists (select 1 from public.hosted_tournament_bracket_slots s
                        where s.bracket_id = p_bracket_id and s.team_id = e.team_id);
    v_issues := v_issues || v_tmp;

    -- ── warning ──────────────────────────────────────────────────────────
    if v_b.declared_entrant_count is not null and v_b.declared_entrant_count <> v_entrants then
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
            'code', 'declared_count_mismatch', 'severity', 'warning',
            'declared', v_b.declared_entrant_count, 'actual', v_entrants));
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('code', 'entrant_team_withdrawn', 'severity', 'warning',
                                                 'teamNo', t.team_no)), '[]'::jsonb)
      into v_tmp
      from public.hosted_tournament_bracket_entrants e
      join public.hosted_tournament_teams t on t.id = e.team_id
     where e.bracket_id = p_bracket_id and t.status = 'withdrawn';
    v_issues := v_issues || v_tmp;

    -- ── summary ──────────────────────────────────────────────────────────
    select count(*) filter (where round_no = 1),
           count(*) filter (where round_no = 1 and slot_type = 'bye'),
           count(*) filter (where round_no = 1 and slot_type = 'tbd')
      into v_first, v_byes, v_unassigned
      from public.hosted_tournament_bracket_slots where bracket_id = p_bracket_id;

    -- 만들 수 있는 경기 수 / BYE 로 자동 진출할 자리 수 (4C 가 실행한다 — 여기서는 세기만 한다)
    select count(*) filter (where teams = 2), count(*) filter (where teams = 1 and byes = 1)
      into v_matches, v_bye_adv
      from (select feeds_slot_id,
                   count(*) filter (where slot_type = 'team') as teams,
                   count(*) filter (where slot_type = 'bye')  as byes
              from public.hosted_tournament_bracket_slots
             where bracket_id = p_bracket_id and feeds_slot_id is not null
             group by feeds_slot_id) q;

    return jsonb_build_object(
        'ok', not exists (select 1 from jsonb_array_elements(v_issues) i
                           where i ->> 'severity' = 'error'),
        'issues', v_issues,
        'summary', jsonb_build_object(
            'entrants',        v_entrants,
            'rounds',          v_rounds,
            'slots',           v_slots,
            'firstRoundSlots', v_first,
            'byes',            v_byes,
            'unassigned',      v_unassigned,
            'matchesToCreate', v_matches,
            'byeAdvances',     v_bye_adv));
end;
$$;

revoke execute on function public.hosted_tournament_bracket_validate(uuid) from public;
revoke execute on function public.hosted_tournament_bracket_validate(uuid) from anon;
revoke execute on function public.hosted_tournament_bracket_validate(uuid) from authenticated;


-- ── 10. RPC: bracket 생성 ────────────────────────────────────────────────────
create or replace function public.create_bracket(
    p_slug                   text,
    p_title                  text default null,
    p_declared_entrant_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_bid uuid;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-bracket:' || v_tid::text));

    if exists (select 1 from public.hosted_tournament_brackets where tournament_id = v_tid) then
        return jsonb_build_object('ok', false, 'reason', 'already_exists');
    end if;

    insert into public.hosted_tournament_brackets (tournament_id, title, declared_entrant_count)
    values (v_tid, nullif(btrim(coalesce(p_title, '')), ''), p_declared_entrant_count)
    returning id into v_bid;

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'create_bracket', null,
        jsonb_build_object('declaredEntrantCount', p_declared_entrant_count), null);

    return jsonb_build_object('ok', true, 'bracketId', v_bid, 'version', 1);
end;
$$;

revoke execute on function public.create_bracket(text,text,integer) from public;
revoke execute on function public.create_bracket(text,text,integer) from anon;
grant  execute on function public.create_bracket(text,text,integer) to authenticated;


-- ── 11. RPC: 진출팀 확정 (전량 교체 · 스냅샷) ────────────────────────────────
--   ⚠ 서버가 예선 결과를 읽어 자동으로 채우지 않는다. Admin 이 보낸 목록을 그대로 저장한다.
create or replace function public.set_bracket_entrants(
    p_slug             text,
    p_entrants         jsonb,
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
    v_bid     uuid;
    v_version integer;
    v_before  integer;
    v_after   integer;
    v_e       jsonb;
    v_team    uuid;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_entrants is null or jsonb_typeof(p_entrants) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if jsonb_array_length(p_entrants) = 0 then
        return jsonb_build_object('ok', false, 'reason', 'empty_payload');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_locked');
    end if;

    -- payload 검증 (전량 확인 후 전량 반영 — 부분 성공 없음)
    drop table if exists _bentrant;
    create temp table _bentrant (
        team_id uuid, source text, group_no integer, rank_no integer, seed_no integer, note text
    ) on commit drop;

    for v_e in select * from jsonb_array_elements(p_entrants) loop
        if v_e ->> 'teamId' is null then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
        end if;
        begin
            v_team := (v_e ->> 'teamId')::uuid;
        exception when others then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
        end;
        if coalesce(v_e ->> 'source', 'manual') not in ('group_rank', 'placement', 'manual') then
            return jsonb_build_object('ok', false, 'reason', 'invalid_source');
        end if;
        if exists (select 1 from _bentrant where team_id = v_team) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_entrant', 'teamId', v_team);
        end if;
        if not exists (select 1 from public.hosted_tournament_teams
                        where id = v_team and tournament_id = v_tid) then
            return jsonb_build_object('ok', false, 'reason', 'team_not_found', 'teamId', v_team);
        end if;
        insert into _bentrant values (
            v_team, coalesce(v_e ->> 'source', 'manual'),
            nullif(v_e ->> 'sourceGroupNo', '')::integer,
            nullif(v_e ->> 'sourceRank', '')::integer,
            nullif(v_e ->> 'seedNo', '')::integer,
            nullif(btrim(coalesce(v_e ->> 'note', '')), ''));
    end loop;

    -- 이미 슬롯에 배치된 팀을 목록에서 빼면 조용히 지우지 않고 거부한다.
    if exists (
        select 1 from public.hosted_tournament_bracket_slots s
         where s.bracket_id = v_bid and s.team_id is not null
           and not exists (select 1 from _bentrant b where b.team_id = s.team_id)
    ) then
        return jsonb_build_object('ok', false, 'reason', 'entrant_in_use');
    end if;

    select count(*) into v_before from public.hosted_tournament_bracket_entrants where bracket_id = v_bid;

    -- 배치된 팀의 entrant_id 연결을 먼저 끊고(FK on delete set null 이지만 명시적으로) 전량 교체한다.
    update public.hosted_tournament_bracket_slots
       set entrant_id = null, updated_at = now()
     where bracket_id = v_bid and entrant_id is not null;

    delete from public.hosted_tournament_bracket_entrants where bracket_id = v_bid;

    insert into public.hosted_tournament_bracket_entrants
        (tournament_id, bracket_id, team_id, source, source_group_no, source_rank, seed_no, snapshot_note)
    select v_tid, v_bid, b.team_id, b.source, b.group_no, b.rank_no, b.seed_no, b.note from _bentrant b;

    -- 슬롯에 남아 있는 팀은 새 entrant 행에 다시 연결한다(팀은 그대로다).
    update public.hosted_tournament_bracket_slots s
       set entrant_id = e.id, updated_at = now()
      from public.hosted_tournament_bracket_entrants e
     where s.bracket_id = v_bid and e.bracket_id = v_bid and s.team_id = e.team_id;

    select count(*) into v_after from public.hosted_tournament_bracket_entrants where bracket_id = v_bid;
    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'set_entrants',
        jsonb_build_object('count', v_before), jsonb_build_object('count', v_after), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'removed', v_before, 'created', v_after, 'entrantCount', v_after);
end;
$$;

revoke execute on function public.set_bracket_entrants(text,jsonb,integer) from public;
revoke execute on function public.set_bracket_entrants(text,jsonb,integer) from anon;
grant  execute on function public.set_bracket_entrants(text,jsonb,integer) to authenticated;


-- ── 12. RPC: 구조(라운드 · 자리 수 · 연결) 전량 교체 ─────────────────────────
--   payload 예:
--     {"rounds":[{"roundNo":1,"name":"32강","slots":32},
--                {"roundNo":2,"name":"16강","slots":16}, …,
--                {"roundNo":6,"name":"우승","slots":1,"isFinalSlot":true}],
--      "connections":[{"roundNo":1,"position":1,"feedsPosition":1},
--                     {"roundNo":1,"position":2,"feedsPosition":1}, …]}
--   ⚠ 연결을 서버가 추론하지 않는다. connections 가 없으면 거부한다.
--   ⚠ 슬롯에 팀/BYE 가 배치되어 있으면 거부한다(자동 초기화 · force reset 없음).
create or replace function public.set_bracket_structure(
    p_slug             text,
    p_structure        jsonb,
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
    v_bid      uuid;
    v_version  integer;
    v_r        jsonb;
    v_c        jsonb;
    v_rounds   jsonb;
    v_conns    jsonb;
    v_round_no integer;
    v_slots    integer;
    v_cnt      integer;
    v_final    integer;
    v_conn_cnt integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_structure is null or jsonb_typeof(p_structure) <> 'object' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    v_rounds := p_structure -> 'rounds';
    v_conns  := p_structure -> 'connections';
    if v_rounds is null or jsonb_typeof(v_rounds) <> 'array' or jsonb_array_length(v_rounds) = 0 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if v_conns is null or jsonb_typeof(v_conns) <> 'array' then
        -- 연결은 경기이사가 정한다. 서버가 만들어내지 않는다.
        return jsonb_build_object('ok', false, 'reason', 'connections_required');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_locked');
    end if;

    -- 배치가 남아 있으면 구조를 바꾸지 않는다. 먼저 비우게 한다.
    if exists (select 1 from public.hosted_tournament_bracket_slots
                where bracket_id = v_bid and slot_type <> 'tbd') then
        return jsonb_build_object('ok', false, 'reason', 'slots_in_use');
    end if;

    -- payload 1차 검증
    drop table if exists _bround;
    drop table if exists _bconn;
    create temp table _bround (round_no integer, name text, slots integer, is_final boolean) on commit drop;
    create temp table _bconn (round_no integer, position integer, feeds_position integer) on commit drop;

    for v_r in select * from jsonb_array_elements(v_rounds) loop
        v_round_no := nullif(v_r ->> 'roundNo', '')::integer;
        v_slots    := nullif(v_r ->> 'slots', '')::integer;
        if v_round_no is null or v_round_no < 1 then
            return jsonb_build_object('ok', false, 'reason', 'invalid_round_no');
        end if;
        if v_slots is null or v_slots < 1 then
            return jsonb_build_object('ok', false, 'reason', 'invalid_slot_count', 'roundNo', v_round_no);
        end if;
        if nullif(btrim(coalesce(v_r ->> 'name', '')), '') is null then
            return jsonb_build_object('ok', false, 'reason', 'invalid_round_name', 'roundNo', v_round_no);
        end if;
        if exists (select 1 from _bround where round_no = v_round_no) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_round_no', 'roundNo', v_round_no);
        end if;
        insert into _bround values (v_round_no, btrim(v_r ->> 'name'), v_slots,
                                    coalesce((v_r ->> 'isFinalSlot')::boolean, false));
    end loop;

    select count(*) into v_cnt from _bround;
    if exists (select 1 from _bround where round_no > v_cnt) then
        return jsonb_build_object('ok', false, 'reason', 'round_gap');
    end if;
    select count(*) into v_final from _bround where is_final;
    if v_final <> 1 then
        return jsonb_build_object('ok', false, 'reason', 'final_round_invalid', 'finalRounds', v_final);
    end if;
    if exists (select 1 from _bround where is_final and (slots <> 1 or round_no <> v_cnt)) then
        return jsonb_build_object('ok', false, 'reason', 'final_round_invalid');
    end if;
    if exists (select 1 from _bround where name is not null
                group by name having count(*) > 1) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_round_name');
    end if;

    for v_c in select * from jsonb_array_elements(v_conns) loop
        insert into _bconn values (
            nullif(v_c ->> 'roundNo', '')::integer,
            nullif(v_c ->> 'position', '')::integer,
            nullif(v_c ->> 'feedsPosition', '')::integer);
    end loop;
    if exists (select 1 from _bconn where round_no is null or position is null or feeds_position is null) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_connection');
    end if;
    if exists (select 1 from _bconn c
                where not exists (select 1 from _bround r where r.round_no = c.round_no
                                   and c.position between 1 and r.slots)) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_connection');
    end if;
    if exists (select 1 from _bconn c
                where not exists (select 1 from _bround r where r.round_no = c.round_no + 1
                                   and c.feeds_position between 1 and r.slots)) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_connection');
    end if;
    if exists (select 1 from _bconn group by round_no, position having count(*) > 1) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_connection');
    end if;
    -- 마지막 라운드를 제외한 모든 자리에 연결이 있어야 한다.
    select count(*) into v_conn_cnt from _bround where not is_final;
    if (select coalesce(sum(slots), 0) from _bround where not is_final) <> (select count(*) from _bconn) then
        return jsonb_build_object('ok', false, 'reason', 'connection_count_mismatch',
                                  'expected', (select coalesce(sum(slots), 0) from _bround where not is_final),
                                  'actual', (select count(*) from _bconn));
    end if;

    -- 전량 교체 (배치가 없는 상태이므로 안전)
    delete from public.hosted_tournament_bracket_slots  where bracket_id = v_bid;
    delete from public.hosted_tournament_bracket_rounds where bracket_id = v_bid;

    insert into public.hosted_tournament_bracket_rounds (tournament_id, bracket_id, round_no, name, is_final_slot)
    select v_tid, v_bid, r.round_no, r.name, r.is_final from _bround r;

    insert into public.hosted_tournament_bracket_slots
        (tournament_id, bracket_id, round_id, round_no, position, slot_type)
    select v_tid, v_bid, rr.id, r.round_no, gs.pos, 'tbd'
      from _bround r
      join public.hosted_tournament_bracket_rounds rr
        on rr.bracket_id = v_bid and rr.round_no = r.round_no,
           generate_series(1, r.slots) as gs(pos);

    -- 연결 반영
    update public.hosted_tournament_bracket_slots s
       set feeds_slot_id = tgt.id, updated_at = now()
      from _bconn c
      join public.hosted_tournament_bracket_slots tgt
        on tgt.bracket_id = v_bid and tgt.round_no = c.round_no + 1 and tgt.position = c.feeds_position
     where s.bracket_id = v_bid and s.round_no = c.round_no and s.position = c.position;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'set_structure', null,
        jsonb_build_object('rounds', (select count(*) from _bround),
                           'slots', (select coalesce(sum(slots), 0) from _bround),
                           'connections', (select count(*) from _bconn)), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'rounds', (select count(*) from _bround),
                              'slots', (select coalesce(sum(slots), 0) from _bround),
                              'connections', (select count(*) from _bconn));
end;
$$;

revoke execute on function public.set_bracket_structure(text,jsonb,integer) from public;
revoke execute on function public.set_bracket_structure(text,jsonb,integer) from anon;
grant  execute on function public.set_bracket_structure(text,jsonb,integer) to authenticated;


-- ── 13. RPC: 1라운드 자리 1개 배치 ───────────────────────────────────────────
--   ⚠ 2라운드 이상은 편집하지 않는다(승자 대기 자리는 4C 전달이 채운다).
create or replace function public.assign_bracket_slot(
    p_slug             text,
    p_slot_id          uuid,
    p_slot_type        text,
    p_team_id          uuid,
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
    v_bid     uuid;
    v_version integer;
    v_s       public.hosted_tournament_bracket_slots%rowtype;
    v_eid     uuid;
    v_before  jsonb;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_slot_type not in ('team', 'bye', 'tbd') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_slot_type');
    end if;
    if (p_slot_type = 'team') <> (p_team_id is not null) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_locked');
    end if;

    select * into v_s from public.hosted_tournament_bracket_slots
     where id = p_slot_id and bracket_id = v_bid;
    if v_s.id is null then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_found');
    end if;
    if v_s.round_no > 1 then
        return jsonb_build_object('ok', false, 'reason', 'slot_not_editable', 'roundNo', v_s.round_no);
    end if;

    if p_slot_type = 'team' then
        select id into v_eid from public.hosted_tournament_bracket_entrants
         where bracket_id = v_bid and team_id = p_team_id;
        if v_eid is null then
            return jsonb_build_object('ok', false, 'reason', 'team_not_entrant');
        end if;
        if exists (select 1 from public.hosted_tournament_bracket_slots
                    where bracket_id = v_bid and team_id = p_team_id and id <> p_slot_id) then
            return jsonb_build_object('ok', false, 'reason', 'team_already_placed');
        end if;
    end if;

    v_before := jsonb_build_object('slotType', v_s.slot_type, 'teamId', v_s.team_id);

    update public.hosted_tournament_bracket_slots
       set slot_type = p_slot_type,
           team_id   = case when p_slot_type = 'team' then p_team_id else null end,
           entrant_id = case when p_slot_type = 'team' then v_eid else null end,
           updated_at = now()
     where id = p_slot_id;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket_slot', p_slot_id, 'assign_slot', v_before,
        jsonb_build_object('slotType', p_slot_type, 'teamId', p_team_id,
                           'position', v_s.position), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'slot', jsonb_build_object('id', p_slot_id, 'roundNo', v_s.round_no,
                                                         'position', v_s.position, 'slotType', p_slot_type));
end;
$$;

revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) from public;
revoke execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) from anon;
grant  execute on function public.assign_bracket_slot(text,uuid,text,uuid,integer) to authenticated;


-- ── 14. RPC: 1라운드 전량 교체 (붙여넣기 입력) ───────────────────────────────
--   ⚠ 1라운드 '모든' 자리를 한 번에 보낸다. 부분 반영 없음 — 전량 검증 후 전량 반영.
--   ⚠ 2라운드 이상은 대상이 아니다. BYE 위치는 payload 그대로 저장한다(자동 배치 없음).
create or replace function public.replace_bracket_slots(
    p_slug             text,
    p_assignments      jsonb,
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
    v_bid     uuid;
    v_version integer;
    v_a       jsonb;
    v_pos     integer;
    v_type    text;
    v_team    uuid;
    v_first   integer;
    v_assigned integer;
    v_byes    integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_locked');
    end if;

    select count(*) into v_first
      from public.hosted_tournament_bracket_slots where bracket_id = v_bid and round_no = 1;
    if v_first = 0 then
        return jsonb_build_object('ok', false, 'reason', 'structure_missing');
    end if;
    if jsonb_array_length(p_assignments) <> v_first then
        return jsonb_build_object('ok', false, 'reason', 'position_count_mismatch',
                                  'expected', v_first, 'actual', jsonb_array_length(p_assignments));
    end if;

    drop table if exists _bassign;
    create temp table _bassign (position integer, slot_type text, team_id uuid) on commit drop;

    for v_a in select * from jsonb_array_elements(p_assignments) loop
        v_pos  := nullif(v_a ->> 'position', '')::integer;
        v_type := coalesce(v_a ->> 'type', '');
        v_team := nullif(v_a ->> 'teamId', '')::uuid;
        if v_pos is null or v_type not in ('team', 'bye', 'tbd') then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
        end if;
        if (v_type = 'team') <> (v_team is not null) then
            return jsonb_build_object('ok', false, 'reason', 'invalid_payload', 'position', v_pos);
        end if;
        if exists (select 1 from _bassign where position = v_pos) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_position', 'position', v_pos);
        end if;
        if v_team is not null and exists (select 1 from _bassign where team_id = v_team) then
            return jsonb_build_object('ok', false, 'reason', 'duplicate_team', 'teamId', v_team);
        end if;
        if not exists (select 1 from public.hosted_tournament_bracket_slots
                        where bracket_id = v_bid and round_no = 1 and position = v_pos) then
            return jsonb_build_object('ok', false, 'reason', 'unknown_position', 'position', v_pos);
        end if;
        if v_team is not null and not exists (
               select 1 from public.hosted_tournament_bracket_entrants
                where bracket_id = v_bid and team_id = v_team) then
            return jsonb_build_object('ok', false, 'reason', 'team_not_entrant', 'teamId', v_team);
        end if;
        insert into _bassign values (v_pos, v_type, v_team);
    end loop;

    -- 전량 반영
    update public.hosted_tournament_bracket_slots s
       set slot_type = a.slot_type,
           team_id   = a.team_id,
           entrant_id = e.id,
           updated_at = now()
      from _bassign a
      left join public.hosted_tournament_bracket_entrants e
        on e.bracket_id = v_bid and e.team_id = a.team_id
     where s.bracket_id = v_bid and s.round_no = 1 and s.position = a.position;

    select count(*) filter (where slot_type = 'team'), count(*) filter (where slot_type = 'bye')
      into v_assigned, v_byes from _bassign;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'replace_slots', null,
        jsonb_build_object('positions', v_first, 'teams', v_assigned, 'byes', v_byes), null);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'assigned', v_assigned, 'byes', v_byes,
                              'cleared', v_first - v_assigned - v_byes);
end;
$$;

revoke execute on function public.replace_bracket_slots(text,jsonb,integer) from public;
revoke execute on function public.replace_bracket_slots(text,jsonb,integer) from anon;
grant  execute on function public.replace_bracket_slots(text,jsonb,integer) to authenticated;


-- ── 15. RPC: 검증 (읽기 전용) ────────────────────────────────────────────────
create or replace function public.validate_bracket(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_bid uuid;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    select id into v_bid from public.hosted_tournament_brackets where tournament_id = v_tid;
    if v_bid is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_found');
    end if;
    return public.hosted_tournament_bracket_validate(v_bid);
end;
$$;

revoke execute on function public.validate_bracket(text) from public;
revoke execute on function public.validate_bracket(text) from anon;
grant  execute on function public.validate_bracket(text) to authenticated;


-- ── 16. RPC: lock ───────────────────────────────────────────────────────────
create or replace function public.lock_bracket(
    p_slug             text,
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
    v_bid     uuid;
    v_val     jsonb;
    v_version integer;
    v_locked  timestamptz;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'already_locked', 'status', v_begin ->> 'status');
    end if;

    v_val := public.hosted_tournament_bracket_validate(v_bid);
    if not (v_val ->> 'ok')::boolean then
        return jsonb_build_object('ok', false, 'reason', 'validation_failed',
                                  'issues', v_val -> 'issues', 'summary', v_val -> 'summary');
    end if;

    update public.hosted_tournament_brackets
       set status = 'locked', locked_at = now(), locked_by = auth.uid(), updated_at = now()
     where id = v_bid
    returning locked_at into v_locked;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'lock_bracket', jsonb_build_object('status', 'draft'),
        jsonb_build_object('status', 'locked', 'version', v_version,
                           'summary', v_val -> 'summary'), null);

    -- ⚠ byeAdvances / matchesToCreate 는 '수'만 알린다. 실제 경기 생성 · BYE 전달은 4C 다.
    return jsonb_build_object('ok', true, 'version', v_version, 'lockedAt', v_locked,
                              'summary', v_val -> 'summary',
                              'issues', v_val -> 'issues');
end;
$$;

revoke execute on function public.lock_bracket(text,integer) from public;
revoke execute on function public.lock_bracket(text,integer) from anon;
grant  execute on function public.lock_bracket(text,integer) to authenticated;


-- ── 17. RPC: unlock (사유 필수) ─────────────────────────────────────────────
--   ⚠ 본선 경기가 하나라도 있으면 거부한다(4C 가 붙은 뒤를 대비해 지금부터 가드를 둔다).
--   ⚠ 공개 중이면 공개도 함께 내린다(4D publish 와의 계약).
create or replace function public.unlock_bracket(
    p_slug             text,
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
    v_bid     uuid;
    v_reason  text;
    v_version integer;
    v_pub     timestamptz;
    v_cnt     integer;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null then
        return jsonb_build_object('ok', false, 'reason', 'reason_required');
    end if;
    if length(v_reason) > 200 then
        return jsonb_build_object('ok', false, 'reason', 'reason_too_long');
    end if;

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;
    v_bid := (v_begin ->> 'bracketId')::uuid;
    if v_begin ->> 'status' <> 'locked' then
        return jsonb_build_object('ok', false, 'reason', 'not_locked', 'status', v_begin ->> 'status');
    end if;

    select count(*) into v_cnt
      from public.hosted_tournament_matches
     where tournament_id = v_tid and stage = 'knockout';
    if v_cnt > 0 then
        return jsonb_build_object('ok', false, 'reason', 'knockout_matches_exist', 'matches', v_cnt);
    end if;

    select published_at into v_pub from public.hosted_tournament_brackets where id = v_bid;

    update public.hosted_tournament_brackets
       set status = 'draft', locked_at = null, locked_by = null,
           published_at = null, updated_at = now()
     where id = v_bid;

    v_version := public.hosted_tournament_bracket_bump(v_bid);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'unlock_bracket',
        jsonb_build_object('status', 'locked', 'publishedAt', v_pub),
        jsonb_build_object('status', 'draft', 'version', v_version), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version, 'unpublished', v_pub is not null);
end;
$$;

revoke execute on function public.unlock_bracket(text,text,integer) from public;
revoke execute on function public.unlock_bracket(text,text,integer) from anon;
grant  execute on function public.unlock_bracket(text,text,integer) to authenticated;


-- ── 18. RPC: Admin 조회 ─────────────────────────────────────────────────────
--   ⚠ 개인정보 없음 — teams 스냅샷의 이름만. registrations 를 조인하지 않는다.
--   entrantDrift: 확정 이후 예선 결과와의 차이. **표시 전용**이며 어떤 것도 자동 반영하지 않는다.
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


notify pgrst, 'reload schema';

commit;
