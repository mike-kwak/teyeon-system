-- ============================================================================
--  2026 TEYEON OPEN — Fixture(허수 데이터) 인프라 (Batch 1 / 4of4)
--
--  적용 순서: events → teams → courts → **fixture**
--
--  목적
--    실제 참가팀이 확정되기 전에 Tournament 플랫폼 전체를 개발·QA 하기 위한
--    격리된 가짜 대회를 만든다. 48/50/51/54/57/60팀 시나리오를 준비한다.
--
--  ⚠⚠ 가장 중요한 것: 운영 대회(2026-teyeon-open)를 절대 건드리지 않는다.
--    아래 3중 가드를 '모두' 통과해야만 시딩이 실행된다.
--      ① slug 가 'fixture-' 로 시작
--      ② hosted_tournaments.status = 'draft'
--      ③ 해당 대회의 hosted_tournament_registrations 가 0건
--    2026-teyeon-open 은 ①②③ 전부에서 걸린다(slug 불일치 / registration_open / 접수 20건).
--
--  ⚠ fixture 팀은 hosted_tournament_teams 에 source='fixture', registration_id=NULL 로
--    '직접' 만든다. 접수 테이블에 가짜 행을 만들지 않는다.
--  ⚠ status='draft' 이므로 get_public_tournament 가 아무것도 반환하지 않는다
--    → fixture 가 공개 화면에 새어 나갈 수 없다(이미 검증된 차단 경로 재사용).
-- ============================================================================

begin;

-- ── 내부 helper: 3중 가드 ────────────────────────────────────────────────────
--   시딩/초기화 RPC 가 공통으로 쓴다. 통과하면 tournament_id, 아니면 예외 대신 NULL 과 사유.
create or replace function public.hosted_tournament_fixture_guard(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_status text;
    v_regs   integer;
begin
    -- ① slug 규칙
    if p_slug is null or p_slug not like 'fixture-%' then
        return jsonb_build_object('ok', false, 'reason', 'not_a_fixture_slug');
    end if;

    select id, status into v_tid, v_status
      from public.hosted_tournaments where slug = p_slug;

    -- 아직 없는 fixture 대회는 생성 대상이므로 통과시킨다(tournamentId = null).
    if v_tid is null then
        return jsonb_build_object('ok', true, 'tournamentId', null);
    end if;

    -- ② draft 만
    if v_status is distinct from 'draft' then
        return jsonb_build_object('ok', false, 'reason', 'not_draft', 'status', v_status);
    end if;

    -- ③ 실제 접수가 1건이라도 있으면 차단
    select count(*) into v_regs
      from public.hosted_tournament_registrations where tournament_id = v_tid;
    if v_regs > 0 then
        return jsonb_build_object('ok', false, 'reason', 'has_real_registrations',
                                  'registrationCount', v_regs);
    end if;

    return jsonb_build_object('ok', true, 'tournamentId', v_tid);
end;
$$;

revoke execute on function public.hosted_tournament_fixture_guard(text) from public;
revoke execute on function public.hosted_tournament_fixture_guard(text) from anon;
grant  execute on function public.hosted_tournament_fixture_guard(text) to authenticated;


-- ── RPC: fixture 대회 생성 + 팀 시딩 ─────────────────────────────────────────
--   p_reset = true 면 기존 fixture 팀을 지우고 다시 만든다(운영 팀은 애초에 여기 없다).
--   p_court_count > 0 이면 코트도 함께 만든다(Control Center QA 용).
create or replace function public.seed_fixture_tournament(
    p_slug        text,
    p_title       text,
    p_team_count  integer,
    p_reset       boolean default false,
    p_court_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_guard    jsonb;
    v_tid      uuid;
    v_existing integer := 0;
    v_created  integer := 0;
    v_courts   integer := 0;
    v_clubs    text[]  := array['테스트클럽 가', '테스트클럽 나', '테스트클럽 다',
                                '테스트클럽 라', '테스트클럽 마'];
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    if p_team_count is null or p_team_count < 1 or p_team_count > 200 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_team_count');
    end if;
    if p_court_count is null or p_court_count < 0 or p_court_count > 30 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_court_count');
    end if;

    -- ⚠ 3중 가드. 여기서 막히면 아무것도 쓰지 않는다.
    v_guard := public.hosted_tournament_fixture_guard(p_slug);
    if not (v_guard ->> 'ok')::boolean then
        return v_guard;
    end if;
    v_tid := nullif(v_guard ->> 'tournamentId', '')::uuid;

    -- 1) fixture 대회가 없으면 draft 로 생성.
    if v_tid is null then
        insert into public.hosted_tournaments (
            slug, title, subtitle, status,
            event_date, registration_close_at,
            venue_name, organizer_name,
            entry_fee, target_capacity, max_capacity, registration_no_prefix
        ) values (
            p_slug,
            coalesce(nullif(btrim(p_title), ''), p_slug),
            'FIXTURE — 개발/QA 전용. 실제 대회가 아닙니다.',
            'draft',
            current_date + 30,
            now() + interval '20 days',
            'FIXTURE VENUE', 'FIXTURE',
            0, p_team_count, p_team_count, 'FX'
        )
        returning id into v_tid;

        perform public.hosted_tournament_log_event(
            v_tid, 'tournament', v_tid, 'create_fixture', null,
            jsonb_build_object('slug', p_slug, 'teamCount', p_team_count), null);
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-teams:' || v_tid::text));

    select count(*) into v_existing
      from public.hosted_tournament_teams where tournament_id = v_tid;

    if v_existing > 0 and not p_reset then
        return jsonb_build_object('ok', false, 'reason', 'already_seeded',
                                  'tournamentId', v_tid, 'existingTeams', v_existing);
    end if;

    -- 2) reset — fixture 팀만 지운다. source 조건을 반드시 건다.
    if p_reset then
        delete from public.hosted_tournament_teams
         where tournament_id = v_tid and source = 'fixture';
    end if;

    -- 3) 팀 생성. 이름은 한눈에 가짜임을 알 수 있게 짧게 만든다(브래킷 렌더 폭 고려).
    --    7의 배수 팀은 클럽을 NULL 로 둬서 '클럽 미입력' 표시 경로도 함께 검증한다.
    insert into public.hosted_tournament_teams
        (tournament_id, team_no, player1_name, player2_name,
         player1_club_name, player2_club_name, source)
    select
        v_tid,
        i,
        'F' || lpad(i::text, 2, '0') || 'A',
        'F' || lpad(i::text, 2, '0') || 'B',
        case when i % 7 = 0 then null else v_clubs[1 + (i % 5)] end,
        case when i % 7 = 0 then null else v_clubs[1 + ((i + 2) % 5)] end,
        'fixture'
      from generate_series(1, p_team_count) as i;

    get diagnostics v_created = row_count;

    -- 4) 코트(선택)
    if p_court_count > 0 then
        insert into public.hosted_tournament_courts
            (tournament_id, court_no, display_order, status)
        select v_tid, c, c, 'active'
          from generate_series(1, p_court_count) as c
         where not exists (
               select 1 from public.hosted_tournament_courts
                where tournament_id = v_tid and court_no = c);
        get diagnostics v_courts = row_count;
    end if;

    -- 대회 정원 표기를 팀 수에 맞춰 둔다(fixture 전용 — 운영 대회에는 해당 없음).
    update public.hosted_tournaments
       set target_capacity = greatest(p_team_count, 1),
           max_capacity    = greatest(p_team_count, 1),
           updated_at      = now()
     where id = v_tid;

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'seed_fixture', null,
        jsonb_build_object('teams', v_created, 'courts', v_courts, 'reset', p_reset), p_slug);

    return jsonb_build_object(
        'ok', true, 'tournamentId', v_tid, 'slug', p_slug,
        'teamsCreated', v_created, 'courtsCreated', v_courts, 'reset', p_reset
    );
end;
$$;

revoke execute on function public.seed_fixture_tournament(text,text,integer,boolean,integer) from public;
revoke execute on function public.seed_fixture_tournament(text,text,integer,boolean,integer) from anon;
grant  execute on function public.seed_fixture_tournament(text,text,integer,boolean,integer) to authenticated;


-- ── RPC: fixture 목록 ────────────────────────────────────────────────────────
create or replace function public.get_admin_fixture_tournaments()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case when not public.can_manage_tournaments() then null else
        coalesce((
            select jsonb_agg(jsonb_build_object(
                       'slug',       h.slug,
                       'title',      h.title,
                       'status',     h.status,
                       'teamCount',  (select count(*) from public.hosted_tournament_teams t
                                       where t.tournament_id = h.id),
                       'courtCount', (select count(*) from public.hosted_tournament_courts c
                                       where c.tournament_id = h.id)
                   ) order by h.slug)
              from public.hosted_tournaments h
             where h.slug like 'fixture-%'
        ), '[]'::jsonb)
    end;
$$;

revoke execute on function public.get_admin_fixture_tournaments() from public;
revoke execute on function public.get_admin_fixture_tournaments() from anon;
grant  execute on function public.get_admin_fixture_tournaments() to authenticated;

commit;


-- ============================================================================
--  [선택] fixture 6종 생성 — 위 migration 적용 후 '별도로' 실행한다.
--
--  ⚠ 아래는 데이터 생성이므로 migration 본문(트랜잭션)에 넣지 않았다.
--    운영자가 내용을 확인하고 원할 때 실행한다. 실행 주체는 로그인한 CEO/ADMIN 이어야 한다
--    (can_manage_tournaments() 가 auth.uid() 를 보므로 SQL Editor 실행 시 세션 계정 기준).
--
--  48 → 16조 × 3            · 진출 32 (플레이인/BYE 0 인 정상 경로)
--  50 → 16조 × 3 + 나머지 2 · 진출 34 (순위결정전 경로 — 3의 배수가 아닌 유일한 케이스)
--  51 → 17조 × 3            · 진출 34 (50팀과 같은 진출 수를 '다른 경로'로)
--  54 → 18조 × 3            · 진출 36
--  57 → 19조 × 3            · 진출 38
--  60 → 20조 × 3            · 진출 40 (최대 규모)
-- ============================================================================
-- select public.seed_fixture_tournament('fixture-open-48', 'FIXTURE 48팀', 48, false, 10);
-- select public.seed_fixture_tournament('fixture-open-50', 'FIXTURE 50팀', 50, false, 10);
-- select public.seed_fixture_tournament('fixture-open-51', 'FIXTURE 51팀', 51, false, 10);
-- select public.seed_fixture_tournament('fixture-open-54', 'FIXTURE 54팀', 54, false, 10);
-- select public.seed_fixture_tournament('fixture-open-57', 'FIXTURE 57팀', 57, false, 10);
-- select public.seed_fixture_tournament('fixture-open-60', 'FIXTURE 60팀', 60, false, 10);
--
--  가드 동작 확인(반드시 ok=false 여야 한다):
-- select public.hosted_tournament_fixture_guard('2026-teyeon-open');
--   → {"ok": false, "reason": "not_a_fixture_slug"}
