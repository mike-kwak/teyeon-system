-- =============================================================================
-- VERIFY — add_hosted_tournament_payment_transitions.sql 적용 확인.
--
--   1) 위쪽 PASS/FAIL 표는 읽기 전용이다.
--   2) 아래 "LOCAL/STAGING ONLY" 블록은 isolated test data 를 만들지만
--      같은 트랜잭션에서 rollback 한다. Production 에서 실행하지 말 것.
--
--   사용법:
--     - Production 적용 전: local/staging 에 migration 적용 후 전체 실행.
--     - Production 적용 후: 승인된 경우 위쪽 읽기 전용 표만 실행.
-- =============================================================================


with fn as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'set_tournament_registration_status'
       and pg_get_function_identity_arguments(p.oid) = 'p_registration_id uuid, p_registration_status text, p_payment_status text, p_admin_note text'
),
player_fn as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'set_tournament_registration_players'
),
checks as (

select 1 as seq, 'A. set_tournament_registration_status RPC exists' as check_name, '1' as expected,
       (select count(*)::text from fn) as actual

union all select 2, 'A. INVALID_PAYMENT_TRANSITION is present', 'true',
       coalesce((select (body like '%INVALID_PAYMENT_TRANSITION%')::text from fn), '(none)')

union all select 3, 'B. pending -> paid allowed in source', 'true',
       coalesce((select (body like '%payment_status = ''pending''%'
                         and body like '%p_payment_status = ''paid''%')::text from fn), '(none)')

union all select 4, 'B. paid -> pending/refund_pending allowed in source', 'true',
       coalesce((select (body like '%payment_status = ''paid''%'
                         and body like '%p_payment_status in (''pending'', ''refund_pending'')%')::text from fn), '(none)')

union all select 5, 'B. refund_pending -> paid/refunded allowed in source', 'true',
       coalesce((select (body like '%payment_status = ''refund_pending''%'
                         and body like '%p_payment_status in (''paid'', ''refunded'')%')::text from fn), '(none)')

union all select 6, 'B. refunded has no outgoing branch', 'false',
       coalesce((select (body like '%payment_status = ''refunded''%')::text from fn), '(none)')

union all select 7, 'C. same-state uses changed flag', 'true',
       coalesce((select (body like '%v_payment_changed%'
                         and body like '%if v_registration_changed or v_payment_changed or v_admin_note_changed then%')::text from fn), '(none)')

union all select 8, 'D. payment_status history path preserved', 'true',
       coalesce((select (body like '%''payment_status'', v_r.payment_status, p_payment_status%'
                         and body like '%actor_user_id, actor_type%')::text from fn), '(none)')

union all select 9, 'E. function remains SECURITY DEFINER', 'true',
       coalesce((select p.prosecdef::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 10, 'E. function search_path fixed', 'true',
       coalesce((select (array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 11, 'E. anon cannot execute admin status RPC', 'false',
       coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 12, 'E. authenticated can execute admin status RPC', 'true',
       coalesce((select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_status'), '(none)')

union all select 13, 'F. history schema still has payment_status action', 'true',
       coalesce((select (pg_get_constraintdef(con.oid) like '%payment_status%')::text
                   from pg_constraint con join pg_class c on c.oid=con.conrelid
                  where c.relname='hosted_tournament_registration_history' and con.contype='c'
                    and con.conkey = array[(select a.attnum from pg_attribute a
                                             where a.attrelid=c.oid and a.attname='action')]), '(none)')

union all select 14, 'G. player-change keeps pending/paid gate', 'true',
       coalesce((select (body like '%payment_status not in (''pending'', ''paid'')%')::text from player_fn), '(none)')

)
select seq, check_name, expected, actual,
       case when actual is not distinct from expected then 'PASS' else 'FAIL' end as verdict
  from checks
 order by seq;


-- 기존 데이터 audit: 과거 잘못된 payment_status 이력이 남아 있는지 확인한다.
-- 이번 P1 migration 은 과거 이력을 자동 수정하지 않는다.
select from_value, to_value, count(*) as history_rows
  from public.hosted_tournament_registration_history
 where action = 'payment_status'
   and from_value is not null
   and to_value is not null
   and not (
     (from_value = 'pending' and to_value = 'paid') or
     (from_value = 'paid' and to_value in ('pending', 'refund_pending')) or
     (from_value = 'refund_pending' and to_value in ('paid', 'refunded'))
   )
 group by from_value, to_value
 order by from_value, to_value;


-- =============================================================================
-- LOCAL/STAGING ONLY — transition behavior verify.
--
--   Production 에서 실행하지 말 것.
--   local/staging 에 CEO/ADMIN profile 이 1명 이상 있어야 한다.
--   모든 변경은 rollback 된다.
-- =============================================================================

begin;

do $$
declare
    v_admin_id       uuid;
    v_tournament_id  uuid := gen_random_uuid();
    v_reg_id         uuid;
    v_slug           text := 'verify-payment-transition-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    v_from           text;
    v_to             text;
    v_payment        text;
    v_updated_before timestamptz;
    v_updated_after  timestamptz;
    v_history_before int;
    v_history_after  int;
    v_player_name    text;
begin
    select id into v_admin_id
      from public.profiles
     where role in ('CEO', 'ADMIN')
     limit 1;

    if v_admin_id is null then
        raise exception 'VERIFY_ADMIN_PROFILE_NOT_FOUND';
    end if;

    perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
    if not public.can_manage_tournaments() then
        raise exception 'VERIFY_ADMIN_CONTEXT_NOT_ACTIVE';
    end if;

    insert into public.hosted_tournaments (
        id, slug, title, subtitle, status,
        event_date, event_start_time, registration_close_at,
        venue_name, organizer_name, entry_fee, target_capacity, max_capacity,
        registration_no_prefix
    ) values (
        v_tournament_id, v_slug, 'VERIFY PAYMENT TRANSITIONS', null, 'draft',
        current_date + 30, time '09:00', now() + interval '7 days',
        'VERIFY COURT', 'TEYEON TENNIS CLUB', 40000, 48, 60,
        'VT'
    );

    insert into public.hosted_tournament_registrations (
        tournament_id, sequence_no, registration_no,
        player1_name, player1_phone, player1_phone_norm,
        player2_name, player2_phone, player2_phone_norm,
        pair_key, club_name, depositor_name, note,
        registration_status, payment_status,
        eligibility_confirmed_at, regulations_confirmed_at,
        privacy_agreed_at, media_notice_confirmed_at
    ) values (
        v_tournament_id, 1, 'VT-VERIFY-0001',
        '검증선수A', '01010000001', '01010000001',
        '검증선수B', '01010000002', '01010000002',
        public.hosted_tournament_pair_key('01010000001', '01010000002'),
        null, '검증', null,
        'applied', 'pending',
        now(), now(), now(), now()
    )
    returning id into v_reg_id;

    -- Allowed transitions.
    for v_from, v_to in
        select * from (values
            ('pending',        'paid'),
            ('paid',           'pending'),
            ('paid',           'refund_pending'),
            ('refund_pending', 'paid'),
            ('refund_pending', 'refunded')
        ) as t(from_status, to_status)
    loop
        update public.hosted_tournament_registrations
           set payment_status = v_from,
               updated_at = clock_timestamp()
         where id = v_reg_id;
        delete from public.hosted_tournament_registration_history
         where registration_id = v_reg_id and action = 'payment_status';

        select count(*) into v_history_before
          from public.hosted_tournament_registration_history
         where registration_id = v_reg_id and action = 'payment_status';

        perform public.set_tournament_registration_status(v_reg_id, null, v_to, null);

        select payment_status into v_payment
          from public.hosted_tournament_registrations
         where id = v_reg_id;
        if v_payment <> v_to then
            raise exception 'ALLOWED_TRANSITION_DID_NOT_APPLY: % -> %', v_from, v_to;
        end if;

        select count(*) into v_history_after
          from public.hosted_tournament_registration_history
         where registration_id = v_reg_id
           and action = 'payment_status'
           and from_value = v_from
           and to_value = v_to
           and actor_user_id = v_admin_id
           and actor_type = 'admin';
        if v_history_after <> v_history_before + 1 then
            raise exception 'ALLOWED_TRANSITION_HISTORY_MISMATCH: % -> %', v_from, v_to;
        end if;
    end loop;

    -- Blocked transitions.
    for v_from, v_to in
        select * from (values
            ('pending',        'refund_pending'),
            ('pending',        'refunded'),
            ('paid',           'refunded'),
            ('refund_pending', 'pending'),
            ('refunded',       'pending'),
            ('refunded',       'paid'),
            ('refunded',       'refund_pending')
        ) as t(from_status, to_status)
    loop
        update public.hosted_tournament_registrations
           set payment_status = v_from,
               updated_at = clock_timestamp()
         where id = v_reg_id;
        delete from public.hosted_tournament_registration_history
         where registration_id = v_reg_id and action = 'payment_status';

        select updated_at into v_updated_before
          from public.hosted_tournament_registrations
         where id = v_reg_id;
        select count(*) into v_history_before
          from public.hosted_tournament_registration_history
         where registration_id = v_reg_id and action = 'payment_status';

        begin
            perform public.set_tournament_registration_status(v_reg_id, null, v_to, null);
            raise exception 'BLOCKED_TRANSITION_WAS_ALLOWED: % -> %', v_from, v_to;
        exception when others then
            if sqlerrm not like '%INVALID_PAYMENT_TRANSITION%' then
                raise exception 'UNEXPECTED_BLOCK_ERROR: % -> %, %', v_from, v_to, sqlerrm;
            end if;
        end;

        select payment_status, updated_at into v_payment, v_updated_after
          from public.hosted_tournament_registrations
         where id = v_reg_id;
        select count(*) into v_history_after
          from public.hosted_tournament_registration_history
         where registration_id = v_reg_id and action = 'payment_status';

        if v_payment <> v_from then
            raise exception 'BLOCKED_TRANSITION_CHANGED_ROW: % -> %', v_from, v_to;
        end if;
        if v_updated_after <> v_updated_before then
            raise exception 'BLOCKED_TRANSITION_UPDATED_AT_CHANGED: % -> %', v_from, v_to;
        end if;
        if v_history_after <> v_history_before then
            raise exception 'BLOCKED_TRANSITION_HISTORY_WRITTEN: % -> %', v_from, v_to;
        end if;
    end loop;

    -- Same-state no-op.
    update public.hosted_tournament_registrations
       set payment_status = 'pending',
           updated_at = clock_timestamp()
     where id = v_reg_id;
    delete from public.hosted_tournament_registration_history
     where registration_id = v_reg_id and action = 'payment_status';

    select updated_at into v_updated_before
      from public.hosted_tournament_registrations
     where id = v_reg_id;
    select count(*) into v_history_before
      from public.hosted_tournament_registration_history
     where registration_id = v_reg_id and action = 'payment_status';

    perform public.set_tournament_registration_status(v_reg_id, null, 'pending', null);

    select payment_status, updated_at into v_payment, v_updated_after
      from public.hosted_tournament_registrations
     where id = v_reg_id;
    select count(*) into v_history_after
      from public.hosted_tournament_registration_history
     where registration_id = v_reg_id and action = 'payment_status';

    if v_payment <> 'pending' or v_updated_after <> v_updated_before or v_history_after <> v_history_before then
        raise exception 'SAME_STATE_NOOP_FAILED';
    end if;

    -- registration_status regression.
    update public.hosted_tournament_registrations
       set registration_status = 'applied',
           payment_status = 'pending',
           confirmed_at = null,
           cancelled_at = null,
           updated_at = clock_timestamp()
     where id = v_reg_id;
    delete from public.hosted_tournament_registration_history
     where registration_id = v_reg_id and action in ('registration_status', 'admin_note');

    perform public.set_tournament_registration_status(v_reg_id, 'confirmed', null, null);
    if not exists (
        select 1 from public.hosted_tournament_registrations
         where id = v_reg_id
           and registration_status = 'confirmed'
           and payment_status = 'pending'
           and confirmed_at is not null
    ) then
        raise exception 'REGISTRATION_STATUS_REGRESSION_FAILED';
    end if;
    if not exists (
        select 1 from public.hosted_tournament_registration_history
         where registration_id = v_reg_id
           and action = 'registration_status'
           and from_value = 'applied'
           and to_value = 'confirmed'
    ) then
        raise exception 'REGISTRATION_STATUS_HISTORY_FAILED';
    end if;

    -- admin_note regression.
    perform public.set_tournament_registration_status(v_reg_id, null, null, '검증 메모');
    if not exists (
        select 1 from public.hosted_tournament_registrations
         where id = v_reg_id and admin_note = '검증 메모'
    ) then
        raise exception 'ADMIN_NOTE_REGRESSION_FAILED';
    end if;
    if not exists (
        select 1 from public.hosted_tournament_registration_history
         where registration_id = v_reg_id
           and action = 'admin_note'
           and to_value = '검증 메모'
    ) then
        raise exception 'ADMIN_NOTE_HISTORY_FAILED';
    end if;

    -- player-change regression: pending/paid 허용.
    update public.hosted_tournament_registrations
       set registration_status = 'applied',
           payment_status = 'pending'
     where id = v_reg_id;
    perform public.set_tournament_registration_players(
        v_reg_id, '검증선수A2', null, null, null, null, null,
        'payment transition verify', true
    );

    update public.hosted_tournament_registrations
       set payment_status = 'paid'
     where id = v_reg_id;
    perform public.set_tournament_registration_players(
        v_reg_id, null, null, '검증선수B2', null, null, null,
        'payment transition verify', true
    );

    -- player-change regression: refund_pending/refunded 차단.
    for v_from in select * from (values ('refund_pending'), ('refunded')) as t(status)
    loop
        update public.hosted_tournament_registrations
           set payment_status = v_from
         where id = v_reg_id;
        select player1_name into v_player_name
          from public.hosted_tournament_registrations
         where id = v_reg_id;

        begin
            perform public.set_tournament_registration_players(
                v_reg_id, '차단검증', null, null, null, null, null,
                'payment transition verify blocked', true
            );
            raise exception 'PLAYER_CHANGE_WAS_ALLOWED_FOR_PAYMENT_STATUS: %', v_from;
        exception when others then
            if sqlerrm not like '%PAYMENT_NOT_EDITABLE%' then
                raise exception 'UNEXPECTED_PLAYER_CHANGE_BLOCK_ERROR: %, %', v_from, sqlerrm;
            end if;
        end;

        if exists (
            select 1 from public.hosted_tournament_registrations
             where id = v_reg_id and player1_name <> v_player_name
        ) then
            raise exception 'PLAYER_CHANGE_BLOCKED_ROW_CHANGED: %', v_from;
        end if;
    end loop;
end $$;

rollback;
