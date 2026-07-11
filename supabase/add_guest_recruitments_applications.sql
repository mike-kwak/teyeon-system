-- =============================================================================
-- TEYEON 게스트 — PUBLIC_GUEST 공개 모집 + 신청 저장 (관계형 + 보수적 RLS/RPC)
--
-- 목적: 공개 게스트 신청을 실제 저장한다. 개인정보(전화번호)를 포함하므로 가장 보수적으로:
--   · 원본 테이블에 anon 직접 접근 전면 차단.
--   · 공개 동작은 SECURITY DEFINER RPC 로만(모집 조회 / 신청 제출).
--   · 브라우저에는 내부 UUID(id/schedule_id/club_id)를 노출하지 않고, 공개용 랜덤 public_token 만 노출.
--   · 모집 생성·수정은 운영진(can_manage_guest_applications=CEO/ADMIN/OPERATOR) RPC 로만.
--
-- 선행 의존: club_schedules, profiles, members, kdk_session_meta(guest_fee, club_schedule_id), pgcrypto.
--   게스트비는 저장하지 않고 KDK 세션(kdk_session_meta.guest_fee) 단일 출처를 표시만 한다.
--
-- ⚠️ 초안. 사용자 승인 후 Supabase SQL Editor 에서 1회 실행. 운영 DB 자동 적용 금지.
-- rollback: supabase/add_guest_recruitments_applications_rollback.sql
-- verify  : supabase/add_guest_recruitments_applications_verify.sql
-- =============================================================================

-- Supabase 에서 pgcrypto 함수는 extensions 스키마에 설치된다(gen_random_bytes 등).
create extension if not exists pgcrypto with schema extensions;  -- gen_random_bytes(공개 토큰)

-- ── 0. 게스트 신청/모집 관리 권한 helper (기존 profiles.role 재사용 — 새 role 아님) ──
create or replace function public.can_manage_guest_applications()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.role in ('CEO', 'ADMIN', 'OPERATOR')
    );
$$;
revoke execute on function public.can_manage_guest_applications() from public;
revoke execute on function public.can_manage_guest_applications() from anon;
grant  execute on function public.can_manage_guest_applications() to authenticated;

-- URL-safe 랜덤 공개 토큰(내부 UUID 와 별개). 서버 전용.
--   · gen_random_bytes 는 extensions 스키마 소속 → 명시적 스키마 한정 + search_path 에 extensions 포함.
--   · base64 → base64url(translate '+/'→'-_') + 패딩('=') 제거로 URL-safe 정리.
create or replace function public.gen_guest_public_token()
returns text
language sql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
    select rtrim(translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/', '-_'), '=');
$$;
revoke execute on function public.gen_guest_public_token() from public;
revoke execute on function public.gen_guest_public_token() from anon;
grant  execute on function public.gen_guest_public_token() to authenticated;

-- ── 1. 모집(정모별) ────────────────────────────────────────────────────────────
create table if not exists public.guest_recruitments (
    id                   uuid        primary key default gen_random_uuid(),
    -- 공개용 랜덤 식별자(브라우저 노출 전용). 내부 id/schedule_id 는 절대 공개하지 않는다.
    public_token         text        not null unique,
    club_id              uuid        not null default '512d047d-a076-4080-97e5-6bb5a2c07819',
    schedule_id          uuid        not null references public.club_schedules(id) on delete cascade,
    status               text        not null default 'draft'
                                     check (status in ('draft', 'open', 'closed', 'completed', 'cancelled')),
    max_guests           int         check (max_guests is null or max_guests >= 1),
    application_deadline timestamptz,
    public_message       text,
    created_by           uuid        references auth.users(id) on delete set null,
    updated_by           uuid        references auth.users(id) on delete set null,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    unique (schedule_id)  -- 정모 1건당 모집 1건
);
comment on table public.guest_recruitments is 'PUBLIC_GUEST 공개 모집(정모별). public_token=공개 식별자. 게스트비 미저장(KDK 단일 출처 표시).';

-- ── 2. 신청(개인정보 포함 — 최대 보수) ──────────────────────────────────────────
create table if not exists public.guest_applications (
    id                uuid        primary key default gen_random_uuid(),
    recruitment_id    uuid        not null references public.guest_recruitments(id) on delete cascade,
    schedule_id       uuid        not null,
    name              text        not null,
    phone             text        not null,          -- 표시용(원문 trim).
    phone_normalized  text        not null,          -- 숫자만 — 중복 방지 키.
    region            text        not null,
    affiliation_type  text        not null check (affiliation_type in ('club', 'independent')),
    club_name         text        not null,
    tennis_experience text        not null,
    best_result       text,
    note              text,
    privacy_consent   boolean     not null check (privacy_consent = true),
    status            text        not null default 'pending'
                                  check (status in ('pending', 'approved', 'on_hold', 'rejected')),
    operator_note     text,
    source_type       text        not null default 'public_application'
                                  check (source_type in ('public_application', 'member_invitation')),
    reviewed_by       uuid        references auth.users(id) on delete set null,
    reviewed_at       timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
comment on table public.guest_applications is 'PUBLIC_GUEST 신청(개인정보). anon 직접 접근 불가 — 제출 RPC, 조회 운영진 RLS, 상태변경 RPC.';
create index if not exists guest_applications_recruitment_idx on public.guest_applications (recruitment_id);
create index if not exists guest_applications_status_idx on public.guest_applications (status);
-- 활성(pending/on_hold/approved) 동일 모집·동일 전화 중복 신청 차단. rejected 는 재신청 허용.
create unique index if not exists guest_applications_active_dup
    on public.guest_applications (recruitment_id, phone_normalized)
    where status in ('pending', 'on_hold', 'approved');

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
alter table public.guest_recruitments  enable row level security;
alter table public.guest_applications  enable row level security;
revoke all on table public.guest_recruitments from anon;
revoke all on table public.guest_applications from anon;
grant select, insert, update, delete on table public.guest_recruitments to authenticated;
grant select on table public.guest_applications to authenticated;  -- 운영진만 실효(정책 제한). 쓰기는 RPC.

-- 모집: 운영진 직접 조회 허용(관리 화면). 쓰기(생성/수정)는 RPC 로만 하되, 방어적으로 정책도 운영진 한정.
drop policy if exists guest_recruitments_manage on public.guest_recruitments;
create policy guest_recruitments_manage on public.guest_recruitments
    for all to authenticated
    using (public.can_manage_guest_applications())
    with check (public.can_manage_guest_applications());

-- 신청: 운영진 select 만. insert/update/delete 직접 정책 없음 → RPC 로만.
drop policy if exists guest_applications_select_manager on public.guest_applications;
create policy guest_applications_select_manager on public.guest_applications
    for select to authenticated
    using (public.can_manage_guest_applications());

-- ── 4. 공개 RPC: 모집 조회(내부 UUID 미반환 + KDK 게스트비 표시) ─────────────────
create or replace function public.get_open_guest_recruitments()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'publicToken',        r.public_token,
        'title',              s.title,
        'date',               s.schedule_date,
        'startTime',          s.start_time,
        'endTime',            s.end_time,
        'location',           s.location,
        'maxGuests',          r.max_guests,
        'applicationDeadline', r.application_deadline,
        'publicMessage',      r.public_message,
        'guestFee',           (select km.guest_fee from public.kdk_session_meta km
                                where km.club_schedule_id = r.schedule_id limit 1),
        'canApply',           (r.application_deadline is null or now() <= r.application_deadline)
    ) order by s.schedule_date asc), '[]'::jsonb)
    from public.guest_recruitments r
    join public.club_schedules s on s.id = r.schedule_id
    where r.status = 'open';
    -- ⚠ 내부 id / schedule_id / club_id / created_by / updated_by / 신청자 정보 미반환.
$$;
revoke execute on function public.get_open_guest_recruitments() from public;
grant  execute on function public.get_open_guest_recruitments() to anon, authenticated;

-- ── 5. 공개 RPC: 신청 제출(public_token 입력 — 내부 UUID 미노출) ─────────────────
create or replace function public.submit_guest_application(
    p_public_token      text,
    p_name              text,
    p_phone             text,
    p_region            text,
    p_affiliation_type  text,
    p_club_name         text,
    p_tennis_experience text,
    p_best_result       text,
    p_note              text,
    p_privacy_consent   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_rec   public.guest_recruitments%rowtype;
    v_phone text;
    v_norm  text;
begin
    if not coalesce(p_privacy_consent, false) then
        raise exception 'PRIVACY_CONSENT_REQUIRED' using errcode = '22023';
    end if;
    if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = ''
       or coalesce(btrim(p_region), '') = '' or coalesce(btrim(p_club_name), '') = ''
       or coalesce(btrim(p_tennis_experience), '') = '' then
        raise exception 'REQUIRED_FIELD_MISSING' using errcode = '22023';
    end if;
    if p_affiliation_type not in ('club', 'independent') then
        raise exception 'INVALID_AFFILIATION' using errcode = '22023';
    end if;

    -- 1) public token 으로 실제 모집 조회 → 2) open → 3) 마감 전 → 4) 연결 정모 존재.
    select * into v_rec from public.guest_recruitments where public_token = p_public_token;
    if v_rec.id is null or v_rec.status <> 'open' then
        raise exception 'RECRUITMENT_NOT_OPEN' using errcode = '22023';
    end if;
    if v_rec.application_deadline is not null and now() > v_rec.application_deadline then
        raise exception 'RECRUITMENT_CLOSED' using errcode = '22023';
    end if;
    if not exists (select 1 from public.club_schedules s where s.id = v_rec.schedule_id) then
        raise exception 'SCHEDULE_NOT_FOUND' using errcode = '22023';
    end if;

    -- 전화: 표시(원문)/비교(숫자만) 분리. 국내 휴대폰(01x + 8~9자리). 에러/로그에 전체번호 미출력.
    v_phone := btrim(p_phone);
    v_norm  := regexp_replace(p_phone, '[^0-9]', '', 'g');
    if v_norm !~ '^01[0-9]{8,9}$' then
        raise exception 'INVALID_PHONE' using errcode = '22023';
    end if;

    -- 5) 중복(같은 모집 + 같은 정규화 전화 + 활성 상태) — 다른 신청 정보 미노출, 일반 오류만.
    if exists (
        select 1 from public.guest_applications a
         where a.recruitment_id = v_rec.id
           and a.phone_normalized = v_norm
           and a.status in ('pending', 'on_hold', 'approved')
    ) then
        raise exception 'DUPLICATE_APPLICATION' using errcode = '23505';
    end if;

    -- 6) 내부 recruitment_id / schedule_id 로 저장. source_type 은 서버가 public_application 고정.
    insert into public.guest_applications (
        recruitment_id, schedule_id, name, phone, phone_normalized, region,
        affiliation_type, club_name, tennis_experience, best_result, note,
        privacy_consent, status, source_type
    ) values (
        v_rec.id, v_rec.schedule_id, btrim(p_name), v_phone, v_norm, btrim(p_region),
        p_affiliation_type,
        case when p_affiliation_type = 'independent' then '무소속' else btrim(p_club_name) end,
        btrim(p_tennis_experience), nullif(btrim(coalesce(p_best_result, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
        true, 'pending', 'public_application'
    );

    return jsonb_build_object('success', true, 'message', '신청이 접수되었습니다.');
end;
$$;
revoke execute on function public.submit_guest_application(text,text,text,text,text,text,text,text,text,boolean) from public;
grant  execute on function public.submit_guest_application(text,text,text,text,text,text,text,text,text,boolean) to anon, authenticated;

-- ── 6. 운영 RPC: 모집 생성/수정(정모 1건당 1건 upsert). public_token 자동 발급·불변. ──
create or replace function public.upsert_guest_recruitment(
    p_schedule_id          uuid,
    p_status               text,
    p_max_guests           int,
    p_application_deadline timestamptz,
    p_public_message       text
)
returns public.guest_recruitments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row public.guest_recruitments%rowtype;
begin
    if not public.can_manage_guest_applications() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if p_status not in ('draft', 'open', 'closed', 'completed', 'cancelled') then
        raise exception 'INVALID_STATUS' using errcode = '22023';
    end if;
    if p_max_guests is not null and p_max_guests < 1 then
        raise exception 'INVALID_MAX_GUESTS' using errcode = '22023';
    end if;
    if not exists (select 1 from public.club_schedules s where s.id = p_schedule_id) then
        raise exception 'SCHEDULE_NOT_FOUND' using errcode = '22023';
    end if;

    select * into v_row from public.guest_recruitments where schedule_id = p_schedule_id;
    if v_row.id is null then
        -- 생성: public_token 서버 자동 발급.
        insert into public.guest_recruitments (public_token, schedule_id, status, max_guests, application_deadline, public_message, created_by, updated_by)
        values (public.gen_guest_public_token(), p_schedule_id, p_status, p_max_guests, p_application_deadline,
                nullif(btrim(coalesce(p_public_message, '')), ''), auth.uid(), auth.uid())
        returning * into v_row;
    else
        -- 수정: public_token 은 절대 변경하지 않는다(클라이언트가 바꿀 수 없음).
        update public.guest_recruitments
           set status = p_status, max_guests = p_max_guests, application_deadline = p_application_deadline,
               public_message = nullif(btrim(coalesce(p_public_message, '')), ''), updated_by = auth.uid(), updated_at = now()
         where id = v_row.id
        returning * into v_row;
    end if;
    return v_row;
end;
$$;
revoke execute on function public.upsert_guest_recruitment(uuid,text,int,timestamptz,text) from public;
revoke execute on function public.upsert_guest_recruitment(uuid,text,int,timestamptz,text) from anon;
grant  execute on function public.upsert_guest_recruitment(uuid,text,int,timestamptz,text) to authenticated;

-- ── 7. 운영 RPC: 신청 관리 요약(정모명 + 상태별 카운트). ────────────────────────
create or replace function public.get_admin_guest_recruitments()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.can_manage_guest_applications() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'scheduleId',  r.schedule_id,
            'publicToken', r.public_token,
            'title',       s.title,
            'date',        s.schedule_date,
            'status',      r.status,
            'maxGuests',   r.max_guests,
            'total',       (select count(*) from public.guest_applications a where a.recruitment_id = r.id),
            'pending',     (select count(*) from public.guest_applications a where a.recruitment_id = r.id and a.status = 'pending'),
            'approved',    (select count(*) from public.guest_applications a where a.recruitment_id = r.id and a.status = 'approved')
        ) order by s.schedule_date desc), '[]'::jsonb)
        from public.guest_recruitments r
        join public.club_schedules s on s.id = r.schedule_id
    );
end;
$$;
revoke execute on function public.get_admin_guest_recruitments() from public;
revoke execute on function public.get_admin_guest_recruitments() from anon;
grant  execute on function public.get_admin_guest_recruitments() to authenticated;

-- ── 8. 운영 RPC: 신청 상태 변경 + 메모(감사 필드) + 승인 정원 검증 ─────────────────
create or replace function public.set_guest_application_status(
    p_application_id uuid,
    p_status         text,
    p_operator_note  text
)
returns public.guest_applications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row      public.guest_applications%rowtype;
    v_rec      public.guest_recruitments%rowtype;
    v_approved int;
begin
    if not public.can_manage_guest_applications() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if p_status not in ('pending', 'approved', 'on_hold', 'rejected') then
        raise exception 'INVALID_STATUS' using errcode = '22023';
    end if;

    select * into v_row from public.guest_applications where id = p_application_id;
    if v_row.id is null then
        raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- 승인 시 정원 검증(동시 승인에도 초과 방지). max_guests NULL = 무제한.
    if p_status = 'approved' and v_row.status <> 'approved' then
        select * into v_rec from public.guest_recruitments where id = v_row.recruitment_id;
        if v_rec.id is not null and v_rec.max_guests is not null then
            perform pg_advisory_xact_lock(hashtext('guest-approve:' || v_row.recruitment_id::text));
            select count(*) into v_approved
              from public.guest_applications
             where recruitment_id = v_row.recruitment_id and status = 'approved' and id <> v_row.id;
            if v_approved >= v_rec.max_guests then
                raise exception 'RECRUITMENT_FULL' using errcode = '23514';
            end if;
        end if;
    end if;

    update public.guest_applications
       set status        = p_status,
           operator_note = nullif(btrim(coalesce(p_operator_note, '')), ''),
           reviewed_by   = auth.uid(),
           reviewed_at   = now(),
           updated_at    = now()
     where id = p_application_id
    returning * into v_row;
    return v_row;
end;
$$;
revoke execute on function public.set_guest_application_status(uuid,text,text) from public;
revoke execute on function public.set_guest_application_status(uuid,text,text) from anon;
grant  execute on function public.set_guest_application_status(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
