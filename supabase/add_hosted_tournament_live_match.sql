-- ============================================================================
--  2026 TEYEON OPEN — LIVE 중계 경기 연결 (LIVE Phase 3 · 1단계)
--
--  하는 일
--    1. hosted_tournament_live_state     — 대회별 '지금 LIVE 화면에 어떤 경기를 보여 줄지' (auto / manual / none)
--    2. hosted_tournament_live_segments  — 중계 경기 구간(시각). 수동 고정 · 없음은 즉시 기록,
--                                          자동 구간은 기존 이벤트 로그에서 복원해 저장한다.
--    3. hosted_tournament_live_clips     — 구간 × Cloudflare 녹화. 자동 계산 구간과 관리자 보정 구간을 따로 둔다.
--    4. 공개 RPC 2개(지금 중계 경기 · 확정된 경기별 다시보기) + 관리자 RPC 6개
--
--  운영 원칙
--    · 기본은 auto — 'LIVE 중계 코트'(hosted_tournament_courts.is_feature_court)에서 진행 중인 경기를 보여 준다.
--      운영자는 평소처럼 관제 화면에서 경기를 투입하기만 하면 된다.
--    · 예외만 본부 관리자(can_manage_tournaments = CEO · ADMIN)가 수동 고정 / 중계 경기 없음 / 자동 복귀.
--      현장 운영자(staff scorer)는 어떤 LIVE 설정도 바꿀 수 없다.
--    · 영상 송출(Cloudflare)과 완전히 분리 — 이 파일의 어떤 값도 송출 · 재생에 관여하지 않는다.
--      경기 선택을 잊어도 영상은 그대로 나간다(화면에 경기 정보만 없다).
--    · 녹화와 경기는 '방송 단위'가 아니라 '시각'으로 연결한다.
--      경기마다 방송을 끊어도 / 계속 켜 두어도 / 재연결로 녹화가 여러 개가 되어도 같은 방식으로 처리된다.
--    · 공개 선수 정보는 기존 DRAW 공개 조건을 그대로 따른다(예선 · 순위결정전 = 조편성 공개, 본선 = 본선표 공개).
--    · 경기별 다시보기는 관리자가 '확정'한 것만 공개한다.
--
--  ⚠ 기존 객체 변경 0건
--    · 기존 테이블 · 컬럼 · 제약 · 정책 · 함수를 바꾸지 않는다(새 테이블 3 · 새 함수만).
--    · 경기 · 코트 · 이벤트 · 팀 · 조 · 본선표는 읽기만 한다. 대회 운영 RPC 를 호출하지 않는다.
--    · hosted_tournament_events 에 쓰지 않는다(entity_type CHECK 를 바꾸지 않기 위해 LIVE 기록은 새 테이블에만).
--  ⚠ 비밀값 저장 없음 — Cloudflare 녹화 UID(재생용 공개 ID)만 저장한다. API Token · Stream Key 는 DB 에 오지 않는다.
--  ⚠ 적용 시각 이전의 녹화(테스트 녹화 포함)는 자동 연결되지 않는다(live_state.linking_started_at).
--
--  점검  : add_hosted_tournament_live_match_verify.sql
--  사전  : precheck_hosted_tournament_live_match_READONLY.sql
--  되돌림: add_hosted_tournament_live_match_rollback.sql
-- ============================================================================

begin;

-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regclass('public.hosted_tournament_matches') is null
       or to_regclass('public.hosted_tournament_courts') is null
       or to_regclass('public.hosted_tournament_events') is null
       or to_regclass('public.hosted_tournament_teams') is null
       or to_regclass('public.hosted_tournament_groups') is null
       or to_regclass('public.hosted_tournament_brackets') is null
       or to_regclass('public.hosted_tournament_bracket_rounds') is null then
        raise exception '선행 테이블(경기 · 코트 · 이벤트 · 팀 · 조 · 본선표)이 없습니다.';
    end if;
    if to_regprocedure('public.can_manage_tournaments()') is null
       or to_regprocedure('public.set_feature_court(text,integer)') is null
       or to_regprocedure('public.start_match(uuid,integer,integer)') is null then
        raise exception '선행 함수(can_manage_tournaments · set_feature_court · start_match)가 없습니다.';
    end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'hosted_tournaments'
                      and column_name = 'preliminary_draw_published_at')
       or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'hosted_tournament_brackets'
                      and column_name = 'published_at') then
        raise exception 'DRAW 공개 컬럼(preliminary_draw_published_at · brackets.published_at)이 없습니다.';
    end if;
end $guard$;


-- ── 1. 테이블 ────────────────────────────────────────────────────────────────

-- 1-1. 지금 상태 — 대회당 1행.
create table if not exists public.hosted_tournament_live_state (
    tournament_id      uuid        primary key
                                   references public.hosted_tournaments(id) on delete cascade,
    mode               text        not null default 'auto'
                                   check (mode in ('auto', 'manual', 'none')),
    -- 수동 고정 경기. ⚠ 본선 대기 경기는 삭제될 수 있다(예선 결과 확정 취소) → set null.
    --   manual 인데 null 이면 '고정했던 경기가 사라짐' — 화면에는 경기 정보를 띄우지 않는다.
    manual_match_id    uuid        references public.hosted_tournament_matches(id) on delete set null,
    -- 이 시각 이후의 경기 · 녹화만 자동 연결한다(적용 전 테스트 녹화 보호).
    linking_started_at timestamptz not null default now(),
    version            integer     not null default 1 check (version >= 1),
    updated_at         timestamptz not null default now(),
    updated_by         uuid        references auth.users(id) on delete set null
);

comment on table public.hosted_tournament_live_state is
    'LIVE 화면 중계 경기 상태(대회당 1행). auto = LIVE 중계 코트의 진행 경기 · manual = 관리자 고정 · none = 경기 정보 없음. 영상 송출과 무관.';

-- 1-2. 구간 — 언제부터 언제까지 어떤 경기를 중계했나.
--   source = manual · none : set_live_match 가 즉시 기록(겹치지 않는 하나의 열린 구간).
--   source = auto          : 기존 이벤트 로그(경기 시작 · 완료 · 취소, LIVE 중계 코트 지정)에서 복원해 저장.
--                            manual · none 구간과 겹치는 부분은 잘려 나간다.
create table if not exists public.hosted_tournament_live_segments (
    id              uuid        primary key default gen_random_uuid(),
    tournament_id   uuid        not null references public.hosted_tournaments(id) on delete cascade,
    source          text        not null check (source in ('auto', 'manual', 'none')),
    match_id        uuid        references public.hosted_tournament_matches(id) on delete set null,
    -- 시작 당시 경기 정보(단계 · 경기 번호 · 코트 · 선수 이름). 경기가 지워지거나 바뀌어도 기록은 남는다.
    --   ⚠ uuid · 연락처 · 점수를 넣지 않는다(공개 다시보기에 그대로 쓰이는 값).
    match_snapshot  jsonb,
    court_no        integer,
    started_at      timestamptz not null,
    ended_at        timestamptz,
    created_by      uuid        references auth.users(id) on delete set null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint hosted_tlseg_time_order   check (ended_at is null or ended_at >= started_at),
    constraint hosted_tlseg_none_shape   check ((source = 'none') = (match_snapshot is null)),
    constraint hosted_tlseg_none_nomatch check (source <> 'none' or match_id is null),
    constraint hosted_tlseg_snapshot_obj check (match_snapshot is null or jsonb_typeof(match_snapshot) = 'object')
);

comment on table public.hosted_tournament_live_segments is
    'LIVE 중계 경기 구간. manual/none 은 관리자 조작 시각, auto 는 이벤트 로그에서 복원. 녹화 연결의 기준 시각.';

-- 관리자 고정 · 없음은 한 번에 하나만 열려 있다.
create unique index if not exists hosted_tlseg_one_open_override
    on public.hosted_tournament_live_segments (tournament_id)
 where ended_at is null and source in ('manual', 'none');
-- 자동 구간의 멱등 키 — 같은 경기 · 같은 시작 시각은 한 행.
create unique index if not exists hosted_tlseg_auto_key
    on public.hosted_tournament_live_segments (tournament_id, match_id, started_at)
 where source = 'auto' and match_id is not null;
create index if not exists hosted_tlseg_time_idx
    on public.hosted_tournament_live_segments (tournament_id, started_at);

-- 1-3. 녹화 클립 — 구간 하나가 녹화 여러 개에 걸칠 수 있고(재연결), 녹화 하나에 구간 여러 개가 들어간다.
create table if not exists public.hosted_tournament_live_clips (
    id                     uuid          primary key default gen_random_uuid(),
    tournament_id          uuid          not null references public.hosted_tournaments(id) on delete cascade,
    segment_id             uuid          not null
                                         references public.hosted_tournament_live_segments(id) on delete cascade,
    provider               text          not null default 'cloudflare_stream'
                                         check (provider in ('cloudflare_stream')),
    -- ⚠ 재생용 공개 ID 만. Stream Key 아님.
    provider_video_uid     text          not null check (provider_video_uid ~ '^[a-f0-9]{32}$'),
    recording_started_at   timestamptz   not null,
    recording_duration_sec numeric(10,3) not null check (recording_duration_sec > 0),

    -- 자동 계산(녹화 시작 기준 초). 다시 계산할 때마다 갱신된다.
    auto_start_sec         numeric(10,3) not null,
    auto_end_sec           numeric(10,3) not null,
    -- 관리자 보정(둘 다 있거나 둘 다 없음). 있으면 공개 재생에 이 값을 쓴다. 재계산이 덮어쓰지 않는다.
    adjusted_start_sec     numeric(10,3),
    adjusted_end_sec       numeric(10,3),

    -- draft = 미확정(비공개) · confirmed = 공개 · hidden = 관리자 숨김
    status                 text          not null default 'draft'
                                         check (status in ('draft', 'confirmed', 'hidden')),
    confirmed_at           timestamptz,
    confirmed_by           uuid          references auth.users(id) on delete set null,

    -- 확장 칸(이번 단계에서는 쓰지 않는다): 제목 · 최종 점수 · 썸네일 시점 · 후편집 영상
    title                  text          check (title is null or length(btrim(title)) between 1 and 80),
    final_score_snapshot   jsonb         check (final_score_snapshot is null or jsonb_typeof(final_score_snapshot) = 'object'),
    thumbnail_sec          numeric(10,3) check (thumbnail_sec is null or thumbnail_sec >= 0),
    edited_video_uid       text          check (edited_video_uid is null or edited_video_uid ~ '^[a-f0-9]{32}$'),

    version                integer       not null default 1 check (version >= 1),
    created_at             timestamptz   not null default now(),
    updated_at             timestamptz   not null default now(),

    constraint hosted_tlclip_segment_video_unique unique (segment_id, provider_video_uid),
    constraint hosted_tlclip_auto_range check (
        auto_start_sec >= 0 and auto_end_sec > auto_start_sec and auto_end_sec <= recording_duration_sec),
    constraint hosted_tlclip_adjusted_pair check ((adjusted_start_sec is null) = (adjusted_end_sec is null)),
    constraint hosted_tlclip_adjusted_range check (
        adjusted_start_sec is null
     or (adjusted_start_sec >= 0 and adjusted_end_sec > adjusted_start_sec
         and adjusted_end_sec <= recording_duration_sec)),
    constraint hosted_tlclip_confirmed_shape check ((status = 'confirmed') = (confirmed_at is not null))
);

comment on table public.hosted_tournament_live_clips is
    'LIVE 구간 × Cloudflare 녹화. 자동 계산(auto_*)과 관리자 보정(adjusted_*)을 분리. status=confirmed 만 공개.';

create index if not exists hosted_tlclip_tournament_idx
    on public.hosted_tournament_live_clips (tournament_id, recording_started_at);
create index if not exists hosted_tlclip_video_idx
    on public.hosted_tournament_live_clips (tournament_id, provider_video_uid);

-- 기존 대회 — 적용 시각부터 연결을 시작한다(그 이전 녹화 · 경기는 자동 연결 대상이 아니다).
insert into public.hosted_tournament_live_state (tournament_id)
select id from public.hosted_tournaments
on conflict (tournament_id) do nothing;


-- ── 2. RLS — 기본 차단(정책 없음). 읽기 · 쓰기는 아래 RPC 로만. ─────────────────
alter table public.hosted_tournament_live_state    enable row level security;
alter table public.hosted_tournament_live_segments enable row level security;
alter table public.hosted_tournament_live_clips    enable row level security;
revoke all on public.hosted_tournament_live_state    from public, anon, authenticated;
revoke all on public.hosted_tournament_live_segments from public, anon, authenticated;
revoke all on public.hosted_tournament_live_clips    from public, anon, authenticated;


-- ── 3. 내부 helper (anon · authenticated 실행 불가) ─────────────────────────────

-- 3-1. 경기 정보 스냅샷 — 공개 화면에 그대로 쓰이므로 uuid · 점수 · 연락처를 넣지 않는다.
create or replace function public.hosted_tournament_live_match_snapshot(
    p_match_id uuid,
    p_court_no integer
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
               'stage',      m.stage,
               'stageLabel', case m.stage
                                 when 'preliminary' then '예선 ' || coalesce(g.label, g.group_no::text || '조')
                                 when 'placement'   then coalesce(g.label, '순위결정전 ' || g.group_no::text)
                                 else coalesce(r.name, '본선')
                             end,
               'groupNo',    g.group_no,
               'roundNo',    m.round_no,
               'roundName',  r.name,
               'matchNo',    m.match_no,
               'courtNo',    p_court_no,
               'courtName',  c.display_name,
               'team1',      jsonb_build_object('player1Name', t1.player1_name, 'player2Name', t1.player2_name),
               'team2',      jsonb_build_object('player1Name', t2.player1_name, 'player2Name', t2.player2_name))
      from public.hosted_tournament_matches m
      join public.hosted_tournament_teams t1 on t1.id = m.team1_id
      join public.hosted_tournament_teams t2 on t2.id = m.team2_id
      left join public.hosted_tournament_groups g on g.id = m.group_id
      left join public.hosted_tournament_bracket_rounds r
        on r.bracket_id = m.bracket_id and r.round_no = m.round_no
      left join public.hosted_tournament_courts c
        on c.tournament_id = m.tournament_id and c.court_no = p_court_no
     where m.id = p_match_id;
$$;

-- 3-2. 단계별 공개 여부 — 기존 공개 RPC(get_public_preliminary_draw · get_public_knockout_bracket)와 같은 조건.
create or replace function public.hosted_tournament_live_stage_is_public(
    p_tid   uuid,
    p_stage text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce((
        select case
                   when t.status = 'draft' then false
                   when p_stage in ('preliminary', 'placement') then
                       t.preliminary_draw_status = 'locked' and t.preliminary_draw_published_at is not null
                   when p_stage = 'knockout' then exists (
                       select 1 from public.hosted_tournament_brackets b
                        where b.tournament_id = p_tid
                          and b.status in ('locked', 'completed')
                          and b.published_at is not null)
                   else false
               end
          from public.hosted_tournaments t
         where t.id = p_tid), false);
$$;

-- 3-3. 지금 화면에 띄울 경기 — (mode, match_id, court_no). 경기가 없으면 match_id null.
create or replace function public.hosted_tournament_live_on_air(p_tid uuid)
returns table (mode text, match_id uuid, court_no integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_mode  text;
    v_mid   uuid;
begin
    select s.mode, s.manual_match_id into v_mode, v_mid
      from public.hosted_tournament_live_state s where s.tournament_id = p_tid;
    v_mode := coalesce(v_mode, 'auto');

    if v_mode = 'none' then
        return query select v_mode, null::uuid, null::integer;
        return;
    end if;

    if v_mode = 'manual' then
        return query
            select v_mode, m.id, c.court_no
              from (select 1) x
              left join public.hosted_tournament_matches m
                on m.id = v_mid and m.tournament_id = p_tid and m.status <> 'cancelled'
              left join public.hosted_tournament_courts c on c.id = m.court_id;
        return;
    end if;

    -- auto: LIVE 중계 코트에서 진행 중인 경기(코트당 진행 경기는 최대 1개 — 기존 운영 제약).
    return query
        select v_mode, m.id, c.court_no
          from (select 1) x
          left join public.hosted_tournament_courts c
            on c.tournament_id = p_tid and c.is_feature_court
          left join public.hosted_tournament_matches m
            on m.tournament_id = p_tid and m.court_id = c.id and m.status = 'playing'
         limit 1;
end;
$$;

-- 3-4. 자동 구간 복원 — 이벤트 로그(append-only)만 읽어 같은 결과를 다시 만든다(멱등).
--   ① 경기가 코트에 있던 구간: match_started(courtNo) ~ 그 뒤 첫 match_completed / match_cancelled(없으면 진행 중)
--   ② 코트가 LIVE 중계 코트였던 구간: set_feature_court / clear_feature_court 이벤트를 시간순으로 이은 타임라인
--      (이벤트가 하나도 없는 대회는 현재 is_feature_court 코트를 전 기간 중계 코트로 본다)
--   자동 구간 = ① ∩ ② − 관리자 고정 · 없음 구간.
--   ⚠ ② 를 '경기 시작 시각의 중계 코트' 한 점으로 판정하면, 경기 도중 중계 코트를 바꿨을 때 그 경기가 통째로 빠진다.
--     그래서 타임라인과 겹치는 부분만큼 잘라 담는다(바뀐 시각부터 새 코트의 경기가 자동 구간이 된다).
create or replace function public.hosted_tournament_live_sync_auto(p_tid uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_since   timestamptz;
    v_rows    jsonb;
    v_n       integer;
begin
    select linking_started_at into v_since
      from public.hosted_tournament_live_state where tournament_id = p_tid;
    if v_since is null then
        return 0;
    end if;

    with starts as (
        select e.entity_id                         as match_id,
               e.created_at                        as started_at,
               (e.to_value ->> 'courtNo')::integer as court_no
          from public.hosted_tournament_events e
         where e.tournament_id = p_tid and e.entity_type = 'match'
           and e.action = 'match_started' and e.created_at >= v_since
    ),
    on_court as (
        select s.match_id, s.started_at, s.court_no, en.ended_at
          from starts s
          left join lateral (
              select min(x.created_at) as ended_at
                from public.hosted_tournament_events x
               where x.tournament_id = p_tid and x.entity_type = 'match' and x.entity_id = s.match_id
                 and x.action in ('match_completed', 'match_cancelled')
                 and x.created_at >= s.started_at) en on true
    ),
    feature_events as (
        select f.created_at, f.id,
               case when f.action = 'set_feature_court' then (f.to_value ->> 'courtNo')::integer end as court_no
          from public.hosted_tournament_events f
         where f.tournament_id = p_tid
           and f.action in ('set_feature_court', 'clear_feature_court')
    ),
    feature_timeline as (
        -- 이벤트 하나 = 다음 이벤트 전까지 그 코트가 중계 코트(마지막 이벤트는 끝없음 · 해제 이벤트는 코트 없음)
        select fe.court_no,
               tstzrange(fe.created_at, lead(fe.created_at) over (order by fe.created_at, fe.id), '[)') as r
          from feature_events fe
        union all
        select c.court_no, tstzrange(null::timestamptz, null::timestamptz, '[)')
          from public.hosted_tournament_courts c
         where c.tournament_id = p_tid and c.is_feature_court
           and not exists (select 1 from feature_events)
    ),
    feature_ranges as (
        select court_no, range_agg(r) as mr
          from feature_timeline
         where court_no is not null and not isempty(r)
         group by court_no
    ),
    overrides as (
        -- ⚠ 끝이 없으면 'infinity' 값이 아니라 상한 없음(null)으로 만든다 — upper_inf() 로 '진행 중'을 판정하기 위함.
        select coalesce(range_agg(tstzrange(o.started_at, o.ended_at, '[)')),
                        '{}'::tstzmultirange) as mr
          from public.hosted_tournament_live_segments o
         where o.tournament_id = p_tid and o.source in ('manual', 'none')
    ),
    pieces as (
        select f.match_id, f.court_no, p.r
          from on_court f
          join feature_ranges fr on fr.court_no = f.court_no
         cross join overrides ov
         cross join lateral unnest(
                 (tstzmultirange(tstzrange(f.started_at, f.ended_at, '[)')) * fr.mr)
                 - ov.mr) as p(r)
         where not isempty(p.r)
    )
    -- 키 이름은 아래 jsonb_to_recordset 의 열 이름과 같아야 한다.
    select coalesce(jsonb_agg(jsonb_build_object(
               'match_id',   match_id,
               'court_no',   court_no,
               'started_at', lower(r),
               'ended_at',   case when upper_inf(r) or upper(r) = 'infinity'::timestamptz then null else upper(r) end)), '[]'::jsonb)
      into v_rows
      from pieces;

    insert into public.hosted_tournament_live_segments
           (tournament_id, source, match_id, match_snapshot, court_no, started_at, ended_at)
    select p_tid, 'auto', d.match_id,
           coalesce(public.hosted_tournament_live_match_snapshot(d.match_id, d.court_no),
                    jsonb_build_object('stage', null, 'missing', true)),
           d.court_no, d.started_at, d.ended_at
      from jsonb_to_recordset(v_rows)
           as d(match_id uuid, court_no integer, started_at timestamptz, ended_at timestamptz)
    on conflict (tournament_id, match_id, started_at) where source = 'auto' and match_id is not null
    do update set ended_at   = excluded.ended_at,
                  court_no   = excluded.court_no,
                  updated_at = now()
     where hosted_tournament_live_segments.ended_at is distinct from excluded.ended_at
        or hosted_tournament_live_segments.court_no is distinct from excluded.court_no;

    -- 더 이상 나오지 않는 자동 구간(관리자 고정이 나중에 덮은 경우 등) — 확정 클립이 없을 때만 지운다.
    delete from public.hosted_tournament_live_segments s
     where s.tournament_id = p_tid and s.source = 'auto'
       and not exists (
           select 1 from jsonb_to_recordset(v_rows) as d(match_id uuid, started_at timestamptz)
            where d.match_id = s.match_id and d.started_at = s.started_at)
       and not exists (
           select 1 from public.hosted_tournament_live_clips k
            where k.segment_id = s.id and k.status = 'confirmed');

    select count(*) into v_n
      from public.hosted_tournament_live_segments
     where tournament_id = p_tid and source = 'auto';
    return v_n;
end;
$$;

revoke execute on function public.hosted_tournament_live_match_snapshot(uuid,integer) from public, anon, authenticated;
revoke execute on function public.hosted_tournament_live_stage_is_public(uuid,text)   from public, anon, authenticated;
revoke execute on function public.hosted_tournament_live_on_air(uuid)                 from public, anon, authenticated;
revoke execute on function public.hosted_tournament_live_sync_auto(uuid)              from public, anon, authenticated;


-- ── 4. 공개 RPC ──────────────────────────────────────────────────────────────

-- 4-1. 지금 중계 경기. DRAW 비공개 단계의 경기는 match = null(이유를 알려주지 않는다).
create or replace function public.get_public_live_match(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_status text;
    v_air    record;
    v_snap   jsonb;
begin
    select id, status into v_tid, v_status from public.hosted_tournaments where slug = p_slug;
    if v_tid is null or v_status = 'draft' then
        return jsonb_build_object('available', false);
    end if;

    select * into v_air from public.hosted_tournament_live_on_air(v_tid);
    if v_air.match_id is null then
        return jsonb_build_object('available', true, 'mode', v_air.mode, 'match', null);
    end if;

    v_snap := public.hosted_tournament_live_match_snapshot(v_air.match_id, v_air.court_no);
    if v_snap is null or not public.hosted_tournament_live_stage_is_public(v_tid, v_snap ->> 'stage') then
        return jsonb_build_object('available', true, 'mode', v_air.mode, 'match', null);
    end if;

    return jsonb_build_object('available', true, 'mode', v_air.mode, 'match', v_snap);
end;
$$;

revoke execute on function public.get_public_live_match(text) from public;
grant  execute on function public.get_public_live_match(text) to anon, authenticated;

-- 4-2. 경기별 다시보기 — 관리자가 확정(confirmed)한 클립 + DRAW 공개 단계만.
create or replace function public.get_public_live_replays(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_status text;
    v_list   jsonb;
begin
    select id, status into v_tid, v_status from public.hosted_tournaments where slug = p_slug;
    if v_tid is null or v_status = 'draft' then
        return jsonb_build_object('available', false, 'replays', '[]'::jsonb);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'videoUid',   k.provider_video_uid,
               'startSec',   coalesce(k.adjusted_start_sec, k.auto_start_sec),
               'endSec',     coalesce(k.adjusted_end_sec, k.auto_end_sec),
               'recordedAt', k.recording_started_at
                             + make_interval(secs => coalesce(k.adjusted_start_sec, k.auto_start_sec)::double precision),
               'title',      k.title,
               'match',      s.match_snapshot)
               order by k.recording_started_at desc, coalesce(k.adjusted_start_sec, k.auto_start_sec) desc), '[]'::jsonb)
      into v_list
      from public.hosted_tournament_live_clips k
      join public.hosted_tournament_live_segments s on s.id = k.segment_id
     where k.tournament_id = v_tid
       and k.status = 'confirmed'
       and public.hosted_tournament_live_stage_is_public(v_tid, s.match_snapshot ->> 'stage');

    return jsonb_build_object('available', true, 'replays', v_list);
end;
$$;

revoke execute on function public.get_public_live_replays(text) from public;
grant  execute on function public.get_public_live_replays(text) to anon, authenticated;


-- ── 5. 관리자 RPC (CEO · ADMIN 만 — 현장 운영자 · 일반 회원 불가) ───────────────

-- 5-1. 현재 상태 조회.
create or replace function public.get_admin_live_state(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_state  record;
    v_air    record;
    v_auto   record;
    v_fc     record;
    v_snap   jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    select * into v_state from public.hosted_tournament_live_state where tournament_id = v_tid;
    select * into v_air from public.hosted_tournament_live_on_air(v_tid);
    select court_no, display_name into v_fc
      from public.hosted_tournament_courts where tournament_id = v_tid and is_feature_court limit 1;
    select m.id, m.match_no, c.court_no into v_auto
      from public.hosted_tournament_courts c
      join public.hosted_tournament_matches m on m.court_id = c.id and m.status = 'playing'
     where c.tournament_id = v_tid and c.is_feature_court
     limit 1;
    v_snap := case when v_air.match_id is null then null
                   else public.hosted_tournament_live_match_snapshot(v_air.match_id, v_air.court_no) end;

    return jsonb_build_object(
        'ok',               true,
        'mode',             coalesce(v_state.mode, 'auto'),
        'version',          coalesce(v_state.version, 0),
        'linkingStartedAt', v_state.linking_started_at,
        'manualMatchId',    v_state.manual_match_id,
        'manualMissing',    coalesce(v_state.mode, 'auto') = 'manual' and v_air.match_id is null,
        'featureCourt',     case when v_fc.court_no is null then null
                                 else jsonb_build_object('courtNo', v_fc.court_no, 'courtName', v_fc.display_name) end,
        'autoMatchId',      v_auto.id,
        'onAirMatchId',     v_air.match_id,
        'onAir',            v_snap,
        'onAirPublic',      v_snap is not null
                            and public.hosted_tournament_live_stage_is_public(v_tid, v_snap ->> 'stage'),
        'updatedAt',        v_state.updated_at);
end;
$$;

revoke execute on function public.get_admin_live_state(text) from public, anon;
grant  execute on function public.get_admin_live_state(text) to authenticated;

-- 5-2. 중계 경기 지정 — auto(자동 복귀) / manual(경기 고정) / none(중계 경기 없음).
--   ⚠ 영상 송출과 무관. 기존 경기 상태를 바꾸지 않는다(읽기만).
--   p_expected_version: 다른 관리자가 먼저 바꿨으면 거부(null 이면 검사하지 않음).
create or replace function public.set_live_match(
    p_slug             text,
    p_mode             text,
    p_match_id         uuid    default null,
    p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid     uuid;
    v_state   record;
    v_mstatus text;
    v_court   integer;
    v_snap    jsonb;
    v_now     timestamptz := clock_timestamp();
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_mode is null or p_mode not in ('auto', 'manual', 'none') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_mode');
    end if;
    if (p_mode = 'manual') <> (p_match_id is not null) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_match');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-live:' || v_tid::text));

    insert into public.hosted_tournament_live_state (tournament_id) values (v_tid)
    on conflict (tournament_id) do nothing;
    select * into v_state from public.hosted_tournament_live_state where tournament_id = v_tid for update;

    if p_expected_version is not null and p_expected_version <> v_state.version then
        return jsonb_build_object('ok', false, 'reason', 'stale_version', 'version', v_state.version);
    end if;

    if p_mode = 'manual' then
        select m.status, c.court_no into v_mstatus, v_court
          from public.hosted_tournament_matches m
          left join public.hosted_tournament_courts c on c.id = m.court_id
         where m.id = p_match_id and m.tournament_id = v_tid;
        if v_mstatus is null then
            return jsonb_build_object('ok', false, 'reason', 'match_not_found');
        end if;
        if v_mstatus not in ('waiting', 'calling', 'playing') then
            return jsonb_build_object('ok', false, 'reason', 'match_not_live', 'status', v_mstatus);
        end if;
    end if;

    -- 같은 지정이면 아무것도 쓰지 않는다(구간이 쪼개지지 않게).
    if v_state.mode = p_mode and v_state.manual_match_id is not distinct from p_match_id then
        return jsonb_build_object('ok', true, 'changed', false, 'mode', p_mode, 'version', v_state.version);
    end if;

    -- 열린 고정 · 없음 구간을 닫는다.
    update public.hosted_tournament_live_segments
       set ended_at = greatest(v_now, started_at), updated_at = now()
     where tournament_id = v_tid and source in ('manual', 'none') and ended_at is null;

    if p_mode = 'manual' then
        v_snap := public.hosted_tournament_live_match_snapshot(p_match_id, v_court);
        insert into public.hosted_tournament_live_segments
               (tournament_id, source, match_id, match_snapshot, court_no, started_at, created_by)
        values (v_tid, 'manual', p_match_id, v_snap, v_court, v_now, auth.uid());
    elsif p_mode = 'none' then
        insert into public.hosted_tournament_live_segments
               (tournament_id, source, match_id, match_snapshot, court_no, started_at, created_by)
        values (v_tid, 'none', null, null, null, v_now, auth.uid());
    end if;
    -- auto 는 구간을 쓰지 않는다 — 녹화 연결 때 이벤트 로그에서 복원한다.

    update public.hosted_tournament_live_state
       set mode            = p_mode,
           manual_match_id = case when p_mode = 'manual' then p_match_id end,
           version         = version + 1,
           updated_at      = now(),
           updated_by      = auth.uid()
     where tournament_id = v_tid;

    return jsonb_build_object('ok', true, 'changed', true, 'mode', p_mode, 'version', v_state.version + 1);
end;
$$;

revoke execute on function public.set_live_match(text,text,uuid,integer) from public, anon;
grant  execute on function public.set_live_match(text,text,uuid,integer) to authenticated;

-- 5-3. 녹화 연결 — 서버가 Cloudflare 에서 받은 녹화 목록을 넘기면 구간과 겹치는 부분을 클립으로 만든다(멱등).
--   p_recordings: [{ "uid": 32hex, "startedAt": ISO, "durationSec": number }, ...] 최대 100개
--   · 자동 구간을 먼저 복원한다.
--   · 관리자 보정값은 덮어쓰지 않는다(auto_* 만 갱신). 단 확정 클립의 공개 구간이 바뀌면 미확정으로 되돌린다(재확인).
--   · 1초 미만 겹침은 버린다. 연결 시작 시각 이전 녹화는 건너뛴다(테스트 녹화 보호).
create or replace function public.sync_live_clips(
    p_slug       text,
    p_recordings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid      uuid;
    v_since    timestamptz;
    v_auto     integer;
    v_bad      integer;
    v_upserted integer;
    v_removed  integer;
    v_skipped  integer;
    v_review   integer;
    v_n        integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_recordings is null or jsonb_typeof(p_recordings) <> 'array' or jsonb_array_length(p_recordings) > 100 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_recordings');
    end if;

    select count(*) into v_bad
      from jsonb_array_elements(p_recordings) e(r)
     where jsonb_typeof(e.r) <> 'object'
        or coalesce(e.r ->> 'uid', '') !~ '^[a-f0-9]{32}$'
        or coalesce(e.r ->> 'startedAt', '') !~ '^\d{4}-\d{2}-\d{2}T'
        or jsonb_typeof(e.r -> 'durationSec') <> 'number'
        or (e.r ->> 'durationSec')::numeric <= 0
        or (e.r ->> 'durationSec')::numeric > 86400;
    if v_bad > 0 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_recordings', 'invalid', v_bad);
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-live:' || v_tid::text));

    insert into public.hosted_tournament_live_state (tournament_id) values (v_tid)
    on conflict (tournament_id) do nothing;
    select linking_started_at into v_since from public.hosted_tournament_live_state where tournament_id = v_tid;

    v_auto := public.hosted_tournament_live_sync_auto(v_tid);

    create temporary table if not exists pg_temp.live_recs (
        uid text, started_at timestamptz, duration_sec numeric(10,3)) on commit drop;
    truncate pg_temp.live_recs;
    insert into pg_temp.live_recs (uid, started_at, duration_sec)
    select distinct on (e.r ->> 'uid') e.r ->> 'uid', (e.r ->> 'startedAt')::timestamptz,
           round((e.r ->> 'durationSec')::numeric, 3)
      from jsonb_array_elements(p_recordings) e(r);

    select count(*) into v_skipped
      from pg_temp.live_recs r
     where r.started_at + make_interval(secs => r.duration_sec::double precision) <= v_since;

    create temporary table if not exists pg_temp.live_calc (
        segment_id uuid, uid text, rec_start timestamptz, rec_dur numeric(10,3),
        a_start numeric(10,3), a_end numeric(10,3)) on commit drop;
    truncate pg_temp.live_calc;
    insert into pg_temp.live_calc
    select s.id, r.uid, r.started_at, r.duration_sec,
           round(greatest(0, extract(epoch from (s.started_at - r.started_at)))::numeric, 3),
           round(least(r.duration_sec,
                       extract(epoch from (coalesce(s.ended_at,
                                                    least(clock_timestamp(),
                                                          r.started_at + make_interval(secs => r.duration_sec::double precision)))
                                           - r.started_at)))::numeric, 3)
      from pg_temp.live_recs r
      join public.hosted_tournament_live_segments s
        on s.tournament_id = v_tid
       and s.source in ('auto', 'manual')
       and s.started_at < r.started_at + make_interval(secs => r.duration_sec::double precision)
       and coalesce(s.ended_at, 'infinity'::timestamptz) > r.started_at
     where r.started_at + make_interval(secs => r.duration_sec::double precision) > v_since;
    delete from pg_temp.live_calc where a_end - a_start < 1;

    -- 확정(공개) 클립의 공개 구간이 바뀌면 관리자 재확인이 필요하다 — 미확정(비공개)으로 되돌린다.
    --   ① (여기) 아직 겹치지만 구간이 바뀜: 보정값이 새 녹화 길이를 벗어남 · 보정 없이 자동 구간이 바뀜
    --   ② (아래, 미확정 정리 뒤) 이제 겹치지 않음 — 지우지 않고 미확정으로 남겨 관리자가 판단하게 한다.
    --   ⚠ 조용히 다른 구간을 공개하지 않기 위함이다. 보정값이 범위 안이면 그대로 둔다(공개 구간 불변).
    --   ⚠ ① 은 자동값을 덮어쓰기(아래 upsert) 전에 비교해야 하므로 여기서 한다.
    update public.hosted_tournament_live_clips k
       set status = 'draft', confirmed_at = null, confirmed_by = null,
           version = k.version + 1, updated_at = now()
     where k.tournament_id = v_tid and k.status = 'confirmed'
       and exists (select 1 from pg_temp.live_calc c
                    where c.segment_id = k.segment_id and c.uid = k.provider_video_uid
                      and (   (k.adjusted_end_sec is not null and k.adjusted_end_sec > c.rec_dur)
                           or (k.adjusted_start_sec is null
                               and (k.auto_start_sec, k.auto_end_sec) is distinct from (c.a_start, c.a_end))));
    get diagnostics v_review = row_count;

    insert into public.hosted_tournament_live_clips
           (tournament_id, segment_id, provider_video_uid, recording_started_at, recording_duration_sec,
            auto_start_sec, auto_end_sec)
    select v_tid, c.segment_id, c.uid, c.rec_start, c.rec_dur, c.a_start, c.a_end
      from pg_temp.live_calc c
    on conflict (segment_id, provider_video_uid) do update
       set recording_started_at   = excluded.recording_started_at,
           recording_duration_sec = excluded.recording_duration_sec,
           auto_start_sec         = excluded.auto_start_sec,
           auto_end_sec           = excluded.auto_end_sec,
           -- 녹화 길이가 줄어 보정값이 범위를 벗어나면 보정값만 비운다(확정 상태는 유지).
           adjusted_start_sec     = case when hosted_tournament_live_clips.adjusted_end_sec <= excluded.recording_duration_sec
                                         then hosted_tournament_live_clips.adjusted_start_sec end,
           adjusted_end_sec       = case when hosted_tournament_live_clips.adjusted_end_sec <= excluded.recording_duration_sec
                                         then hosted_tournament_live_clips.adjusted_end_sec end,
           version                = hosted_tournament_live_clips.version + 1,
           updated_at             = now()
     where (hosted_tournament_live_clips.auto_start_sec, hosted_tournament_live_clips.auto_end_sec,
            hosted_tournament_live_clips.recording_duration_sec, hosted_tournament_live_clips.recording_started_at)
           is distinct from
           (excluded.auto_start_sec, excluded.auto_end_sec, excluded.recording_duration_sec, excluded.recording_started_at);
    get diagnostics v_upserted = row_count;

    -- 넘겨받은 녹화의 미확정 클립 중 이제 겹치지 않는 것만 지운다(확정 · 숨김은 남긴다).
    delete from public.hosted_tournament_live_clips k
     where k.tournament_id = v_tid and k.status = 'draft'
       and k.provider_video_uid in (select uid from pg_temp.live_recs)
       and not exists (select 1 from pg_temp.live_calc c
                        where c.segment_id = k.segment_id and c.uid = k.provider_video_uid);
    get diagnostics v_removed = row_count;

    -- ② 확정 클립인데 이제 겹치지 않음 — 미확정으로 되돌려 남긴다(위 정리에서 지워지지 않도록 정리 뒤에 한다).
    update public.hosted_tournament_live_clips k
       set status = 'draft', confirmed_at = null, confirmed_by = null,
           version = k.version + 1, updated_at = now()
     where k.tournament_id = v_tid and k.status = 'confirmed'
       and k.provider_video_uid in (select uid from pg_temp.live_recs)
       and not exists (select 1 from pg_temp.live_calc c
                        where c.segment_id = k.segment_id and c.uid = k.provider_video_uid);
    get diagnostics v_n = row_count;
    v_review := v_review + v_n;

    return jsonb_build_object('ok', true,
        'autoSegments', v_auto,
        'clipsWritten', v_upserted,
        'clipsRemoved', v_removed,
        'recordingsBeforeLinking', v_skipped,
        'clipsNeedReview', v_review,
        'linkingStartedAt', v_since);
end;
$$;

revoke execute on function public.sync_live_clips(text,jsonb) from public, anon;
grant  execute on function public.sync_live_clips(text,jsonb) to authenticated;

-- 5-4. 클립 구간 보정 — 둘 다 null 이면 자동 계산값으로 되돌린다.
create or replace function public.adjust_live_clip(
    p_clip_id          uuid,
    p_start_sec        numeric,
    p_end_sec          numeric,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_clip record;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    select * into v_clip from public.hosted_tournament_live_clips where id = p_clip_id for update;
    if v_clip.id is null then
        return jsonb_build_object('ok', false, 'reason', 'clip_not_found');
    end if;
    if p_expected_version is null or p_expected_version <> v_clip.version then
        return jsonb_build_object('ok', false, 'reason', 'stale_version', 'version', v_clip.version);
    end if;
    if (p_start_sec is null) <> (p_end_sec is null) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_range');
    end if;
    if p_start_sec is not null
       and (p_start_sec < 0 or p_end_sec <= p_start_sec or p_end_sec > v_clip.recording_duration_sec) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_range',
                                  'durationSec', v_clip.recording_duration_sec);
    end if;

    update public.hosted_tournament_live_clips
       set adjusted_start_sec = round(p_start_sec, 3),
           adjusted_end_sec   = round(p_end_sec, 3),
           version            = version + 1,
           updated_at         = now()
     where id = p_clip_id;

    return jsonb_build_object('ok', true, 'version', v_clip.version + 1);
end;
$$;

revoke execute on function public.adjust_live_clip(uuid,numeric,numeric,integer) from public, anon;
grant  execute on function public.adjust_live_clip(uuid,numeric,numeric,integer) to authenticated;

-- 5-5. 클립 공개 상태 — confirmed(공개) / draft(미확정) / hidden(숨김).
create or replace function public.set_live_clip_status(
    p_clip_id          uuid,
    p_status           text,
    p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_clip record;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_status is null or p_status not in ('draft', 'confirmed', 'hidden') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;

    select * into v_clip from public.hosted_tournament_live_clips where id = p_clip_id for update;
    if v_clip.id is null then
        return jsonb_build_object('ok', false, 'reason', 'clip_not_found');
    end if;
    if p_expected_version is null or p_expected_version <> v_clip.version then
        return jsonb_build_object('ok', false, 'reason', 'stale_version', 'version', v_clip.version);
    end if;

    update public.hosted_tournament_live_clips
       set status       = p_status,
           confirmed_at = case when p_status = 'confirmed' then now() end,
           confirmed_by = case when p_status = 'confirmed' then auth.uid() end,
           version      = version + 1,
           updated_at   = now()
     where id = p_clip_id;

    return jsonb_build_object('ok', true, 'status', p_status, 'version', v_clip.version + 1);
end;
$$;

revoke execute on function public.set_live_clip_status(uuid,text,integer) from public, anon;
grant  execute on function public.set_live_clip_status(uuid,text,integer) to authenticated;

-- 5-6. 구간 · 클립 목록(관리자 보정 화면용).
create or replace function public.get_admin_live_clips(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    return jsonb_build_object('ok', true, 'segments', (
        select coalesce(jsonb_agg(jsonb_build_object(
                   'id',        s.id,
                   'source',    s.source,
                   'matchId',   s.match_id,
                   'match',     s.match_snapshot,
                   'courtNo',   s.court_no,
                   'startedAt', s.started_at,
                   'endedAt',   s.ended_at,
                   'clips', (
                       select coalesce(jsonb_agg(jsonb_build_object(
                                  'id',                   k.id,
                                  'videoUid',             k.provider_video_uid,
                                  'recordingStartedAt',   k.recording_started_at,
                                  'recordingDurationSec', k.recording_duration_sec,
                                  'autoStartSec',         k.auto_start_sec,
                                  'autoEndSec',           k.auto_end_sec,
                                  'adjustedStartSec',     k.adjusted_start_sec,
                                  'adjustedEndSec',       k.adjusted_end_sec,
                                  'status',               k.status,
                                  'version',              k.version)
                                  order by k.recording_started_at), '[]'::jsonb)
                         from public.hosted_tournament_live_clips k where k.segment_id = s.id))
                   order by s.started_at desc), '[]'::jsonb)
          from public.hosted_tournament_live_segments s
         where s.tournament_id = v_tid));
end;
$$;

revoke execute on function public.get_admin_live_clips(text) from public, anon;
grant  execute on function public.get_admin_live_clips(text) to authenticated;

notify pgrst, 'reload schema';

commit;
