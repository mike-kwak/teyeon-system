-- =============================================================================
-- 2026 TEYEON OPEN — 대기열 순서 · 접수↔운영팀 정합성  (2026-09-23)
--
--   배경 (APPLY_CHECKLIST §17 TODO 2건)
--     1) 접수를 cancelled/rejected 로 바꿔도 이미 승격된 hosted_tournament_teams 행이
--        active 로 남아 조편성 후보에 그대로 들어갔다.
--     2) 대기 순번을 sequence_no 로 계산해서, 오래된 취소 접수를 대기로 되살리면
--        나중에 신청한 대기자보다 앞에 섰다.
--
--   확정 정책
--     · 대기 순서는 waitlisted_at(대기열 진입 시각) 기준. 표시 순번은 조회 시 계산한다.
--       신규 대기 → now() / 다른 상태에서 대기로 → now() / 대기를 떠나면 → NULL.
--       registration_no · sequence_no 는 절대 바꾸지 않는다. waitlist_order 정수 컬럼도 만들지 않는다.
--     · 접수가 cancelled/rejected 가 되면 연결된 팀을 **삭제하지 않고**
--       status='withdrawn' · withdrawn_reason='registration_cancelled' 로 바꾼다.
--       단, 이미 조편성(group_members) 또는 경기(matches)에 사용된 팀은 자동으로 바꾸지 않고
--       Admin 에 경고만 돌려준다(현장 운영 안정성 우선 — 조 재편성 · 경기 취소 자동화 없음).
--     · 접수가 applied/confirmed 로 복구되면 withdrawn_reason='registration_cancelled' 인 팀만
--       active 로 되돌린다. 운영진이 직접 기권시킨 팀('manual')은 자동 복구하지 않는다.
--     · 팀 id · team_no 는 유지한다. 새 팀 행을 만들지 않는다.
--
--   ⚠ 기존 Production 데이터를 수정하지 않는다.
--     · 이 파일에는 기존 행을 대상으로 하는 UPDATE / DELETE / backfill 이 없다.
--     · 적용 전 precheck 결과: 보정 대상 0건(취소·active 팀 0 / confirmed·withdrawn 팀 0 / 대기 0).
--     · 추가 컬럼은 둘 다 nullable — 기존 행은 NULL 그대로다(테이블 재작성 없음).
--
--   ⚠ 정책 불변 (이 파일에서 바꾸지 않는다)
--     48 모집 목표 · 60 정상 참가 최대 · 61번째부터 대기 · 대기 상한 없음 ·
--     자동 승격 없음 · 대기 1번 외 승격은 사유 필수 · 입금 상태 모델 · 개인정보 범위.
--
--   ⚠ 잠금 순서 고정 — registration → teams.
--     반대 순서(teams 먼저 잡고 registration)를 잡는 함수는 없다(promote_confirmed_registrations,
--     update_tournament_team 은 teams 잠금만 사용).
--
--   선행: add_hosted_tournament_waitlist_policy.sql · add_hosted_tournament_teams.sql
--   검증: add_hosted_tournament_waitlist_integrity_verify.sql
--   실동작: verify_hosted_tournament_waitlist_integrity_fixture.sql (전량 rollback)
--   되돌림: add_hosted_tournament_waitlist_integrity_rollback.sql (컬럼은 DROP 하지 않는다)
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_waitlist_policy.sql)이 적용되지 않았습니다.';
    end if;
    if to_regclass('public.hosted_tournament_teams') is null
       or to_regclass('public.hosted_tournament_group_members') is null
       or to_regclass('public.hosted_tournament_matches') is null then
        raise exception 'Tournament 운영 기반(Batch 1/2/3)이 적용되지 않았습니다.';
    end if;
end $guard$;


-- ── 1. 컬럼 추가 (nullable · backfill 없음) ───────────────────────────────────
alter table public.hosted_tournament_registrations
    add column if not exists waitlisted_at timestamptz;

comment on column public.hosted_tournament_registrations.waitlisted_at is
    '대기열 진입 시각. waitlisted 인 동안에만 값이 있다(대기를 떠나면 NULL). 대기 순서의 단일 기준 — '
    'updated_at 이나 sequence_no 로 대기 순서를 계산하지 않는다. 기존 행은 NULL(적용 시점 대기 0팀).';

alter table public.hosted_tournament_teams
    add column if not exists withdrawn_reason text;

comment on column public.hosted_tournament_teams.withdrawn_reason is
    '기권 사유. NULL=참가 중이거나 사유 미상(legacy) / registration_cancelled=접수 취소·거절로 자동 기권 '
    '/ manual=운영진 수동 기권. 자동 복구는 registration_cancelled 인 팀만 대상이다.';

-- 허용값 제한. 기존 행은 전부 NULL 이라 검증을 통과한다.
--   ⚠ active 인데 사유가 남아 있는 상태를 만들지 않는다(사유는 status='withdrawn' 일 때만).
do $chk$
begin
    if not exists (select 1 from pg_constraint
                    where conname = 'hosted_tteam_withdrawn_reason_check'
                      and conrelid = 'public.hosted_tournament_teams'::regclass) then
        alter table public.hosted_tournament_teams
            add constraint hosted_tteam_withdrawn_reason_check
            check (withdrawn_reason is null
                   or (status = 'withdrawn'
                       and withdrawn_reason in ('registration_cancelled', 'manual')));
    end if;
end $chk$;

-- 대기열 조회 전용 부분 인덱스(현재 대기팀만).
create index if not exists hosted_treg_waitlist_order_idx
    on public.hosted_tournament_registrations (tournament_id, waitlisted_at, sequence_no)
 where registration_status = 'waitlisted';


-- ── 2. submit RPC — 대기 저장 시 waitlisted_at 기록 (판정 로직 불변) ──────────
--   바뀐 곳은 INSERT 의 waitlisted_at 한 컬럼뿐이다.
--   정상/대기 판정(정상 < max_capacity 이고 대기 0) · 잠금 · 중복 · 순번 · 계좌 응답은 그대로다.
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
    p_media_notice_confirmed  boolean,
    p_player1_club_name       text default null,
    p_player2_club_name       text default null
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
    v_p1_club    text;
    v_p2_club    text;
    v_note       text;
    v_p1_norm    text;
    v_p2_norm    text;
    v_pair       text;
    v_normal     int;
    v_waiting    int;
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
    v_p1_club := nullif(btrim(coalesce(p_player1_club_name, '')), '');
    v_p2_club := nullif(btrim(coalesce(p_player2_club_name, '')), '');
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    if length(v_p1_name) > 20 or length(v_p2_name) > 20 or length(v_depositor) > 20
       or (v_club is not null and length(v_club) > 40)
       or (v_p1_club is not null and length(v_p1_club) > 40)
       or (v_p2_club is not null and length(v_p2_club) > 40)
       or (v_note is not null and length(v_note) > 300) then
        raise exception 'FIELD_TOO_LONG' using errcode = '22023';
    end if;

    -- (3) 전화 정규화·형식·동일번호. 오류 메시지에 번호를 노출하지 않는다.
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

    -- (4) 대회 존재 · 접수 상태 · 접수 기간. ⚠ 접수 마감은 이 두 조건으로만 결정한다.
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

    -- (8) 정상 슬롯 · 대기 집계 (lock 안). 정상 슬롯 = applied + confirmed.
    select count(*) filter (where r.registration_status in ('applied', 'confirmed')),
           count(*) filter (where r.registration_status = 'waitlisted')
      into v_normal, v_waiting
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id;

    -- (9) 접수 순번 — max+1. 취소/거절된 신청의 번호를 재사용하지 않는다(접수번호 영구 고유).
    select coalesce(max(r.sequence_no), 0) + 1 into v_seq
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id;

    -- (10) 정상 / 대기 판정. 목표 모집 수(48)는 판정에 쓰지 않는다.
    v_status := case when v_normal < v_t.max_capacity and v_waiting = 0
                     then 'applied' else 'waitlisted' end;

    -- (11) 접수번호 — 개인정보 미포함. 예: TO-2026-0031
    v_no := v_t.registration_no_prefix || '-' ||
            to_char(v_t.event_date, 'YYYY') || '-' ||
            lpad(v_seq::text, 4, '0');

    insert into public.hosted_tournament_registrations (
        tournament_id, sequence_no, registration_no,
        player1_name, player1_phone, player1_phone_norm,
        player2_name, player2_phone, player2_phone_norm,
        pair_key, club_name, player1_club_name, player2_club_name, depositor_name, note,
        registration_status, payment_status,
        eligibility_confirmed_at, regulations_confirmed_at,
        privacy_agreed_at, media_notice_confirmed_at,
        submitted_at, waitlisted_at
    ) values (
        v_t.id, v_seq, v_no,
        v_p1_name, btrim(coalesce(p_player1_phone, '')), v_p1_norm,
        v_p2_name, btrim(coalesce(p_player2_phone, '')), v_p2_norm,
        v_pair, v_club, v_p1_club, v_p2_club, v_depositor, v_note,
        v_status, 'pending',
        v_now, v_now, v_now, v_now,
        v_now,
        -- ⚠ 대기로 들어갈 때만 대기열 진입 시각을 찍는다. 정상 접수는 NULL.
        --    now() 가 아니라 clock_timestamp() 다 — now() 는 트랜잭션 시작 시각이라
        --    한 트랜잭션에서 여러 건이 대기로 들어가면 값이 같아져 진입 순서를 구분하지 못한다.
        case when v_status = 'waitlisted' then clock_timestamp() end
    )
    returning id into v_reg_id;

    insert into public.hosted_tournament_registration_history (
        registration_id, action, from_value, to_value, actor_type
    ) values (
        v_reg_id, 'submit', null, v_status, 'public'
    );

    -- (12) 최소 반환. 계좌는 'applied' 에만.
    --   waitlistPosition = 방금 찍은 waitlisted_at 이 가장 늦으므로 기존 대기 수 + 1 이다(lock 안 집계).
    return jsonb_build_object(
        'registrationNo',     v_no,
        'registrationStatus', v_status,
        'paymentStatus',      'pending',
        'player1Name',        v_p1_name,
        'player2Name',        v_p2_name,
        'entryFee',           v_t.entry_fee,
        'waitlistPosition',   case when v_status = 'waitlisted' then v_waiting + 1 end
    ) || case
            when v_status = 'applied' then jsonb_build_object(
                'bankName',    v_t.bank_name,
                'bankAccount', v_t.bank_account,
                'bankHolder',  v_t.bank_holder
            )
            else '{}'::jsonb
         end;
    -- ⚠ 미반환: id, tournament_id, phone, phone_norm, pair_key, depositor_name, note, admin_note,
    --           waitlisted_at 원본값, 이력.
end;
$$;

revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) from public;
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) from anon;
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) from authenticated;


-- ── 3. 운영 RPC: 상태 변경 — 대기 진입 시각 + 접수↔팀 동기화 ──────────────────
--   추가된 것만: waitlisted_at lifecycle · 팀 자동 기권/복구 · 반환의 teamSync.
--   정원 가드 · 입금 전이 matrix · 중복 pair · 이력 · confirmed_at/cancelled_at 은 그대로다.
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
    v_r                    public.hosted_tournament_registrations%rowtype;
    v_t                    public.hosted_tournaments%rowtype;
    v_normal               int;
    v_new_note             text;
    v_was_active           boolean;
    v_will_active          boolean;
    v_was_normal           boolean;
    v_will_normal          boolean;
    v_was_closed           boolean;
    v_will_closed          boolean;
    v_registration_changed boolean := false;
    v_payment_changed      boolean := false;
    v_admin_note_changed   boolean := false;
    v_team_id              uuid;
    v_team_no              integer;
    v_team_status          text;
    v_team_reason          text;
    v_team_in_use          boolean := false;
    v_team_sync            jsonb := jsonb_build_object('action', 'none');
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

    select * into v_r
      from public.hosted_tournament_registrations
     where id = p_registration_id;
    if v_r.id is null then
        raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- 잠금 순서 ①: 접수. (② 팀 잠금은 아래 동기화 구간에서만 추가로 잡는다 — 역순 금지)
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-registration:' || v_r.tournament_id::text));

    select * into v_r
      from public.hosted_tournament_registrations
     where id = p_registration_id;
    if v_r.id is null then
        raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002';
    end if;

    select * into v_t
      from public.hosted_tournaments
     where id = v_r.tournament_id;

    v_registration_changed := p_registration_status is not null
                              and p_registration_status <> v_r.registration_status;
    v_payment_changed      := p_payment_status is not null
                              and p_payment_status <> v_r.payment_status;

    if p_admin_note is not null then
        v_new_note := nullif(btrim(p_admin_note), '');
        v_admin_note_changed := v_new_note is distinct from v_r.admin_note;
    end if;

    -- payment_status 는 명시된 상태 흐름만 허용한다. registration_status 와 자동 연동하지 않는다.
    if v_payment_changed and not (
        (v_r.payment_status = 'pending'        and p_payment_status = 'paid') or
        (v_r.payment_status = 'paid'           and p_payment_status in ('pending', 'refund_pending')) or
        (v_r.payment_status = 'refund_pending' and p_payment_status in ('paid', 'refunded'))
    ) then
        raise exception 'INVALID_PAYMENT_TRANSITION' using errcode = '22023';
    end if;

    if v_registration_changed then
        v_was_active  := v_r.registration_status in ('applied', 'waitlisted', 'confirmed');
        v_will_active := p_registration_status  in ('applied', 'waitlisted', 'confirmed');
        v_was_normal  := v_r.registration_status in ('applied', 'confirmed');
        v_will_normal := p_registration_status  in ('applied', 'confirmed');
        v_was_closed  := v_r.registration_status in ('cancelled', 'rejected');
        v_will_closed := p_registration_status  in ('cancelled', 'rejected');

        -- 비활성 → 활성 복귀: 같은 팀의 다른 활성 신청이 있으면 막는다.
        if v_will_active and not v_was_active then
            if exists (
                select 1 from public.hosted_tournament_registrations x
                 where x.tournament_id = v_r.tournament_id
                   and x.pair_key = v_r.pair_key
                   and x.id <> v_r.id
                   and x.registration_status in ('applied', 'waitlisted', 'confirmed')
            ) then
                raise exception 'DUPLICATE_REGISTRATION' using errcode = '23505';
            end if;
        end if;

        -- 정상 슬롯으로 '새로 들어가는' 전환은 lock 안에서 다시 센다.
        if v_will_normal and not v_was_normal then
            select count(*) into v_normal
              from public.hosted_tournament_registrations r
             where r.tournament_id = v_r.tournament_id
               and r.registration_status in ('applied', 'confirmed');
            if v_normal >= v_t.max_capacity then
                raise exception 'NORMAL_CAPACITY_FULL' using errcode = '23514';
            end if;
        end if;

        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type)
        values (v_r.id, 'registration_status', v_r.registration_status, p_registration_status, auth.uid(), 'admin');
    end if;

    if v_payment_changed then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type)
        values (v_r.id, 'payment_status', v_r.payment_status, p_payment_status, auth.uid(), 'admin');
    end if;

    if v_admin_note_changed then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type)
        values (v_r.id, 'admin_note', v_r.admin_note, v_new_note, auth.uid(), 'admin');
    end if;

    if v_registration_changed or v_payment_changed or v_admin_note_changed then
        update public.hosted_tournament_registrations r
           set registration_status = case when v_registration_changed then p_registration_status
                                          else r.registration_status end,
               payment_status      = case when v_payment_changed then p_payment_status
                                          else r.payment_status end,
               admin_note          = case when v_admin_note_changed then v_new_note
                                          else r.admin_note end,
               -- ⚠ 대기열 진입 시각. 대기로 들어오면 그 시점으로 새로 찍고(맨 뒤), 대기를 떠나면 지운다.
               --    updated_at 은 대기 순서에 쓰지 않는다.
               --    clock_timestamp() — now() 는 트랜잭션 시작 시각이라 한 트랜잭션 안의 연속 전환에서
               --    값이 같아져 대기 순서가 뒤섞인다.
               waitlisted_at       = case when v_registration_changed and p_registration_status = 'waitlisted'
                                          then clock_timestamp()
                                          when v_registration_changed
                                          then null
                                          else r.waitlisted_at end,
               confirmed_at        = case when v_registration_changed
                                                and p_registration_status = 'confirmed'
                                                and r.confirmed_at is null
                                          then now() else r.confirmed_at end,
               cancelled_at        = case when v_registration_changed
                                                and p_registration_status in ('cancelled', 'rejected')
                                                and r.cancelled_at is null
                                          then now() else r.cancelled_at end,
               updated_at          = now()
         where r.id = p_registration_id
        returning * into v_r;
    end if;

    -- ── 접수 ↔ 운영팀 동기화 ────────────────────────────────────────────────
    --   ⚠ 팀 행을 삭제하지 않는다. team id · team_no 를 바꾸지 않는다.
    --   ⚠ 조편성 · 경기에 이미 사용된 팀은 자동으로 바꾸지 않고 경고만 돌려준다.
    if v_registration_changed then
        -- 잠금 순서 ②: 팀. (반대 순서로 잡는 함수 없음)
        perform pg_advisory_xact_lock(hashtext('hosted-tournament-teams:' || v_r.tournament_id::text));

        select t.id, t.team_no, t.status, t.withdrawn_reason
          into v_team_id, v_team_no, v_team_status, v_team_reason
          from public.hosted_tournament_teams t
         where t.tournament_id = v_r.tournament_id
           and t.registration_id = v_r.id;

        if v_team_id is not null then
            v_team_in_use :=
                exists (select 1 from public.hosted_tournament_group_members gm
                         where gm.tournament_id = v_r.tournament_id and gm.team_id = v_team_id)
                or exists (select 1 from public.hosted_tournament_matches m
                            where m.tournament_id = v_r.tournament_id
                              and (m.team1_id = v_team_id or m.team2_id = v_team_id));

            if v_will_closed and not v_was_closed then
                if v_team_in_use then
                    -- 조/경기 진입 후 — 자동 변경 금지. 운영진이 확인하고 처리한다.
                    v_team_sync := jsonb_build_object('action', 'blocked_in_use',
                                                      'teamId', v_team_id, 'teamNo', v_team_no,
                                                      'teamStatus', v_team_status);
                elsif v_team_status = 'active' then
                    update public.hosted_tournament_teams
                       set status = 'withdrawn', withdrawn_reason = 'registration_cancelled', updated_at = now()
                     where id = v_team_id;
                    perform public.hosted_tournament_log_event(
                        v_r.tournament_id, 'team', v_team_id, 'auto_withdraw_registration_cancelled',
                        jsonb_build_object('status', v_team_status, 'withdrawnReason', v_team_reason),
                        jsonb_build_object('status', 'withdrawn', 'withdrawnReason', 'registration_cancelled'),
                        null);
                    v_team_sync := jsonb_build_object('action', 'withdrawn',
                                                      'teamId', v_team_id, 'teamNo', v_team_no);
                else
                    -- 이미 기권 상태 — 사유를 덮어쓰지 않는다(수동 기권 존중).
                    v_team_sync := jsonb_build_object('action', 'already_withdrawn',
                                                      'teamId', v_team_id, 'teamNo', v_team_no,
                                                      'withdrawnReason', v_team_reason);
                end if;

            elsif v_will_normal and v_was_closed then
                if v_team_status = 'withdrawn' and v_team_reason = 'registration_cancelled' then
                    update public.hosted_tournament_teams
                       set status = 'active', withdrawn_reason = null, updated_at = now()
                     where id = v_team_id;
                    perform public.hosted_tournament_log_event(
                        v_r.tournament_id, 'team', v_team_id, 'auto_restore_registration_restored',
                        jsonb_build_object('status', 'withdrawn', 'withdrawnReason', 'registration_cancelled'),
                        jsonb_build_object('status', 'active', 'withdrawnReason', null),
                        null);
                    v_team_sync := jsonb_build_object('action', 'restored',
                                                      'teamId', v_team_id, 'teamNo', v_team_no);
                elsif v_team_status = 'withdrawn' then
                    -- 운영진 수동 기권(또는 사유 미상 legacy) — 자동 복구하지 않는다.
                    v_team_sync := jsonb_build_object('action', 'blocked_manual',
                                                      'teamId', v_team_id, 'teamNo', v_team_no,
                                                      'withdrawnReason', v_team_reason);
                end if;
            end if;
        end if;
    end if;

    return jsonb_build_object(
        'id',                 v_r.id,
        'registrationNo',     v_r.registration_no,
        'registrationStatus', v_r.registration_status,
        'paymentStatus',      v_r.payment_status,
        'adminNote',          v_r.admin_note,
        'confirmedAt',        v_r.confirmed_at,
        'cancelledAt',        v_r.cancelled_at,
        -- 운영 화면 경고용. 'blocked_in_use' 는 조/경기에 물려 자동 처리하지 않았다는 뜻이다.
        'teamSync',           v_team_sync
    );
end;
$$;

revoke execute on function public.set_tournament_registration_status(uuid,text,text,text) from public;
revoke execute on function public.set_tournament_registration_status(uuid,text,text,text) from anon;
grant  execute on function public.set_tournament_registration_status(uuid,text,text,text) to authenticated;

comment on function public.set_tournament_registration_status(uuid,text,text,text) is
    '운영진(CEO/ADMIN) 신청/입금 상태/운영메모 변경. applied/confirmed 진입은 정상 슬롯 < max_capacity 일 때만. '
    '대기 진입/이탈 시 waitlisted_at 을 기록/해제하고, 연결된 운영팀을 자동 기권/복구한다'
    '(조·경기에 사용된 팀과 수동 기권 팀은 자동 변경하지 않고 teamSync 로 알린다).';


-- ── 4. 대기팀 승격 — 대기 순서 기준 교체 + waitlisted_at 해제 ─────────────────
create or replace function public.promote_waitlisted_tournament_registration(
    p_registration_id uuid,
    p_reason          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_r        public.hosted_tournament_registrations%rowtype;
    v_t        public.hosted_tournaments%rowtype;
    v_pos      int;
    v_normal   int;
    v_waiting  int;
    v_reason   text;
    v_note     text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is not null and length(v_reason) > 300 then
        raise exception 'FIELD_TOO_LONG' using errcode = '22023';
    end if;

    select * into v_r
      from public.hosted_tournament_registrations
     where id = p_registration_id;
    if v_r.id is null then
        raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002';
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-registration:' || v_r.tournament_id::text));

    select * into v_r
      from public.hosted_tournament_registrations
     where id = p_registration_id;
    if v_r.registration_status <> 'waitlisted' then
        raise exception 'NOT_WAITLISTED' using errcode = '22023';
    end if;

    select * into v_t
      from public.hosted_tournaments
     where id = v_r.tournament_id;

    -- 대기 순번 = 대기열 진입 시각 순서. (waitlisted_at 이 비어 있는 legacy 행은 신청 시각으로 대체)
    select count(*) filter (where r.registration_status in ('applied', 'confirmed')),
           count(*) filter (where r.registration_status = 'waitlisted'),
           count(*) filter (where r.registration_status = 'waitlisted'
                              and (coalesce(r.waitlisted_at, r.submitted_at), r.sequence_no)
                                  <= (coalesce(v_r.waitlisted_at, v_r.submitted_at), v_r.sequence_no))
      into v_normal, v_waiting, v_pos
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_r.tournament_id;

    if v_normal >= v_t.max_capacity then
        raise exception 'NORMAL_CAPACITY_FULL' using errcode = '23514';
    end if;
    if v_pos > 1 and v_reason is null then
        raise exception 'PROMOTION_REASON_REQUIRED' using errcode = '22023';
    end if;

    v_note := '대기 ' || v_pos || '번 승격'
              || case when v_pos > 1 then ' (예외: 대기 1번 아님)' else '' end
              || case when v_reason is not null then ' · ' || v_reason else '' end;

    insert into public.hosted_tournament_registration_history
        (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
    values (v_r.id, 'registration_status', 'waitlisted', 'applied', auth.uid(), 'admin', v_note);

    -- 승격 = 대기열에서 빠짐 → waitlisted_at 해제. payment_status 는 건드리지 않는다.
    update public.hosted_tournament_registrations r
       set registration_status = 'applied',
           waitlisted_at       = null,
           updated_at          = now()
     where r.id = v_r.id
    returning * into v_r;

    return jsonb_build_object(
        'id',                      v_r.id,
        'registrationNo',          v_r.registration_no,
        'registrationStatus',      v_r.registration_status,
        'paymentStatus',           v_r.payment_status,
        'previousWaitlistPosition', v_pos,
        'exceptional',             v_pos > 1,
        'normalCount',             v_normal + 1,
        'waitlistedCount',         v_waiting - 1
    );
end;
$$;

revoke execute on function public.promote_waitlisted_tournament_registration(uuid, text) from public;
revoke execute on function public.promote_waitlisted_tournament_registration(uuid, text) from anon;
grant  execute on function public.promote_waitlisted_tournament_registration(uuid, text) to authenticated;


-- ── 5. 공개 참가팀 RPC — 대기 순번 기준 교체 (시그니처 · 키 목록 불변) ─────────
--   ⚠ waitlisted_at 원본값은 공개하지 않는다. 계산된 순번만 준다.
create or replace function public.get_public_tournament_teams(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
               'sequenceNo',       x.sequence_no,
               'player1Name',      x.player1_name,
               'player2Name',      x.player2_name,
               'clubName',         x.club_name,
               'player1ClubName',  x.player1_club_name,
               'player2ClubName',  x.player2_club_name,
               'publicStatus',     x.registration_status,
               'waitlistPosition', x.waitlist_position
           ) order by x.sequence_no), '[]'::jsonb)
      from (
            select r.sequence_no, r.player1_name, r.player2_name, r.club_name,
                   r.player1_club_name, r.player2_club_name, r.registration_status,
                   case when r.registration_status = 'waitlisted'
                        then row_number() over (partition by (r.registration_status = 'waitlisted')
                                                    order by coalesce(r.waitlisted_at, r.submitted_at),
                                                             r.sequence_no)
                   end as waitlist_position
              from public.hosted_tournament_registrations r
              join public.hosted_tournaments t on t.id = r.tournament_id
             where t.slug = p_slug
               and t.status <> 'draft'
               and r.registration_status in ('applied', 'waitlisted', 'confirmed')
           ) x;
    -- ⚠ 미반환: id, tournament_id, phone, phone_norm, pair_key, depositor_name, note, admin_note,
    --           payment_status, waitlisted_at, 각종 시각, 이력.
$$;

revoke execute on function public.get_public_tournament_teams(text) from public;
grant  execute on function public.get_public_tournament_teams(text) to anon, authenticated;


-- ── 6. 운영 Admin 신청 목록 — 대기 순번 기준 교체 + 대기 진입 시각 ────────────
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
            'id',                     x.id,
            'sequenceNo',             x.sequence_no,
            'registrationNo',         x.registration_no,
            'player1Name',            x.player1_name,
            'player1Phone',           x.player1_phone_norm,
            'player2Name',            x.player2_name,
            'player2Phone',           x.player2_phone_norm,
            'clubName',               x.club_name,
            'player1ClubName',        x.player1_club_name,
            'player2ClubName',        x.player2_club_name,
            'depositorName',          x.depositor_name,
            'note',                   x.note,
            'registrationStatus',     x.registration_status,
            'paymentStatus',          x.payment_status,
            'waitlistPosition',       x.waitlist_position,
            'waitlistedAt',           x.waitlisted_at,
            'eligibilityConfirmedAt', x.eligibility_confirmed_at,
            'regulationsConfirmedAt', x.regulations_confirmed_at,
            'privacyAgreedAt',        x.privacy_agreed_at,
            'mediaNoticeConfirmedAt', x.media_notice_confirmed_at,
            'submittedAt',            x.submitted_at,
            'confirmedAt',            x.confirmed_at,
            'cancelledAt',            x.cancelled_at,
            'adminNote',              x.admin_note
        ) order by x.sequence_no), '[]'::jsonb)
        from (
              select r.*,
                     case when r.registration_status = 'waitlisted'
                          then row_number() over (partition by (r.registration_status = 'waitlisted')
                                                      order by coalesce(r.waitlisted_at, r.submitted_at),
                                                               r.sequence_no)
                     end as waitlist_position
                from public.hosted_tournament_registrations r
                join public.hosted_tournaments t on t.id = r.tournament_id
               where t.slug = p_slug
             ) x
    );
    -- pair_key 는 반환하지 않는다.
end;
$$;

revoke execute on function public.get_admin_tournament_registrations(text) from public;
revoke execute on function public.get_admin_tournament_registrations(text) from anon;
grant  execute on function public.get_admin_tournament_registrations(text) to authenticated;


-- ── 7. 운영 Team RPC — 기권 사유 노출 + 수동 기권 사유 기록 ───────────────────
--   ⚠ Admin 전용. 공개 경로에는 withdrawn_reason 을 내보내지 않는다.
create or replace function public.get_admin_tournament_teams(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case when not public.can_manage_tournaments() then null else
        coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id',              t.id,
                       'teamNo',          t.team_no,
                       'player1Name',     t.player1_name,
                       'player2Name',     t.player2_name,
                       'player1ClubName', t.player1_club_name,
                       'player2ClubName', t.player2_club_name,
                       'clubName',        t.club_name,
                       'source',          t.source,
                       'status',          t.status,
                       'withdrawnReason', t.withdrawn_reason,
                       'seedNo',          t.seed_no,
                       'fromRegistration', (t.registration_id is not null),
                       'registrationId',  t.registration_id,
                       'createdAt',       t.created_at
                   ) order by t.team_no)
              from public.hosted_tournament_teams t
              join public.hosted_tournaments h on h.id = t.tournament_id
             where h.slug = p_slug
        ), '[]'::jsonb)
    end;
$$;

revoke execute on function public.get_admin_tournament_teams(text) from public;
revoke execute on function public.get_admin_tournament_teams(text) from anon;
grant  execute on function public.get_admin_tournament_teams(text) to authenticated;


--   수동 기권은 사유를 'manual' 로 남긴다. 수동 복구는 사유를 지운다.
--   ⚠ 팀 번호 · 시드 · 잠금 · 이벤트 로그 등 기존 동작은 그대로다.
create or replace function public.update_tournament_team(
    p_team_id uuid,
    p_team_no integer default null,
    p_seed_no integer default null,
    p_status  text    default null,
    p_clear_seed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_before jsonb;
    v_rows integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    if p_status is not null and p_status not in ('active', 'withdrawn') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if p_team_no is not null and p_team_no < 1 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_team_no');
    end if;

    select tournament_id,
           jsonb_build_object('teamNo', team_no, 'seedNo', seed_no, 'status', status,
                              'withdrawnReason', withdrawn_reason)
      into v_tid, v_before
      from public.hosted_tournament_teams
     where id = p_team_id;

    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'team_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-teams:' || v_tid::text));

    begin
        update public.hosted_tournament_teams
           set team_no    = coalesce(p_team_no, team_no),
               seed_no    = case when p_clear_seed then null else coalesce(p_seed_no, seed_no) end,
               status     = coalesce(p_status, status),
               -- 운영진이 직접 기권시키면 'manual' — 접수 복구 시 자동으로 되살아나지 않는다.
               withdrawn_reason = case when p_status = 'withdrawn' then 'manual'
                                       when p_status = 'active' then null
                                       else withdrawn_reason end,
               updated_at = now()
         where id = p_team_id;
        get diagnostics v_rows = row_count;
    exception
        when unique_violation then
            return jsonb_build_object('ok', false, 'reason', 'team_no_taken');
    end;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'team_not_found');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'team', p_team_id, 'update_team', v_before,
        jsonb_build_object('teamNo', p_team_no, 'seedNo', p_seed_no,
                           'status', p_status, 'clearSeed', p_clear_seed),
        null);

    return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.update_tournament_team(uuid,integer,integer,text,boolean) from public;
revoke execute on function public.update_tournament_team(uuid,integer,integer,text,boolean) from anon;
grant  execute on function public.update_tournament_team(uuid,integer,integer,text,boolean) to authenticated;


notify pgrst, 'reload schema';

commit;
