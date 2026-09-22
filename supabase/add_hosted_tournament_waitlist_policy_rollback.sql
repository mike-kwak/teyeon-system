-- =============================================================================
-- ROLLBACK — add_hosted_tournament_waitlist_policy.sql
--
--   정책 적용 직전 정의로 되돌린다. 본문은 아래 원본 파일에서 그대로 옮겼다(수정 없음).
--     submit / teams / admin 목록 : add_hosted_tournament_player_clubs.sql
--     set_status                 : add_hosted_tournament_payment_transitions.sql
--     get_public_tournament      : add_hosted_tournament_public_bank_info.sql
--     get_admin_hosted_tournaments: add_hosted_tournament_registration_mvp.sql
--   promote_waitlisted_tournament_registration 은 삭제한다.
--
--   ⚠ 데이터는 건드리지 않는다. 되돌린 뒤에는 옛 판정(활성 48 미만 applied / 60 미만 waitlisted /
--     60 이상 TOURNAMENT_FULL)이 다시 적용된다. 정책 적용 기간에 받은 대기팀 행은 그대로 남는다.
--   ⚠ 모든 함수는 create or replace(시그니처 불변)라 기존 ACL 이 유지된다. lockdown 을 다시 못박는다.
-- =============================================================================

begin;

drop function if exists public.promote_waitlisted_tournament_registration(uuid, text);


-- ── submit (player_clubs 원본) ──────────────────────────────────────────────
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
    -- ⚠ default null 이 무중단의 핵심이다. 구버전 앱이 12개 인자만 보내도 이 함수가 그대로 받는다.
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
    -- 선수별 클럽. 구버전 앱은 보내지 않으므로 여기서 '필수'로 막지 않는다(막으면 접수가 끊긴다).
    --   필수 입력은 신청 폼과 서버 route 가 강제하고, 여기서는 길이만 검사한다.
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
        pair_key, club_name, player1_club_name, player2_club_name, depositor_name, note,
        registration_status, payment_status,
        eligibility_confirmed_at, regulations_confirmed_at,
        privacy_agreed_at, media_notice_confirmed_at,
        submitted_at
    ) values (
        v_t.id, v_seq, v_no,
        v_p1_name, btrim(coalesce(p_player1_phone, '')), v_p1_norm,
        v_p2_name, btrim(coalesce(p_player2_phone, '')), v_p2_norm,
        v_pair, v_club, v_p1_club, v_p2_club, v_depositor, v_note,
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



-- ⚠ lockdown 재적용 — drop/create 로 Supabase 기본 권한이 되살아난다. 반드시 회수한다.
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) from public;
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) from anon;
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) from authenticated;

comment on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text) is
    '공개 참가신청 제출. anon·authenticated 직접 호출 불가 — 서버 route 가 Turnstile 검증 후 service_role 로만 호출한다.';


-- ── set_status (payment_transitions 원본) ───────────────────────────────────
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
    v_active               int;
    v_new_note             text;
    v_was_active           boolean;
    v_will_active          boolean;
    v_registration_changed boolean := false;
    v_payment_changed      boolean := false;
    v_admin_note_changed   boolean := false;
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

    -- 상태 변경·선수 교체·접수 경계 처리를 대회 단위로 직렬화한다.
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

    -- 비활성 → 활성 복귀 시에만 상한(max_capacity) 재검증.
    -- target_capacity(48)는 운영 우선순위 기준이므로 여기서 막지 않는다.
    if v_registration_changed then
        v_was_active  := v_r.registration_status in ('applied', 'waitlisted', 'confirmed');
        v_will_active := p_registration_status  in ('applied', 'waitlisted', 'confirmed');
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

comment on function public.set_tournament_registration_status(uuid,text,text,text) is
    '운영진(CEO/ADMIN) 신청/입금 상태/운영메모 변경. payment_status 는 pending→paid, paid→pending/refund_pending, refund_pending→paid/refunded 만 허용하며 refunded 는 terminal.';


-- ── get_public_tournament (public_bank_info 원본) ──────────────────────────
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
        -- 입금계좌 — Hub 에서 상시 확인용(의도된 공개 정보).
        'bankName',            v_t.bank_name,
        'bankAccount',         v_t.bank_account,
        'bankHolder',          v_t.bank_holder,
        'isRegistrationOpen',  (v_t.status = 'registration_open'
                                and (v_t.registration_open_at is null or now() >= v_t.registration_open_at)
                                and now() <= v_t.registration_close_at
                                and v_active < v_t.max_capacity)
    );
    -- ⚠ 미반환: id, contact_*, published_at, created_at/updated_at, 신청자 정보 일체.
end;
$$;

revoke execute on function public.get_public_tournament(text) from public;
grant  execute on function public.get_public_tournament(text) to anon, authenticated;


-- ── get_public_tournament_teams (player_clubs 원본) ─────────────────────────
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
               'clubName',       r.club_name,          -- legacy 팀 단위(원본 보존)
               'player1ClubName', r.player1_club_name, -- NULL 가능(미보정 건)
               'player2ClubName', r.player2_club_name,
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


-- ── get_admin_tournament_registrations (player_clubs 원본) ──────────────────
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
            'player1ClubName',        r.player1_club_name,
            'player2ClubName',        r.player2_club_name,
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


-- ── get_admin_hosted_tournaments (registration_mvp 원본) ────────────────────
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


-- ── 정원 컬럼 comment (registration_mvp 원본) ───────────────────────────────
comment on column public.hosted_tournaments.target_capacity is
    '우선 참가 기준(48). 초과분은 waitlisted 로 접수된다 — hard cap 이 아니다.';
comment on column public.hosted_tournaments.max_capacity is
    '실제 접수 상한(60). 이 수를 넘으면 TOURNAMENT_FULL.';


notify pgrst, 'reload schema';

commit;
