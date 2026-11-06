-- =============================================================================
-- TEYEON MATCH SPOTLIGHT — 경기 시작 전 예측 snapshot · 주목 경기 공개(PUBLIC)   [초안 v2.2]
--
-- v2.1 → v2.2(2026-11-06): 관리 권한을 기존 KDK 관리자 체계(SQL 30 can_manage_kdk)로 확장 — kdk_spotlight_is_admin 만 변경.
--   CEO · ADMIN · kdk_managers 등재 회원(앱 권한 MEMBER 유지)이 생성 · 미리보기 · 공개 · 비공개. 일반 회원 · GUEST · anon 불가.
--   SQL 30 미적용 DB 에서는 예전과 같이 CEO · ADMIN 만.
--
-- ⚠️ 초안. 사용자 승인 전 운영 실행 금지. rollback: add_kdk_match_spotlight_rollback.sql
--    verify: add_kdk_match_spotlight_verify.sql · 로컬 PGlite 시험: scripts/verify_match_spotlight_sql.mjs
--
-- v1 → v2 변경(fail-closed):
--   · v1 은 "ledger 기록 없음 = 시작한 적 없음"으로 판정 → trigger 실패 시 사후 예측이 열리는 fail-open.
--     v2 는 "생성 시점부터 waiting 이었음"을 **양(+)의 증명서**로 요구한다.
--       - matches INSERT(status='waiting') 때 trigger 가 certificate(certified=true) 를 만든다.
--       - waiting 을 벗어나면 left_waiting_at 을 1회 기록(되돌려도 지우지 않음).
--       - 증명서가 없거나(trigger 실패·설치 전 생성) · uncertifiable · left_waiting_at 있음 · fault 기록 있음
--         · trigger 비활성 → 예측 생성 거부. KDK 경기 운영 자체는 막지 않는다.
--   · 설치 전부터 있던 경기는 uncertifiable 로 backfill → 설치 시 LIVE 세션이 있어도 안전(그 경기만 예측 불가).
--   · trigger 내부 오류는 삼키되 fault 테이블에 남긴다 → 해당 경기는 예측 불가(fail-closed).
--   · record 무행 처리 · revision 계산 · 잠금 순서(order by id) · lock_timeout(KDK 쪽이 아니라 이쪽이 양보) 수정.
--   · publish 는 draft·unpublished 회차(세션 최신)만. unpublished → 같은 회차 재공개 가능.
--
-- v2 → v2.1 변경(행 버전 체인 · STEP 2 P0):
--   · v2 잔여 위험 = 증명서 UPDATE 와 fault INSERT 가 **동시에** 실패하면 이탈 기록이 남지 않아,
--     waiting 으로 되돌린 뒤 사후 예측이 열릴 수 있었다.
--   · v2.1 은 증명서에 "증명한 matches 행 버전(xmin)"을 함께 저장하고, 예측 시 현재 행 버전과 같아야만 허용한다.
--     matches 행은 어떤 UPDATE(값이 같아도)에서도 xmin 이 바뀐다 → 기록이 실패해도 행 버전이 어긋나 차단.
--   · 시작 전 정상 수정(선수 교체·강제 동기화 = waiting→waiting)은 recert trigger 가 "직전 버전이 증명 버전일 때만"
--     새 버전으로 이어받는다(체인). waiting 을 한 번이라도 벗어나거나, trigger 가 실패·비활성이면 체인이 끊겨
--     영구 차단(fail-closed). matches 테이블 컬럼·데이터는 바꾸지 않는다.
--   · 설치 시 lock_timeout 3s — matches 잠금을 오래 기다리며 KDK 쓰기를 줄 세우지 않는다(실패 시 재시도).
--
-- 남는 위험(문서화): ① DB 소유자(superuser)가 ledger 테이블 값을 직접 조작하는 경우.
--   ② trigger 비활성 상태에서의 변경은 체인 단절로 차단되지만, 비활성 사실 자체는 verify A2 로 점검한다.
--   ③ 덤프/복원 등으로 matches 를 재적재하면 xmin 이 바뀌어 기존 경기 전부 예측 불가(안전 방향).
--
-- 구성:
--   1) kdk_match_lifecycle        — 경기별 증명서(생성 시 waiting · 첫 이탈 시각). 추가/1회 갱신만.
--   2) kdk_match_lifecycle_faults — trigger 내부 오류 기록(해당 경기 예측 차단 근거).
--   3) kdk_spotlight_runs          — 생성 회차(draft → published → unpublished / superseded).
--   4) kdk_match_predictions       — 경기별 예측 snapshot.
--   5) RPC: save / publish / unpublish (service_role 전용), get_kdk_spotlight_admin (CEO·ADMIN·KDK 관리자 읽기),
--           get_public_kdk_spotlight · get_public_kdk_spotlight_link (anon, published 만).
-- =============================================================================

begin;

-- matches 에 trigger 를 거는 동안 잠금을 오래 기다리지 않는다(대기 중 KDK 쓰기가 뒤에 줄 서는 것 방지).
-- 3s 안에 잠금을 못 얻으면 전체가 실패·롤백된다 → 진행 중 쓰기가 없는 시점에 다시 실행.
set local lock_timeout = '3s';
set local statement_timeout = '120s';

-- ── 1) 증명서 ────────────────────────────────────────────────────────────────
create table if not exists public.kdk_match_lifecycle (
    match_id         text        primary key,
    club_id          text,
    session_id       text,
    certified        boolean     not null,          -- true = INSERT 시점에 status='waiting' 을 trigger 가 확인
    certified_at     timestamptz,
    left_waiting_at  timestamptz,                   -- waiting 을 처음 벗어난 시각(되돌려도 유지)
    first_left_status text,
    note             text,
    certified_xmin   xid                            -- 증명한 matches 행 버전. 현재 xmin 과 같아야 예측 가능(v2.1)
);
alter table public.kdk_match_lifecycle add column if not exists certified_xmin xid;   -- v2 부분 적용 환경 재적용 대비
comment on table public.kdk_match_lifecycle is
    'MATCH SPOTLIGHT 시작 전 증명서. certified=true 이고 left_waiting_at 이 null 인 경기만 예측 가능. 직접 접근 불가.';
create index if not exists kdk_match_lifecycle_session_idx on public.kdk_match_lifecycle (session_id);

create table if not exists public.kdk_match_lifecycle_faults (
    id         bigserial   primary key,
    match_id   text,
    session_id text,
    op         text        not null,
    error      text,
    created_at timestamptz not null default now()
);
create index if not exists kdk_match_lifecycle_faults_match_idx on public.kdk_match_lifecycle_faults (match_id);

alter table public.kdk_match_lifecycle        enable row level security;  -- 정책 없음 = 클라이언트 접근 불가
alter table public.kdk_match_lifecycle_faults enable row level security;
revoke all on public.kdk_match_lifecycle        from anon, authenticated;
revoke all on public.kdk_match_lifecycle_faults from anon, authenticated;

create or replace function public.kdk_match_lifecycle_capture()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.status is not distinct from 'waiting' then
        insert into public.kdk_match_lifecycle (match_id, club_id, session_id, certified, certified_at, certified_xmin)
        values (new.id::text, new.club_id::text, new.session_id::text, true, now(),
                (select m.xmin from public.matches m where m.id = new.id))
        on conflict (match_id) do nothing;          -- 같은 id 재삽입은 기존 이력 유지(되살리기 금지 · 버전 불일치로 차단)
      else
        insert into public.kdk_match_lifecycle (match_id, club_id, session_id, certified, left_waiting_at, first_left_status, note)
        values (new.id::text, new.club_id::text, new.session_id::text, false, now(), new.status::text, 'inserted_not_waiting')
        on conflict (match_id) do update
          set left_waiting_at   = coalesce(public.kdk_match_lifecycle.left_waiting_at, excluded.left_waiting_at),
              first_left_status = coalesce(public.kdk_match_lifecycle.first_left_status, excluded.first_left_status);
      end if;
    else
      -- UPDATE: trigger WHEN 절이 "waiting 이 아닌 값으로 바뀐 경우"만 넘긴다.
      update public.kdk_match_lifecycle
         set left_waiting_at   = coalesce(left_waiting_at, now()),
             first_left_status = coalesce(first_left_status, new.status::text)
       where match_id = new.id::text;
      if not found then
        insert into public.kdk_match_lifecycle (match_id, club_id, session_id, certified, left_waiting_at, first_left_status, note)
        values (new.id::text, new.club_id::text, new.session_id::text, false, now(), new.status::text, 'no_certificate_on_update')
        on conflict (match_id) do nothing;
      end if;
    end if;
  exception when others then
    -- ⚠ KDK 운영을 막지 않는다. 대신 fault 를 남겨 해당 경기 예측을 차단한다(fail-closed).
    begin
      insert into public.kdk_match_lifecycle_faults (match_id, session_id, op, error)
      values (new.id::text, new.session_id::text, tg_op, left(sqlerrm, 500));
    exception when others then
      raise warning 'kdk_match_lifecycle_capture: fault log failed for match % (%)', new.id, sqlerrm;
    end;
  end;
  return null;
end;
$$;
revoke all on function public.kdk_match_lifecycle_capture() from public, anon, authenticated;

-- 시작 전 수정(waiting → waiting: 선수 교체 · 강제 동기화 upsert 등) — 직전 버전이 증명 버전일 때만 체인을 잇는다.
--   직전 버전이 이미 어긋났거나(이탈·기록 실패·trigger 비활성 중 변경) 이 갱신이 실패하면 체인은 끊긴 채로 남는다(차단).
create or replace function public.kdk_match_lifecycle_recert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.id is distinct from new.id then
    return null;                                     -- id 변경 = 새 경기(증명서 없음 → 차단)
  end if;
  begin
    update public.kdk_match_lifecycle l
       set certified_xmin = (select m.xmin from public.matches m where m.id = new.id)
     where l.match_id = new.id::text
       and l.certified
       and l.left_waiting_at is null
       and l.certified_xmin = old.xmin;
  exception when others then
    begin
      insert into public.kdk_match_lifecycle_faults (match_id, session_id, op, error)
      values (new.id::text, new.session_id::text, 'RECERT', left(sqlerrm, 500));
    exception when others then
      raise warning 'kdk_match_lifecycle_recert: fault log failed for match % (%)', new.id, sqlerrm;
    end;
  end;
  return null;
end;
$$;
revoke all on function public.kdk_match_lifecycle_recert() from public, anon, authenticated;

drop trigger if exists kdk_match_lifecycle_insert_trg on public.matches;
create trigger kdk_match_lifecycle_insert_trg
  after insert on public.matches
  for each row execute function public.kdk_match_lifecycle_capture();

drop trigger if exists kdk_match_lifecycle_status_trg on public.matches;
create trigger kdk_match_lifecycle_status_trg
  after update of status on public.matches
  for each row
  when (old.status is distinct from new.status and new.status is distinct from 'waiting')
  execute function public.kdk_match_lifecycle_capture();

drop trigger if exists kdk_match_lifecycle_recert_trg on public.matches;
create trigger kdk_match_lifecycle_recert_trg
  after update on public.matches
  for each row
  when (old.status = 'waiting' and new.status = 'waiting')
  execute function public.kdk_match_lifecycle_recert();

-- 설치 전부터 있던 경기: 증명 불가(uncertifiable). waiting 이 아니면 이탈 시각도 기록.
insert into public.kdk_match_lifecycle (match_id, club_id, session_id, certified, left_waiting_at, first_left_status, note)
select m.id::text, m.club_id::text, m.session_id::text, false,
       case when m.status is distinct from 'waiting' then now() end,
       case when m.status is distinct from 'waiting' then m.status::text end,
       'pre_install'
  from public.matches m
on conflict (match_id) do nothing;

-- ── 2) 생성 회차 ─────────────────────────────────────────────────────────────
create table if not exists public.kdk_spotlight_runs (
    id                   uuid        primary key default gen_random_uuid(),
    club_id              text        not null,
    session_id           text        not null,
    public_slug          text        not null check (public_slug ~ '^[a-z0-9]{12,32}$'),
    status               text        not null check (status in ('draft','published','unpublished','superseded')),
    revision             integer     not null check (revision >= 1),
    model_version        text        not null,
    select_version       text        not null,
    cutoff_date          text        not null check (cutoff_date ~ '^\d{4}-\d{2}-\d{2}$'),
    source_signature     text        not null,
    source_archive_count integer     not null check (source_archive_count >= 0),
    source_game_count    integer     not null check (source_game_count >= 0),
    session_title        text        not null default '',
    session_date         text        not null default '',
    public_payload       jsonb       not null check (jsonb_typeof(public_payload) = 'object'),
    generated_at         timestamptz not null default now(),
    generated_by         uuid        not null,
    published_at         timestamptz,
    published_by         uuid,
    unpublished_at       timestamptz,
    unpublished_by       uuid,
    superseded_by        uuid,
    unique (session_id, revision)
);
comment on table public.kdk_spotlight_runs is
    'MATCH SPOTLIGHT 생성 회차. 세션당 draft ≤1 · published ≤1. slug 는 세션 내 고정. 쓰기는 service_role RPC 만.';
create unique index if not exists kdk_spotlight_runs_one_draft
    on public.kdk_spotlight_runs (session_id) where status = 'draft';
create unique index if not exists kdk_spotlight_runs_one_published
    on public.kdk_spotlight_runs (session_id) where status = 'published';
create unique index if not exists kdk_spotlight_runs_published_slug
    on public.kdk_spotlight_runs (public_slug) where status = 'published';
alter table public.kdk_spotlight_runs enable row level security;
revoke all on public.kdk_spotlight_runs from anon, authenticated;

-- ── 3) 경기별 예측 snapshot ──────────────────────────────────────────────────
create table if not exists public.kdk_match_predictions (
    id                  uuid         primary key default gen_random_uuid(),
    run_id              uuid         not null references public.kdk_spotlight_runs(id) on delete restrict,
    club_id             text         not null,
    session_id          text         not null,
    match_id            text         not null,
    match_no            integer      not null,
    round               integer      not null default 0,
    player_ids          text[]       not null check (cardinality(player_ids) = 4),
    players_hash        text         not null,
    model_version       text         not null,
    tier                text         not null check (tier in ('model','reference','insufficient')),
    prob_a              numeric(6,4) check (prob_a is null or (prob_a >= 0 and prob_a <= 1)),
    snapshot            jsonb        not null,       -- SpotlightPredictionSnapshot 전체(비공개)
    main_type           text         check (main_type is null or main_type in ('RIVAL','CLOSE','HOT_STREAK','POWER')),
    score               numeric(7,2) not null default 0,
    selected            boolean      not null default false,
    status              text         not null check (status in ('active','superseded','invalidated')),
    invalid_reason      text,
    verified_waiting_at timestamptz  not null default now(),
    created_at          timestamptz  not null default now(),
    check ((tier = 'insufficient') = (prob_a is null))
);
comment on table public.kdk_match_predictions is
    '경기 시작 전 예측 snapshot. 경기당 active ≤1. 증명서로 시작 전임이 확인된 경기만 저장.';
create unique index if not exists kdk_match_predictions_one_active
    on public.kdk_match_predictions (session_id, match_id) where status = 'active';
create index if not exists kdk_match_predictions_run_idx on public.kdk_match_predictions (run_id);
alter table public.kdk_match_predictions enable row level security;
revoke all on public.kdk_match_predictions from anon, authenticated;

-- ── 공통 helper ──────────────────────────────────────────────────────────────
-- SPOTLIGHT 관리 권한 = 기존 KDK 관리자 체계(SQL 30 can_manage_kdk: CEO · ADMIN · kdk_managers 등재 회원) 그대로.
--   · CEO · ADMIN 은 바로 허용(30 미적용 DB 와 같은 결과).
--   · 그 외에는 can_manage_kdk() 를 "그 사용자"로 평가해 판정한다 — 규칙을 복제하지 않는다.
--     service_role 로 호출되는 RPC(p_actor 전달)에서는 판정하는 동안만 JWT 주체를 p_user 로 바꾸고 즉시 원래 값으로 되돌린다.
--   · can_manage_kdk 가 없는 DB(SQL 30 미적용)에서는 CEO · ADMIN 만(권한 확대 없음).
create or replace function public.kdk_spotlight_is_admin(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role        text;
  v_prev_sub    text;
  v_prev_claims text;
  v_ok          boolean := false;
begin
  if p_user is null then
    return false;
  end if;
  select upper(btrim(coalesce(pr.role, ''))) into v_role from public.profiles pr where pr.id::text = p_user::text;
  if v_role in ('CEO', 'ADMIN') then
    return true;
  end if;
  if to_regprocedure('public.can_manage_kdk()') is null then
    return false;
  end if;
  if auth.uid() is not distinct from p_user then
    return coalesce(public.can_manage_kdk(), false);
  end if;
  v_prev_sub    := current_setting('request.jwt.claim.sub', true);
  v_prev_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  begin
    v_ok := coalesce(public.can_manage_kdk(), false);
  exception when others then
    v_ok := false;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  return v_ok;
end;
$$;
revoke all on function public.kdk_spotlight_is_admin(uuid) from public, anon, authenticated;

-- trigger 세 개가 존재하고 활성(tgenabled <> 'D')인가.
create or replace function public.kdk_spotlight_ledger_healthy()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) = 3
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'matches' and not t.tgisinternal
     and t.tgname in ('kdk_match_lifecycle_insert_trg', 'kdk_match_lifecycle_status_trg', 'kdk_match_lifecycle_recert_trg')
     and t.tgenabled <> 'D';
$$;
revoke all on function public.kdk_spotlight_ledger_healthy() from public, anon, authenticated;

-- 경기 하나의 예측 가능 사유(null = 가능). 호출자는 이미 matches 행을 잠근 상태여야 한다.
--   p_xmin = 잠근 matches 행의 현재 xmin. 증명 버전과 다르면 row_changed(체인 단절).
drop function if exists public.kdk_spotlight_match_block_reason(text, text);   -- v2 서명 제거(재적용 대비)
create or replace function public.kdk_spotlight_match_block_reason(p_match_id text, p_status text, p_xmin xid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_status is distinct from 'waiting' then 'not_waiting'
    when exists (select 1 from public.kdk_match_lifecycle_faults f where f.match_id = p_match_id) then 'ledger_fault'
    when not exists (select 1 from public.kdk_match_lifecycle l where l.match_id = p_match_id) then 'no_certificate'
    when exists (select 1 from public.kdk_match_lifecycle l where l.match_id = p_match_id and l.left_waiting_at is not null) then 'started_before'
    when exists (select 1 from public.kdk_match_lifecycle l where l.match_id = p_match_id and not l.certified) then 'uncertifiable'
    when p_xmin is null or not exists (select 1 from public.kdk_match_lifecycle l
                                        where l.match_id = p_match_id and l.certified_xmin = p_xmin) then 'row_changed'
    else null end;
$$;
revoke all on function public.kdk_spotlight_match_block_reason(text, text, xid) from public, anon, authenticated;

-- ── 4-1) 저장(service_role 전용, all-or-nothing) ────────────────────────────
create or replace function public.save_kdk_spotlight_run(
    p_club_id     text,
    p_session_id  text,
    p_actor       uuid,
    p_run         jsonb,
    p_predictions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rejected jsonb := '[]'::jsonb;
  v_item     jsonb;
  v_mid      text;
  v_status   text;
  v_pids     text[];
  v_xmin     xid;
  v_reason   text;
  v_slug     text;
  v_revision integer;
  v_run_id   uuid;
  v_saved    integer := 0;
begin
  if not public.kdk_spotlight_is_admin(p_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if coalesce(btrim(p_club_id), '') = '' or coalesce(btrim(p_session_id), '') = ''
     or jsonb_typeof(p_predictions) is distinct from 'array' or jsonb_typeof(p_run) is distinct from 'object'
     or jsonb_typeof(p_run->'public_payload') is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  if not public.kdk_spotlight_ledger_healthy() then
    return jsonb_build_object('ok', false, 'reason', 'ledger_unhealthy');
  end if;
  if exists (select 1 from public.teyeon_archive_v1 a where a.id::text = p_session_id) then
    return jsonb_build_object('ok', false, 'reason', 'session_archived');
  end if;

  -- KDK 쪽이 아니라 이쪽이 양보한다: 잠금을 오래 기다리지 않는다(교착 탐지 1s 전에 포기).
  set local lock_timeout = '800ms';
  perform pg_advisory_xact_lock(hashtextextended('kdk_spotlight:' || p_club_id || ':' || p_session_id, 0));

  -- 세션 경기 행 잠금(고정 순서) — 이 트랜잭션 동안 경기 시작/완료/선수 변경과 직렬화.
  perform 1 from (
    select m.id from public.matches m
     where m.club_id::text = p_club_id and m.session_id::text = p_session_id
     order by m.id::text
     for update
  ) locked;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_matches');
  end if;

  for v_item in select * from jsonb_array_elements(p_predictions) loop
    v_mid := v_item->>'match_id';
    select m.status::text, m.player_ids::text[], m.xmin into v_status, v_pids, v_xmin
      from public.matches m
     where m.club_id::text = p_club_id and m.session_id::text = p_session_id and m.id::text = v_mid;
    if not found then
      v_reason := 'not_found';
    else
      v_reason := public.kdk_spotlight_match_block_reason(v_mid, v_status, v_xmin);
      if v_reason is null and v_pids is distinct from array(select jsonb_array_elements_text(v_item->'player_ids')) then
        v_reason := 'player_mismatch';
      end if;
    end if;
    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object('match_id', v_mid, 'reason', v_reason);
    end if;
  end loop;
  if jsonb_array_length(v_rejected) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'stale_matches', 'rejected', v_rejected);
  end if;

  select r.public_slug into v_slug
    from public.kdk_spotlight_runs r
   where r.session_id = p_session_id
   order by r.revision asc
   limit 1;                                             -- 세션 최초 slug 고정(공유 링크 불변)
  v_slug := coalesce(v_slug, nullif(p_run->>'public_slug', ''));
  if v_slug is null or v_slug !~ '^[a-z0-9]{12,32}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  end if;
  select coalesce(max(r.revision), 0) + 1 into v_revision
    from public.kdk_spotlight_runs r where r.session_id = p_session_id;

  -- 기존 draft → superseded 후 새 draft(부분 unique 위반 방지 순서).
  update public.kdk_spotlight_runs set status = 'superseded'
   where session_id = p_session_id and status = 'draft';

  insert into public.kdk_spotlight_runs (
      club_id, session_id, public_slug, status, revision, model_version, select_version, cutoff_date,
      source_signature, source_archive_count, source_game_count, session_title, session_date,
      public_payload, generated_by)
  values (
      p_club_id, p_session_id, v_slug, 'draft', v_revision, p_run->>'model_version', p_run->>'select_version',
      p_run->>'cutoff_date', p_run->>'source_signature', (p_run->>'source_archive_count')::int,
      (p_run->>'source_game_count')::int, left(coalesce(p_run->>'session_title', ''), 80),
      left(coalesce(p_run->>'session_date', ''), 10), p_run->'public_payload', p_actor)
  returning id into v_run_id;

  update public.kdk_spotlight_runs set superseded_by = v_run_id
   where session_id = p_session_id and status = 'superseded' and superseded_by is null and id <> v_run_id;

  for v_item in select * from jsonb_array_elements(p_predictions) loop
    update public.kdk_match_predictions set status = 'superseded'
     where session_id = p_session_id and match_id = v_item->>'match_id' and status = 'active';
    insert into public.kdk_match_predictions (
        run_id, club_id, session_id, match_id, match_no, round, player_ids, players_hash, model_version,
        tier, prob_a, snapshot, main_type, score, selected, status)
    values (
        v_run_id, p_club_id, p_session_id, v_item->>'match_id', (v_item->>'match_no')::int,
        coalesce((v_item->>'round')::int, 0), array(select jsonb_array_elements_text(v_item->'player_ids')),
        v_item->>'players_hash', v_item->>'model_version', v_item->>'tier',
        nullif(v_item->>'prob_a', '')::numeric, v_item->'snapshot',
        nullif(v_item->>'main_type', ''), coalesce((v_item->>'score')::numeric, 0),
        coalesce((v_item->>'selected')::boolean, false), 'active');
    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reason', 'saved', 'run_id', v_run_id, 'revision', v_revision,
                            'public_slug', v_slug, 'saved', v_saved);
end;
$$;
revoke all on function public.save_kdk_spotlight_run(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_kdk_spotlight_run(text, text, uuid, jsonb, jsonb) to service_role;

-- ── 4-2) 공개 직전 재검증용 조회(service_role 전용) ─────────────────────────
--   route 가 이 결과(저장 snapshot + 현재 선수 구성)로 공개 DTO 를 다시 만든다.
create or replace function public.get_kdk_spotlight_run_for_publish(p_run_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.kdk_spotlight_runs%rowtype;
begin
  if not public.kdk_spotlight_is_admin(p_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into v_run from public.kdk_spotlight_runs where id = p_run_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object(
    'ok', true,
    'run', jsonb_build_object('id', v_run.id, 'club_id', v_run.club_id, 'session_id', v_run.session_id,
                              'status', v_run.status, 'revision', v_run.revision, 'public_slug', v_run.public_slug,
                              'model_version', v_run.model_version, 'select_version', v_run.select_version,
                              'cutoff_date', v_run.cutoff_date, 'session_title', v_run.session_title,
                              'session_date', v_run.session_date),
    'predictions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'match_id', p.match_id, 'status', p.status, 'selected', p.selected, 'snapshot', p.snapshot,
               'current_player_ids', to_jsonb(m.player_ids::text[]))
             order by p.match_no)
        from public.kdk_match_predictions p
        left join public.matches m on m.id::text = p.match_id and m.session_id::text = p.session_id
       where p.run_id = v_run.id), '[]'::jsonb));
end;
$$;
revoke all on function public.get_kdk_spotlight_run_for_publish(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_kdk_spotlight_run_for_publish(uuid, uuid) to service_role;

-- ── 4-3) 공개 / 비공개(service_role 전용) ───────────────────────────────────
create or replace function public.publish_kdk_spotlight_run(
    p_run_id               uuid,
    p_actor                uuid,
    p_public_payload       jsonb,
    p_invalidate_match_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run    public.kdk_spotlight_runs%rowtype;
  v_latest integer;
begin
  if not public.kdk_spotlight_is_admin(p_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if jsonb_typeof(p_public_payload) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  select * into v_run from public.kdk_spotlight_runs where id = p_run_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform pg_advisory_xact_lock(hashtextextended('kdk_spotlight:' || v_run.club_id || ':' || v_run.session_id, 0));
  select * into v_run from public.kdk_spotlight_runs where id = p_run_id for update;   -- 잠금 후 재조회
  if v_run.status = 'published' then
    return jsonb_build_object('ok', true, 'reason', 'already_published', 'public_slug', v_run.public_slug);
  end if;
  if v_run.status not in ('draft', 'unpublished') then
    return jsonb_build_object('ok', false, 'reason', 'not_publishable', 'status', v_run.status);
  end if;
  select max(r.revision) into v_latest
    from public.kdk_spotlight_runs r where r.session_id = v_run.session_id and r.status <> 'superseded';
  if v_run.revision <> v_latest then
    return jsonb_build_object('ok', false, 'reason', 'not_latest');
  end if;

  update public.kdk_match_predictions
     set status = 'invalidated', invalid_reason = 'players_changed_before_publish', selected = false
   where run_id = p_run_id and status = 'active' and match_id = any(coalesce(p_invalidate_match_ids, '{}'));

  update public.kdk_spotlight_runs set status = 'superseded', superseded_by = p_run_id
   where session_id = v_run.session_id and status = 'published';
  update public.kdk_spotlight_runs
     set status = 'published', public_payload = p_public_payload, published_at = now(), published_by = p_actor,
         unpublished_at = null, unpublished_by = null
   where id = p_run_id;
  return jsonb_build_object('ok', true, 'reason', 'published', 'public_slug', v_run.public_slug);
end;
$$;
revoke all on function public.publish_kdk_spotlight_run(uuid, uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.publish_kdk_spotlight_run(uuid, uuid, jsonb, text[]) to service_role;

create or replace function public.unpublish_kdk_spotlight_run(p_club_id text, p_session_id text, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  if not public.kdk_spotlight_is_admin(p_actor) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kdk_spotlight:' || p_club_id || ':' || p_session_id, 0));
  update public.kdk_spotlight_runs
     set status = 'unpublished', unpublished_at = now(), unpublished_by = p_actor
   where club_id = p_club_id and session_id = p_session_id and status = 'published';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'reason', case when v_n > 0 then 'unpublished' else 'not_published' end);
end;
$$;
revoke all on function public.unpublish_kdk_spotlight_run(text, text, uuid) from public, anon, authenticated;
grant execute on function public.unpublish_kdk_spotlight_run(text, text, uuid) to service_role;

-- ── 4-4) 운영진 미리보기(authenticated CEO/ADMIN/KDK 관리자 — 읽기 전용) ───────────────
create or replace function public.get_kdk_spotlight_admin(p_session_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.kdk_spotlight_is_admin(auth.uid()) then
    raise exception 'not authorized: KDK manager(CEO/ADMIN/kdk_managers) required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ok', true,
    'ledger_healthy', public.kdk_spotlight_ledger_healthy(),
    'runs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'status', r.status, 'revision', r.revision, 'public_slug', r.public_slug,
               'model_version', r.model_version, 'cutoff_date', r.cutoff_date,
               'source_archive_count', r.source_archive_count, 'source_game_count', r.source_game_count,
               'generated_at', r.generated_at, 'published_at', r.published_at, 'unpublished_at', r.unpublished_at,
               'public_payload', r.public_payload)
             order by r.revision desc)
        from public.kdk_spotlight_runs r
       where r.session_id = p_session_id and r.status in ('draft', 'published', 'unpublished')), '[]'::jsonb));
end;
$$;
revoke all on function public.get_kdk_spotlight_admin(text) from public, anon;
grant execute on function public.get_kdk_spotlight_admin(text) to authenticated;

-- ── 4-5) 공개 조회(anon) — published 만 · 공개 DTO 만 · 선수 교체 경기 숨김 ──
create or replace function public.get_public_kdk_spotlight(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_run     public.kdk_spotlight_runs%rowtype;
  v_hidden  integer[];
  v_payload jsonb;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]{12,32}$' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_run from public.kdk_spotlight_runs where public_slug = p_slug and status = 'published';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select coalesce(array_agg(p.match_no), '{}') into v_hidden
    from public.kdk_match_predictions p
    join public.matches m on m.id::text = p.match_id and m.session_id::text = p.session_id
   where p.run_id = v_run.id and p.status = 'active' and m.player_ids::text[] is distinct from p.player_ids;

  v_payload := v_run.public_payload;
  if cardinality(v_hidden) > 0 then
    v_payload := jsonb_set(v_payload, '{items}', coalesce((
      select jsonb_agg(i) from jsonb_array_elements(coalesce(v_payload->'items', '[]'::jsonb)) i
       where not ((i->>'matchNo')::int = any(v_hidden))), '[]'::jsonb));
    v_payload := jsonb_set(v_payload, '{matches}', coalesce((
      select jsonb_agg(i) from jsonb_array_elements(coalesce(v_payload->'matches', '[]'::jsonb)) i
       where not ((i->>'matchNo')::int = any(v_hidden))), '[]'::jsonb));
  end if;
  return jsonb_build_object('ok', true, 'published_at', v_run.published_at, 'payload', v_payload,
                            'hidden_count', cardinality(v_hidden));
end;
$$;
revoke all on function public.get_public_kdk_spotlight(text) from public;
grant execute on function public.get_public_kdk_spotlight(text) to anon, authenticated;

create or replace function public.get_public_kdk_spotlight_link(p_session_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'public_slug', r.public_slug,
                               'item_count', jsonb_array_length(coalesce(r.public_payload->'items', '[]'::jsonb)))
       from public.kdk_spotlight_runs r
      where r.session_id = p_session_id and r.status = 'published'
      limit 1),
    jsonb_build_object('ok', false, 'reason', 'not_published'));
$$;
revoke all on function public.get_public_kdk_spotlight_link(text) from public;
grant execute on function public.get_public_kdk_spotlight_link(text) to anon, authenticated;

commit;
