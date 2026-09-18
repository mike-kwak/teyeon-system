-- ============================================================================
--  2026 TEYEON OPEN — 예선 경기 엔진 (Batch 3A)
--
--  선행: Batch 1 4종 + Batch 2A(groups) + bulk follow-up 운영 적용 완료
--
--  범위: 경기 스키마 · 생성 · lifecycle(호명/시작/완료/수정/취소) · unlock 보호 · stale 계약
--  제외: Standings · 합산연령 tie resolution · Admin 화면 · Knockout · Public · Realtime
--
--  ⚠⚠ 기권 / 노쇼 정책
--    별도 WALKOVER / RET / DEF 상태·컬럼·RPC 를 만들지 않는다.
--    운영상 기권·노쇼는 상대팀의 **6:0 승리**로 일반 경기와 동일하게 입력한다.
--    따라서 승/패 1, games_for/against 6:0, game differential 모두 그대로 반영된다.
--    실제 6:0 과 기권승 6:0 을 데이터 모델에서 구분하지 않는다.
--
--  ⚠ CANCELLED 의 의미는 하나뿐이다 — '공식 결과 없이 경기가 취소됨'.
--    standings 집계(3B)에서 제외되며, 기권 처리 용도가 아니다.
--
--  ⚠ 개인정보: 경기 도메인은 hosted_tournament_teams 스냅샷만 참조한다.
--    hosted_tournament_registrations 를 join 하지 않고 감사 로그에도 PII 를 남기지 않는다.
--    DOB · 나이 컬럼을 만들지 않는다.
-- ============================================================================

begin;

-- ── 1. 경기 ─────────────────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_matches (
    id              uuid        primary key default gen_random_uuid(),
    tournament_id   uuid        not null references public.hosted_tournaments(id) on delete cascade,

    -- knockout 은 이번 Batch 구현 대상이 아니다. 값만 미리 열어 둔다.
    stage           text        not null
                                check (stage in ('preliminary', 'placement', 'knockout')),
    group_id        uuid,
    round_no        integer     check (round_no is null or round_no >= 1),

    -- 조 안에서의 경기 순서(1..N(N-1)/2). 생성 멱등성의 키가 된다.
    sequence_no     integer     not null check (sequence_no >= 1),
    -- 대회 전체 진행 번호(호명용).
    match_no        integer     not null check (match_no >= 1),

    team1_id        uuid        not null,
    team2_id        uuid        not null,

    -- ⚠ PLAYING 에서만 채운다. CALLING 은 코트를 점유하지 않는다.
    court_id        uuid,

    status          text        not null default 'waiting'
                                check (status in ('waiting', 'calling', 'playing',
                                                  'completed', 'cancelled')),

    -- 6게임 1세트 · No-Ad · 5:5 타이브레이크 → 승자는 항상 6, 패자는 0~5.
    score1          integer     check (score1 is null or score1 between 0 and 6),
    score2          integer     check (score2 is null or score2 between 0 and 6),
    winner_team_id  uuid,

    called_at       timestamptz,
    started_at      timestamptz,
    completed_at    timestamptz,
    cancelled_at    timestamptz,

    version         integer     not null default 1 check (version >= 1),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    -- 교차 대회 오염 차단 — Batch 1·2 가 (tournament_id, id) unique 를 이미 갖고 있다.
    constraint hosted_tmatch_group_fk foreign key (tournament_id, group_id)
        references public.hosted_tournament_groups (tournament_id, id) on delete cascade,
    constraint hosted_tmatch_team1_fk foreign key (tournament_id, team1_id)
        references public.hosted_tournament_teams  (tournament_id, id) on delete restrict,
    constraint hosted_tmatch_team2_fk foreign key (tournament_id, team2_id)
        references public.hosted_tournament_teams  (tournament_id, id) on delete restrict,
    constraint hosted_tmatch_court_fk foreign key (tournament_id, court_id)
        references public.hosted_tournament_courts (tournament_id, id) on delete set null,

    constraint hosted_tmatch_no_unique      unique (tournament_id, match_no),
    -- ★ 생성 멱등성 최종 방어선. 같은 조에 같은 순번 경기가 두 번 생길 수 없다.
    constraint hosted_tmatch_seq_unique     unique (group_id, sequence_no),
    -- 후속 Batch(knockout 등)가 복합 FK 를 걸 수 있게 미리 열어 둔다.
    constraint hosted_tmatch_tid_id_unique  unique (tournament_id, id),

    constraint hosted_tmatch_distinct_teams check (team1_id <> team2_id),
    constraint hosted_tmatch_group_required check (
        stage = 'knockout' or group_id is not null),

    -- 완료 ↔ 점수·승자 동시 존재. 둘 중 하나만 있는 상태가 불가능하다.
    constraint hosted_tmatch_completed_shape check (
        (status =  'completed' and score1 is not null and score2 is not null
                               and winner_team_id is not null)
     or (status <> 'completed' and score1 is null and score2 is null
                               and winner_team_id is null)),
    -- 승자는 반드시 두 팀 중 하나.
    constraint hosted_tmatch_winner_member check (
        winner_team_id is null or winner_team_id in (team1_id, team2_id)),
    -- 6게임 규칙. 기권승 6:0 도 동일하게 이 제약을 통과한다.
    constraint hosted_tmatch_score_rule check (
        score1 is null
     or (greatest(score1, score2) = 6 and least(score1, score2) between 0 and 5)),
    -- PLAYING 만 코트를 점유한다. 완료·취소 시 반드시 반납된다.
    constraint hosted_tmatch_court_shape check (
        (status =  'playing' and court_id is not null)
     or (status <> 'playing' and court_id is null))
);

comment on table public.hosted_tournament_matches is
    '예선/순위결정전 경기. ⚠ 기권·노쇼는 별도 상태 없이 6:0 으로 입력한다. PII 미포함.';
comment on column public.hosted_tournament_matches.court_id is
    'PLAYING 에서만 채운다. CALLING 은 코트를 점유하지 않는다(다음 경기 준비 안내일 뿐).';
comment on column public.hosted_tournament_matches.winner_team_id is
    '서버 RPC 가 score 에서 파생해 저장한다. 클라이언트가 결정하지 않는다.';

-- ★ 같은 코트에 PLAYING 경기는 하나뿐.
create unique index if not exists hosted_tmatch_playing_court_uniq
    on public.hosted_tournament_matches (tournament_id, court_id)
    where status = 'playing' and court_id is not null;

create index if not exists hosted_tmatch_status_idx
    on public.hosted_tournament_matches (tournament_id, status);
create index if not exists hosted_tmatch_group_idx
    on public.hosted_tournament_matches (group_id, sequence_no);
create index if not exists hosted_tmatch_team1_idx
    on public.hosted_tournament_matches (team1_id);
create index if not exists hosted_tmatch_team2_idx
    on public.hosted_tournament_matches (team2_id);


-- ── 2. 조편성 지문 컬럼 ─────────────────────────────────────────────────────
--   경기를 생성한 시점의 '조편성 의미'를 기록한다. 지금 지문과 다르면 경기 목록이 낡은 것이다.
--   ⚠ nullable — 기존 행에 영향 없음(테이블 재작성 없음).
alter table public.hosted_tournaments
    add column if not exists preliminary_matches_fingerprint text;

comment on column public.hosted_tournaments.preliminary_matches_fingerprint is
    '경기 생성 시점 조편성 지문. 현재 지문과 다르면 stale. null = 경기 미생성.';


-- ── 3. 권한 ─────────────────────────────────────────────────────────────────
alter table public.hosted_tournament_matches enable row level security;

revoke all on table public.hosted_tournament_matches from public, anon, authenticated;
grant  select on table public.hosted_tournament_matches to authenticated;

drop policy if exists hosted_tmatch_select_manager on public.hosted_tournament_matches;
create policy hosted_tmatch_select_manager on public.hosted_tournament_matches
    for select to authenticated using (public.can_manage_tournaments());
-- INSERT/UPDATE/DELETE 정책 없음 → 직접 쓰기 경로가 존재하지 않는다.


-- ── 4. 내부 helper: 조편성 지문 ─────────────────────────────────────────────
--   ⚠ canonical 규칙 (비본질 값 제외)
--     포함: group_type · group_no(preliminary 만) · slot_no · team_id
--     제외: display_order · label · group id(uuid) · created_at
--     placement 는 대회당 1개이므로 group_no 대신 고정 키 'P' 를 쓴다
--            (조 재생성으로 번호만 바뀌었을 때 헛된 stale 을 피한다).
--     정렬: group_type → group_no → slot_no 로 고정.
--   목표: 실제 조/팀 배치가 같으면 지문도 항상 같다.
create or replace function public.hosted_tournament_membership_fingerprint(p_tid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select md5(coalesce(string_agg(
               case when g.group_type = 'placement'
                    then 'P' else 'G' || g.group_no::text end
               || '#' || m.slot_no::text || '#' || m.team_id::text,
               '|' order by g.group_type, g.group_no, m.slot_no), ''))
      from public.hosted_tournament_group_members m
      join public.hosted_tournament_groups g on g.id = m.group_id
     where m.tournament_id = p_tid;
$$;

revoke execute on function public.hosted_tournament_membership_fingerprint(uuid) from public;
revoke execute on function public.hosted_tournament_membership_fingerprint(uuid) from anon;
revoke execute on function public.hosted_tournament_membership_fingerprint(uuid) from authenticated;


-- ── 5. 내부 helper: 경기 write 전제조건 ─────────────────────────────────────
--   ① 권한 ② 경기 존재 ③ advisory lock ④ 락 이후 재조회 ⑤ 버전 일치
--   ⚠ p_expected_version 은 '경기 1건'의 version 이다. 조편성 version 과 다른 개념.
--   ⚠ 네임스페이스 'hosted-tournament-matches:' — 접수/팀/코트/조편성 락과 분리된다.
--     한 RPC 가 두 네임스페이스를 동시에 잡지 않는다(데드락 방지 규칙).
create or replace function public.hosted_tournament_match_begin(
    p_match_id         uuid,
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

    select tournament_id into v_tid
      from public.hosted_tournament_matches where id = p_match_id;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'match_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-matches:' || v_tid::text));

    -- 락 이후 재조회 — 락 전 값은 신뢰하지 않는다.
    select status, version into v_status, v_version
      from public.hosted_tournament_matches where id = p_match_id;

    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;

    return jsonb_build_object('ok', true, 'tournamentId', v_tid,
                              'status', v_status, 'version', v_version);
end;
$$;

revoke execute on function public.hosted_tournament_match_begin(uuid,integer) from public;
revoke execute on function public.hosted_tournament_match_begin(uuid,integer) from anon;
revoke execute on function public.hosted_tournament_match_begin(uuid,integer) from authenticated;


-- ── 6. RPC: 경기 생성 ───────────────────────────────────────────────────────
--   ⚠ 조편성 LOCK 을 전제로 한다. DRAFT 에서는 공식 경기를 만들지 않는다.
--   ⚠ 이미 경기가 있으면 거부한다. 조용한 재생성·삭제 경로를 만들지 않는다.
--   ⚠ p_expected_version 은 '조편성' version 이다.
create or replace function public.generate_group_matches(
    p_slug             text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid       uuid;
    v_dstatus   text;
    v_dversion  integer;
    v_valid     jsonb;
    v_existing  integer;
    v_prelim    integer := 0;
    v_place     integer := 0;
    v_fp        text;
    v_version   integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-matches:' || v_tid::text));

    select preliminary_draw_status, preliminary_draw_version
      into v_dstatus, v_dversion
      from public.hosted_tournaments where id = v_tid;

    if p_expected_version <> v_dversion then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_dversion);
    end if;
    if v_dstatus is distinct from 'locked' then
        return jsonb_build_object('ok', false, 'reason', 'draw_not_locked');
    end if;

    -- 잠근 뒤에 조편성이 훼손됐을 수 있으므로 검증을 다시 돌린다.
    v_valid := public.hosted_tournament_draw_validate(v_tid);
    if not (v_valid ->> 'ok')::boolean then
        return jsonb_build_object('ok', false, 'reason', 'draw_invalid',
                                  'validation', v_valid);
    end if;

    select count(*) into v_existing
      from public.hosted_tournament_matches where tournament_id = v_tid;
    if v_existing > 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_generated',
                                  'matches', v_existing);
    end if;

    -- 라운드로빈 일반식 N(N-1)/2 — 조 크기를 하드코딩하지 않는다.
    --   3팀 조 → (1,2)(1,3)(2,3) 3경기 / placement 2팀 → (1,2) 1경기
    with pair as (
        select g.id            as gid,
               g.group_no      as gno,
               g.group_type    as gtype,
               g.display_order as gorder,
               m1.team_id      as t1,
               m2.team_id      as t2,
               row_number() over (partition by g.id order by m1.slot_no, m2.slot_no) as seq
          from public.hosted_tournament_groups g
          join public.hosted_tournament_group_members m1 on m1.group_id = g.id
          join public.hosted_tournament_group_members m2
            on m2.group_id = g.id and m2.slot_no > m1.slot_no
         where g.tournament_id = v_tid
    )
    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, sequence_no, match_no, team1_id, team2_id)
    select v_tid,
           case when p.gtype = 'placement' then 'placement' else 'preliminary' end,
           p.gid, p.seq,
           row_number() over (order by p.gorder, p.gno, p.seq),
           p.t1, p.t2
      from pair p;

    select count(*) filter (where stage = 'preliminary'),
           count(*) filter (where stage = 'placement')
      into v_prelim, v_place
      from public.hosted_tournament_matches where tournament_id = v_tid;

    v_fp := public.hosted_tournament_membership_fingerprint(v_tid);

    update public.hosted_tournaments
       set preliminary_matches_fingerprint = v_fp,
           updated_at = now()
     where id = v_tid;

    v_version := public.hosted_tournament_draw_bump(v_tid);

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'group_matches_generated', null,
        jsonb_build_object('preliminaryMatches', v_prelim, 'placementMatches', v_place,
                           'totalMatches', v_prelim + v_place, 'version', v_version), p_slug);

    return jsonb_build_object('ok', true,
                              'preliminaryMatches', v_prelim,
                              'placementMatches', v_place,
                              'totalMatches', v_prelim + v_place,
                              'version', v_version);
end;
$$;

revoke execute on function public.generate_group_matches(text,integer) from public;
revoke execute on function public.generate_group_matches(text,integer) from anon;
grant  execute on function public.generate_group_matches(text,integer) to authenticated;


-- ── 7. RPC: 호명 ────────────────────────────────────────────────────────────
--   ⚠ CALLING 은 코트를 점유하지 않는다. court_id 를 건드리지 않는다.
--   ⚠ 같은 팀이 여러 CALLING 에 동시에 걸리는 것을 막지 않는다(운영 효율).
create or replace function public.call_match(
    p_match_id         uuid,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin jsonb; v_tid uuid; v_rows integer; v_version integer; v_no integer;
begin
    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    update public.hosted_tournament_matches
       set status = 'calling', called_at = now(),
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'waiting'
    returning version, match_no into v_version, v_no;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed',
                                  'status', v_begin ->> 'status');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_called', null,
        jsonb_build_object('matchNo', v_no, 'version', v_version), null);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.call_match(uuid,integer) from public;
revoke execute on function public.call_match(uuid,integer) from anon;
grant  execute on function public.call_match(uuid,integer) to authenticated;


-- ── 8. RPC: 호명 취소 ───────────────────────────────────────────────────────
create or replace function public.uncall_match(
    p_match_id         uuid,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin jsonb; v_tid uuid; v_rows integer; v_version integer; v_no integer;
begin
    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid := (v_begin ->> 'tournamentId')::uuid;

    update public.hosted_tournament_matches
       set status = 'waiting', called_at = null,
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'calling'
    returning version, match_no into v_version, v_no;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed',
                                  'status', v_begin ->> 'status');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_uncalled', null,
        jsonb_build_object('matchNo', v_no, 'version', v_version), null);

    return jsonb_build_object('ok', true, 'version', v_version);
end;
$$;

revoke execute on function public.uncall_match(uuid,integer) from public;
revoke execute on function public.uncall_match(uuid,integer) from anon;
grant  execute on function public.uncall_match(uuid,integer) to authenticated;


-- ── 9. RPC: 경기 시작 (코트 배정) ───────────────────────────────────────────
--   ⚠ 코트는 번호로 받아 서버가 id 로 해석한다(Batch 1 courts RPC 와 같은 규약).
--   ⚠ team busy 는 DB 제약으로 표현할 수 없다(팀이 team1/team2 두 컬럼에 나뉨).
--     그래서 advisory lock 으로 직렬화한 뒤 authoritative 하게 재검사한다.
--   ⚠ 코트 중복은 partial unique index 가 최종 방어선이다(23505 → court_conflict).
create or replace function public.start_match(
    p_match_id         uuid,
    p_court_no         integer,
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
    v_status text;
    v_cid    uuid;
    v_cstat  text;
    v_t1     uuid;
    v_t2     uuid;
    v_rows   integer;
    v_version integer;
    v_no     integer;
begin
    v_begin := public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    if v_status not in ('waiting', 'calling') then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    -- 코트 — 존재 + active 여야 한다.
    select id, status into v_cid, v_cstat
      from public.hosted_tournament_courts
     where tournament_id = v_tid and court_no = p_court_no;
    if v_cid is null then
        return jsonb_build_object('ok', false, 'reason', 'court_not_found');
    end if;
    if v_cstat <> 'active' then
        return jsonb_build_object('ok', false, 'reason', 'court_disabled');
    end if;

    -- 코트 점유 1차 확인(최종 방어선은 partial unique index).
    if exists (select 1 from public.hosted_tournament_matches
                where tournament_id = v_tid and court_id = v_cid
                  and status = 'playing' and id <> p_match_id) then
        return jsonb_build_object('ok', false, 'reason', 'court_conflict');
    end if;

    -- team busy — 양쪽 팀 모두 다른 PLAYING 경기에 없어야 한다.
    select team1_id, team2_id into v_t1, v_t2
      from public.hosted_tournament_matches where id = p_match_id;

    if exists (select 1 from public.hosted_tournament_matches
                where tournament_id = v_tid and status = 'playing' and id <> p_match_id
                  and (team1_id in (v_t1, v_t2) or team2_id in (v_t1, v_t2))) then
        return jsonb_build_object('ok', false, 'reason', 'team_busy');
    end if;

    begin
        update public.hosted_tournament_matches
           set status = 'playing', court_id = v_cid, started_at = now(),
               version = version + 1, updated_at = now()
         where id = p_match_id and status in ('waiting', 'calling')
        returning version, match_no into v_version, v_no;
        get diagnostics v_rows = row_count;
    exception
        when unique_violation then
            return jsonb_build_object('ok', false, 'reason', 'court_conflict');
    end;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_started', null,
        jsonb_build_object('matchNo', v_no, 'courtNo', p_court_no, 'version', v_version), null);

    return jsonb_build_object('ok', true, 'version', v_version, 'courtNo', p_court_no);
end;
$$;

revoke execute on function public.start_match(uuid,integer,integer) from public;
revoke execute on function public.start_match(uuid,integer,integer) from anon;
grant  execute on function public.start_match(uuid,integer,integer) to authenticated;


-- ── 10. RPC: 경기 완료 ──────────────────────────────────────────────────────
--   ⚠ winner 는 클라이언트가 보내지 않는다. 서버가 score 에서 파생한다.
--   ⚠ 완료 즉시 코트를 반납한다(court_id = null).
--   ⚠ 기권·노쇼는 6:0 으로 여기에 그대로 입력한다. 별도 경로가 없다.
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


-- ── 11. RPC: 완료 결과 수정 ─────────────────────────────────────────────────
--   ⚠ 일반 입력과 구분한다. 사유 필수이며 별도 action 으로 감사에 남는다.
--   ⚠ winner 도 새 score 에서 다시 파생한다.
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

revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from public;
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from anon;
grant  execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) to authenticated;


-- ── 12. RPC: 경기 취소 ──────────────────────────────────────────────────────
--   ⚠ '공식 결과 없이 취소'의 의미만 갖는다. 기권 처리 용도가 아니다(기권은 6:0).
--   ⚠ 완료된 경기는 취소하지 않는다. 결과를 고치려면 amend 를 쓴다.
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


-- ── 13. RPC: 경기 보드 조회 (Admin) ─────────────────────────────────────────
--   ⚠ 반환 화이트리스트. registrations 를 join 하지 않는다.
--     표시 데이터는 전부 hosted_tournament_teams 스냅샷에서만 읽는다.
create or replace function public.get_admin_match_board(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_tstatus  text;
    v_dstatus  text;
    v_dversion integer;
    v_saved_fp text;
    v_now_fp   text;
    v_matches  jsonb;
    v_courts   jsonb;
begin
    if not public.can_manage_tournaments() then
        return null;   -- 권한 없음은 '빈 목록'이 아니라 null 로 구분한다
    end if;

    select id, status, preliminary_draw_status, preliminary_draw_version,
           preliminary_matches_fingerprint
      into v_tid, v_tstatus, v_dstatus, v_dversion, v_saved_fp
      from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

    v_now_fp := public.hosted_tournament_membership_fingerprint(v_tid);

    select coalesce(jsonb_agg(jsonb_build_object(
               'matchId',     m.id,
               'matchNo',     m.match_no,
               'stage',       m.stage,
               'groupNo',     g.group_no,
               'groupType',   g.group_type,
               'sequenceNo',  m.sequence_no,
               'status',      m.status,
               'courtNo',     c.court_no,
               'score1',      m.score1,
               'score2',      m.score2,
               'winnerTeamId', m.winner_team_id,
               'version',     m.version,
               'team1', jsonb_build_object(
                   'teamId', t1.id, 'teamNo', t1.team_no,
                   'player1Name', t1.player1_name, 'player2Name', t1.player2_name,
                   'teamStatus', t1.status),
               'team2', jsonb_build_object(
                   'teamId', t2.id, 'teamNo', t2.team_no,
                   'player1Name', t2.player1_name, 'player2Name', t2.player2_name,
                   'teamStatus', t2.status)
           ) order by m.match_no), '[]'::jsonb)
      into v_matches
      from public.hosted_tournament_matches m
      join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      join public.hosted_tournament_teams t2 on t2.id = m.team2_id
      left join public.hosted_tournament_groups g on g.id = m.group_id
      left join public.hosted_tournament_courts c on c.id = m.court_id
     where m.tournament_id = v_tid;

    select coalesce(jsonb_agg(jsonb_build_object(
               'courtNo',     c.court_no,
               'displayName', c.display_name,
               'status',      c.status,
               'busy', exists (select 1 from public.hosted_tournament_matches mm
                                where mm.court_id = c.id and mm.status = 'playing')
           ) order by c.display_order, c.court_no), '[]'::jsonb)
      into v_courts
      from public.hosted_tournament_courts c
     where c.tournament_id = v_tid;

    return jsonb_build_object(
        'slug',             p_slug,
        'tournamentStatus', v_tstatus,
        'drawStatus',       v_dstatus,
        'drawVersion',      v_dversion,
        'matchesGenerated', (v_saved_fp is not null),
        -- 경기를 만든 뒤 조편성이 실제로 바뀌었는가(표시 순서 같은 비본질 값은 무시).
        'matchesStale',     (v_saved_fp is not null and v_saved_fp is distinct from v_now_fp),
        'matches',          v_matches,
        'courts',           v_courts
    );
end;
$$;

revoke execute on function public.get_admin_match_board(text) from public;
revoke execute on function public.get_admin_match_board(text) from anon;
grant  execute on function public.get_admin_match_board(text) to authenticated;


-- ── 14. unlock_preliminary_draw 교체 — 경기 보호 + CALLING 초기화 ───────────
--   ⚠⚠ create or replace 이므로 Supabase 기본 권한이 되살아난다.
--     같은 트랜잭션에서 revoke/grant 를 다시 적용한다(bulk follow-up 에서 검증된 함정).
--
--   변경점
--     · PLAYING / COMPLETED 경기가 하나라도 있으면 unlock 차단(matches_in_progress)
--     · WAITING/CALLING/CANCELLED 만 있으면 사유를 받고 unlock 허용 + 경고 반환
--     · unlock 성공 시 CALLING 경기를 WAITING 으로 되돌린다
--       (DRAFT 조편성과 호명 상태가 동시에 존재하면 안 된다)
--     · CANCELLED 는 자동 변경하지 않는다. 경기 삭제도 하지 않는다.
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
    v_tid       uuid;
    v_status    text;
    v_version   integer;
    v_reason    text;
    v_active    integer := 0;   -- playing + completed
    v_total     integer := 0;
    v_reset     integer := 0;   -- calling → waiting
    v_warnings  jsonb := '[]'::jsonb;
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

    -- 경기 보호 — 진행/완료된 경기가 있으면 조편성을 흔들 수 없다.
    select count(*) filter (where status in ('playing', 'completed')),
           count(*)
      into v_active, v_total
      from public.hosted_tournament_matches where tournament_id = v_tid;

    if v_active > 0 then
        return jsonb_build_object('ok', false, 'reason', 'matches_in_progress',
                                  'activeMatches', v_active, 'version', v_version);
    end if;

    -- 호명 상태 초기화. ⚠ CANCELLED 는 건드리지 않고, 경기를 삭제하지도 않는다.
    update public.hosted_tournament_matches
       set status = 'waiting', called_at = null,
           version = version + 1, updated_at = now()
     where tournament_id = v_tid and status = 'calling';
    get diagnostics v_reset = row_count;

    if v_total > 0 then
        v_warnings := v_warnings || jsonb_build_array('matches_exist');
    end if;
    if v_reset > 0 then
        v_warnings := v_warnings || jsonb_build_array('calling_reset');
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
        jsonb_build_object('version', v_version, 'existingMatches', v_total,
                           'callingReset', v_reset, 'warnings', v_warnings), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version,
                              'existingMatches', v_total, 'callingReset', v_reset,
                              'warnings', v_warnings);
end;
$$;

-- ⚠⚠ 재생성했으므로 권한을 다시 잠근다(기본 권한 부활 방지).
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from public;
revoke execute on function public.unlock_preliminary_draw(text,text,integer) from anon;
grant  execute on function public.unlock_preliminary_draw(text,text,integer) to authenticated;

commit;
