-- TEYEON OPEN 공식 결과 — 입상팀 선수별 소속 클럽(대회 당시 기록) 고정.
--
--   왜: 공식 결과 스냅샷(hosted_tournament_result_archives.snapshot)에는 선수 이름만 있고 소속 클럽이 없다.
--       회원 프로필 · 참가 신청의 클럽은 나중에 바뀔 수 있으므로, 결과 화면이 그 값을 그때그때 읽으면 과거 기록이 바뀌어 보인다.
--   무엇: ① 새 테이블 hosted_tournament_result_team_clubs — 회차(대회)별 입상팀 번호 → 선수1 · 선수2 소속(대회 당시 값) 한 줄씩.
--           한 번 저장하면 고치거나 지울 수 없다(트리거). 스냅샷과 같은 불변 기록이다.
--         ② 내부 함수 hosted_tournament_result_capture_clubs — 공식 스냅샷의 입상팀(우승 · 준우승 · 공동 3위)마다
--           경기 운영 팀(hosted_tournament_teams, 승격 시점 스냅샷)에서 '같은 대회 · 같은 팀 번호 · 같은 두 선수 이름' 인 행만 찾아
--           선수별 클럽(player1_club_name · player2_club_name)을 그대로 옮긴다. 이미 있으면 건너뛴다.
--           · 팀 단위 legacy club_name 을 쪼개거나 선수에게 나눠 붙이지 않는다. 선수별 값이 비어 있으면 비어 있는 채로 둔다.
--           · 이름이 스냅샷과 다르면(선수 교체 등) 그 팀은 저장하지 않는다 — 추정하지 않는다.
--         ③ 관리자 함수 capture_tournament_result_clubs(slug) — CEO/ADMIN 만. 다음 회차는 확정 뒤 이 함수로 고정한다.
--         ④ 공개 함수 get_public_tournament_result_clubs(slug) — 공개 승인된 회차만. 팀 번호 · 이름 · 선수별 클럽만 내보낸다
--           (클럽은 이미 공개 참가팀 화면에 공개된 값이다. 전화 · 입금 등은 없다).
--   ⚠ 공식 스냅샷 · 확정 · 정정 · 공개 상태 · 사진 · 경기 기록은 건드리지 않는다. 기존 함수는 바꾸지 않는다(새 함수만 추가).
--   ⚠ 여러 번 실행해도 같은 결과(멱등). 2026 제1회 값 채우기는 backfill_hosted_tournament_result_team_clubs_2026.sql 로 따로 한다.

begin;

do $guard$
begin
    if to_regclass('public.hosted_tournament_result_archives') is null or to_regclass('public.hosted_tournament_teams') is null then
        raise exception 'STOP: 결과 아카이브 · 팀 테이블이 없습니다.';
    end if;
end $guard$;

create table if not exists public.hosted_tournament_result_team_clubs (
    tournament_id  uuid        not null references public.hosted_tournament_result_archives(tournament_id) on delete restrict,
    team_no        integer     not null check (team_no > 0),
    -- 저장 당시 스냅샷의 두 선수 이름(대조용). 화면은 이름이 스냅샷과 같을 때만 클럽을 붙인다.
    player1_name   text        not null,
    player2_name   text        not null,
    player1_club   text        check (player1_club is null or length(btrim(player1_club)) between 1 and 40),
    player2_club   text        check (player2_club is null or length(btrim(player2_club)) between 1 and 40),
    source         text        not null default 'hosted_tournament_teams' check (source in ('hosted_tournament_teams')),
    captured_at    timestamptz not null default now(),
    captured_by    uuid,
    primary key (tournament_id, team_no)
);

comment on table public.hosted_tournament_result_team_clubs is
    '공식 결과 입상팀의 선수별 소속 클럽(대회 당시 값). 저장 후 수정 · 삭제 불가. 공식 스냅샷은 바꾸지 않는다.';

alter table public.hosted_tournament_result_team_clubs enable row level security;
revoke all on public.hosted_tournament_result_team_clubs from public, anon, authenticated;

-- 불변 보호 — 고치기 · 지우기 금지(되돌림 스크립트는 테이블 자체를 지운다).
create or replace function public.hosted_tournament_result_team_clubs_guard()
returns trigger
language plpgsql
as $$
begin
    raise exception 'official result team clubs are immutable' using errcode = '42501';
end;
$$;

drop trigger if exists hosted_tournament_result_team_clubs_guard on public.hosted_tournament_result_team_clubs;
create trigger hosted_tournament_result_team_clubs_guard
    before update or delete on public.hosted_tournament_result_team_clubs
    for each row execute function public.hosted_tournament_result_team_clubs_guard();

-- 내부: 입상팀 클럽 고정. 새로 저장한 팀 수 · 이름 불일치로 건너뛴 팀 번호를 돌려준다. 누구에게도 실행 권한을 주지 않는다.
create or replace function public.hosted_tournament_result_capture_clubs(p_tid uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_awards jsonb; v_team jsonb; v_t public.hosted_tournament_teams%rowtype;
    v_saved int := 0; v_skipped int[] := '{}'; v_n int;
begin
    select snapshot -> 'awards' into v_awards from public.hosted_tournament_result_archives where tournament_id = p_tid;
    if v_awards is null then return jsonb_build_object('ok', false, 'reason', 'archive_not_found'); end if;
    for v_team in
        select x from (select v_awards -> 'champion' -> 'team' x
                       union all select v_awards -> 'runnerUp' -> 'team'
                       union all select s -> 'team' from jsonb_array_elements(coalesce(v_awards -> 'semifinalists', '[]'::jsonb)) s) q
         where x ? 'teamNo'
    loop
        select * into v_t from public.hosted_tournament_teams
         where tournament_id = p_tid and team_no = (v_team ->> 'teamNo')::int
           and player1_name = v_team ->> 'player1Name' and player2_name = v_team ->> 'player2Name';
        if v_t.id is null then v_skipped := v_skipped || (v_team ->> 'teamNo')::int; continue; end if;
        insert into public.hosted_tournament_result_team_clubs
               (tournament_id, team_no, player1_name, player2_name, player1_club, player2_club, captured_by)
        values (p_tid, v_t.team_no, v_t.player1_name, v_t.player2_name,
                nullif(btrim(coalesce(v_t.player1_club_name, '')), ''), nullif(btrim(coalesce(v_t.player2_club_name, '')), ''), p_by)
        on conflict (tournament_id, team_no) do nothing;
        get diagnostics v_n = row_count; v_saved := v_saved + v_n;
        v_t := null;
    end loop;
    return jsonb_build_object('ok', true, 'saved', v_saved, 'skippedTeamNos', to_jsonb(v_skipped));
end;
$$;
revoke all on function public.hosted_tournament_result_capture_clubs(uuid, uuid) from public, anon, authenticated;

-- 관리자: 확정된 회차의 입상팀 클럽 고정(CEO/ADMIN). 이미 고정된 팀은 그대로 둔다.
create or replace function public.capture_tournament_result_clubs(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid; v_r jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); end if;
    v_r := public.hosted_tournament_result_capture_clubs(v_tid, auth.uid());
    if (v_r ->> 'saved')::int > 0 then
        perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_team_clubs_captured', null, v_r, null);
    end if;
    return v_r;
end;
$$;
revoke all on function public.capture_tournament_result_clubs(text) from public, anon;
grant execute on function public.capture_tournament_result_clubs(text) to authenticated;

-- 공개: 공개 승인된 회차의 입상팀 선수별 클럽. 공개 전이면 null.
create or replace function public.get_public_tournament_result_clubs(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case when a.tournament_id is null then null else
        coalesce((select jsonb_agg(jsonb_build_object('teamNo', c.team_no, 'player1Name', c.player1_name, 'player2Name', c.player2_name,
                                                      'player1Club', c.player1_club, 'player2Club', c.player2_club) order by c.team_no)
                    from public.hosted_tournament_result_team_clubs c where c.tournament_id = a.tournament_id), '[]'::jsonb)
    end
      from public.hosted_tournaments t
      left join public.hosted_tournament_result_archives a on a.tournament_id = t.id and a.is_public
     where t.slug = p_slug;
$$;
revoke all on function public.get_public_tournament_result_clubs(text) from public;
grant execute on function public.get_public_tournament_result_clubs(text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
