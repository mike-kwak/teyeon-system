-- =============================================================================
-- TEYEON hosted tournament — payment_status transition hardening [P1]
--
--   범위:
--     1) 기존 set_tournament_registration_status RPC 구조 유지
--     2) payment_status 변경에 명시 transition matrix 강제
--     3) 허용되지 않은 transition 은 INVALID_PAYMENT_TRANSITION 으로 거부
--     4) history 스키마 변경 없음
--
--   확정 matrix:
--     pending        -> paid
--     paid           -> pending / refund_pending
--     refund_pending -> paid / refunded
--     refunded       -> terminal, 이동 불가
--
--   ⚠ Production DB 자동 적용 금지. Supabase SQL Editor 에서 승인 후 수동 적용.
--   rollback: supabase/add_hosted_tournament_payment_transitions_rollback.sql
--   verify  : supabase/add_hosted_tournament_payment_transitions_verify.sql
-- =============================================================================

begin;


-- ── 0. 선행 조건 확인 ─────────────────────────────────────────────────────────
do $$
begin
    if to_regclass('public.hosted_tournament_registrations') is null
       or to_regclass('public.hosted_tournament_registration_history') is null then
        raise exception '선행 마이그레이션(add_hosted_tournament_registration_mvp.sql)이 적용되지 않았습니다.';
    end if;
    if to_regprocedure('public.set_tournament_registration_status(uuid,text,text,text)') is null then
        raise exception '기존 RPC set_tournament_registration_status 가 없습니다.';
    end if;
end $$;


-- ── 1. 운영 RPC: 신청/입금 상태 변경 + 운영메모 ───────────────────────────────
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

notify pgrst, 'reload schema';

commit;
