-- =============================================================================
-- 주최 대회 — 운영진 선수(파트너) 교체  [P1]
--
--   실전에서 부상·개인사정으로 선수가 바뀔 때, 기존 접수를 취소하고 다시 신청하면
--     · sequence_no / registration_no 가 바뀌고
--     · 만석(max_capacity)이면 재신청 자체가 막히며
--     · payment_status 가 pending 으로 초기화되어 입금 대사가 깨진다.
--   이 마이그레이션은 그 우회로를 없애고, 접수 신원만 안전하게 갈아끼운다.
--
--   범위 (최소):
--     1) history.action CHECK 확장  — 컬럼 추가 없음
--     2) 내부 helper hosted_tournament_mask_phone()  — 이력용 전화 마스킹
--     3) 신규 RPC set_tournament_registration_players()
--
--   ⚠ 기존 함수는 하나도 수정하지 않는다.
--     submit_tournament_registration / set_tournament_registration_status /
--     get_admin_* / get_public_* 는 이 파일에서 건드리지 않는다.
--   ⚠ 테이블 컬럼을 추가하지 않는다. 정원(48/60)·순번·대기 로직도 건드리지 않는다.
--
--   선행 조건: add_hosted_tournament_registration_mvp.sql 이 이미 적용되어 있을 것.
--   적용 후   : add_hosted_tournament_player_change_verify.sql 을 실행해 전 항목 PASS 확인.
--   되돌리기  : add_hosted_tournament_player_change_rollback.sql
-- =============================================================================


-- ⚠ 이 파일은 전체가 하나의 트랜잭션이다(BEGIN … COMMIT).
--   history.action CHECK 를 drop → recreate 하는 구간이 있어, 중간에 실패하면
--   CHECK 가 없는 상태로 남을 수 있기 때문이다. 전체를 한 번에 실행할 것.
begin;


-- ── 0. 선행 조건 확인 ─────────────────────────────────────────────────────────
--   MVP 마이그레이션 없이 이 파일만 돌리는 사고를 막는다.
do $$
begin
    if to_regclass('public.hosted_tournament_registrations') is null
       or to_regclass('public.hosted_tournament_registration_history') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_registration_mvp.sql)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.hosted_tournament_pair_key(text,text)') is null then
        raise exception 'helper hosted_tournament_pair_key 가 없습니다. 선행 마이그레이션을 먼저 적용하세요.';
    end if;
end $$;


-- ── 1. history.action CHECK 확장 ──────────────────────────────────────────────
--   기존 4종에 선수/클럽/입금자명 6종을 더한다. CHECK 를 '넓히는' 변경이므로
--   기존 행은 전부 그대로 통과하고 테이블 재작성도 일어나지 않는다.
--   제약 이름은 자동 생성되었을 수 있으므로 action 컬럼에 걸린 CHECK 를 찾아 드롭한다.
do $$
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
       and con.conkey = array[(select a.attnum
                                 from pg_attribute a
                                where a.attrelid = c.oid and a.attname = 'action')];
    if v_name is not null then
        execute format('alter table public.hosted_tournament_registration_history drop constraint %I', v_name);
    end if;
end $$;

alter table public.hosted_tournament_registration_history
    add constraint hosted_treg_history_action_check
    check (action in ('submit', 'registration_status', 'payment_status', 'admin_note',
                      'player1_name', 'player1_phone', 'player2_name', 'player2_phone',
                      'club_name', 'depositor_name'));

comment on column public.hosted_tournament_registration_history.action is
    '변경 항목. player*_phone 의 from/to 는 반드시 마스킹된 값이다(원문 저장 금지).';


-- ── 2. 내부 helper: 이력용 전화 마스킹 ────────────────────────────────────────
--   이력에는 전화번호 원문을 남기지 않는다. 010-****-5678 형태만 저장한다.
--   현재 신원(registration row)에는 정상 운영을 위해 원문 + norm 을 그대로 유지한다.
--   ⚠ 어떤 클라이언트 role 도 직접 실행할 수 없다. SECURITY DEFINER 함수 내부 호출 전용.
create or replace function public.hosted_tournament_mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
    select case
        when length(public.hosted_tournament_normalize_phone(p_phone)) < 7 then null
        else left(public.hosted_tournament_normalize_phone(p_phone), 3)
             || '-****-'
             || right(public.hosted_tournament_normalize_phone(p_phone), 4)
    end;
$$;
revoke execute on function public.hosted_tournament_mask_phone(text) from public;
revoke execute on function public.hosted_tournament_mask_phone(text) from anon;
revoke execute on function public.hosted_tournament_mask_phone(text) from authenticated;


-- ── 3. 운영 RPC: 선수(파트너) 교체 ────────────────────────────────────────────
--   NULL = '변경 없음'. club_name 만 빈 문자열('')로 '지우기'를 표현한다(컬럼이 NULL 허용).
--   depositor_name 은 NOT NULL 이므로 빈 값이 오면 거부한다.
--
--   불변 보장: id / sequence_no / registration_no / registration_status /
--             payment_status / submitted_at / 동의 4종 timestamp.
--             eligibility_confirmed_at 은 '최초 신청자 본인의 확인 기록'이므로
--             운영진의 재확인으로 덮어쓰지 않는다 — 재확인 사실은 이력 note 에만 남긴다.
--
--   교체 허용 상태:
--     registration_status  applied / waitlisted / confirmed        (cancelled / rejected 차단)
--     payment_status       pending / paid                          (refund_pending / refunded 차단)
--
--   동시성: set_tournament_registration_status 와 '동일한' advisory lock key 를 쓴다.
--          상태 변경·대기 승격·선수 교체가 대회 단위로 직렬화된다.
create or replace function public.set_tournament_registration_players(
    p_registration_id       uuid,
    p_player1_name          text,
    p_player1_phone         text,
    p_player2_name          text,
    p_player2_phone         text,
    p_club_name             text,
    p_depositor_name        text,
    p_reason                text,
    p_eligibility_rechecked boolean
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

    if length(v_p1_name) > 20 or length(v_p2_name) > 20 or length(v_depositor) > 20
       or (v_club is not null and length(v_club) > 40) then
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

revoke execute on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean) from public;
revoke execute on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean) from anon;
grant  execute on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean) to authenticated;

comment on function public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean) is
    '운영진(CEO/ADMIN) 선수·파트너 교체. 접수번호/순번/신청상태/입금상태 유지, 변경 사유 필수, 이력의 전화번호는 마스킹.';


commit;
