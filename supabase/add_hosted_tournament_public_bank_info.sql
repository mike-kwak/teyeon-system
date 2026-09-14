-- =============================================================================
-- 2026 TEYEON OPEN — 공개 RPC 에 입금계좌 추가  (Hub 상시 노출용)
--
--   목적: 신청 후 나중에 입금하려는 참가자가 Hub INFO 에서 계좌를 다시 볼 수 있게 한다.
--         현재 get_public_tournament 는 bank_* 를 반환하지 않아, 계좌를 화면에 띄우려면
--         코드에 하드코딩해야 한다. 그걸 피하려고 DB 값을 그대로 내려준다.
--
--   ⚠ 이 변경은 '계좌번호를 공개 정보로 만든다'는 의미다.
--     이미 완료 화면에서 신청자 전원에게 노출되고, 이제 Hub 에서도 상시 노출하기로
--     결정했으므로 의도된 공개다. 다만 승인 없이 적용하지 말 것.
--
--   ⚠ 반환 키만 3개 늘린다. 시그니처(p_slug text)·SECURITY DEFINER·search_path·권한 불변.
--     계좌 외의 비공개 필드(id, contact_*, published_at, 신청자 정보)는 계속 반환하지 않는다.
--   ⚠ 접수 로직(submit RPC)·정원·대기·Turnstile·lockdown 은 건드리지 않는다.
--
--   되돌리기: add_hosted_tournament_public_bank_info_rollback.sql
-- =============================================================================

begin;

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

-- ⚠ create or replace 는 시그니처가 같으므로 기존 권한(ACL)이 유지된다.
--   그래도 계약을 명시적으로 다시 못박는다(공개 조회 RPC 는 anon 허용이 정상).
revoke execute on function public.get_public_tournament(text) from public;
grant  execute on function public.get_public_tournament(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;


-- ── 확인 (읽기 전용) ──────────────────────────────────────────────────────────
-- 기대: bankAccount = 3333256163764, 신청자 정보·contact 는 없음
select public.get_public_tournament('2026-teyeon-open') -> 'bankName'    as bank_name,
       public.get_public_tournament('2026-teyeon-open') -> 'bankAccount' as bank_account,
       public.get_public_tournament('2026-teyeon-open') -> 'bankHolder'  as bank_holder,
       public.get_public_tournament('2026-teyeon-open') -> 'entryFee'    as entry_fee;

-- anon 권한 유지 확인 — 기대: true
select has_function_privilege('anon', 'public.get_public_tournament(text)', 'EXECUTE') as anon_exec;
