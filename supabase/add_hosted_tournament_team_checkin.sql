-- ============================================================================
--  2026 TEYEON OPEN — 현장 팀 체크인 (현장 운영 1단계)
--
--  적용 순서: (기존 체인 전부 적용된 뒤) → **team_checkin**
--    사전 점검: precheck_hosted_tournament_team_checkin_READONLY.sql
--    적용 후 점검: add_hosted_tournament_team_checkin_verify.sql (읽기 전용)
--    되돌리기: add_hosted_tournament_team_checkin_rollback.sql
--
--  무엇을 하는가
--    본부(CEO/ADMIN)가 복식 선수 2명의 도착을 직접 확인한 뒤 '팀 단위'로 체크인한다.
--    체크인 = 이 테이블에 행이 있음. 취소 = 행 삭제. 바꿀 때마다 기존 감사 로그에 남긴다.
--
--  ⚠ 별도 테이블로 둔다 — hosted_tournament_teams 에 컬럼을 더하지 않는다.
--    기존 팀 조회 · 조편성 지문(membership_fingerprint) · 경기 RPC 에 영향이 0 이다.
--  ⚠ 기존 경기 RPC(start_match · complete_* · 타이머 · 보드)를 일절 바꾸지 않는다.
--    미체크인 팀 코트 투입은 서버에서 막지 않는다(화면 경고만 — 당일 입력 실수로 진행이 멈추지 않게).
--  ⚠ 공개(anon) 경로 없음. 테이블은 RLS + 권한 회수로 직접 접근을 막고, RPC 2개만 연다.
--  ⚠ 개인정보 없음 — 팀 스냅샷(이름 · 클럽)만 돌려준다. registrations 를 join 하지 않는다.
--  ⚠ 락 네임스페이스는 팀 쓰기와 같은 'hosted-tournament-teams:' — 경기 락과 겹치지 않는다.
-- ============================================================================

begin;

-- ── 테이블 ──────────────────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_team_checkins (
    team_id        uuid        primary key,
    tournament_id  uuid        not null,
    checked_in_at  timestamptz not null default now(),
    checked_in_by  uuid,        -- auth.uid() 기록용(감사 로그에도 남는다). FK 를 걸지 않는다 — 계정 삭제와 무관하게 남긴다.

    -- 다른 대회 팀이 섞이는 사고를 막는다(teams 의 (tournament_id, id) unique 를 쓴다).
    -- 팀이 지워지면(fixture reset 등) 체크인도 함께 지워진다.
    constraint hosted_tcheckin_team_fk
        foreign key (tournament_id, team_id)
        references public.hosted_tournament_teams (tournament_id, id)
        on delete cascade
);

comment on table public.hosted_tournament_team_checkins is
    '현장 팀 체크인(행이 있으면 체크인). RPC(set_team_checkin)로만 쓴다. ⚠ 개인정보 미포함.';

create index if not exists hosted_tcheckin_tid_idx
    on public.hosted_tournament_team_checkins (tournament_id);

alter table public.hosted_tournament_team_checkins enable row level security;
revoke all on table public.hosted_tournament_team_checkins from public, anon, authenticated;
-- 정책 없음 → 클라이언트 직접 조회 · 쓰기 경로 없음. SECURITY DEFINER RPC 만 읽고 쓴다.


-- ── RPC 1: 체크인 현황 (Admin) ───────────────────────────────────────────────
--   권한 없음 · 대회 없음 = null. 팀 목록 + 체크인 시각 + 요약을 한 번에 준다.
--   ⚠ 요약의 total / checkedIn 은 active 팀만 센다(기권 팀은 따로 센다).
create or replace function public.get_admin_team_checkins(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid   uuid;
    v_teams jsonb;
begin
    if not public.can_manage_tournaments() then
        return null;
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'teamId',          t.id,
               'teamNo',          t.team_no,
               'player1Name',     t.player1_name,
               'player2Name',     t.player2_name,
               'player1ClubName', t.player1_club_name,
               'player2ClubName', t.player2_club_name,
               'clubName',        t.club_name,
               'status',          t.status,
               'checkedInAt',     c.checked_in_at
           ) order by t.team_no), '[]'::jsonb)
      into v_teams
      from public.hosted_tournament_teams t
      left join public.hosted_tournament_team_checkins c on c.team_id = t.id
     where t.tournament_id = v_tid;

    return jsonb_build_object(
        'slug',      p_slug,
        'teams',     v_teams,
        'total',     (select count(*) from public.hosted_tournament_teams
                       where tournament_id = v_tid and status = 'active'),
        'checkedIn', (select count(*) from public.hosted_tournament_teams t
                        join public.hosted_tournament_team_checkins c on c.team_id = t.id
                       where t.tournament_id = v_tid and t.status = 'active'),
        'withdrawn', (select count(*) from public.hosted_tournament_teams
                       where tournament_id = v_tid and status = 'withdrawn'),
        'serverNow', now()
    );
end;
$$;

revoke execute on function public.get_admin_team_checkins(text) from public;
revoke execute on function public.get_admin_team_checkins(text) from anon;
grant  execute on function public.get_admin_team_checkins(text) to authenticated;


-- ── RPC 2: 체크인 / 취소 (Admin) ─────────────────────────────────────────────
--   p_checked = true → 체크인, false → 취소. 같은 값을 다시 보내도 결과가 같다(멱등).
--   ⚠ p_slug 로 팀이 그 대회 소속인지 확인한다(다른 대회 팀 id 를 잘못 보내는 사고 차단).
--   ⚠ 기권(withdrawn) 팀은 체크인할 수 없다. 취소는 언제나 된다.
--   ⚠ 바뀐 경우에만 감사 로그를 남긴다(changed=false 면 기록 없음).
create or replace function public.set_team_checkin(
    p_slug    text,
    p_team_id uuid,
    p_checked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_team_no integer;
    v_status  text;
    v_at      timestamptz;
    v_rows    integer := 0;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_checked is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value');
    end if;

    select t.tournament_id into v_tid
      from public.hosted_tournament_teams t
      join public.hosted_tournaments h on h.id = t.tournament_id
     where t.id = p_team_id and h.slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-teams:' || v_tid::text));

    -- 락 이후 재조회
    select team_no, status into v_team_no, v_status
      from public.hosted_tournament_teams where id = p_team_id;
    if v_team_no is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_found');
    end if;

    if p_checked then
        if v_status <> 'active' then
            return jsonb_build_object('ok', false, 'reason', 'team_withdrawn', 'teamNo', v_team_no);
        end if;
        insert into public.hosted_tournament_team_checkins (team_id, tournament_id, checked_in_by)
        values (p_team_id, v_tid, auth.uid())
        on conflict (team_id) do nothing;
        get diagnostics v_rows = row_count;
    else
        delete from public.hosted_tournament_team_checkins where team_id = p_team_id;
        get diagnostics v_rows = row_count;
    end if;

    select checked_in_at into v_at
      from public.hosted_tournament_team_checkins where team_id = p_team_id;

    if v_rows > 0 then
        perform public.hosted_tournament_log_event(
            v_tid, 'team', p_team_id,
            case when p_checked then 'team_checkin' else 'team_checkin_cancel' end,
            null, jsonb_build_object('teamNo', v_team_no, 'checkedIn', p_checked), null);
    end if;

    return jsonb_build_object('ok', true, 'teamId', p_team_id, 'teamNo', v_team_no,
                              'checkedIn', v_at is not null, 'checkedInAt', v_at,
                              'changed', v_rows > 0);
end;
$$;

revoke execute on function public.set_team_checkin(text,uuid,boolean) from public;
revoke execute on function public.set_team_checkin(text,uuid,boolean) from anon;
grant  execute on function public.set_team_checkin(text,uuid,boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
