-- =============================================================================
-- 2026 TEYEON OPEN — 선수별 클럽 구조 전환  (2026-09-14)
--
--   목표: 신규 신청부터 선수1/선수2 클럽을 각각 저장하고, 공개 참가팀 현황에서
--         "누가 어느 클럽인지" 1:1 로 보이게 한다.
--
--   ⚠⚠ 실제 접수가 진행 중이다(registration_open). 접수가 한 건도 실패하면 안 된다.
--
--   무중단 설계 — 오버로드 대신 'DEFAULT NULL 파라미터' 를 쓴다.
--     · submit / set_players 를 한 트랜잭션 안에서 drop → create 한다.
--     · 새 파라미터에 default null 이 있으므로, 구버전 앱이 기존 인자 수로 호출해도
--       PostgREST 가 그대로 해석해 동작한다(빠진 인자는 기본값).
--     · 따라서 [이 SQL 먼저] → [앱 배포] 순서면 어느 시점에도 실패 구간이 없다.
--       (앱을 먼저 배포하면 인자가 남아 실패하므로 순서를 지킬 것)
--     · DDL 은 트랜잭션 안이라 동시 호출은 잠깐 대기했다가 새 함수로 처리된다. 실패하지 않는다.
--
--   ⚠ 기존 데이터 보호
--     · 컬럼은 nullable 로만 추가한다. backfill 없음, 기존 행은 NULL 유지.
--     · club_name 은 절대 DROP 하지 않는다(기존 건의 유일한 클럽 정보 + 원본 보존).
--     · club_name 문자열을 파싱해 선수별로 배정하는 로직은 어디에도 만들지 않는다.
--
--   ⚠ 보안 — drop 후 재생성하면 Supabase 기본 권한이 anon/authenticated 에 다시 붙는다.
--     같은 트랜잭션에서 lockdown(anon·authenticated·PUBLIC 회수)을 반드시 재적용한다.
--     이걸 빠뜨리면 봇 방어가 조용히 풀린다.
--
--   검증  : add_hosted_tournament_player_clubs_verify.sql
--   되돌림: add_hosted_tournament_player_clubs_rollback.sql
-- =============================================================================

begin;


-- ── 0. 선행 조건 ──────────────────────────────────────────────────────────────
do $guard$
begin
    if to_regclass('public.hosted_tournament_registrations') is null then
        raise exception '선행 마이그레이션이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.set_tournament_registration_players('
                       'uuid,text,text,text,text,text,text,text,boolean)') is null then
        raise exception 'set_tournament_registration_players(9인자) 가 없습니다. 선수 교체 마이그레이션을 먼저 적용하세요.';
    end if;
end $guard$;


-- ── 1. 컬럼 추가 (nullable · backfill 없음) ───────────────────────────────────
--   default 가 없는 nullable 컬럼 추가라 테이블 재작성이 없다(메타데이터 변경).
alter table public.hosted_tournament_registrations
    add column if not exists player1_club_name text,
    add column if not exists player2_club_name text;

comment on column public.hosted_tournament_registrations.player1_club_name is
    '선수1 소속 클럽. 신규 신청부터 SSOT. 기존 건은 NULL(운영진이 Admin 에서 직접 보정).';
comment on column public.hosted_tournament_registrations.player2_club_name is
    '선수2 소속 클럽. 신규 신청부터 SSOT. 기존 건은 NULL(운영진이 Admin 에서 직접 보정).';
comment on column public.hosted_tournament_registrations.club_name is
    'legacy 팀 단위 클럽(참가자가 한 칸에 입력한 원본). 보존 전용 — 파싱·자동 배정 금지.';


-- ── 2. history action CHECK 확장 (선수별 클럽 보정 이력) ──────────────────────
do $chk$
declare
    v_name text;
begin
    select con.conname into v_name
      from pg_constraint con
      join pg_class      c on c.oid = con.conrelid
      join pg_namespace  n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'hosted_tournament_registration_history'
       and con.contype = 'c'
       and con.conkey = array[(select a.attnum from pg_attribute a
                                where a.attrelid = c.oid and a.attname = 'action')];
    if v_name is not null then
        execute format('alter table public.hosted_tournament_registration_history drop constraint %I', v_name);
    end if;
end $chk$;

alter table public.hosted_tournament_registration_history
    add constraint hosted_treg_history_action_check
    check (action in ('submit', 'registration_status', 'payment_status', 'admin_note',
                      'player1_name', 'player1_phone', 'player2_name', 'player2_phone',
                      'club_name', 'depositor_name',
                      'player1_club_name', 'player2_club_name'));


-- ── 3. 공개 참가팀 RPC — 반환 키 2개 추가 (시그니처 불변) ─────────────────────
--   ⚠ 전화·입금·메모는 여전히 반환하지 않는다.
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


-- ── 4. 운영 Admin 목록 RPC — 반환 키 2개 추가 (시그니처 불변) ─────────────────
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


-- ── 5. submit RPC 교체 (12인자 → 14인자, 뒤 2개는 default null) ───────────────
--   ⚠ 본문 로직은 그대로다: advisory lock · 중복 pair · 1~48 applied / 49~60 waitlisted /
--     61 full · 동의 검증 · 접수번호 발급 · history · applied 에만 계좌 응답.
--     추가된 것은 컬럼 2개 저장과 길이 검사뿐이다.
drop function if exists public.submit_tournament_registration(
    text, text, text, text, text, text, text, text, boolean, boolean, boolean, boolean);

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


-- ── 6. 선수 정보 수정 RPC 교체 (9인자 → 11인자, 뒤 2개는 default null) ────────
--   ⚠ 본문 로직 그대로: 상태 게이트(cancelled/rejected·환불 차단) · 사유 필수 ·
--     참가자격 재확인 필수 · pair_key 재계산 · 중복 차단 · advisory lock ·
--     접수번호/순번/신청상태/입금상태 불변 · 전화번호 이력 마스킹.
drop function if exists public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean);

create or replace function public.set_tournament_registration_players(
    p_registration_id       uuid,
    p_player1_name          text,
    p_player1_phone         text,
    p_player2_name          text,
    p_player2_phone         text,
    p_club_name             text,
    p_depositor_name        text,
    p_reason                text,
    p_eligibility_rechecked boolean,
    -- default null = '변경 없음'. 구버전 Admin(9인자)도 그대로 동작한다.
    p_player1_club_name     text default null,
    p_player2_club_name     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_r          public.hosted_tournament_registrations%rowtype;
    v_reason     text;
    v_note       text;
    v_p1_name    text;
    v_p2_name    text;
    v_p1_raw     text;
    v_p2_raw     text;
    v_p1_norm    text;
    v_p2_norm    text;
    v_club       text;
    v_p1_club    text;
    v_p2_club    text;
    v_depositor  text;
    v_pair       text;
    v_changed    text[] := '{}';
begin
    -- (1) 권한 — UI 가 뚫려도 여기서 막힌다.
    if not public.can_manage_tournaments() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;

    -- (2) 변경 사유 필수. 참가자격 재확인 체크 필수.
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null then
        raise exception 'REASON_REQUIRED' using errcode = '22023';
    end if;
    if length(v_reason) > 300 then
        raise exception 'FIELD_TOO_LONG' using errcode = '22023';
    end if;
    if not coalesce(p_eligibility_rechecked, false) then
        raise exception 'ELIGIBILITY_RECHECK_REQUIRED' using errcode = '22023';
    end if;

    -- (3) 대상 신청.
    select * into v_r from public.hosted_tournament_registrations where id = p_registration_id;
    if v_r.id is null then
        raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- (4) 상태 게이트 — 환불 절차와 선수 교체를 섞지 않는다.
    if v_r.registration_status not in ('applied', 'waitlisted', 'confirmed') then
        raise exception 'REGISTRATION_NOT_EDITABLE' using errcode = '22023';
    end if;
    if v_r.payment_status not in ('pending', 'paid') then
        raise exception 'PAYMENT_NOT_EDITABLE' using errcode = '22023';
    end if;

    -- (5) 새 값 확정. NULL 이면 기존 값을 그대로 쓴다.
    v_p1_name   := btrim(coalesce(p_player1_name,   v_r.player1_name));
    v_p2_name   := btrim(coalesce(p_player2_name,   v_r.player2_name));
    v_depositor := btrim(coalesce(p_depositor_name, v_r.depositor_name));
    if v_p1_name = '' or v_p2_name = '' or v_depositor = '' then
        raise exception 'REQUIRED_FIELD_MISSING' using errcode = '22023';
    end if;

    -- club_name 만 '' = 지우기(NULL). NULL 파라미터는 '변경 없음'.
    v_club := case when p_club_name is null then v_r.club_name
                   else nullif(btrim(p_club_name), '') end;
    -- 선수별 클럽도 같은 규약: NULL = 변경 없음, '' = 지우기.
    v_p1_club := case when p_player1_club_name is null then v_r.player1_club_name
                      else nullif(btrim(p_player1_club_name), '') end;
    v_p2_club := case when p_player2_club_name is null then v_r.player2_club_name
                      else nullif(btrim(p_player2_club_name), '') end;

    if length(v_p1_name) > 20 or length(v_p2_name) > 20 or length(v_depositor) > 20
       or (v_club is not null and length(v_club) > 40)
       or (v_p1_club is not null and length(v_p1_club) > 40)
       or (v_p2_club is not null and length(v_p2_club) > 40) then
        raise exception 'FIELD_TOO_LONG' using errcode = '22023';
    end if;

    -- (6) 전화 — 원문 길이를 먼저 자르고(정규화 우회 방지) 정규화·형식·동일번호 검사.
    v_p1_raw := case when p_player1_phone is null then v_r.player1_phone else btrim(p_player1_phone) end;
    v_p2_raw := case when p_player2_phone is null then v_r.player2_phone else btrim(p_player2_phone) end;
    if length(v_p1_raw) > 32 or length(v_p2_raw) > 32 then
        raise exception 'INVALID_PHONE' using errcode = '22023';
    end if;
    v_p1_norm := public.hosted_tournament_normalize_phone(v_p1_raw);
    v_p2_norm := public.hosted_tournament_normalize_phone(v_p2_raw);
    if v_p1_norm !~ '^01[0-9]{8,9}$' or v_p2_norm !~ '^01[0-9]{8,9}$' then
        raise exception 'INVALID_PHONE' using errcode = '22023';
    end if;
    if v_p1_norm = v_p2_norm then
        raise exception 'SAME_PLAYER_PHONE' using errcode = '22023';
    end if;

    -- (7) 페어키는 서버가 다시 만든다. least/greatest 정렬이므로 선수1/2 순서를 바꿔도 같은 키다.
    v_pair := public.hosted_tournament_pair_key(v_p1_norm, v_p2_norm);

    -- (8) 실제 변경이 하나도 없으면 아무것도 쓰지 않는다(사유만 남는 빈 이력 방지).
    if v_p1_name = v_r.player1_name
       and v_p2_name = v_r.player2_name
       and v_p1_norm = v_r.player1_phone_norm
       and v_p2_norm = v_r.player2_phone_norm
       and v_club is not distinct from v_r.club_name
       and v_p1_club is not distinct from v_r.player1_club_name
       and v_p2_club is not distinct from v_r.player2_club_name
       and v_depositor = v_r.depositor_name then
        raise exception 'NO_CHANGES' using errcode = '22023';
    end if;

    -- (9) 여기서부터 대회 단위 직렬화 — status RPC / submit RPC 와 동일한 key.
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-registration:' || v_r.tournament_id::text));

    -- (10) 교체 결과가 다른 '활성' 신청과 같은 팀이 되면 거부한다.
    --      cancelled / rejected 는 검사 대상이 아니다(부분 unique index 와 동일 기준).
    --      partial unique index hosted_treg_active_pair 가 최종 방어선으로 그대로 남는다.
    if v_pair <> v_r.pair_key and exists (
        select 1 from public.hosted_tournament_registrations x
         where x.tournament_id = v_r.tournament_id
           and x.pair_key = v_pair
           and x.id <> v_r.id
           and x.registration_status in ('applied', 'waitlisted', 'confirmed')
    ) then
        raise exception 'DUPLICATE_REGISTRATION' using errcode = '23505';
    end if;

    -- (11) 이력 — 변경된 항목마다 1행. 기존 status RPC 와 같은 패턴.
    --      note 에 변경 사유 + 운영진 참가자격 재확인 사실을 함께 남긴다
    --      (eligibility_recheck 라는 별도 action 을 만들지 않는 최소 구조).
    v_note := v_reason || ' · 운영진 참가자격 재확인 완료';

    if v_p1_name <> v_r.player1_name then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'player1_name', v_r.player1_name, v_p1_name, auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'player1_name'::text;
    end if;

    -- ⚠ 전화번호는 마스킹된 값만 저장한다. 원문은 registration row 에만 남는다.
    if v_p1_norm <> v_r.player1_phone_norm then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'player1_phone',
                public.hosted_tournament_mask_phone(v_r.player1_phone_norm),
                public.hosted_tournament_mask_phone(v_p1_norm),
                auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'player1_phone'::text;
    end if;

    if v_p2_name <> v_r.player2_name then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'player2_name', v_r.player2_name, v_p2_name, auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'player2_name'::text;
    end if;

    if v_p2_norm <> v_r.player2_phone_norm then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'player2_phone',
                public.hosted_tournament_mask_phone(v_r.player2_phone_norm),
                public.hosted_tournament_mask_phone(v_p2_norm),
                auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'player2_phone'::text;
    end if;

    if v_club is distinct from v_r.club_name then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'club_name', v_r.club_name, v_club, auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'club_name'::text;
    end if;

    if v_p1_club is distinct from v_r.player1_club_name then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'player1_club_name', v_r.player1_club_name, v_p1_club, auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'player1_club_name'::text;
    end if;

    if v_p2_club is distinct from v_r.player2_club_name then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'player2_club_name', v_r.player2_club_name, v_p2_club, auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'player2_club_name'::text;
    end if;

    if v_depositor <> v_r.depositor_name then
        insert into public.hosted_tournament_registration_history
            (registration_id, action, from_value, to_value, actor_user_id, actor_type, note)
        values (v_r.id, 'depositor_name', v_r.depositor_name, v_depositor, auth.uid(), 'admin', v_note);
        v_changed := v_changed || 'depositor_name'::text;
    end if;

    -- (12) 신원만 갱신. 순번·접수번호·상태·입금·동의 시각은 UPDATE 대상에 없다.
    update public.hosted_tournament_registrations r
       set player1_name       = v_p1_name,
           player1_phone      = v_p1_raw,
           player1_phone_norm = v_p1_norm,
           player2_name       = v_p2_name,
           player2_phone      = v_p2_raw,
           player2_phone_norm = v_p2_norm,
           pair_key           = v_pair,
           club_name          = v_club,
           player1_club_name  = v_p1_club,
           player2_club_name  = v_p2_club,
           depositor_name     = v_depositor,
           updated_at         = now()
     where r.id = p_registration_id
    returning * into v_r;

    -- (13) 응답 — 개인정보 없음. 무엇이 바뀌었고 무엇이 유지됐는지만 돌려준다.
    return jsonb_build_object(
        'registrationNo',     v_r.registration_no,
        'sequenceNo',         v_r.sequence_no,
        'registrationStatus', v_r.registration_status,
        'paymentStatus',      v_r.payment_status,
        'changed',            to_jsonb(v_changed)
    );
    -- ⚠ 미반환: id, tournament_id, 이름, 전화번호(원문·norm), pair_key, 이력.
end;
$$;


-- ⚠ 운영 RPC 권한 재적용(재생성으로 되살아난 기본 권한 회수).
revoke execute on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean, text, text) from public;
revoke execute on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean, text, text) from anon;
grant  execute on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean, text, text) to authenticated;

comment on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean, text, text) is
    '운영진(CEO/ADMIN) 선수·파트너·클럽 수정. 접수번호/순번/신청상태/입금상태 유지, 사유 필수, 이력의 전화번호는 마스킹.';


notify pgrst, 'reload schema';

commit;


-- =============================================================================
-- 적용 직후 최소 확인 (읽기 전용). 자세한 검증은 _verify.sql 로.
-- =============================================================================
select column_name, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'hosted_tournament_registrations'
   and column_name in ('club_name', 'player1_club_name', 'player2_club_name')
 order by column_name;

-- 기존 건은 전부 NULL 이어야 한다(backfill 안 함).
select count(*) as total,
       count(player1_club_name) as p1_filled,
       count(player2_club_name) as p2_filled,
       count(club_name)         as legacy_club_filled
  from public.hosted_tournament_registrations;
