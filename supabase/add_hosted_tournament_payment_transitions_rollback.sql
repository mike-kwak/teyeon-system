-- =============================================================================
-- ROLLBACK — add_hosted_tournament_payment_transitions.sql 되돌리기.
--
--   이 롤백은 테이블/데이터/history 를 건드리지 않고,
--   set_tournament_registration_status RPC 만 P1 이전 동작으로 되돌린다.
--
--   ⚠ Production 적용 전후 모두 승인 없이 실행 금지.
-- =============================================================================

begin;


do $$
begin
    if to_regprocedure('public.set_tournament_registration_status(uuid,text,text,text)') is null then
        raise exception '기존 RPC set_tournament_registration_status 가 없습니다.';
    end if;
end $$;


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
    -- target_capacity(48)는 운영 우선순위 기준이므로 여기서 막지 않는다.
    if p_registration_status is not null and p_registration_status <> v_r.registration_status then
        v_was_active  := v_r.registration_status in ('applied', 'waitlisted', 'confirmed');
        v_will_active := p_registration_status  in ('applied', 'waitlisted', 'confirmed');
        if v_will_active and not v_was_active then
            perform pg_advisory_xact_lock(hashtext('hosted-tournament-registration:' || v_r.tournament_id::text));
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

comment on function public.set_tournament_registration_status(uuid,text,text,text) is
    '운영진(CEO/ADMIN) 신청/입금 상태/운영메모 변경. P1 payment transition hardening 이전 동작.';

notify pgrst, 'reload schema';

commit;
