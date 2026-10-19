-- ============================================================================
--  2026 TEYEON OPEN — 예선 조별 일정 안내(출전 신고 · 예정 코트) 공개 보완
--
--  적용 순서: (public_draw · matches · team_checkin · staff_scoring 적용 뒤) → **group_schedule**
--    사전 점검: precheck_hosted_tournament_group_schedule_READONLY.sql
--    적용 후 점검: add_hosted_tournament_group_schedule_verify.sql (읽기 전용)
--    되돌리기: add_hosted_tournament_group_schedule_rollback.sql (새 객체만 삭제)
--
--  무엇을 하는가
--    · 대회 공통: 출전 신고 장소(기본 '대회 운영본부'), 첫 번째 조 · 두 번째 조의 신고 마감 · 시작 시각 · 시작 안내
--    · 조별: 경기이사가 직접 지정하는 '몇 번째 조(1 · 2)' 와 '예정 코트 번호'
--    · 참가자 공개: DRAW 공개 조건(대회 공개 · 조편성 locked · DRAW 공개 시각)을 만족할 때만 위 정보를 돌려준다.
--
--  ⚠ 기존 함수 · 테이블 정의를 하나도 바꾸지 않는다(create or replace 대상은 새 이름 4개뿐).
--    조편성 잠금 · 버전 · 경기 생성 · Control Center · 점수 입력 · 승자 진출 · 기존 공개 RPC 그대로.
--  ⚠ 일정 쓰기는 조편성 잠금 · 버전과 분리된다 — DRAW 공개 뒤에 고쳐도 공개 상태가 바뀌지 않는다.
--  ⚠ 시스템은 몇 번째 조인지 추정하지 않는다(조 번호 홀짝 · 순서 사용 안 함). 경기이사가 조마다 지정한다.
--  ⚠ 예정 코트는 안내용이다. 실제 코트는 본부가 경기를 투입할 때(start_match) 정해지고 경기별로 따로 공개된다.
--  ⚠ 개인정보 없음. 새 테이블은 RLS + 권한 회수(정책 없음) — RPC 로만 읽고 쓴다.
-- ============================================================================

begin;

-- ── 1. 대회 공통 일정 설정(대회당 1행) ──────────────────────────────────────────
create table if not exists public.hosted_tournament_schedule_settings (
    tournament_id              uuid        primary key references public.hosted_tournaments(id) on delete cascade,
    checkin_place              text        not null default '대회 운영본부'
                                           check (length(btrim(checkin_place)) between 1 and 40),
    -- 첫 번째 조 · 두 번째 조. 시각은 대회 당일 현지(한국) 시각. 비워 두면 화면이 그 줄을 표시하지 않는다.
    session1_checkin_deadline  time,
    session1_start_time        time,
    session1_start_note        text        check (session1_start_note is null or length(btrim(session1_start_note)) between 1 and 60),
    session2_checkin_deadline  time,
    session2_start_time        time,
    session2_start_note        text        check (session2_start_note is null or length(btrim(session2_start_note)) between 1 and 60),
    updated_at                 timestamptz not null default now(),
    updated_by                 uuid
);

comment on table public.hosted_tournament_schedule_settings is
    '대회 공통 출전 신고 안내(장소 · 첫 번째/두 번째 조 신고 마감 · 시작). 조편성 잠금과 무관. RPC 로만 읽고 쓴다.';

alter table public.hosted_tournament_schedule_settings enable row level security;
revoke all on table public.hosted_tournament_schedule_settings from public, anon, authenticated;

-- ── 2. 조별 일정(조당 1행) ──────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_group_schedules (
    group_id          uuid        primary key,
    tournament_id     uuid        not null,
    -- 1 = 첫 번째 조, 2 = 두 번째 조. NULL = 미정.
    session_no        smallint    check (session_no is null or session_no in (1, 2)),
    -- 예정 코트 번호(hosted_tournament_courts.court_no). NULL = 미정.
    planned_court_no  integer     check (planned_court_no is null or planned_court_no >= 1),
    updated_at        timestamptz not null default now(),
    updated_by        uuid,
    -- 조가 삭제되면 일정도 함께 사라진다. 다른 대회의 조를 가리킬 수 없다.
    constraint hosted_tgsched_group_fk foreign key (tournament_id, group_id)
        references public.hosted_tournament_groups (tournament_id, id) on delete cascade
);

create index if not exists hosted_tgsched_tid_idx on public.hosted_tournament_group_schedules (tournament_id);

comment on table public.hosted_tournament_group_schedules is
    '예선 조별 출전 순서(첫 번째/두 번째 조) · 예정 코트. 경기이사가 직접 지정. 조편성 잠금과 무관. RPC 로만 읽고 쓴다.';

alter table public.hosted_tournament_group_schedules enable row level security;
revoke all on table public.hosted_tournament_group_schedules from public, anon, authenticated;


-- ── 3. 본부 조회 ────────────────────────────────────────────────────────────────
--   CEO/ADMIN 만. 그 밖에는 null. 경고는 막지 않고 알려 주기만 한다.
create or replace function public.get_admin_group_schedule(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_dstatus  text;
    v_pub      timestamptz;
    v_settings jsonb;
    v_courts   jsonb;
    v_groups   jsonb;
    v_warn     jsonb;
begin
    if not public.can_manage_tournaments() then return null; end if;
    select id, preliminary_draw_status, preliminary_draw_published_at into v_tid, v_dstatus, v_pub
      from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;

    select jsonb_build_object(
               'checkinPlace',            s.checkin_place,
               'session1CheckinDeadline', to_char(s.session1_checkin_deadline, 'HH24:MI'),
               'session1StartTime',       to_char(s.session1_start_time, 'HH24:MI'),
               'session1StartNote',       s.session1_start_note,
               'session2CheckinDeadline', to_char(s.session2_checkin_deadline, 'HH24:MI'),
               'session2StartTime',       to_char(s.session2_start_time, 'HH24:MI'),
               'session2StartNote',       s.session2_start_note,
               'updatedAt',               s.updated_at)
      into v_settings
      from public.hosted_tournament_schedule_settings s where s.tournament_id = v_tid;

    select coalesce(jsonb_agg(jsonb_build_object(
               'courtNo', c.court_no, 'displayName', c.display_name, 'status', c.status)
               order by c.court_no), '[]'::jsonb)
      into v_courts
      from public.hosted_tournament_courts c where c.tournament_id = v_tid;

    select coalesce(jsonb_agg(jsonb_build_object(
               'groupNo',        g.group_no,
               'groupType',      g.group_type,
               'sessionNo',      gs.session_no,
               'plannedCourtNo', gs.planned_court_no,
               'teams', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                              'teamNo', t.team_no, 'player1Name', t.player1_name, 'player2Name', t.player2_name)
                              order by t.team_no), '[]'::jsonb)
                     from public.hosted_tournament_group_members gm
                     join public.hosted_tournament_teams t on t.id = gm.team_id
                    where gm.group_id = g.id))
               order by g.display_order, g.group_no), '[]'::jsonb)
      into v_groups
      from public.hosted_tournament_groups g
      left join public.hosted_tournament_group_schedules gs on gs.group_id = g.id
     where g.tournament_id = v_tid;

    -- 경고(막지 않음): 없는 코트 · 꺼진 코트 · 같은 코트 같은 순서 중복 · 한 코트 3개 조 이상 · 미지정 조
    select coalesce(jsonb_agg(w order by w ->> 'kind', (w ->> 'courtNo')::integer nulls last, (w ->> 'groupNo')::integer nulls last), '[]'::jsonb)
      into v_warn
      from (
        select jsonb_build_object('kind', 'court_unknown', 'courtNo', gs.planned_court_no, 'groupNo', g.group_no) as w
          from public.hosted_tournament_group_schedules gs
          join public.hosted_tournament_groups g on g.id = gs.group_id
         where gs.tournament_id = v_tid and gs.planned_court_no is not null
           and not exists (select 1 from public.hosted_tournament_courts c
                            where c.tournament_id = v_tid and c.court_no = gs.planned_court_no)
        union all
        select jsonb_build_object('kind', 'court_disabled', 'courtNo', gs.planned_court_no, 'groupNo', g.group_no)
          from public.hosted_tournament_group_schedules gs
          join public.hosted_tournament_groups g on g.id = gs.group_id
          join public.hosted_tournament_courts c on c.tournament_id = v_tid and c.court_no = gs.planned_court_no
         where gs.tournament_id = v_tid and c.status <> 'active'
        union all
        select jsonb_build_object('kind', 'same_court_same_session', 'courtNo', gs.planned_court_no,
                                  'sessionNo', gs.session_no, 'count', count(*))
          from public.hosted_tournament_group_schedules gs
         where gs.tournament_id = v_tid and gs.planned_court_no is not null and gs.session_no is not null
         group by gs.planned_court_no, gs.session_no having count(*) > 1
        union all
        select jsonb_build_object('kind', 'court_over_two', 'courtNo', gs.planned_court_no, 'count', count(*))
          from public.hosted_tournament_group_schedules gs
         where gs.tournament_id = v_tid and gs.planned_court_no is not null
         group by gs.planned_court_no having count(*) > 2
        union all
        select jsonb_build_object('kind', 'unassigned', 'groupNo', g.group_no)
          from public.hosted_tournament_groups g
          left join public.hosted_tournament_group_schedules gs on gs.group_id = g.id
         where g.tournament_id = v_tid and (gs.session_no is null or gs.planned_court_no is null)
      ) x;

    return jsonb_build_object(
        'slug', p_slug,
        'drawStatus', v_dstatus,
        'drawPublishedAt', v_pub,
        'settings', v_settings,
        'courts', v_courts,
        'groups', v_groups,
        'warnings', v_warn,
        'serverNow', now());
end;
$$;
revoke execute on function public.get_admin_group_schedule(text) from public;
revoke execute on function public.get_admin_group_schedule(text) from anon;
grant  execute on function public.get_admin_group_schedule(text) to authenticated;


-- ── 4. 본부 저장: 대회 공통 설정 ─────────────────────────────────────────────────
--   시각은 'HH:MM' 문자열(빈 값 = 비움). 조편성 잠금 · 버전 · DRAW 공개 상태와 무관.
create or replace function public.set_schedule_settings(
    p_slug                text,
    p_checkin_place       text,
    p_session1_deadline   text default null,
    p_session1_start      text default null,
    p_session1_note       text default null,
    p_session2_deadline   text default null,
    p_session2_start      text default null,
    p_session2_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_place  text := btrim(coalesce(p_checkin_place, ''));
    v_t      text[];
    v_times  time[] := array[]::time[];
    v_n1     text := nullif(btrim(coalesce(p_session1_note, '')), '');
    v_n2     text := nullif(btrim(coalesce(p_session2_note, '')), '');
    v_before jsonb;
    i        integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if length(v_place) < 1 or length(v_place) > 40 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_checkin_place');
    end if;
    if (v_n1 is not null and length(v_n1) > 60) or (v_n2 is not null and length(v_n2) > 60) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_start_note');
    end if;

    v_t := array[p_session1_deadline, p_session1_start, p_session2_deadline, p_session2_start];
    for i in 1..4 loop
        if nullif(btrim(coalesce(v_t[i], '')), '') is null then
            v_times := v_times || null::time;
        elsif btrim(v_t[i]) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
            v_times := v_times || btrim(v_t[i])::time;
        else
            return jsonb_build_object('ok', false, 'reason', 'invalid_time', 'index', i);
        end if;
    end loop;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-schedule:' || v_tid::text));

    select to_jsonb(s) - 'tournament_id' - 'updated_by' into v_before
      from public.hosted_tournament_schedule_settings s where s.tournament_id = v_tid;

    insert into public.hosted_tournament_schedule_settings as s (
        tournament_id, checkin_place,
        session1_checkin_deadline, session1_start_time, session1_start_note,
        session2_checkin_deadline, session2_start_time, session2_start_note,
        updated_at, updated_by)
    values (v_tid, v_place, v_times[1], v_times[2], v_n1, v_times[3], v_times[4], v_n2, now(), auth.uid())
    on conflict (tournament_id) do update
       set checkin_place = excluded.checkin_place,
           session1_checkin_deadline = excluded.session1_checkin_deadline,
           session1_start_time = excluded.session1_start_time,
           session1_start_note = excluded.session1_start_note,
           session2_checkin_deadline = excluded.session2_checkin_deadline,
           session2_start_time = excluded.session2_start_time,
           session2_start_note = excluded.session2_start_note,
           updated_at = now(), updated_by = auth.uid();

    perform public.hosted_tournament_log_event(
        v_tid, 'tournament', v_tid, 'schedule_settings_update', v_before,
        jsonb_build_object('checkinPlace', v_place,
                           'session1', jsonb_build_array(to_char(v_times[1], 'HH24:MI'), to_char(v_times[2], 'HH24:MI'), v_n1),
                           'session2', jsonb_build_array(to_char(v_times[3], 'HH24:MI'), to_char(v_times[4], 'HH24:MI'), v_n2)),
        null);

    return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_schedule_settings(text,text,text,text,text,text,text,text) from public;
revoke execute on function public.set_schedule_settings(text,text,text,text,text,text,text,text) from anon;
grant  execute on function public.set_schedule_settings(text,text,text,text,text,text,text,text) to authenticated;


-- ── 5. 본부 저장: 조별 순서 · 예정 코트 ───────────────────────────────────────────
--   둘 다 NULL 이면 그 조의 일정을 지운다(미정). 없는 코트 번호는 거절한다(오타 방지).
--   ⚠ 조편성 잠금 · 버전 · DRAW 공개 상태를 바꾸지 않는다.
create or replace function public.set_group_schedule(
    p_slug             text,
    p_group_no         integer,
    p_session_no       integer default null,
    p_planned_court_no integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_gid    uuid;
    v_before jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;
    if p_session_no is not null and p_session_no not in (1, 2) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_session');
    end if;
    if p_planned_court_no is not null and p_planned_court_no < 1 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_court');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-schedule:' || v_tid::text));

    select id into v_gid from public.hosted_tournament_groups
     where tournament_id = v_tid and group_no = p_group_no;
    if v_gid is null then
        return jsonb_build_object('ok', false, 'reason', 'group_not_found');
    end if;
    if p_planned_court_no is not null and not exists (
           select 1 from public.hosted_tournament_courts
            where tournament_id = v_tid and court_no = p_planned_court_no) then
        return jsonb_build_object('ok', false, 'reason', 'court_not_found');
    end if;

    select jsonb_build_object('sessionNo', session_no, 'plannedCourtNo', planned_court_no) into v_before
      from public.hosted_tournament_group_schedules where group_id = v_gid;

    if p_session_no is null and p_planned_court_no is null then
        delete from public.hosted_tournament_group_schedules where group_id = v_gid;
    else
        insert into public.hosted_tournament_group_schedules as s
               (group_id, tournament_id, session_no, planned_court_no, updated_at, updated_by)
        values (v_gid, v_tid, p_session_no, p_planned_court_no, now(), auth.uid())
        on conflict (group_id) do update
           set session_no = excluded.session_no, planned_court_no = excluded.planned_court_no,
               updated_at = now(), updated_by = auth.uid();
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'group', v_gid, 'group_schedule_update', v_before,
        jsonb_build_object('groupNo', p_group_no, 'sessionNo', p_session_no, 'plannedCourtNo', p_planned_court_no),
        null);

    return jsonb_build_object('ok', true, 'groupNo', p_group_no,
                              'sessionNo', p_session_no, 'plannedCourtNo', p_planned_court_no);
end;
$$;
revoke execute on function public.set_group_schedule(text,integer,integer,integer) from public;
revoke execute on function public.set_group_schedule(text,integer,integer,integer) from anon;
grant  execute on function public.set_group_schedule(text,integer,integer,integer) to authenticated;


-- ── 6. 참가자 공개 조회 ─────────────────────────────────────────────────────────
--   get_public_preliminary_draw 와 같은 공개 조건(① 대회 공개(draft 아님) ② 조편성 locked ③ DRAW 공개 시각)을
--   모두 만족할 때만 반환한다. 아니면 null(이유를 알려주지 않는다). 로그인 없이 실행 가능.
--   ⚠ uuid · 수정자 · 감사 정보 미반환. 조 번호 · 순서 · 예정 코트 · 공통 안내만.
create or replace function public.get_public_group_schedule(p_slug text)
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
    v_pub      timestamptz;
    v_sessions jsonb;
    v_place    text;
    v_groups   jsonb;
begin
    select id, status, preliminary_draw_status, preliminary_draw_published_at
      into v_tid, v_tstatus, v_dstatus, v_pub
      from public.hosted_tournaments where slug = p_slug;

    if v_tid is null
       or v_tstatus = 'draft'
       or v_dstatus <> 'locked'
       or v_pub is null then
        return null;
    end if;

    select s.checkin_place,
           jsonb_build_array(
               jsonb_build_object('sessionNo', 1,
                   'checkinDeadline', to_char(s.session1_checkin_deadline, 'HH24:MI'),
                   'startTime',       to_char(s.session1_start_time, 'HH24:MI'),
                   'startNote',       s.session1_start_note),
               jsonb_build_object('sessionNo', 2,
                   'checkinDeadline', to_char(s.session2_checkin_deadline, 'HH24:MI'),
                   'startTime',       to_char(s.session2_start_time, 'HH24:MI'),
                   'startNote',       s.session2_start_note))
      into v_place, v_sessions
      from public.hosted_tournament_schedule_settings s where s.tournament_id = v_tid;

    select coalesce(jsonb_agg(jsonb_build_object(
               'groupNo',          g.group_no,
               'sessionNo',        gs.session_no,
               'plannedCourtNo',   gs.planned_court_no,
               'plannedCourtName', c.display_name)
               order by g.group_no), '[]'::jsonb)
      into v_groups
      from public.hosted_tournament_group_schedules gs
      join public.hosted_tournament_groups g on g.id = gs.group_id
      left join public.hosted_tournament_courts c
        on c.tournament_id = v_tid and c.court_no = gs.planned_court_no
     where gs.tournament_id = v_tid;

    return jsonb_build_object(
        'slug',         p_slug,
        'checkinPlace', v_place,
        'sessions',     coalesce(v_sessions, '[]'::jsonb),
        'groups',       v_groups);
end;
$$;
revoke execute on function public.get_public_group_schedule(text) from public;
grant  execute on function public.get_public_group_schedule(text) to anon;
grant  execute on function public.get_public_group_schedule(text) to authenticated;


notify pgrst, 'reload schema';

commit;
