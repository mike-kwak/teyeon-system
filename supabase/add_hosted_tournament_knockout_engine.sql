-- =============================================================================
-- 2026 TEYEON OPEN — 본선 Knockout Match Engine (Batch 4C)  (2026-09-23)
--
--   ★ 핵심 원칙(4A 와 동일): 시스템은 본선 구조를 결정하지 않는다.
--     · 이 파일의 어떤 함수도 라운드 · 자리 수 · BYE 위치 · 시드를 만들지 않는다.
--     · 경기 생성은 '이미 확정(locked)된 구조를 경기 행으로 옮겨 적는 것'뿐이다.
--     · 승자 전달은 경기 결과를 destination slot 에 그대로 옮기는 것뿐이다.
--
--   이번 Batch 가 하는 일
--     1. materialize_bracket_matches  — locked bracket → 본선 경기 생성 + BYE 전달(멱등)
--     2. complete_knockout_match      — 완료 + 승자 전달 + 다음 경기 생성을 한 번의 호출로(원자적)
--     3. amend_knockout_match_score   — 완료 결과 수정. 하위 진행 상태에 따라 허용/거부
--     4. 기존 complete_match / amend_completed_match_score / cancel_match 에
--        knockout 직접 사용 차단 guard 추가(예선 동작은 한 줄도 바뀌지 않는다)
--     5. get_admin_bracket 최소 확장 — 본선 경기 목록(matches) 추가
--
--   ⚠ 클라이언트 2회 호출 금지
--     '완료 → 승자 전달' 을 클라이언트가 두 번 나눠 호출하는 구조를 만들지 않는다.
--     중간에 끊기면 승자가 사라진다. 그래서 complete_knockout_match 하나로 끝낸다.
--
--   ⚠ 전역 잠금 순서 (반드시 유지)
--       hosted-tournament-matches:<tid>   →   hosted-tournament-bracket:<tid>
--     이 파일의 모든 RPC 는 matches 를 먼저 잡고 bracket 을 잡는다. 반대 순서 없음.
--
--   ⚠ 스키마 변경 1건 (4C 에서 반드시 필요 — 설계 검토 중 발견)
--     4A 의 hosted_tbslot_team_uniq (bracket_id, team_id) 는 '한 팀은 bracket 안에 한 번'
--     이었다. 승자 전달은 같은 팀을 다음 라운드 자리에 다시 놓는 동작이므로 이 인덱스가
--     있으면 본선 진행 자체가 불가능하다. 라운드 단위 unique 로 좁힌다.
--       hosted_tbslot_team_round_uniq (bracket_id, round_no, team_id)
--     → 1라운드 중복 배치는 그대로 막히고(같은 round_no), 진출만 가능해진다.
--
--   ⚠ additive 전용
--     · 테이블 · 컬럼 · CHECK 를 추가하지 않는다(4A 가 이미 열어 뒀다).
--     · 기존 행을 backfill 하지 않는다.
--     · 예선(get_preliminary_standings · generate_group_matches · call/uncall/start) 미변경.
--
--   검증  : add_hosted_tournament_knockout_engine_verify.sql
--   실동작: verify_hosted_tournament_knockout_engine_fixture.sql (전량 rollback)
--   되돌림: add_hosted_tournament_knockout_engine_rollback.sql
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regclass('public.hosted_tournament_brackets') is null
       or to_regclass('public.hosted_tournament_bracket_slots') is null then
        raise exception '본선 Bracket 기반(Batch 4A)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_bracket_begin(text,integer)') is null
       or to_regprocedure('public.hosted_tournament_bracket_bump(uuid)') is null then
        raise exception '4A bracket helper 가 없습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_match_begin(uuid,integer)') is null
       or to_regprocedure('public.complete_match(uuid,integer,integer,integer)') is null
       or to_regprocedure('public.cancel_match(uuid,text,integer)') is null
       or to_regprocedure('public.amend_completed_match_score(uuid,integer,integer,text,integer)') is null then
        raise exception 'Match Engine(Batch 3)이 적용되지 않았습니다.';
    end if;
    -- 4C 가 만드는 경기는 반드시 destination 당 1개여야 한다(멱등 키).
    if not exists (select 1 from pg_indexes
                    where schemaname = 'public' and indexname = 'hosted_tmatch_bracket_target_uniq') then
        raise exception 'hosted_tmatch_bracket_target_uniq 가 없습니다(4A 미적용).';
    end if;
end $guard$;


-- ── 1. slot 팀 중복 방어선 재정의 (bracket 전체 → 라운드 단위) ────────────────
--   ⚠ 약화가 아니다. 1라운드 중복 배치는 그대로 막힌다(같은 round_no 안에서 unique).
--     승자 전달만 가능해진다(다른 round_no 에 같은 팀이 존재할 수 있어야 한다).
create unique index if not exists hosted_tbslot_team_round_uniq
    on public.hosted_tournament_bracket_slots (bracket_id, round_no, team_id)
 where team_id is not null;

drop index if exists public.hosted_tbslot_team_uniq;

comment on index public.hosted_tbslot_team_round_uniq is
    '한 팀은 같은 라운드에 한 자리만 차지한다. 4C 승자 전달(다음 라운드 재배치)의 전제.';


-- ── 2. 내부 helper: destination 경기 생성 (멱등) ──────────────────────────────
--   두 feeder 가 모두 실제 팀일 때만 경기를 만든다. 이미 있으면 아무 것도 하지 않는다.
--   ⚠ 여기서 자리를 만들거나 BYE 를 놓지 않는다. 읽고, 조건이 맞으면 경기 1행을 넣을 뿐이다.
--   ⚠ match_no 는 호출자가 잡은 hosted-tournament-matches 잠금 안에서만 계산한다.
create or replace function public.hosted_tournament_knockout_create_match(
    p_tournament_id  uuid,
    p_bracket_id     uuid,
    p_target_slot_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_target public.hosted_tournament_bracket_slots%rowtype;
    v_a      public.hosted_tournament_bracket_slots%rowtype;
    v_b      public.hosted_tournament_bracket_slots%rowtype;
    v_cnt    integer;
    v_exists uuid;
    v_no     integer;
    v_mid    uuid;
begin
    select * into v_target
      from public.hosted_tournament_bracket_slots where id = p_target_slot_id;
    if v_target.id is null or v_target.bracket_id <> p_bracket_id then
        return null;
    end if;

    -- 이미 이 destination 을 향하는 경기가 있으면 재생성하지 않는다(멱등).
    select id into v_exists
      from public.hosted_tournament_matches
     where bracket_id = p_bracket_id and bracket_target_slot_id = p_target_slot_id
       and stage = 'knockout';
    if v_exists is not null then
        return null;
    end if;

    -- destination 이 이미 채워졌으면 경기를 만들지 않는다(승자가 이미 정해진 자리).
    if v_target.slot_type <> 'tbd' then
        return null;
    end if;

    select count(*) into v_cnt
      from public.hosted_tournament_bracket_slots
     where feeds_slot_id = p_target_slot_id;
    if v_cnt <> 2 then
        return null;
    end if;

    select * into v_a from public.hosted_tournament_bracket_slots
     where feeds_slot_id = p_target_slot_id order by position limit 1;
    select * into v_b from public.hosted_tournament_bracket_slots
     where feeds_slot_id = p_target_slot_id order by position offset 1 limit 1;

    -- 양쪽이 모두 실제 팀일 때만 경기가 성립한다(tbd · bye 는 아직/영영 경기가 아니다).
    if v_a.slot_type <> 'team' or v_b.slot_type <> 'team'
       or v_a.team_id is null or v_b.team_id is null
       or v_a.team_id = v_b.team_id then
        return null;
    end if;

    select coalesce(max(match_no), 0) + 1 into v_no
      from public.hosted_tournament_matches where tournament_id = p_tournament_id;

    insert into public.hosted_tournament_matches
        (tournament_id, stage, group_id, round_no, sequence_no, match_no,
         team1_id, team2_id, bracket_id, bracket_target_slot_id)
    values
        (p_tournament_id, 'knockout', null, v_a.round_no, v_target.position, v_no,
         v_a.team_id, v_b.team_id, p_bracket_id, p_target_slot_id)
    returning id into v_mid;

    perform public.hosted_tournament_log_event(
        p_tournament_id, 'match', v_mid, 'knockout_match_created', null,
        jsonb_build_object('matchNo', v_no, 'roundNo', v_a.round_no,
                           'targetRoundNo', v_target.round_no,
                           'targetPosition', v_target.position), null);

    return v_mid;
end;
$$;

revoke execute on function public.hosted_tournament_knockout_create_match(uuid,uuid,uuid) from public;
revoke execute on function public.hosted_tournament_knockout_create_match(uuid,uuid,uuid) from anon;
revoke execute on function public.hosted_tournament_knockout_create_match(uuid,uuid,uuid) from authenticated;


-- ── 3. 내부 helper: 승자 전달 (BYE 연쇄 포함) ─────────────────────────────────
--   p_slot_id 자리에 p_team_id 를 놓고, 상대가 BYE 면 계속 올려 보낸다.
--   상대가 실제 팀이면 그 destination 의 다음 경기를 만든다.
--   ⚠ 이 함수는 BYE 를 '놓지' 않는다. 이미 경기이사가 놓아 둔 BYE 를 읽고 통과시킬 뿐이다.
--   ⚠ 호출자는 반드시 matches → bracket 순서로 잠금을 잡은 뒤 호출한다.
create or replace function public.hosted_tournament_knockout_advance(
    p_tournament_id uuid,
    p_bracket_id    uuid,
    p_slot_id       uuid,
    p_team_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_cur      uuid := p_slot_id;
    v_slot     public.hosted_tournament_bracket_slots%rowtype;
    v_sib      public.hosted_tournament_bracket_slots%rowtype;
    v_guard    integer := 0;
    v_filled   integer := 0;
    v_created  integer := 0;
    v_byes     integer := 0;
    v_champion uuid    := null;
    v_mid      uuid;
begin
    loop
        v_guard := v_guard + 1;
        if v_guard > 64 then
            raise exception 'knockout advance loop guard tripped (bracket %)', p_bracket_id;
        end if;

        select * into v_slot
          from public.hosted_tournament_bracket_slots where id = v_cur;
        if v_slot.id is null then
            exit;
        end if;

        if v_slot.slot_type = 'team' and v_slot.team_id = p_team_id then
            null;  -- 이미 같은 팀이 있다(재실행). 그대로 두고 아래 연쇄만 이어 간다.
        elsif v_slot.slot_type <> 'tbd' then
            return jsonb_build_object('ok', false, 'reason', 'slot_occupied',
                                      'roundNo', v_slot.round_no, 'position', v_slot.position);
        else
            update public.hosted_tournament_bracket_slots
               set slot_type = 'team', team_id = p_team_id, updated_at = now()
             where id = v_cur;
            v_filled := v_filled + 1;

            perform public.hosted_tournament_log_event(
                p_tournament_id, 'bracket_slot', v_cur, 'bracket_slot_advanced', null,
                jsonb_build_object('roundNo', v_slot.round_no, 'position', v_slot.position), null);
        end if;

        -- 다음 연결이 없다 = 우승 자리다.
        if v_slot.feeds_slot_id is null then
            v_champion := p_team_id;
            exit;
        end if;

        select * into v_sib
          from public.hosted_tournament_bracket_slots
         where feeds_slot_id = v_slot.feeds_slot_id and id <> v_cur
         limit 1;

        if v_sib.id is null then
            exit;  -- 구조 이상(validate 가 lock 에서 막는다). 여기서 고치지 않는다.
        end if;

        if v_sib.slot_type = 'bye' then
            v_byes := v_byes + 1;
            v_cur  := v_slot.feeds_slot_id;
            continue;  -- 부전승 — 한 칸 더 올라간다.
        end if;

        if v_sib.slot_type = 'team' and v_sib.team_id is not null then
            v_mid := public.hosted_tournament_knockout_create_match(
                         p_tournament_id, p_bracket_id, v_slot.feeds_slot_id);
            if v_mid is not null then
                v_created := v_created + 1;
            end if;
        end if;

        exit;  -- 상대가 아직 미정이면 여기서 멈춘다.
    end loop;

    return jsonb_build_object('ok', true, 'filled', v_filled, 'created', v_created,
                              'byeAdvances', v_byes, 'championTeamId', v_champion);
end;
$$;

revoke execute on function public.hosted_tournament_knockout_advance(uuid,uuid,uuid,uuid) from public;
revoke execute on function public.hosted_tournament_knockout_advance(uuid,uuid,uuid,uuid) from anon;
revoke execute on function public.hosted_tournament_knockout_advance(uuid,uuid,uuid,uuid) from authenticated;


-- ── 4. RPC: 본선 경기 생성 (locked bracket → matches) ─────────────────────────
--   ⚠ locked 에서만 동작한다. draft 구조로는 경기를 만들지 않는다.
--   ⚠ 멱등하다. 두 번 눌러도 같은 경기가 두 번 생기지 않는다(destination unique).
--   ⚠ 구조를 만들지 않는다. BYE 위치 · 시드 · 라운드 수를 여기서 결정하지 않는다.
create or replace function public.materialize_bracket_matches(
    p_slug             text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_begin    jsonb;
    v_bid      uuid;
    v_bstatus  text;
    v_version  integer;
    v_rec      record;
    v_sib      public.hosted_tournament_bracket_slots%rowtype;
    v_res      jsonb;
    v_mid      uuid;
    v_created  integer := 0;
    v_existing integer := 0;
    v_filled   integer := 0;
    v_byes     integer := 0;
    v_champion uuid    := null;
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

    -- ★ 전역 잠금 순서: matches → bracket.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-matches:' || v_tid::text));

    v_begin := public.hosted_tournament_bracket_begin(p_slug, p_expected_version);
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_bid     := (v_begin ->> 'bracketId')::uuid;
    v_bstatus := v_begin ->> 'status';
    v_version := (v_begin ->> 'version')::integer;

    if v_bstatus = 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_not_locked');
    end if;
    if v_bstatus = 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_completed');
    end if;

    -- 생성 개수는 '전후 차이' 로 센다(같은 destination 을 두 feeder 에서 두 번 만나기 때문).
    select count(*) into v_existing
      from public.hosted_tournament_matches
     where bracket_id = v_bid and stage = 'knockout';

    -- 1) 부전승 전달 — 상대가 BYE 인 자리의 팀을 올려 보낸다(연쇄 포함).
    for v_rec in
        select s.id, s.team_id, s.feeds_slot_id, s.round_no, s.position
          from public.hosted_tournament_bracket_slots s
         where s.bracket_id = v_bid and s.slot_type = 'team' and s.feeds_slot_id is not null
         order by s.round_no, s.position
    loop
        select * into v_sib
          from public.hosted_tournament_bracket_slots
         where feeds_slot_id = v_rec.feeds_slot_id and id <> v_rec.id
         limit 1;
        if v_sib.id is null or v_sib.slot_type <> 'bye' then
            continue;
        end if;

        v_res := public.hosted_tournament_knockout_advance(
                     v_tid, v_bid, v_rec.feeds_slot_id, v_rec.team_id);
        if not (v_res ->> 'ok')::boolean then return v_res; end if;
        v_filled := v_filled + (v_res ->> 'filled')::integer;
        v_byes   := v_byes   + (v_res ->> 'byeAdvances')::integer + 1;
        if (v_res ->> 'championTeamId') is not null then
            v_champion := (v_res ->> 'championTeamId')::uuid;
        end if;
    end loop;

    -- 2) 양쪽이 모두 실제 팀인 destination 마다 경기 1개. 이미 있으면 건너뛴다(멱등).
    --   ⚠ 정렬 필수 — 경기 번호(match_no)는 대진 순서(라운드 → 자리)를 따라야 한다.
    --     정렬이 없으면 같은 대진에서도 실행할 때마다 번호가 달라진다(현장 호명이 어긋난다).
    for v_rec in
        select f.feeds_slot_id as dest, d.round_no as d_round, d.position as d_pos
          from public.hosted_tournament_bracket_slots f
          join public.hosted_tournament_bracket_slots d on d.id = f.feeds_slot_id
         where f.bracket_id = v_bid and f.feeds_slot_id is not null and f.slot_type = 'team'
         group by f.feeds_slot_id, d.round_no, d.position
        having count(*) = 2
         order by d.round_no, d.position
    loop
        v_mid := public.hosted_tournament_knockout_create_match(v_tid, v_bid, v_rec.dest);
    end loop;

    select count(*) - v_existing into v_created
      from public.hosted_tournament_matches
     where bracket_id = v_bid and stage = 'knockout';

    -- 극단적 구조(진출팀 1팀 등)에서 BYE 만으로 우승 자리까지 갔다면 그대로 완료로 본다.
    if v_champion is not null then
        update public.hosted_tournament_brackets
           set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
         where id = v_bid and status <> 'completed';
        perform public.hosted_tournament_log_event(
            v_tid, 'bracket', v_bid, 'bracket_completed', null,
            jsonb_build_object('cause', 'materialize_bye_chain'), null);
    end if;

    if v_created > 0 or v_filled > 0 then
        v_version := public.hosted_tournament_bracket_bump(v_bid);
        perform public.hosted_tournament_log_event(
            v_tid, 'bracket', v_bid, 'bracket_matches_materialized', null,
            jsonb_build_object('created', v_created, 'byeAdvanced', v_filled,
                               'version', v_version), null);
    end if;

    return jsonb_build_object('ok', true, 'version', v_version,
                              'created', v_created, 'existing', v_existing,
                              'byeAdvanced', v_filled,
                              'bracketCompleted', v_champion is not null);
end;
$$;

revoke execute on function public.materialize_bracket_matches(text,integer) from public;
revoke execute on function public.materialize_bracket_matches(text,integer) from anon;
grant  execute on function public.materialize_bracket_matches(text,integer) to authenticated;


-- ── 5. RPC: 본선 경기 완료 (완료 + 승자 전달 원자적) ──────────────────────────
--   ⚠ complete_match 를 대신한다. 두 번 호출로 나누지 않는다.
--   ⚠ 점수 규칙 · 코트 반납 · version 규약은 예선 complete_match 와 완전히 같다.
create or replace function public.complete_knockout_match(
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
    v_begin    jsonb;
    v_tid      uuid;
    v_status   text;
    v_stage    text;
    v_bid      uuid;
    v_target   uuid;
    v_t1       uuid;
    v_t2       uuid;
    v_no       integer;
    v_winner   uuid;
    v_bstatus  text;
    v_dtype    text;
    v_dteam    uuid;
    v_rows     integer;
    v_version  integer;
    v_bversion integer;
    v_res      jsonb;
begin
    if p_expected_version is null then
        return jsonb_build_object('ok', false, 'reason', 'version_required');
    end if;
    -- 6게임 1세트: 승자 6 / 패자 0~5.
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

    select stage, bracket_id, bracket_target_slot_id, team1_id, team2_id, match_no
      into v_stage, v_bid, v_target, v_t1, v_t2, v_no
      from public.hosted_tournament_matches where id = p_match_id;

    if v_stage <> 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'not_knockout_match');
    end if;
    if v_bid is null or v_target is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_link_missing');
    end if;
    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    -- ★ 잠금 순서: matches(위 match_begin) → bracket.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-bracket:' || v_tid::text));

    select status into v_bstatus from public.hosted_tournament_brackets where id = v_bid;
    if v_bstatus = 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'bracket_completed');
    end if;

    v_winner := case when p_score1 > p_score2 then v_t1 else v_t2 end;

    -- 승자를 넣을 자리가 비어 있는지 먼저 본다(쓰기 전에 거부해야 부분 반영이 없다).
    select slot_type, team_id into v_dtype, v_dteam
      from public.hosted_tournament_bracket_slots where id = v_target;
    if v_dtype is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_link_missing');
    end if;
    if v_dtype <> 'tbd' and not (v_dtype = 'team' and v_dteam = v_winner) then
        return jsonb_build_object('ok', false, 'reason', 'slot_occupied');
    end if;

    update public.hosted_tournament_matches
       set status = 'completed', score1 = p_score1, score2 = p_score2,
           winner_team_id = v_winner, court_id = null, completed_at = now(),
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'playing' and version = p_expected_version
    returning version into v_version;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_completed', null,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version,
                           'stage', 'knockout'), null);

    -- 승자 전달. 여기서 실패하면 완료까지 통째로 되돌린다(부분 반영 금지).
    v_res := public.hosted_tournament_knockout_advance(v_tid, v_bid, v_target, v_winner);
    if not (v_res ->> 'ok')::boolean then
        raise exception 'knockout propagation failed: % (match %)', v_res ->> 'reason', v_no;
    end if;

    if (v_res ->> 'championTeamId') is not null then
        update public.hosted_tournament_brackets
           set status = 'completed', completed_at = now(), updated_at = now()
         where id = v_bid;
        perform public.hosted_tournament_log_event(
            v_tid, 'bracket', v_bid, 'bracket_completed', null,
            jsonb_build_object('matchNo', v_no, 'championTeamId', v_res ->> 'championTeamId'), null);
    end if;

    v_bversion := public.hosted_tournament_bracket_bump(v_bid);

    return jsonb_build_object('ok', true, 'version', v_version, 'bracketVersion', v_bversion,
                              'winnerTeamId', v_winner,
                              'createdMatches', (v_res ->> 'created')::integer,
                              'byeAdvances', (v_res ->> 'byeAdvances')::integer,
                              'bracketCompleted', (v_res ->> 'championTeamId') is not null);
end;
$$;

revoke execute on function public.complete_knockout_match(uuid,integer,integer,integer) from public;
revoke execute on function public.complete_knockout_match(uuid,integer,integer,integer) from anon;
grant  execute on function public.complete_knockout_match(uuid,integer,integer,integer) to authenticated;


-- ── 6. RPC: 본선 완료 결과 수정 ───────────────────────────────────────────────
--   승자가 그대로면(점수만 정정) 언제나 허용한다.
--   승자가 바뀌면 하위 진행 상태로 판단한다.
--     · 다음 경기 없음        → 자리만 교체
--     · 다음 경기 WAITING     → 그 경기의 팀을 교체(삭제·재생성 금지)
--     · CALLING/PLAYING/완료  → 거부(사람이 먼저 되돌려야 한다)
--     · bracket 이 completed  → 거부(결승 재개는 4C 범위 밖)
create or replace function public.amend_knockout_match_score(
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
    v_begin    jsonb;
    v_tid      uuid;
    v_status   text;
    v_stage    text;
    v_bid      uuid;
    v_target   uuid;
    v_t1       uuid;
    v_t2       uuid;
    v_no       integer;
    v_reason   text;
    v_before   jsonb;
    v_old      uuid;
    v_new      uuid;
    v_bstatus  text;
    v_cur      uuid;
    v_slot     public.hosted_tournament_bracket_slots%rowtype;
    v_chain    uuid[] := '{}';
    v_swap     uuid   := null;
    v_swap_no  integer;
    v_mid      uuid;
    v_mstatus  text;
    v_mno      integer;
    v_guard    integer := 0;
    v_rows     integer;
    v_version  integer;
    v_bversion integer;
    v_res      jsonb;
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

    select stage, bracket_id, bracket_target_slot_id, team1_id, team2_id, match_no,
           winner_team_id,
           jsonb_build_object('score1', score1, 'score2', score2, 'winnerTeamId', winner_team_id)
      into v_stage, v_bid, v_target, v_t1, v_t2, v_no, v_old, v_before
      from public.hosted_tournament_matches where id = p_match_id;

    if v_stage <> 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'not_knockout_match');
    end if;
    if v_bid is null or v_target is null then
        return jsonb_build_object('ok', false, 'reason', 'bracket_link_missing');
    end if;
    if v_status <> 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'match_not_completed', 'status', v_status);
    end if;

    -- ★ 잠금 순서: matches(위 match_begin) → bracket.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-bracket:' || v_tid::text));
    select status into v_bstatus from public.hosted_tournament_brackets where id = v_bid;

    v_new := case when p_score1 > p_score2 then v_t1 else v_t2 end;

    -- ── 6-1. 승자가 바뀌는 경우: 하위 진행을 먼저 전부 확인한다(쓰기 전에 거부) ──
    if v_new <> v_old then
        if v_bstatus = 'completed' then
            return jsonb_build_object('ok', false, 'reason', 'bracket_completed');
        end if;

        v_cur := v_target;
        loop
            v_guard := v_guard + 1;
            if v_guard > 64 then
                raise exception 'knockout amend loop guard tripped (match %)', v_no;
            end if;

            select * into v_slot
              from public.hosted_tournament_bracket_slots where id = v_cur;
            exit when v_slot.id is null;
            -- 이 자리에 기존 승자가 없으면 더 따라갈 것이 없다.
            exit when v_slot.slot_type <> 'team' or v_slot.team_id <> v_old;

            v_chain := v_chain || v_cur;
            exit when v_slot.feeds_slot_id is null;

            select id, status, match_no into v_mid, v_mstatus, v_mno
              from public.hosted_tournament_matches
             where bracket_id = v_bid and bracket_target_slot_id = v_slot.feeds_slot_id
               and stage = 'knockout';

            if v_mid is not null then
                if v_mstatus <> 'waiting' then
                    return jsonb_build_object('ok', false,
                        'reason', case v_mstatus
                                      when 'calling'   then 'downstream_calling'
                                      when 'playing'   then 'downstream_playing'
                                      when 'completed' then 'downstream_completed'
                                      else 'downstream_' || v_mstatus end,
                        'matchNo', v_mno);
                end if;
                v_swap    := v_mid;
                v_swap_no := v_mno;
                exit;  -- WAITING 경기에서 멈춘다. 그 위로는 올라가지 않았다.
            end if;

            v_cur := v_slot.feeds_slot_id;  -- 경기가 없다 = BYE 로 더 올라갔을 수 있다.
        end loop;
    end if;

    -- ── 6-2. 점수 · 승자 갱신 ────────────────────────────────────────────────
    update public.hosted_tournament_matches
       set score1 = p_score1, score2 = p_score2, winner_team_id = v_new,
           version = version + 1, updated_at = now()
     where id = p_match_id and status = 'completed' and version = p_expected_version
    returning version into v_version;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_score_amended', v_before,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_new, 'version', v_version,
                           'stage', 'knockout',
                           'winnerChanged', v_new <> v_old), v_reason);

    if v_new = v_old then
        return jsonb_build_object('ok', true, 'version', v_version,
                                  'winnerTeamId', v_new, 'winnerChanged', false);
    end if;

    -- ── 6-3. 기존 승자가 올라간 자리를 되돌린다 ──────────────────────────────
    update public.hosted_tournament_bracket_slots
       set slot_type = 'tbd', team_id = null, entrant_id = null, updated_at = now()
     where id = any(v_chain);

    perform public.hosted_tournament_log_event(
        v_tid, 'bracket', v_bid, 'bracket_slot_rolled_back', v_before,
        jsonb_build_object('matchNo', v_no, 'slots', array_length(v_chain, 1)), v_reason);

    -- ── 6-4. 대기 중인 다음 경기의 팀만 교체한다(삭제·재생성 금지) ───────────
    if v_swap is not null then
        update public.hosted_tournament_matches
           set team1_id = case when team1_id = v_old then v_new else team1_id end,
               team2_id = case when team2_id = v_old then v_new else team2_id end,
               version = version + 1, updated_at = now()
         where id = v_swap and status = 'waiting';

        perform public.hosted_tournament_log_event(
            v_tid, 'match', v_swap, 'knockout_match_team_replaced', null,
            jsonb_build_object('matchNo', v_swap_no, 'causeMatchNo', v_no), v_reason);
    end if;

    -- ── 6-5. 새 승자를 다시 올려 보낸다 ──────────────────────────────────────
    v_res := public.hosted_tournament_knockout_advance(v_tid, v_bid, v_target, v_new);
    if not (v_res ->> 'ok')::boolean then
        raise exception 'knockout re-propagation failed: % (match %)', v_res ->> 'reason', v_no;
    end if;

    v_bversion := public.hosted_tournament_bracket_bump(v_bid);

    return jsonb_build_object('ok', true, 'version', v_version, 'bracketVersion', v_bversion,
                              'winnerTeamId', v_new, 'winnerChanged', true,
                              'rolledBackSlots', coalesce(array_length(v_chain, 1), 0),
                              'replacedMatch', v_swap is not null,
                              'createdMatches', (v_res ->> 'created')::integer);
end;
$$;

revoke execute on function public.amend_knockout_match_score(uuid,integer,integer,text,integer) from public;
revoke execute on function public.amend_knockout_match_score(uuid,integer,integer,text,integer) from anon;
grant  execute on function public.amend_knockout_match_score(uuid,integer,integer,text,integer) to authenticated;


-- ── 7. 기존 RPC 에 knockout 직접 사용 차단 guard ──────────────────────────────
--   ⚠ 예선 동작은 한 줄도 바뀌지 않는다. knockout 경기일 때만 한 줄 더 거부한다.
--     이유: 이 경로들은 승자 전달을 모른다. 통과시키면 bracket 이 조용히 어긋난다.

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
    v_stage  text;
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

    select stage, team1_id, team2_id into v_stage, v_t1, v_t2
      from public.hosted_tournament_matches where id = p_match_id;

    -- ★ 본선 경기는 complete_knockout_match 로만 완료한다(승자 전달 포함).
    if v_stage = 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'knockout_requires_bracket_rpc');
    end if;

    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'already_changed', 'status', v_status);
    end if;

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
    v_stage  text;
    v_reason text;
    v_before jsonb;
    v_t1     uuid;
    v_t2     uuid;
    v_gid    uuid;
    v_gno    integer;
    v_winner uuid;
    v_rows   integer;
    v_version integer;
    v_no     integer;
    v_inval  integer := 0;
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

    select team1_id, team2_id, match_no, group_id, stage,
           jsonb_build_object('score1', score1, 'score2', score2,
                              'winnerTeamId', winner_team_id)
      into v_t1, v_t2, v_no, v_gid, v_stage, v_before
      from public.hosted_tournament_matches where id = p_match_id;

    -- ★ 본선 결과 수정은 amend_knockout_match_score 로만 한다(하위 진행 보호 포함).
    if v_stage = 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'knockout_requires_bracket_rpc');
    end if;

    if v_status <> 'completed' then
        return jsonb_build_object('ok', false, 'reason', 'match_not_completed', 'status', v_status);
    end if;

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

    -- ★ 같은 트랜잭션에서 동률 확정 무효화. 클라이언트 후처리에 의존하지 않는다.
    if v_gid is not null then
        update public.hosted_tournament_group_tie_resolutions
           set invalidated_at = now(), invalidated_reason = 'score_amended'
         where group_id = v_gid and invalidated_at is null;
        get diagnostics v_inval = row_count;

        if v_inval > 0 then
            select group_no into v_gno
              from public.hosted_tournament_groups where id = v_gid;
            perform public.hosted_tournament_log_event(
                v_tid, 'group', v_gid, 'group_age_tie_resolution_invalidated', null,
                jsonb_build_object('groupNo', v_gno, 'invalidatedCount', v_inval,
                                   'cause', 'score_amended', 'matchNo', v_no), v_reason);
        end if;
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_score_amended', v_before,
        jsonb_build_object('matchNo', v_no, 'score1', p_score1, 'score2', p_score2,
                           'winnerTeamId', v_winner, 'version', v_version,
                           'invalidatedResolutions', v_inval), v_reason);

    return jsonb_build_object('ok', true, 'version', v_version, 'winnerTeamId', v_winner,
                              'invalidatedResolutions', v_inval);
end;
$$;

revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from public;
revoke execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) from anon;
grant  execute on function public.amend_completed_match_score(uuid,integer,integer,text,integer) to authenticated;


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
    v_stage  text;
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

    select stage into v_stage
      from public.hosted_tournament_matches where id = p_match_id;

    -- ★ 본선 경기는 취소하지 않는다. 자리가 비면 대진이 끊긴다(4C 범위 밖).
    if v_stage = 'knockout' then
        return jsonb_build_object('ok', false, 'reason', 'knockout_cancel_not_supported');
    end if;

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


-- ── 8. get_admin_bracket 최소 확장 (본선 경기 목록 추가) ──────────────────────
--   ⚠ 4A 반환값을 하나도 제거하지 않는다. matches 키만 추가한다.
--   ⚠ 반환 화이트리스트 유지 — registrations 를 join 하지 않는다.
--     팀 식별은 teamNo + 이름 스냅샷만 쓴다. 원시 UUID 는 경기 id 하나만 내보낸다
--     (RPC 호출에 필요하다. 화면에 표시하지 않는다).
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
    v_matches  jsonb;
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

    -- ★ 4C 추가: 본선 경기 목록. 라운드 → destination 자리 순.
    select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'matchNo', m.match_no, 'roundNo', m.round_no,
               'roundName', r.name,
               'targetRoundNo', ts.round_no, 'targetPosition', ts.position,
               'status', m.status, 'version', m.version,
               'courtNo', c.court_no, 'courtName', c.display_name,
               'score1', m.score1, 'score2', m.score2,
               'winnerTeamNo', wt.team_no,
               'team1', jsonb_build_object('teamNo', t1.team_no, 'player1Name', t1.player1_name,
                                           'player2Name', t1.player2_name, 'teamStatus', t1.status),
               'team2', jsonb_build_object('teamNo', t2.team_no, 'player1Name', t2.player1_name,
                                           'player2Name', t2.player2_name, 'teamStatus', t2.status))
               order by ts.round_no, ts.position), '[]'::jsonb)
      into v_matches
      from public.hosted_tournament_matches m
      join public.hosted_tournament_bracket_slots ts on ts.id = m.bracket_target_slot_id
      left join public.hosted_tournament_bracket_rounds r on r.bracket_id = v_b.id and r.round_no = m.round_no
      left join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      left join public.hosted_tournament_teams t2 on t2.id = m.team2_id
      left join public.hosted_tournament_teams wt on wt.id = m.winner_team_id
      left join public.hosted_tournament_courts c on c.id = m.court_id
     where m.bracket_id = v_b.id and m.stage = 'knockout';

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
        'matches', v_matches,
        'entrantDrift', v_drift,
        'validation', public.hosted_tournament_bracket_validate(v_b.id));
end;
$$;

revoke execute on function public.get_admin_bracket(text) from public;
revoke execute on function public.get_admin_bracket(text) from anon;
grant  execute on function public.get_admin_bracket(text) to authenticated;


notify pgrst, 'reload schema';

commit;
