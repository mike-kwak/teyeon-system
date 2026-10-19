-- ============================================================================
--  2026 TEYEON OPEN — 현장 운영자 권한 (최종 권한 구조)
--
--  적용 순서: (team_checkin 적용 뒤 · 순서 무관) → **staff_scoring**
--    사전 점검: precheck_hosted_tournament_staff_scoring_READONLY.sql  ← 기존 함수 md5 가 기대값과 같아야 적용한다
--    적용 후 점검: add_hosted_tournament_staff_scoring_verify.sql (읽기 전용)
--    되돌리기: add_hosted_tournament_staff_scoring_rollback.sql (기존 함수 3개를 원본 그대로 복원)
--
--  무엇을 하는가
--    임원진 · 외부 도우미 · 그 밖의 신청자를 하나의 '현장 운영자' 로 다룬다.
--    카카오 로그인 → 대회별 권한 요청 → 본부(CEO/ADMIN)가 이름 · 카카오 닉네임 · 확인 코드 4자리를 대조해 승인 →
--    그 대회에서만 '예선 · 본선 경기 시작(타이머) · 점수 입력 · 완료 · 경기 현황 조회' 를 할 수 있다.
--    만료 · 회수 · 대회 종료가 즉시 효력을 갖는다. 임원진도 자동 승인하지 않는다.
--
--  ⚠ profiles.role 을 바꾸지 않는다. 권한은 대회별 허용 목록(hosted_tournament_staff)에만 있다.
--  ⚠ 본부 전용(서버에서 차단): 팀 체크인 · 코트 배정/투입(start_match) · 호명 · 경기 취소/복구 · 점수 정정 ·
--    대진 생성/수정 · 운영 설정 · 관리자 보드 조회 · 권한 승인/회수. 이 RPC 들은 기존 그대로(CEO/ADMIN 만).
--  ⚠ 공개(anon) 쓰기 경로 없음. 새 테이블은 RLS + 권한 회수, 내부 helper 는 클라이언트 실행 불가.
--  ⚠ 기존 RPC 변경은 3개(아래 3절) — 권한 진입점 한 단어만. CEO/ADMIN 동작은 같다.
-- ============================================================================

begin;

-- ── 1. 현장 운영자 허용 목록 ──────────────────────────────────────────────────────
--   대회별 · 사용자별 1행. 상태: pending(요청) → approved(승인, 만료 시각 필수) → revoked(회수/거절).
--   만료는 상태가 아니라 시각으로 판정한다(approved 여도 expires_at 이 지나면 권한 없음).
create table if not exists public.hosted_tournament_staff (
    id                uuid        primary key default gen_random_uuid(),
    tournament_id     uuid        not null references public.hosted_tournaments(id) on delete cascade,
    user_id           uuid        not null references auth.users(id) on delete cascade,
    -- 현장 운영자가 요청 때 직접 적는 이름(본부가 누구인지 알아보는 용도). 개인정보(전화 · 이메일)는 받지 않는다.
    display_name      text        not null check (length(btrim(display_name)) between 1 and 20),
    -- 요청 시점의 카카오 닉네임(profiles.nickname) 스냅샷 — 본부 확인 보조.
    profile_nickname  text,
    status            text        not null default 'pending'
                                  check (status in ('pending', 'approved', 'revoked')),
    requested_at      timestamptz not null default now(),
    approved_at       timestamptz,
    approved_by       uuid,
    expires_at        timestamptz,
    revoked_at        timestamptz,
    revoked_by        uuid,
    -- 본인 확인 코드(4자리) — 요청할 때마다 새로 만든다. 현장 운영자 화면과 본부 승인 화면에 같은 숫자가 보이면
    -- 본부가 '눈앞의 그 사람이 이 요청을 보낸 사람' 임을 확인할 수 있다. 권한 판정에는 쓰지 않는다.
    verify_code       text        check (verify_code ~ '^[0-9]{4}$'),
    -- 회수(거절 포함) 횟수 — 다시 요청한 사람을 본부가 알아보도록 남긴다(재요청해도 줄지 않는다).
    revoke_count      integer     not null default 0,
    updated_at        timestamptz not null default now(),
    constraint hosted_tstaff_unique unique (tournament_id, user_id),
    constraint hosted_tstaff_approved_has_expiry check (status <> 'approved' or expires_at is not null)
);

comment on table public.hosted_tournament_staff is
    '대회 현장 현장 운영자 허용 목록. profiles.role 과 무관(역할을 바꾸지 않는다). RPC 로만 읽고 쓴다.';

create index if not exists hosted_tstaff_tid_idx on public.hosted_tournament_staff (tournament_id, status);

alter table public.hosted_tournament_staff enable row level security;
revoke all on table public.hosted_tournament_staff from public, anon, authenticated;
-- 정책 없음 → 클라이언트 직접 접근 경로 없음.


-- ── 2. 내부 helper ──────────────────────────────────────────────────────────
-- 2-1) 지금 로그인한 사용자가 이 대회의 '유효한' 현장 운영자인가.
--      승인 + 만료 전 + 대회가 종료/취소가 아님. CEO/ADMIN 여부는 여기서 보지 않는다.
create or replace function public.hosted_tournament_is_staff_scorer(p_tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select auth.uid() is not null and exists (
        select 1
          from public.hosted_tournament_staff s
          join public.hosted_tournaments h on h.id = s.tournament_id
         where s.tournament_id = p_tid
           and s.user_id = auth.uid()
           and s.status = 'approved'
           and s.expires_at > now()
           and h.status not in ('completed', 'cancelled')
    );
$$;
revoke execute on function public.hosted_tournament_is_staff_scorer(uuid) from public;
revoke execute on function public.hosted_tournament_is_staff_scorer(uuid) from anon;
revoke execute on function public.hosted_tournament_is_staff_scorer(uuid) from authenticated;

-- 2-2) 승인 기본 만료 — 대회일 다음날 자정(한국 시간) 이후까지. 대회 당일 운영 중 끊기지 않게
--      대회일 + 2일 00:00 KST 와 '지금 + 24시간' 중 늦은 쪽, 단 최대 14일.
create or replace function public.hosted_tournament_staff_default_expiry(p_tid uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select least(
               greatest(((h.event_date + 2)::timestamp at time zone 'Asia/Seoul'), now() + interval '24 hours'),
               now() + interval '14 days')
      from public.hosted_tournaments h where h.id = p_tid;
$$;
revoke execute on function public.hosted_tournament_staff_default_expiry(uuid) from public;
revoke execute on function public.hosted_tournament_staff_default_expiry(uuid) from anon;
revoke execute on function public.hosted_tournament_staff_default_expiry(uuid) from authenticated;

-- 2-3) 경기 write 전제조건 — '경기 시작(타이머) · 예선 완료 · 본선 완료' 전용.
--   · CEO/ADMIN : 기존 hosted_tournament_match_begin 을 그대로 호출해 결과를 그대로 돌려준다
--                 (같은 권한 판정 · 같은 락 · 같은 재조회 · 같은 reason — 동작 무회귀).
--   · 현장 운영자    : ① 락 전 빠른 거절(권한 없는 사용자는 대회 락을 잡지 못한다)
--                 ② 경기 락(hosted-tournament-matches:) — 관리자 경로와 같은 락
--                 ③ 락 이후 '전부' 재검증 — 경기 소속 · 대회 상태 · 본인 허용 행 · 만료 · version
--      ③ 의 대회 행 · 허용 행은 FOR SHARE 로 읽는다:
--        - 회수/승인(허용 행 UPDATE)이 먼저 진행 중이면 그 커밋을 기다렸다가 '커밋된 최신 값'으로 다시 판정한다.
--        - 이 함수가 먼저 읽었으면 회수는 이 경기 쓰기가 커밋될 때까지 기다린다(회수 응답 = 진행 중 쓰기 종료 이후).
--        - 대회 종료/취소(대회 행 UPDATE)도 같은 방식으로 직렬화된다.
--      락 순서는 항상 '경기 락 → 대회 행 → 허용 행'. 허용 행을 쓰는 RPC(요청 · 승인 · 회수)는 경기 락을 잡지 않고,
--      경기 락을 잡은 채 대회 행을 쓰는 기존 RPC(generate_group_matches)는 이 함수와 경기 락에서 먼저 직렬화되므로
--      교착이 생기지 않는다.
--   ⚠ 현장 운영자는 예선 · 본선 모두 '경기 시작 · 점수 입력 · 완료' 를 할 수 있다(최종 권한 구조).
--     본선 완료의 승자 진출 · 다음 경기 생성 · 대진 완료는 complete_knockout_match 본문이 그대로 처리한다.
--   ⚠ 코트 투입 · 호명 · 취소 · 복구 · 점수 정정(amend_*) · 대진 생성은 이 함수를 쓰지 않는다
--     (기존 hosted_tournament_match_begin = CEO/ADMIN 만).
--   ⚠ 클라이언트가 직접 부를 수 없다(내부 전용).
create or replace function public.hosted_tournament_match_begin_score(
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
    v_tid2    uuid;
    v_status  text;
    v_version integer;
begin
    -- CEO/ADMIN — 기존 관문 그대로.
    if public.can_manage_tournaments() then
        return public.hosted_tournament_match_begin(p_match_id, p_expected_version);
    end if;

    -- ① 락 전 빠른 거절. 경기가 없거나 현장 운영자가 아니면 존재 여부를 드러내지 않고 권한 오류.
    select tournament_id into v_tid
      from public.hosted_tournament_matches where id = p_match_id;
    if v_tid is null or not public.hosted_tournament_is_staff_scorer(v_tid) then
        raise exception 'not authorized: tournament staff or CEO/ADMIN required' using errcode = '42501';
    end if;

    -- ② 경기 락(관리자 경로와 같은 네임스페이스).
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-matches:' || v_tid::text));

    -- ③ 락 이후 재조회 · 재검증 — 락 전 값은 신뢰하지 않는다.
    select tournament_id, status, version into v_tid2, v_status, v_version
      from public.hosted_tournament_matches where id = p_match_id;
    if v_tid2 is distinct from v_tid then
        raise exception 'not authorized: tournament staff or CEO/ADMIN required' using errcode = '42501';
    end if;

    perform 1 from public.hosted_tournaments h
     where h.id = v_tid and h.status not in ('completed', 'cancelled')
       for share;
    if not found then
        raise exception 'not authorized: tournament closed' using errcode = '42501';
    end if;

    perform 1 from public.hosted_tournament_staff s
     where s.tournament_id = v_tid
       and s.user_id = auth.uid()
       and s.status = 'approved'
       and s.expires_at > clock_timestamp()
       for share;
    if not found then
        raise exception 'not authorized: tournament staff or CEO/ADMIN required' using errcode = '42501';
    end if;

    if p_expected_version is not null and p_expected_version <> v_version then
        return jsonb_build_object('ok', false, 'reason', 'version_conflict',
                                  'version', v_version, 'expected', p_expected_version);
    end if;

    return jsonb_build_object('ok', true, 'tournamentId', v_tid,
                              'status', v_status, 'version', v_version);
end;
$$;
revoke execute on function public.hosted_tournament_match_begin_score(uuid,integer) from public;
revoke execute on function public.hosted_tournament_match_begin_score(uuid,integer) from anon;
revoke execute on function public.hosted_tournament_match_begin_score(uuid,integer) from authenticated;


-- ── 3. 기존 RPC 3개 — 권한 진입점만 바꾼다(본문의 나머지 글자는 운영 정의와 같다) ─────────
--   start_hosted_match_timer : 경기 시작(타이머) — 예선 · 본선
--   complete_match           : 예선 완료(본선은 원래부터 거절: knockout_requires_bracket_rpc)
--   complete_knockout_match  : 본선 완료 — 승자 진출 · 다음 경기 생성 · 대진 완료 · 감사 로그는 본문 그대로
--   ⚠ 바뀐 것은 'public.hosted_tournament_match_begin(' → 'public.hosted_tournament_match_begin_score(' 한 곳뿐이다.
--     검증: md5(replace(prosrc, '_match_begin_score(', '_match_begin(')) = 적용 전 운영 md5
--       start_hosted_match_timer 102e2c5d2dbed3911fb33e32fe2876bc
--       complete_match           0d33b70ee0dd0f0e04f3a921ac58727b
--       complete_knockout_match  ca42ef267edd9469ae65b9aa226b0615
--   ⚠ CEO/ADMIN 에게는 동작이 같다(같은 관문 · 같은 락 · 같은 reason).
--   ⚠ 코트 투입(start_match) · 호명 · 취소 · 복구 · 점수 정정(amend_*) · 대진 생성은 그대로(CEO/ADMIN 만).

create or replace function public.start_hosted_match_timer(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_begin   jsonb;
    v_tid     uuid;
    v_status  text;
    v_started timestamptz;
    v_play    timestamptz;
    v_no      integer;
begin
    v_begin := public.hosted_tournament_match_begin_score(p_match_id, null);   -- 권한(42501) · 락 · 존재 확인
    if not (v_begin ->> 'ok')::boolean then return v_begin; end if;
    v_tid    := (v_begin ->> 'tournamentId')::uuid;
    v_status := v_begin ->> 'status';

    -- 코트에 투입된(playing) 경기만 시작할 수 있다. 시작 전 완료 · 취소 경기는 거절.
    if v_status <> 'playing' then
        return jsonb_build_object('ok', false, 'reason', 'not_playing', 'status', v_status);
    end if;

    select started_at, play_started_at, match_no into v_started, v_play, v_no
      from public.hosted_tournament_matches where id = p_match_id;

    -- 이미 이번 투입에서 시작했다 → 덮어쓰지 않고 기존 값(멱등).
    if v_play is not null and v_started is not null and v_play >= v_started then
        return jsonb_build_object('ok', true, 'reason', 'already_started',
                                  'playStartedAt', v_play, 'serverNow', now());
    end if;

    update public.hosted_tournament_matches
       set play_started_at = clock_timestamp(), updated_at = now()   -- ⚠ version 은 올리지 않는다(원칙 5)
     where id = p_match_id and status = 'playing'
    returning play_started_at into v_play;

    if v_play is null then                                   -- 락 안이라 사실상 오지 않지만 방어
        return jsonb_build_object('ok', false, 'reason', 'already_changed');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'match', p_match_id, 'match_timer_started', null,
        jsonb_build_object('matchNo', v_no, 'playStartedAt', v_play), null);

    return jsonb_build_object('ok', true, 'reason', 'timer_started',
                              'playStartedAt', v_play, 'serverNow', now());
end;
$$;

revoke execute on function public.start_hosted_match_timer(uuid) from public;
revoke execute on function public.start_hosted_match_timer(uuid) from anon;
grant  execute on function public.start_hosted_match_timer(uuid) to authenticated;

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

    v_begin := public.hosted_tournament_match_begin_score(p_match_id, p_expected_version);
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

    v_begin := public.hosted_tournament_match_begin_score(p_match_id, p_expected_version);
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


-- ── 4. 현장 운영자 본인용 RPC ─────────────────────────────────────────────────────
-- 4-1) 권한 요청 — 로그인한 누구나. 승인 전에는 아무 권한도 없다(목록에 pending 으로만 남는다).
create or replace function public.request_tournament_staff(p_slug text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid     uuid := auth.uid();
    v_name    text := btrim(coalesce(p_display_name, ''));
    v_tid     uuid;
    v_tstatus text;
    v_nick    text;
    v_row     public.hosted_tournament_staff%rowtype;
    v_pending integer;
begin
    if v_uid is null then
        raise exception 'not authorized: login required' using errcode = '42501';
    end if;
    if length(v_name) < 1 or length(v_name) > 20 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_display_name');
    end if;

    select id, status into v_tid, v_tstatus from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if v_tstatus in ('completed', 'cancelled') then
        return jsonb_build_object('ok', false, 'reason', 'tournament_closed');
    end if;
    if public.can_manage_tournaments() then
        return jsonb_build_object('ok', true, 'status', 'manager');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-staff:' || v_tid::text));

    select nickname into v_nick from public.profiles where id = v_uid;
    select * into v_row from public.hosted_tournament_staff
     where tournament_id = v_tid and user_id = v_uid;

    if not found then
        select count(*) into v_pending from public.hosted_tournament_staff
         where tournament_id = v_tid and status = 'pending';
        if v_pending >= 30 then
            return jsonb_build_object('ok', false, 'reason', 'too_many_requests');
        end if;
        insert into public.hosted_tournament_staff (tournament_id, user_id, display_name, profile_nickname, verify_code)
        values (v_tid, v_uid, v_name, v_nick, lpad(floor(random() * 10000)::int::text, 4, '0'));
        perform public.hosted_tournament_log_event(
            v_tid, 'tournament', v_tid, 'staff_request', null,
            jsonb_build_object('staffUserId', v_uid, 'displayName', v_name), null);
        return jsonb_build_object('ok', true, 'status', 'pending');
    end if;

    if v_row.status = 'approved' and v_row.expires_at > now() then
        return jsonb_build_object('ok', true, 'status', 'approved', 'expiresAt', v_row.expires_at);
    end if;

    if v_row.status = 'pending' then
        update public.hosted_tournament_staff
           set display_name = v_name, profile_nickname = v_nick, updated_at = now()
         where id = v_row.id;
        return jsonb_build_object('ok', true, 'status', 'pending');
    end if;

    -- 회수됐거나 만료된 승인 → 다시 요청. 기존 승인은 되살리지 않는다(승인 정보를 지우고 pending 으로).
    -- 본부가 다시 확인하도록 확인 코드를 새로 만든다. revoke_count 는 그대로 둔다(이력 표시).
    update public.hosted_tournament_staff
       set status = 'pending', display_name = v_name, profile_nickname = v_nick,
           requested_at = now(), approved_at = null, approved_by = null, expires_at = null,
           revoked_at = null, revoked_by = null,
           verify_code = lpad(floor(random() * 10000)::int::text, 4, '0'), updated_at = now()
     where id = v_row.id;
    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'staff_request', jsonb_build_object('status', v_row.status),
        jsonb_build_object('staffUserId', v_uid, 'displayName', v_name), null);
    return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;
revoke execute on function public.request_tournament_staff(text,text) from public;
revoke execute on function public.request_tournament_staff(text,text) from anon;
grant  execute on function public.request_tournament_staff(text,text) to authenticated;

-- 4-2) 내 상태 — none | pending | approved | expired | revoked | closed | manager
create or replace function public.get_my_tournament_staff(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid     uuid := auth.uid();
    v_tid     uuid;
    v_title   text;
    v_tstatus text;
    v_row     public.hosted_tournament_staff%rowtype;
    v_status  text;
begin
    if v_uid is null then
        raise exception 'not authorized: login required' using errcode = '42501';
    end if;
    select id, title, status into v_tid, v_title, v_tstatus
      from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    if public.can_manage_tournaments() then
        v_status := 'manager';
    else
        select * into v_row from public.hosted_tournament_staff
         where tournament_id = v_tid and user_id = v_uid;
        v_status := case
            when not found then 'none'
            when v_tstatus in ('completed', 'cancelled') then 'closed'
            when v_row.status = 'approved' and v_row.expires_at > now() then 'approved'
            when v_row.status = 'approved' then 'expired'
            else v_row.status end;
    end if;

    return jsonb_build_object(
        'ok', true, 'slug', p_slug, 'title', v_title, 'status', v_status,
        'displayName', v_row.display_name,
        'verifyCode', case when v_status = 'pending' then v_row.verify_code end,
        'expiresAt', case when v_status = 'approved' then v_row.expires_at end,
        'serverNow', now());
end;
$$;
revoke execute on function public.get_my_tournament_staff(text) from public;
revoke execute on function public.get_my_tournament_staff(text) from anon;
grant  execute on function public.get_my_tournament_staff(text) to authenticated;

-- 4-3) 현장 운영자 경기판 — 유효한 현장 운영자 또는 CEO/ADMIN 만. 그 밖에는 null.
--   ⚠ 개인정보 없음(팀 스냅샷 이름만). 취소 경기는 내보내지 않는다.
--   ⚠ playStartedAt 은 관리자 보드와 같은 규칙으로 유효한 값만 준다.
create or replace function public.get_staff_match_board(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_title   text;
    v_tstatus text;
    v_role    text;
    v_exp     timestamptz;
    v_matches jsonb;
    v_courts  jsonb;
begin
    select id, title, status into v_tid, v_title, v_tstatus
      from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

    if public.can_manage_tournaments() then
        v_role := 'manager';
    elsif public.hosted_tournament_is_staff_scorer(v_tid) then
        v_role := 'staff';
        select expires_at into v_exp from public.hosted_tournament_staff
         where tournament_id = v_tid and user_id = auth.uid();
    else
        return null;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'matchId',    m.id,
               'matchNo',    m.match_no,
               'stage',      m.stage,
               'groupNo',    g.group_no,
               'groupType',  g.group_type,
               'status',     m.status,
               'courtNo',    c.court_no,
               'version',    m.version,
               'score1',     m.score1,
               'score2',     m.score2,
               'startedAt',  m.started_at,
               'playStartedAt', case when m.status in ('playing', 'completed')
                                      and m.play_started_at is not null
                                      and m.started_at is not null
                                      and m.play_started_at >= m.started_at
                                      and (m.completed_at is null or m.completed_at >= m.play_started_at)
                                     then m.play_started_at end,
               'completedAt', m.completed_at,
               'team1', jsonb_build_object('teamNo', t1.team_no,
                          'player1Name', t1.player1_name, 'player2Name', t1.player2_name),
               'team2', jsonb_build_object('teamNo', t2.team_no,
                          'player1Name', t2.player1_name, 'player2Name', t2.player2_name)
           ) order by m.match_no), '[]'::jsonb)
      into v_matches
      from public.hosted_tournament_matches m
      join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      join public.hosted_tournament_teams t2 on t2.id = m.team2_id
      left join public.hosted_tournament_groups g on g.id = m.group_id
      left join public.hosted_tournament_courts c on c.id = m.court_id
     where m.tournament_id = v_tid and m.status <> 'cancelled';

    select coalesce(jsonb_agg(jsonb_build_object(
               'courtNo', c.court_no, 'displayName', c.display_name, 'status', c.status
           ) order by c.display_order, c.court_no), '[]'::jsonb)
      into v_courts
      from public.hosted_tournament_courts c where c.tournament_id = v_tid;

    return jsonb_build_object(
        'slug', p_slug, 'title', v_title, 'tournamentStatus', v_tstatus,
        'role', v_role, 'expiresAt', v_exp,
        'matches', v_matches, 'courts', v_courts, 'serverNow', now());
end;
$$;
revoke execute on function public.get_staff_match_board(text) from public;
revoke execute on function public.get_staff_match_board(text) from anon;
grant  execute on function public.get_staff_match_board(text) to authenticated;


-- ── 5. 본부(CEO/ADMIN) RPC ───────────────────────────────────────────────────
-- 5-1) 목록 — 권한 없음 · 대회 없음 = null.
create or replace function public.get_admin_tournament_staff(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_tst  text;
    v_list jsonb;
begin
    if not public.can_manage_tournaments() then return null; end if;
    select id, status into v_tid, v_tst from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'userId',      s.user_id,
               'displayName', s.display_name,
               'nickname',    s.profile_nickname,
               'status',      case
                                when s.status = 'approved' and v_tst in ('completed', 'cancelled') then 'closed'
                                when s.status = 'approved' and s.expires_at <= now() then 'expired'
                                else s.status end,
               'requestedAt', s.requested_at,
               'approvedAt',  s.approved_at,
               'expiresAt',   s.expires_at,
               'revokedAt',   s.revoked_at,
               'revokeCount', s.revoke_count,
               -- 확인 코드는 승인 대기 행에만 보여 준다(승인 때 현장 운영자 화면의 숫자와 대조).
               'verifyCode',  case when s.status = 'pending' then s.verify_code end
           ) order by case s.status when 'pending' then 0 when 'approved' then 1 else 2 end,
                      s.requested_at desc), '[]'::jsonb)
      into v_list
      from public.hosted_tournament_staff s where s.tournament_id = v_tid;

    return jsonb_build_object('slug', p_slug, 'staff', v_list,
        'defaultExpiresAt', public.hosted_tournament_staff_default_expiry(v_tid),
        'serverNow', now());
end;
$$;
revoke execute on function public.get_admin_tournament_staff(text) from public;
revoke execute on function public.get_admin_tournament_staff(text) from anon;
grant  execute on function public.get_admin_tournament_staff(text) to authenticated;

-- 5-2) 승인(또는 만료 연장) — 요청한 사용자만 승인할 수 있다(임의 사용자 id 로 권한을 만들지 않는다).
--   p_expires_at = null 이면 기본 만료. 지정하면 지금+10분 ~ 지금+14일.
--   ⚠ 승인 대기(pending) 행은 확인 코드가 맞아야 승인된다 — 본부가 본 요청과 지금 요청이 같은지 서버가 확인한다
--     (본부 화면을 본 뒤 현장 운영자가 다시 요청해 코드가 바뀌었으면 verify_code_mismatch).
--   ⚠ 회수(거절)된 행은 바로 승인할 수 없다 — 현장 운영자가 다시 요청해 새 코드를 받아야 한다(staff_not_pending).
--   ⚠ 승인 중(만료 포함) 행은 코드 없이 만료만 다시 정한다(같은 사람의 연장).
create or replace function public.approve_tournament_staff(
    p_slug        text,
    p_user_id     uuid,
    p_expires_at  timestamptz default null,
    p_verify_code text        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_tst text;
    v_exp timestamptz;
    v_row public.hosted_tournament_staff%rowtype;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id, status into v_tid, v_tst from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if v_tst in ('completed', 'cancelled') then
        return jsonb_build_object('ok', false, 'reason', 'tournament_closed');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-staff:' || v_tid::text));

    select * into v_row from public.hosted_tournament_staff
     where tournament_id = v_tid and user_id = p_user_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'staff_not_found');
    end if;
    if v_row.status = 'revoked' then
        return jsonb_build_object('ok', false, 'reason', 'staff_not_pending');
    end if;
    if v_row.status = 'pending' and (p_verify_code is null or v_row.verify_code is null
                                     or btrim(p_verify_code) <> v_row.verify_code) then
        return jsonb_build_object('ok', false, 'reason', 'verify_code_mismatch');
    end if;

    if p_expires_at is null then
        v_exp := public.hosted_tournament_staff_default_expiry(v_tid);
    elsif p_expires_at < now() + interval '10 minutes' or p_expires_at > now() + interval '14 days' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_expiry');
    else
        v_exp := p_expires_at;
    end if;

    update public.hosted_tournament_staff
       set status = 'approved', approved_at = now(), approved_by = auth.uid(), expires_at = v_exp,
           revoked_at = null, revoked_by = null, updated_at = now()
     where id = v_row.id;

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'staff_approve', jsonb_build_object('status', v_row.status),
        jsonb_build_object('staffUserId', p_user_id, 'displayName', v_row.display_name, 'expiresAt', v_exp), null);

    return jsonb_build_object('ok', true, 'status', 'approved', 'expiresAt', v_exp);
end;
$$;
revoke execute on function public.approve_tournament_staff(text,uuid,timestamptz,text) from public;
revoke execute on function public.approve_tournament_staff(text,uuid,timestamptz,text) from anon;
grant  execute on function public.approve_tournament_staff(text,uuid,timestamptz,text) to authenticated;

-- 5-3) 회수(승인 취소 · 요청 거절) — 즉시 효력. 다시 쓰려면 현장 운영자가 다시 요청하고 본부가 다시 승인한다.
create or replace function public.revoke_tournament_staff(p_slug text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_row public.hosted_tournament_staff%rowtype;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-staff:' || v_tid::text));

    select * into v_row from public.hosted_tournament_staff
     where tournament_id = v_tid and user_id = p_user_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'staff_not_found');
    end if;
    if v_row.status = 'revoked' then
        return jsonb_build_object('ok', true, 'status', 'revoked', 'changed', false);
    end if;

    update public.hosted_tournament_staff
       set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
           revoke_count = revoke_count + 1, updated_at = now()
     where id = v_row.id;

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'staff_revoke', jsonb_build_object('status', v_row.status),
        jsonb_build_object('staffUserId', p_user_id, 'displayName', v_row.display_name), null);

    return jsonb_build_object('ok', true, 'status', 'revoked', 'changed', true);
end;
$$;
revoke execute on function public.revoke_tournament_staff(text,uuid) from public;
revoke execute on function public.revoke_tournament_staff(text,uuid) from anon;
grant  execute on function public.revoke_tournament_staff(text,uuid) to authenticated;


notify pgrst, 'reload schema';

commit;
