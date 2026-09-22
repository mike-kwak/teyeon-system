-- =============================================================================
-- 2026 TEYEON OPEN — 정원 / 대기팀 정책 재정의  (2026-09-22)
--
--   확정 정책
--     · target_capacity(48) = 목표 모집 수. 안내용 숫자다. 서버 판정에 쓰지 않는다.
--     · max_capacity(60)    = 정상 참가 최대 슬롯.
--     · 정상 슬롯           = registration_status in ('applied', 'confirmed').
--                             waitlisted 는 정상 슬롯에 들어가지 않는다.
--     · 신규 신청: 정상 슬롯 < 60 이고 활성 waitlisted 가 0 → applied
--                  그 외(정상 60 이상, 또는 대기팀이 한 팀이라도 있음) → waitlisted
--                  대기팀이 있으면 빈 정상 슬롯이 있어도 신규 신청은 기존 대기팀을 앞지르지 않는다.
--     · 정원 때문에 신청 자체를 막지 않는다(TOURNAMENT_FULL 제거). 대기 접수는 상한이 없다.
--       접수 자체의 마감은 대회 status · 접수 기간으로만 결정한다.
--     · 대기 순번 = waitlisted 팀을 sequence_no ASC 로 세서 '조회 시' 계산한다. 컬럼을 만들지 않는다.
--       sequence_no / registration_no 는 절대 변경하지 않는다.
--     · 승격은 자동으로 하지 않는다. 운영진이 promote_waitlisted_tournament_registration 으로
--       waitlisted → applied 를 수동으로 처리한다. payment_status 는 pending 그대로다.
--       대기 1번이 아닌 팀도 승격할 수 있지만 사유를 필수로 받아 이력(note)에 남긴다.
--     · applied / confirmed 로 '새로 들어가는' 모든 전환은 대회 advisory lock 안에서
--       정상 슬롯 < 60 을 다시 확인한다(NORMAL_CAPACITY_FULL). 61팀이 되는 경로는 없다.
--
--   변경 대상 (전부 CREATE OR REPLACE · 시그니처 불변 · DROP 없음)
--     1) submit_tournament_registration(14인자)   — 판정 교체 + 응답에 waitlistPosition
--     2) set_tournament_registration_status(4인자) — 정상 슬롯 가드
--     3) promote_waitlisted_tournament_registration(uuid, text) — 신규
--     4) get_public_tournament(text)               — normalCount / nextRegistrationWaitlisted,
--                                                     isRegistrationOpen 에서 정원 조건 제거
--     5) get_public_tournament_teams(text)         — waitlistPosition
--     6) get_admin_tournament_registrations(text)  — waitlistPosition
--     7) get_admin_hosted_tournaments()            — normalCount
--     8) 정원 컬럼 comment
--
--   ⚠ 하지 않는 것
--     · 테이블 · 컬럼 · CHECK · index 변경 없음. 기존 행 UPDATE 없음(backfill 없음).
--     · payment_status 모델 확장 없음. 입금 상태 전이 matrix 그대로.
--     · 공개 RPC 의 개인정보 범위 변경 없음(전화 · 입금자 · 메모 · 입금상태 미반환 유지).
--     · raw table 권한 · RLS 변경 없음.
--     · confirmed 취소 후 hosted_tournament_teams 가 active 로 남는 문제는 범위 밖(APPLY_CHECKLIST TODO).
--
--   ⚠ 보안 — create or replace 는 기존 ACL 을 유지한다. 그래도 lockdown 을 같은 트랜잭션에서
--     다시 못박는다(submit = anon · authenticated · PUBLIC 회수).
--
--   검증  : add_hosted_tournament_waitlist_policy_verify.sql
--   실동작: verify_hosted_tournament_waitlist_policy_fixture.sql (전량 rollback)
--   되돌림: add_hosted_tournament_waitlist_policy_rollback.sql
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regclass('public.hosted_tournament_registrations') is null
       or to_regclass('public.hosted_tournament_registration_history') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_registration_mvp.sql)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.submit_tournament_registration('
                       'text,text,text,text,text,text,text,text,'
                       'boolean,boolean,boolean,boolean,text,text)') is null then
        raise exception 'submit_tournament_registration(14인자)가 없습니다. 선수별 클럽 마이그레이션을 먼저 적용하세요.';
    end if;
    if to_regprocedure('public.set_tournament_registration_status(uuid,text,text,text)') is null then
        raise exception 'set_tournament_registration_status(4인자)가 없습니다.';
    end if;
    if to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)') is not null then
        raise exception 'promote_waitlisted_tournament_registration 이 이미 있습니다. 적용 상태를 먼저 확인하세요.';
    end if;
end $guard$;


-- ── 1. submit RPC — 판정 교체 (시그니처 · 파라미터 이름 · default 불변) ──────────
--   바뀐 곳은 (8) 정원 집계 · (10) 판정 · (12) 응답의 waitlistPosition 뿐이다.
--   동의 검증 · 필수값 · 전화 정규화 · 접수 기간 · advisory lock · 중복 pair ·
--   순번 발급 · history · applied 에만 계좌 응답은 그대로다.
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
    --     ⚠ 상태 변경 · 대기 승격 · 선수 교체와 같은 키다. 아래 집계와 INSERT 는 반드시 이 뒤에 둔다.
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

    -- (8) 정상 슬롯 · 대기 집계 (lock 안).
    --     정상 슬롯 = applied + confirmed. waitlisted 는 정상 슬롯에 넣지 않는다.
    --     ⚠ 정원 때문에 신청을 막지 않는다 — 정원 초과 예외는 더 이상 없다.
    select count(*) filter (where r.registration_status in ('applied', 'confirmed')),
           count(*) filter (where r.registration_status = 'waitlisted')
      into v_normal, v_waiting
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id;

    -- (9) 접수 순번 — max+1. 취소/거절된 신청의 번호를 재사용하지 않는다(접수번호 영구 고유).
    --     ⚠ 신청 행을 물리 삭제하면 번호가 재사용될 수 있다. 반드시 cancelled / rejected 로 처리한다.
    select coalesce(max(r.sequence_no), 0) + 1 into v_seq
      from public.hosted_tournament_registrations r
     where r.tournament_id = v_t.id;

    -- (10) 정상 / 대기 판정.
    --      정상 슬롯에 자리가 있고 기다리는 대기팀이 없을 때만 applied.
    --      대기팀이 한 팀이라도 있으면 빈 정상 슬롯은 운영진이 대기팀 승격으로 채운다(새 신청이 앞지르지 않는다).
    --      목표 모집 수(48)는 판정에 쓰지 않는다.
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
    --   ⚠ 계좌는 'applied' 일 때만 싣는다. 'waitlisted' 는 운영진 안내 전 입금하지 않으므로 계좌를 주지 않는다.
    --   waitlistPosition = 새 행은 가장 큰 순번이므로 기존 대기팀 수 + 1 이다(lock 안에서 센 값).
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
    -- ⚠ 미반환: id, tournament_id, phone, phone_norm, pair_key, depositor_name, note, admin_note, 이력.
end;
$$;

-- ⚠ lockdown 재확인 — anon · authenticated · PUBLIC 직접 호출 불가(서버 route 가 service_role 로만 호출).
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
    '공개 참가신청 제출. 정상 슬롯(applied+confirmed) < max_capacity 이고 대기팀이 없으면 applied, 아니면 waitlisted(상한 없음). anon·authenticated 직접 호출 불가 — 서버 route 가 Turnstile 검증 후 service_role 로만 호출한다.';


-- ── 2. 운영 RPC: 신청/입금 상태 변경 — 정상 슬롯 가드 (시그니처 불변) ─────────────
--   바뀐 곳: 활성 복귀 시 '활성 수 >= max' 검사를 없애고,
--            applied / confirmed 로 새로 들어가는 전환에 '정상 슬롯 >= max' 검사를 둔다.
--   applied ↔ confirmed 처럼 정상 슬롯 안에서 움직이는 전환은 정원과 무관하다(60번째 팀 확정 가능).
--   입금 상태 전이 matrix · 이력 · 운영메모 · confirmed_at / cancelled_at 처리는 그대로다.
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

    -- 상태 변경·대기 승격·선수 교체·신규 접수를 대회 단위로 직렬화한다.
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

        -- 비활성 → 활성 복귀: 같은 팀의 다른 활성 신청이 있으면 막는다.
        --   대기(waitlisted)로의 복귀는 정원과 무관하다(대기 접수 상한 없음).
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

        -- 정상 슬롯으로 '새로 들어가는' 전환(waitlisted/cancelled/rejected → applied/confirmed).
        --   lock 안에서 다시 센다. 이미 max 이면 어떤 경로로도 들어갈 수 없다.
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
    '운영진(CEO/ADMIN) 신청/입금 상태/운영메모 변경. applied/confirmed 로 새로 들어가는 전환은 정상 슬롯 < max_capacity 일 때만(NORMAL_CAPACITY_FULL). payment_status 는 pending→paid, paid→pending/refund_pending, refund_pending→paid/refunded 만 허용하며 refunded 는 terminal.';


-- ── 3. 운영 RPC: 대기팀 승격 (신규) ──────────────────────────────────────────
--   waitlisted → applied. 이 승격이 곧 '입금 요청 대상이 됨'이다. payment_status 는 건드리지 않는다.
--   · 대기 순번은 lock 안에서 sequence_no ASC 로 다시 계산한다.
--   · 대기 1번이 아니면 사유가 필수다(예외 승격). 서버가 무조건 막지는 않는다.
--   · 정상 슬롯이 이미 max 이면 순번과 관계없이 막는다(NORMAL_CAPACITY_FULL).
--   · 이력: registration_status waitlisted → applied, note = '대기 N번 승격[ · 예외] · 사유'.
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

    -- 신규 접수 · 상태 변경 · 선수 교체와 같은 키로 직렬화한다.
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

    select count(*) filter (where r.registration_status in ('applied', 'confirmed')),
           count(*) filter (where r.registration_status = 'waitlisted'),
           count(*) filter (where r.registration_status = 'waitlisted'
                              and r.sequence_no <= v_r.sequence_no)
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

    update public.hosted_tournament_registrations r
       set registration_status = 'applied',
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

comment on function public.promote_waitlisted_tournament_registration(uuid, text) is
    '운영진(CEO/ADMIN) 대기팀 수동 승격(waitlisted→applied, payment_status 불변). 정상 슬롯이 max 이면 NORMAL_CAPACITY_FULL, 대기 1번이 아니면 사유 필수(PROMOTION_REASON_REQUIRED). 사유는 이력 note 에 남는다.';


-- ── 4. 공개 RPC: 대회 정보 + 접수 현황 ────────────────────────────────────────
--   · isRegistrationOpen 에서 정원 조건을 뺀다 — 정원이 차도 접수 기간이면 대기 접수를 받는다.
--   · normalCount = 정상 슬롯(applied+confirmed), remaining = max - normalCount.
--   · nextRegistrationWaitlisted = 지금 신청하면 대기 접수가 되는가(정상 슬롯 만석 또는 대기팀 존재).
--   · appliedCount 는 기존 의미(활성 = applied+waitlisted+confirmed) 그대로 둔다(구버전 앱 호환).
--   ⚠ 반환 화이트리스트 유지. 신청자 정보 · 내부 UUID · contact_* 는 반환하지 않는다.
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
    v_normal int;
    v_wait   int;
begin
    select * into v_t from public.hosted_tournaments
     where slug = p_slug and status <> 'draft';
    if v_t.id is null then
        return null;  -- 없음/비공개 — 클라이언트는 "준비 중"으로 처리한다.
    end if;

    select count(*) filter (where r.registration_status in ('applied', 'waitlisted', 'confirmed')),
           count(*) filter (where r.registration_status in ('applied', 'confirmed')),
           count(*) filter (where r.registration_status = 'waitlisted')
      into v_active, v_normal, v_wait
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
        'appliedCount',        v_active,      -- 활성 신청 팀 수(applied+waitlisted+confirmed) — legacy 의미 유지
        'normalCount',         v_normal,      -- 정상 참가 슬롯 점유(applied+confirmed)
        'waitlistedCount',     v_wait,
        'remaining',           greatest(v_t.max_capacity - v_normal, 0),
        'nextRegistrationWaitlisted', (v_normal >= v_t.max_capacity or v_wait > 0),
        -- 입금계좌 — Hub 에서 상시 확인용(의도된 공개 정보).
        'bankName',            v_t.bank_name,
        'bankAccount',         v_t.bank_account,
        'bankHolder',          v_t.bank_holder,
        'isRegistrationOpen',  (v_t.status = 'registration_open'
                                and (v_t.registration_open_at is null or now() >= v_t.registration_open_at)
                                and now() <= v_t.registration_close_at)
    );
    -- ⚠ 미반환: id, contact_*, published_at, created_at/updated_at, 신청자 정보 일체.
end;
$$;

revoke execute on function public.get_public_tournament(text) from public;
grant  execute on function public.get_public_tournament(text) to anon, authenticated;


-- ── 5. 공개 참가팀 RPC — waitlistPosition 추가 (시그니처 불변) ─────────────────
--   ⚠ 전화·입금·메모·입금상태는 여전히 반환하지 않는다. 대기 순번은 개인정보가 아니다.
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
               'clubName',         x.club_name,          -- legacy 팀 단위(원본 보존)
               'player1ClubName',  x.player1_club_name,  -- NULL 가능(미보정 건)
               'player2ClubName',  x.player2_club_name,
               'publicStatus',     x.registration_status, -- 'applied' | 'waitlisted' | 'confirmed'
               'waitlistPosition', x.waitlist_position    -- waitlisted 만 1..N, 그 외 null
           ) order by x.sequence_no), '[]'::jsonb)
      from (
            select r.sequence_no, r.player1_name, r.player2_name, r.club_name,
                   r.player1_club_name, r.player2_club_name, r.registration_status,
                   case when r.registration_status = 'waitlisted'
                        then row_number() over (partition by (r.registration_status = 'waitlisted')
                                                    order by r.sequence_no)
                   end as waitlist_position
              from public.hosted_tournament_registrations r
              join public.hosted_tournaments t on t.id = r.tournament_id
             where t.slug = p_slug
               and t.status <> 'draft'
               and r.registration_status in ('applied', 'waitlisted', 'confirmed')
           ) x;
    -- ⚠ 미반환: id, tournament_id, phone, phone_norm, pair_key, depositor_name,
    --           note, admin_note, payment_status, 각종 시각, 이력.
$$;

revoke execute on function public.get_public_tournament_teams(text) from public;
grant  execute on function public.get_public_tournament_teams(text) to anon, authenticated;


-- ── 6. 운영 Admin 목록 RPC — waitlistPosition 추가 (시그니처 불변) ─────────────
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
                                                      order by r.sequence_no)
                     end as waitlist_position
                from public.hosted_tournament_registrations r
                join public.hosted_tournaments t on t.id = r.tournament_id
               where t.slug = p_slug
             ) x
    );
    -- pair_key 는 반환하지 않는다(운영 화면에서 쓸 일이 없는 내부 판정 키).
end;
$$;

revoke execute on function public.get_admin_tournament_registrations(text) from public;
revoke execute on function public.get_admin_tournament_registrations(text) from anon;
grant  execute on function public.get_admin_tournament_registrations(text) to authenticated;


-- ── 7. 운영 RPC: 대회 목록 — normalCount 추가 (시그니처 불변) ─────────────────
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
            'normalCount',     (select count(*) from public.hosted_tournament_registrations r
                                 where r.tournament_id = t.id
                                   and r.registration_status in ('applied','confirmed')),
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


-- ── 8. 정원 컬럼 의미 갱신 ─────────────────────────────────────────────────────
comment on column public.hosted_tournaments.target_capacity is
    '목표 모집 팀 수(48). 안내용 — 서버 판정(applied/waitlisted)에 쓰지 않는다.';
comment on column public.hosted_tournaments.max_capacity is
    '정상 참가 최대 슬롯(60). 정상 슬롯 = applied+confirmed. 초과·대기팀 존재 시 신규 신청은 waitlisted(상한 없음) — 접수를 막지 않는다.';


notify pgrst, 'reload schema';

commit;
