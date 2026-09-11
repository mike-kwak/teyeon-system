-- =============================================================================
-- TEYEON 주최 공개 대회(hosted tournament) — 참가신청 MVP
--
-- 목적: QR 로 들어온 외부 참가자가 로그인 없이 복식 1팀을 접수하고,
--       운영진(CEO/ADMIN)이 신청 목록과 입금 상태를 관리한다.
--
-- 네임스페이스 주의 ⚠
--   · public.tournament_events / tournament_pairs / tournament_partner_requests 는
--     /tournament-calendar(회원이 "출전"하는 외부 대회 캘린더)가 이미 쓰는 테이블이며
--     anon 공개 SELECT 정책이 걸려 있다. 이 마이그레이션은 그 테이블을 절대 건드리지 않는다.
--   · 여기서 만드는 hosted_* 는 "TEYEON 이 주최하는" 대회 전용이다.
--
-- 보안 원칙(PUBLIC_GUEST 패턴 재사용 — supabase/add_guest_recruitments_applications.sql)
--   · 개인정보 테이블에 anon 직접 접근 전면 차단(revoke). 공개 동작은 SECURITY DEFINER RPC 로만.
--   · 공개 RPC 응답에 전화번호/입금자명/메모/운영메모/내부 UUID/이력을 넣지 않는다.
--   · 접수순번·정원(48/60) 판정·중복 차단은 전부 서버가 한 트랜잭션 안에서 원자적으로 처리한다.
--     클라이언트 count 기반 판정 금지.
--   · Admin RPC 는 authenticated 에게만 grant 하고, 함수 안에서 CEO/ADMIN 을 다시 검증한다.
--
-- 이번 MVP 에서 만들지 않는 것: SMS 관련 컬럼/상태, PG 결제, 자동 환불,
--   나이·합산연령 관련 컬럼(우선순위 기준 미확정 — 요강 표기만 하고 로직화하지 않는다).
--
-- ⚠️ 초안. 사용자 승인 후 Supabase SQL Editor 에서 1회 실행. 운영 DB 자동 적용 금지.
-- rollback: supabase/add_hosted_tournament_registration_mvp_rollback.sql
-- verify  : supabase/add_hosted_tournament_registration_mvp_verify.sql
-- =============================================================================


-- ── 0. 권한 helper ────────────────────────────────────────────────────────────
--   Admin Console 과 동일 기준(profiles.role). members.role(클럽 직책)은 쓰지 않는다.
--   /admin/** 기본 정책이 CEO/ADMIN 이므로 여기도 CEO/ADMIN 로 시작한다.
create or replace function public.can_manage_tournaments()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')
    );
$$;
revoke execute on function public.can_manage_tournaments() from public;
revoke execute on function public.can_manage_tournaments() from anon;
grant  execute on function public.can_manage_tournaments() to authenticated;


-- ── 0-1. 내부 helper: 전화 정규화 / 페어키 ─────────────────────────────────────
--   페어키는 반드시 서버에서 만든다. 클라이언트가 보낸 pair_key 는 신뢰하지 않는다(애초에 받지 않는다).
--   두 번호를 정렬해 결합하므로 선수1/선수2 순서를 바꿔 재신청해도 같은 팀으로 판정된다.
create or replace function public.hosted_tournament_normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
    select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
$$;
-- 내부 전용 — 어떤 클라이언트 role 도 직접 실행할 수 없게 한다.
--   SECURITY DEFINER 함수 안에서는 소유자 권한으로 호출되므로 submit RPC 동작에는 영향이 없다.
revoke execute on function public.hosted_tournament_normalize_phone(text) from public;
revoke execute on function public.hosted_tournament_normalize_phone(text) from anon;
revoke execute on function public.hosted_tournament_normalize_phone(text) from authenticated;

create or replace function public.hosted_tournament_pair_key(p_phone1 text, p_phone2 text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
    select least(public.hosted_tournament_normalize_phone(p_phone1),
                 public.hosted_tournament_normalize_phone(p_phone2))
        || '|' ||
           greatest(public.hosted_tournament_normalize_phone(p_phone1),
                    public.hosted_tournament_normalize_phone(p_phone2));
$$;
revoke execute on function public.hosted_tournament_pair_key(text,text) from public;
revoke execute on function public.hosted_tournament_pair_key(text,text) from anon;
revoke execute on function public.hosted_tournament_pair_key(text,text) from authenticated;


-- ── 1. 대회 ───────────────────────────────────────────────────────────────────
create table if not exists public.hosted_tournaments (
    id                     uuid        primary key default gen_random_uuid(),
    -- QR 영구 진입점의 키. 한 번 정하면 바꾸지 않는다(/tournaments/<slug>).
    slug                   text        not null unique
                                       check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
    title                  text        not null,
    subtitle               text,
    -- draft = 비공개(공개 RPC 가 아무것도 반환하지 않음). 접수는 registration_open 에서만 가능.
    status                 text        not null default 'draft'
                                       check (status in ('draft', 'published', 'registration_open',
                                                         'registration_closed', 'in_progress',
                                                         'completed', 'cancelled')),
    event_date             date        not null,
    event_start_time       time,
    registration_open_at   timestamptz,          -- null = status 로만 제어
    registration_close_at  timestamptz not null,
    venue_name             text        not null,
    organizer_name         text        not null,
    sponsor_name           text,
    entry_fee              integer     not null default 0 check (entry_fee >= 0),
    -- 48 = 우선 참가 기준(hard cap 아님) / 60 = 실제 접수 상한.
    target_capacity        integer     not null check (target_capacity >= 1),
    max_capacity           integer     not null check (max_capacity >= 1),
    -- 접수번호 접두어. 'TO' → TO-2026-0031. 개인정보를 포함하지 않는다.
    registration_no_prefix text        not null default 'TO'
                                       check (registration_no_prefix ~ '^[A-Z]{1,6}$'),
    contact_label          text,
    contact_phone          text,
    bank_name              text,
    bank_account           text,
    bank_holder            text,
    published_at           timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint hosted_tournaments_capacity_order check (max_capacity >= target_capacity)
);
comment on table public.hosted_tournaments is
    'TEYEON 주최 공개 대회. /tournaments/<slug> 의 단일 출처. ⚠ 회원 출전용 대회 캘린더 테이블과는 별개 도메인.';
comment on column public.hosted_tournaments.target_capacity is
    '우선 참가 기준(48). 초과분은 waitlisted 로 접수된다 — hard cap 이 아니다.';
comment on column public.hosted_tournaments.max_capacity is
    '실제 접수 상한(60). 이 수를 넘으면 TOURNAMENT_FULL.';

create index if not exists hosted_tournaments_status_idx on public.hosted_tournaments (status);


-- ── 2. 참가신청(1 row = 복식 1팀, 개인정보 포함) ─────────────────────────────────
create table if not exists public.hosted_tournament_registrations (
    id                        uuid        primary key default gen_random_uuid(),
    tournament_id             uuid        not null references public.hosted_tournaments(id) on delete cascade,
    -- 접수 순번. 취소분을 재사용하지 않는다(접수번호가 영구 고유해야 하므로).
    sequence_no               integer     not null check (sequence_no >= 1),
    registration_no           text        not null,

    player1_name              text        not null,
    player1_phone             text        not null,   -- 표시용 원문(trim)
    player1_phone_norm        text        not null    -- 숫자만 — 비교 키
                                          check (player1_phone_norm ~ '^01[0-9]{8,9}$'),
    player2_name              text        not null,
    player2_phone             text        not null,
    player2_phone_norm        text        not null
                                          check (player2_phone_norm ~ '^01[0-9]{8,9}$'),
    -- 두 정규화 번호를 정렬해 결합한 값. 서버가 생성한다.
    pair_key                  text        not null,

    -- 선택 입력. 공식 요강에 클럽 소속이 참가 조건으로 없다.
    --   비어 있으면 NULL 로 둔다 — '무소속' 같은 대체 문자열을 만들어 저장하지 않는다.
    club_name                 text,
    depositor_name            text        not null,
    note                      text,

    -- 신청 상태와 입금 상태는 절대 한 필드로 합치지 않는다.
    registration_status       text        not null default 'applied'
                                          check (registration_status in ('applied', 'waitlisted', 'confirmed',
                                                                         'cancelled', 'rejected')),
    payment_status            text        not null default 'pending'
                                          check (payment_status in ('pending', 'paid',
                                                                    'refund_pending', 'refunded')),

    -- "동의했다"가 아니라 "언제 동의했다"를 남긴다. 미동의면 애초에 INSERT 되지 않는다.
    eligibility_confirmed_at  timestamptz not null,
    regulations_confirmed_at  timestamptz not null,
    privacy_agreed_at         timestamptz not null,
    media_notice_confirmed_at timestamptz not null,

    submitted_at              timestamptz not null default now(),
    confirmed_at              timestamptz,
    cancelled_at              timestamptz,

    admin_note                text,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),

    constraint hosted_treg_seq_unique      unique (tournament_id, sequence_no),
    constraint hosted_treg_no_unique       unique (tournament_id, registration_no),
    -- 같은 사람이 자기 자신과 페어를 이룰 수 없다.
    constraint hosted_treg_distinct_phones check (player1_phone_norm <> player2_phone_norm)
);
comment on table public.hosted_tournament_registrations is
    '주최 대회 참가신청(개인정보). anon 직접 접근 불가 — 제출은 RPC, 조회/변경은 CEO/ADMIN.';
comment on column public.hosted_tournament_registrations.pair_key is
    '정규화 전화번호 2개를 정렬·결합. 선수 순서를 바꾼 재신청도 동일 팀으로 판정.';
comment on column public.hosted_tournament_registrations.club_name is
    '선택 입력. NULL 허용 — 빈 값을 임의 문자열로 채우지 않는다.';

create index if not exists hosted_treg_tournament_seq_idx
    on public.hosted_tournament_registrations (tournament_id, sequence_no);
create index if not exists hosted_treg_status_idx
    on public.hosted_tournament_registrations (tournament_id, registration_status);

-- 활성 상태에서만 동일 페어 중복 차단. cancelled/rejected 후에는 재신청을 허용한다.
--   전화번호 단독 전역 UNIQUE 는 걸지 않는다(정상적인 수정·재접수를 막지 않기 위해).
create unique index if not exists hosted_treg_active_pair
    on public.hosted_tournament_registrations (tournament_id, pair_key)
 where registration_status in ('applied', 'waitlisted', 'confirmed');


-- ── 3. 상태 변경 이력 ──────────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_registration_history (
    id              uuid        primary key default gen_random_uuid(),
    registration_id uuid        not null references public.hosted_tournament_registrations(id) on delete cascade,
    action          text        not null
                                check (action in ('submit', 'registration_status', 'payment_status', 'admin_note')),
    from_value      text,
    to_value        text,
    -- 내부 기록 전용. 공개 RPC 에 절대 노출하지 않는다.
    actor_user_id   uuid        references auth.users(id) on delete set null,
    actor_type      text        not null check (actor_type in ('public', 'admin', 'system')),
    note            text,
    created_at      timestamptz not null default now()
);
comment on table public.hosted_tournament_registration_history is
    '신청 상태/입금 상태/운영메모 변경 이력. actor_user_id 는 내부 기록 전용(공개 금지).';

create index if not exists hosted_treg_history_reg_idx
    on public.hosted_tournament_registration_history (registration_id, created_at desc);


-- ── 4. RLS · 테이블 권한 ──────────────────────────────────────────────────────
--   Supabase 프로젝트에는 다음 기본 권한이 걸려 있다:
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
--   즉 create table 시점에 anon 과 authenticated 가 이미 ALL
--   (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER)을 자동으로 받는다.
--   ⚠ 그래서 revoke 대상에서 authenticated 를 빠뜨리면, 뒤의 grant select 는 이미 가진 권한의
--      부분집합이라 아무 효과가 없고 쓰기 권한이 그대로 남는다(2026-09-10 verify seq 13 FAIL 원인).
--      반드시 public, anon, authenticated 를 모두 회수한 뒤 필요한 것만 다시 부여한다.
--
--   계약: anon = 권한 0 / authenticated = SELECT ONLY / 쓰기는 SECURITY DEFINER RPC 로만.
alter table public.hosted_tournaments                     enable row level security;
alter table public.hosted_tournament_registrations        enable row level security;
alter table public.hosted_tournament_registration_history enable row level security;

revoke all on table public.hosted_tournaments                     from public, anon, authenticated;
revoke all on table public.hosted_tournament_registrations        from public, anon, authenticated;
revoke all on table public.hosted_tournament_registration_history from public, anon, authenticated;

-- authenticated 는 SELECT 만. INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 를 주지 않는다.
--   (실제 행 노출은 RLS 정책 can_manage_tournaments() 가 2차로 제한한다)
grant select on table public.hosted_tournaments                     to authenticated;
grant select on table public.hosted_tournament_registrations        to authenticated;
grant select on table public.hosted_tournament_registration_history to authenticated;

-- 정책: 운영진(CEO/ADMIN)만 SELECT 실효. 그 외 authenticated 는 0행.
drop policy if exists hosted_tournaments_select_manager on public.hosted_tournaments;
create policy hosted_tournaments_select_manager on public.hosted_tournaments
    for select to authenticated
    using (public.can_manage_tournaments());

drop policy if exists hosted_treg_select_manager on public.hosted_tournament_registrations;
create policy hosted_treg_select_manager on public.hosted_tournament_registrations
    for select to authenticated
    using (public.can_manage_tournaments());

drop policy if exists hosted_treg_history_select_manager on public.hosted_tournament_registration_history;
create policy hosted_treg_history_select_manager on public.hosted_tournament_registration_history
    for select to authenticated
    using (public.can_manage_tournaments());
-- INSERT/UPDATE/DELETE 정책 없음 → 직접 쓰기 경로가 존재하지 않는다.


-- ── 5. 공개 RPC: 대회 정보 + 접수 현황 ────────────────────────────────────────
--   반환 화이트리스트만 채운다. 내부 UUID(id), 계좌정보, 신청자 정보는 반환하지 않는다.
--   draft 대회는 아무것도 반환하지 않는다(공개 전 노출 방지).
create or replace function public.get_public_tournament(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_t      public.hosted_tournaments%rowtype;
    v_active int;
    v_wait   int;
begin
    select * into v_t from public.hosted_tournaments
     where slug = p_slug and status <> 'draft';
    if v_t.id is null then
        return null;  -- 없음/비공개 — 클라이언트는 "준비 중"으로 처리한다.
    end if;

    select count(*) filter (where r.registration_status in ('applied', 'waitlisted', 'confirmed')),
           count(*) filter (where r.registration_status = 'waitlisted')
      into v_active, v_wait
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id;

    return jsonb_build_object(
        'slug',                v_t.slug,
        'title',               v_t.title,
        'subtitle',            v_t.subtitle,
        'status',              v_t.status,
        'eventDate',           v_t.event_date,
        'eventStartTime',      to_char(v_t.event_start_time, 'HH24:MI'),
        'registrationOpenAt',  v_t.registration_open_at,
        'registrationCloseAt', v_t.registration_close_at,
        'venueName',           v_t.venue_name,
        'organizerName',       v_t.organizer_name,
        'sponsorName',         v_t.sponsor_name,
        'entryFee',            v_t.entry_fee,
        'targetCapacity',      v_t.target_capacity,
        'maxCapacity',         v_t.max_capacity,
        'appliedCount',        v_active,      -- 활성 신청 팀 수(applied+waitlisted+confirmed)
        'waitlistedCount',     v_wait,
        'remaining',           greatest(v_t.max_capacity - v_active, 0),
        'isRegistrationOpen',  (v_t.status = 'registration_open'
                                and (v_t.registration_open_at is null or now() >= v_t.registration_open_at)
                                and now() <= v_t.registration_close_at
                                and v_active < v_t.max_capacity)
    );
    -- ⚠ 미반환: id, bank_*, contact_*, published_at, created_at/updated_at, 신청자 정보 일체.
end;
$$;
revoke execute on function public.get_public_tournament(text) from public;
grant  execute on function public.get_public_tournament(text) to anon, authenticated;


-- ── 6. 공개 RPC: 참가팀 현황 ──────────────────────────────────────────────────
--   개인정보 없이 접수 순번/선수 이름/클럽명/공개 상태만. 입금 상태는 절대 공개하지 않는다.
create or replace function public.get_public_tournament_teams(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'sequenceNo',   r.sequence_no,
               'player1Name',  r.player1_name,
               'player2Name',  r.player2_name,
               'clubName',     r.club_name,          -- NULL 가능(선택 입력)
               'publicStatus', r.registration_status -- 'applied' | 'waitlisted' | 'confirmed'
           ) order by r.sequence_no), '[]'::jsonb)
      from public.hosted_tournament_registrations r
      join public.hosted_tournaments t on t.id = r.tournament_id
     where t.slug = p_slug
       and t.status <> 'draft'
       and r.registration_status in ('applied', 'waitlisted', 'confirmed');
    -- ⚠ 미반환: id, tournament_id, phone, phone_norm, pair_key, depositor_name,
    --           note, admin_note, payment_status, 각종 시각, 이력.
$$;
revoke execute on function public.get_public_tournament_teams(text) from public;
grant  execute on function public.get_public_tournament_teams(text) to anon, authenticated;


-- ── 7. 공개 RPC: 참가신청 제출 (anon 에게 허용되는 유일한 저장 경로) ──────────────
--   클라이언트 검증을 전혀 신뢰하지 않고 전 항목을 서버에서 다시 검증한다.
--   advisory lock 이후 구간(중복확인 → 정원확인 → 순번발급 → INSERT → 이력)은 한 트랜잭션이며
--   대회 단위로 직렬화되므로 동시 신청에도 48/60 경계가 깨지지 않는다.
create or replace function public.submit_tournament_registration(
    p_slug                    text,
    p_player1_name            text,
    p_player1_phone           text,
    p_player2_name            text,
    p_player2_phone           text,
    p_club_name               text,
    p_depositor_name          text,
    p_note                    text,
    p_eligibility_confirmed   boolean,
    p_regulations_confirmed   boolean,
    p_privacy_agreed          boolean,
    p_media_notice_confirmed  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_t          public.hosted_tournaments%rowtype;
    v_now        timestamptz := now();
    v_p1_name    text;
    v_p2_name    text;
    v_depositor  text;
    v_club       text;
    v_note       text;
    v_p1_norm    text;
    v_p2_norm    text;
    v_pair       text;
    v_active     int;
    v_seq        int;
    v_status     text;
    v_no         text;
    v_reg_id     uuid;
begin
    -- (1) 4개 확인/동의 — 하나라도 빠지면 저장하지 않는다.
    if not (coalesce(p_eligibility_confirmed, false)
            and coalesce(p_regulations_confirmed, false)
            and coalesce(p_privacy_agreed, false)
            and coalesce(p_media_notice_confirmed, false)) then
        raise exception 'CONSENT_REQUIRED' using errcode = '22023';
    end if;

    -- (2) 필수값 — club_name 은 선택이므로 여기서 요구하지 않는다.
    v_p1_name   := btrim(coalesce(p_player1_name, ''));
    v_p2_name   := btrim(coalesce(p_player2_name, ''));
    v_depositor := btrim(coalesce(p_depositor_name, ''));
    if v_p1_name = '' or v_p2_name = '' or v_depositor = '' then
        raise exception 'REQUIRED_FIELD_MISSING' using errcode = '22023';
    end if;

    v_club := nullif(btrim(coalesce(p_club_name, '')), '');
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    if length(v_p1_name) > 20 or length(v_p2_name) > 20 or length(v_depositor) > 20
       or (v_club is not null and length(v_club) > 40)
       or (v_note is not null and length(v_note) > 300) then
        raise exception 'FIELD_TOO_LONG' using errcode = '22023';
    end if;

    -- (3) 전화 정규화·형식·동일번호. 오류 메시지에 번호를 노출하지 않는다.
    --     ⚠ 원문 길이를 먼저 자른다. 정규화하면 숫자만 남으므로, 숫자 사이에 임의의 문자를
    --        대량으로 끼워 넣어도 형식 검사를 통과할 수 있다(원문 컬럼에 그대로 저장되는 것을 막는다).
    if length(coalesce(p_player1_phone, '')) > 32 or length(coalesce(p_player2_phone, '')) > 32 then
        raise exception 'INVALID_PHONE' using errcode = '22023';
    end if;
    v_p1_norm := public.hosted_tournament_normalize_phone(p_player1_phone);
    v_p2_norm := public.hosted_tournament_normalize_phone(p_player2_phone);
    if v_p1_norm !~ '^01[0-9]{8,9}$' or v_p2_norm !~ '^01[0-9]{8,9}$' then
        raise exception 'INVALID_PHONE' using errcode = '22023';
    end if;
    if v_p1_norm = v_p2_norm then
        raise exception 'SAME_PLAYER_PHONE' using errcode = '22023';
    end if;

    -- (4) 대회 존재 · 접수 상태 · 접수 기간.
    select * into v_t from public.hosted_tournaments where slug = p_slug;
    if v_t.id is null or v_t.status <> 'registration_open' then
        raise exception 'TOURNAMENT_NOT_OPEN' using errcode = '22023';
    end if;
    if v_t.registration_open_at is not null and v_now < v_t.registration_open_at then
        raise exception 'TOURNAMENT_NOT_OPEN' using errcode = '22023';
    end if;
    if v_now > v_t.registration_close_at then
        raise exception 'REGISTRATION_CLOSED' using errcode = '22023';
    end if;

    -- (5) 페어키는 서버가 만든다(클라이언트 입력을 받지 않는다).
    v_pair := public.hosted_tournament_pair_key(v_p1_norm, v_p2_norm);

    -- (6) 여기서부터 대회 단위 직렬화 — 트랜잭션 종료 시 자동 해제.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-registration:' || v_t.id::text));

    -- (7) 활성 중복 페어. 다른 팀의 정보를 알려주지 않고 일반 오류만 던진다.
    if exists (
        select 1 from public.hosted_tournament_registrations r
         where r.tournament_id = v_t.id
           and r.pair_key = v_pair
           and r.registration_status in ('applied', 'waitlisted', 'confirmed')
    ) then
        raise exception 'DUPLICATE_REGISTRATION' using errcode = '23505';
    end if;

    -- (8) 정원 — 활성 팀 수 기준. 취소된 팀은 자리를 비워 준다.
    select count(*) into v_active
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id
       and r.registration_status in ('applied', 'waitlisted', 'confirmed');

    if v_active >= v_t.max_capacity then
        raise exception 'TOURNAMENT_FULL' using errcode = '23514';
    end if;

    -- (9) 접수 순번 — max+1. 취소/거절된 신청의 번호를 재사용하지 않는다(접수번호 영구 고유).
    --     ⚠ 운영 주의: 신청 행을 물리 삭제(delete)하면 max 가 내려가 번호가 재사용될 수 있고,
    --        이미 발급된 접수번호와 겹치게 된다. 잘못된 신청은 반드시 delete 가 아니라
    --        registration_status = 'cancelled' / 'rejected' 로 처리한다(RPC 에도 삭제 경로가 없다).
    select coalesce(max(r.sequence_no), 0) + 1 into v_seq
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id;

    -- (10) 우선 참가 / 대기 판정 — 순번이 아니라 '현재 활성 팀 수' 기준.
    --      취소가 없으면 48번째=applied, 49번째=waitlisted 로 순번 기준과 결과가 같고,
    --      취소가 생기면 빈 자리를 다음 신청자가 채운다.
    v_status := case when v_active < v_t.target_capacity then 'applied' else 'waitlisted' end;

    -- (11) 접수번호 — 개인정보 미포함. 예: TO-2026-0031
    v_no := v_t.registration_no_prefix || '-' ||
            to_char(v_t.event_date, 'YYYY') || '-' ||
            lpad(v_seq::text, 4, '0');

    insert into public.hosted_tournament_registrations (
        tournament_id, sequence_no, registration_no,
        player1_name, player1_phone, player1_phone_norm,
        player2_name, player2_phone, player2_phone_norm,
        pair_key, club_name, depositor_name, note,
        registration_status, payment_status,
        eligibility_confirmed_at, regulations_confirmed_at,
        privacy_agreed_at, media_notice_confirmed_at,
        submitted_at
    ) values (
        v_t.id, v_seq, v_no,
        v_p1_name, btrim(coalesce(p_player1_phone, '')), v_p1_norm,
        v_p2_name, btrim(coalesce(p_player2_phone, '')), v_p2_norm,
        v_pair, v_club, v_depositor, v_note,
        v_status, 'pending',
        v_now, v_now, v_now, v_now,
        v_now
    )
    returning id into v_reg_id;

    insert into public.hosted_tournament_registration_history (
        registration_id, action, from_value, to_value, actor_type
    ) values (
        v_reg_id, 'submit', null, v_status, 'public'
    );

    -- (12) 최소 반환. 접수번호와 이름/참가비까지만.
    --
    --   입금 계좌는 공개 Hub RPC(get_public_tournament)에 절대 넣지 않는다.
    --   실제로 접수를 성공시킨 신청자에게만, 그것도 'applied'(우선 참가 대상)일 때만
    --   이 응답에 한 번 실어 보낸다. 원본 테이블 anon SELECT 를 여는 구조가 아니다.
    --
    --   ⚠ 'waitlisted' 에는 계좌를 내려보내지 않는다.
    --      대기팀(49~60)의 입금 정책이 아직 확정되지 않았으므로, 입금을 유도하는 정보를
    --      화면에 띄울 수 있는 데이터 자체를 서버가 주지 않는다.
    --      정책이 확정되면 아래 case 조건만 바꾸면 된다(화면 코드 수정 불필요).
    return jsonb_build_object(
        'registrationNo',     v_no,
        'registrationStatus', v_status,
        'paymentStatus',      'pending',
        'player1Name',        v_p1_name,
        'player2Name',        v_p2_name,
        'entryFee',           v_t.entry_fee
    ) || case
            when v_status = 'applied' then jsonb_build_object(
                'bankName',    v_t.bank_name,
                'bankAccount', v_t.bank_account,
                'bankHolder',  v_t.bank_holder
            )
            else '{}'::jsonb
         end;
    -- ⚠ 미반환: id, tournament_id, phone, phone_norm, pair_key, depositor_name, note, admin_note, 이력.
end;
$$;
revoke execute on function public.submit_tournament_registration(
    text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) from public;
grant  execute on function public.submit_tournament_registration(
    text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean) to anon, authenticated;


-- ── 8. 운영 RPC: 대회 목록 요약 ───────────────────────────────────────────────
create or replace function public.get_admin_hosted_tournaments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.can_manage_tournaments() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id',              t.id,
            'slug',            t.slug,
            'title',           t.title,
            'status',          t.status,
            'eventDate',       t.event_date,
            'registrationCloseAt', t.registration_close_at,
            'entryFee',        t.entry_fee,
            'targetCapacity',  t.target_capacity,
            'maxCapacity',     t.max_capacity,
            'activeCount',     (select count(*) from public.hosted_tournament_registrations r
                                 where r.tournament_id = t.id
                                   and r.registration_status in ('applied','waitlisted','confirmed')),
            'waitlistedCount', (select count(*) from public.hosted_tournament_registrations r
                                 where r.tournament_id = t.id and r.registration_status = 'waitlisted'),
            'confirmedCount',  (select count(*) from public.hosted_tournament_registrations r
                                 where r.tournament_id = t.id and r.registration_status = 'confirmed'),
            'paidCount',       (select count(*) from public.hosted_tournament_registrations r
                                 where r.tournament_id = t.id and r.payment_status = 'paid')
        ) order by t.event_date desc), '[]'::jsonb)
        from public.hosted_tournaments t
    );
end;
$$;
revoke execute on function public.get_admin_hosted_tournaments() from public;
revoke execute on function public.get_admin_hosted_tournaments() from anon;
grant  execute on function public.get_admin_hosted_tournaments() to authenticated;


-- ── 9. 운영 RPC: 신청 목록(개인정보 포함 — CEO/ADMIN 전용) ──────────────────────
create or replace function public.get_admin_tournament_registrations(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.can_manage_tournaments() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id',                     r.id,
            'sequenceNo',             r.sequence_no,
            'registrationNo',         r.registration_no,
            'player1Name',            r.player1_name,
            'player1Phone',           r.player1_phone_norm,
            'player2Name',            r.player2_name,
            'player2Phone',           r.player2_phone_norm,
            'clubName',               r.club_name,
            'depositorName',          r.depositor_name,
            'note',                   r.note,
            'registrationStatus',     r.registration_status,
            'paymentStatus',          r.payment_status,
            'eligibilityConfirmedAt', r.eligibility_confirmed_at,
            'regulationsConfirmedAt', r.regulations_confirmed_at,
            'privacyAgreedAt',        r.privacy_agreed_at,
            'mediaNoticeConfirmedAt', r.media_notice_confirmed_at,
            'submittedAt',            r.submitted_at,
            'confirmedAt',            r.confirmed_at,
            'cancelledAt',            r.cancelled_at,
            'adminNote',              r.admin_note
        ) order by r.sequence_no), '[]'::jsonb)
        from public.hosted_tournament_registrations r
        join public.hosted_tournaments t on t.id = r.tournament_id
       where t.slug = p_slug
    );
    -- pair_key 는 반환하지 않는다(운영 화면에서 쓸 일이 없는 내부 판정 키).
end;
$$;
revoke execute on function public.get_admin_tournament_registrations(text) from public;
revoke execute on function public.get_admin_tournament_registrations(text) from anon;
grant  execute on function public.get_admin_tournament_registrations(text) to authenticated;


-- ── 10. 운영 RPC: 상태 변경 이력 ──────────────────────────────────────────────
create or replace function public.get_tournament_registration_history(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.can_manage_tournaments() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'action',      h.action,
            'fromValue',   h.from_value,
            'toValue',     h.to_value,
            'actorType',   h.actor_type,
            'actorUserId', h.actor_user_id,   -- 운영 화면 전용. 공개 RPC 에는 절대 넣지 않는다.
            'note',        h.note,
            'createdAt',   h.created_at
        ) order by h.created_at desc), '[]'::jsonb)
        from public.hosted_tournament_registration_history h
       where h.registration_id = p_registration_id
    );
end;
$$;
revoke execute on function public.get_tournament_registration_history(uuid) from public;
revoke execute on function public.get_tournament_registration_history(uuid) from anon;
grant  execute on function public.get_tournament_registration_history(uuid) to authenticated;


-- ── 11. 운영 RPC: 신청/입금 상태 변경 + 운영메모 ───────────────────────────────
--   p_registration_status / p_payment_status / p_admin_note 는 NULL = '변경 없음'.
--   운영메모를 지우려면 빈 문자열('')을 넘긴다.
--   변경 항목마다 이력 1행을 남긴다.
create or replace function public.set_tournament_registration_status(
    p_registration_id     uuid,
    p_registration_status text,
    p_payment_status      text,
    p_admin_note          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_r        public.hosted_tournament_registrations%rowtype;
    v_t        public.hosted_tournaments%rowtype;
    v_active   int;
    v_new_note text;
    v_was_active boolean;
    v_will_active boolean;
begin
    if not public.can_manage_tournaments() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if p_registration_status is not null
       and p_registration_status not in ('applied', 'waitlisted', 'confirmed', 'cancelled', 'rejected') then
        raise exception 'INVALID_STATUS' using errcode = '22023';
    end if;
    if p_payment_status is not null
       and p_payment_status not in ('pending', 'paid', 'refund_pending', 'refunded') then
        raise exception 'INVALID_STATUS' using errcode = '22023';
    end if;

    select * into v_r from public.hosted_tournament_registrations where id = p_registration_id;
    if v_r.id is null then
        raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002';
    end if;
    select * into v_t from public.hosted_tournaments where id = v_r.tournament_id;

    -- 비활성 → 활성 복귀 시에만 상한(max_capacity) 재검증.
    --   target_capacity(48)는 운영 우선순위 기준이므로 여기서 막지 않는다 — 대기팀 승격을 방해하지 않기 위해.
    if p_registration_status is not null and p_registration_status <> v_r.registration_status then
        v_was_active  := v_r.registration_status in ('applied', 'waitlisted', 'confirmed');
        v_will_active := p_registration_status  in ('applied', 'waitlisted', 'confirmed');
        if v_will_active and not v_was_active then
            perform pg_advisory_xact_lock(hashtext('hosted-tournament-registration:' || v_r.tournament_id::text));
            -- 활성 복귀 시 동일 페어가 이미 활성인지도 확인(부분 unique index 위반 선제 차단).
            if exists (
                select 1 from public.hosted_tournament_registrations x
                 where x.tournament_id = v_r.tournament_id
                   and x.pair_key = v_r.pair_key
                   and x.id <> v_r.id
                   and x.registration_status in ('applied', 'waitlisted', 'confirmed')
            ) then
                raise exception 'DUPLICATE_REGISTRATION' using errcode = '23505';
            end if;
            select count(*) into v_active
              from public.hosted_tournament_registrations r
             where r.tournament_id = v_r.tournament_id
               and r.registration_status in ('applied', 'waitlisted', 'confirmed');
            if v_active >= v_t.max_capacity then
                raise exception 'TOURNAMENT_FULL' using errcode = '23514';
            end if;
        end if;

        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type)
        values (v_r.id, 'registration_status', v_r.registration_status, p_registration_status, auth.uid(), 'admin');
    end if;

    if p_payment_status is not null and p_payment_status <> v_r.payment_status then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type)
        values (v_r.id, 'payment_status', v_r.payment_status, p_payment_status, auth.uid(), 'admin');
    end if;

    if p_admin_note is not null then
        v_new_note := nullif(btrim(p_admin_note), '');
        if v_new_note is distinct from v_r.admin_note then
            insert into public.hosted_tournament_registration_history
                (registration_id, action, from_value, to_value, actor_user_id, actor_type)
            values (v_r.id, 'admin_note', v_r.admin_note, v_new_note, auth.uid(), 'admin');
        end if;
    end if;

    update public.hosted_tournament_registrations r
       set registration_status = coalesce(p_registration_status, r.registration_status),
           payment_status      = coalesce(p_payment_status, r.payment_status),
           admin_note          = case when p_admin_note is null then r.admin_note
                                      else nullif(btrim(p_admin_note), '') end,
           confirmed_at        = case when p_registration_status = 'confirmed' and r.confirmed_at is null
                                      then now() else r.confirmed_at end,
           cancelled_at        = case when p_registration_status in ('cancelled', 'rejected') and r.cancelled_at is null
                                      then now() else r.cancelled_at end,
           updated_at          = now()
     where r.id = p_registration_id
    returning * into v_r;

    return jsonb_build_object(
        'id',                 v_r.id,
        'registrationNo',     v_r.registration_no,
        'registrationStatus', v_r.registration_status,
        'paymentStatus',      v_r.payment_status,
        'adminNote',          v_r.admin_note,
        'confirmedAt',        v_r.confirmed_at,
        'cancelledAt',        v_r.cancelled_at
    );
end;
$$;
revoke execute on function public.set_tournament_registration_status(uuid,text,text,text) from public;
revoke execute on function public.set_tournament_registration_status(uuid,text,text,text) from anon;
grant  execute on function public.set_tournament_registration_status(uuid,text,text,text) to authenticated;


-- ── 12. Seed: 2026 TEYEON OPEN ────────────────────────────────────────────────
--   값은 전부 임원진 최종 승인된 공식 포스터 / 1Page 대회요강 기준이다.
--   요강에 없는 값은 추측하지 않고 NULL 로 둔다(registration_open_at).
--
--   ⚠ status = 'draft' 로 시작한다.
--     draft 인 동안 get_public_tournament 는 아무것도 반환하지 않고(Hub 는 "접수 현황 준비 중"),
--     submit_tournament_registration 은 TOURNAMENT_NOT_OPEN 을 던진다.
--     즉 이 마이그레이션을 적용해도 접수가 열리지 않는다. 접수를 열 때만 아래를 따로 실행한다:
--
--       update public.hosted_tournaments
--          set status = 'registration_open', published_at = now(), updated_at = now()
--        where slug = '2026-teyeon-open';
--
--   시각은 KST(+09) 오프셋을 명시해 timestamptz 로 저장한다(서버 타임존 설정에 의존하지 않는다).
insert into public.hosted_tournaments (
    slug, title, subtitle, status,
    event_date, event_start_time,
    registration_open_at, registration_close_at,
    venue_name, organizer_name, sponsor_name,
    entry_fee, target_capacity, max_capacity,
    registration_no_prefix,
    contact_label, contact_phone,
    bank_name, bank_account, bank_holder
) values (
    '2026-teyeon-open',
    '2026 TEYEON OPEN',
    '비랭킹 복식 테니스 대회',
    'draft',
    date '2026-10-25',
    time '09:00',
    null,                                        -- 요강에 접수 시작 시각 없음 — status 로 제어
    timestamptz '2026-10-19 17:00:00+09',        -- 접수 마감 2026.10.19 17:00 KST
    '아산시 강변 테니스장',
    'TEYEON TENNIS CLUB',
    '아산시 테니스 협회',
    40000,
    48,
    60,
    'TO',
    '경기 김민준',
    '010-7224-3689',
    '카카오뱅크',
    '3333015235337',
    '곽민섭'
)
on conflict (slug) do nothing;   -- 재실행해도 기존 행을 덮어쓰지 않는다.


notify pgrst, 'reload schema';
