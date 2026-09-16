-- ============================================================================
--  2026 TEYEON OPEN — Court 운영 엔티티 (Batch 1 / 3of4)
--
--  적용 순서: events → teams → **courts** → fixture
--
--  왜 숫자 하나(court_count)가 아니라 테이블인가
--    · Control Center 는 "몇 면인가"가 아니라 "2번 코트가 지금 비었나 / 점검중인가"를 묻는다.
--    · Arena TV 는 코트를 고정 순서로 배열해야 하고, '센터코트' 같은 이름이 필요하다.
--    · LIVE 중계 코트(feature court)를 코드에 하드코딩하지 않으려면 저장할 곳이 있어야 한다.
--
--  ⚠ 과설계하지 않는다. status 는 active/disabled 2값으로 시작한다.
--    (점검중·야간전용 같은 값은 실제로 필요해졌을 때 check 를 늘린다)
--  ⚠ 코트 번호를 앱 코드에 하드코딩하지 않는다. 몇 면을 쓰는지는 전적으로 이 테이블이 정한다.
--  ⚠ LIVE Phase 2 초안(add_hosted_tournament_live_sessions_DRAFT.sql)의
--    hosted_tournaments.feature_court_label 은 폐기하고 여기 is_feature_court 로 통합한다.
--    (해당 초안은 아직 미적용이므로 운영 DB 에 영향 없음)
-- ============================================================================

begin;

create table if not exists public.hosted_tournament_courts (
    id               uuid        primary key default gen_random_uuid(),
    tournament_id    uuid        not null references public.hosted_tournaments(id) on delete cascade,

    -- 현장에서 부르는 번호. 1~30 은 오타 방어용 범위이지 대회 포맷 결정이 아니다.
    court_no         integer     not null check (court_no between 1 and 30),
    -- NULL 이면 앱이 'N번 코트' 로 표기한다. '센터코트' 처럼 부를 때만 채운다.
    display_name     text        check (display_name is null
                                        or length(btrim(display_name)) between 1 and 30),
    display_order    integer     not null check (display_order >= 1),

    status           text        not null default 'active'
                                 check (status in ('active', 'disabled')),
    is_feature_court boolean     not null default false,

    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),

    constraint hosted_tcourt_no_unique unique (tournament_id, court_no),
    -- 표시 순서도 유일해야 하지만, 재정렬은 두 행을 맞바꾸는 동작이라
    -- 즉시 검사하면 중간 상태에서 반드시 충돌한다 → 트랜잭션 끝에 검사한다.
    constraint hosted_tcourt_order_unique unique (tournament_id, display_order)
                                 deferrable initially deferred,
    -- 후속 Batch 의 matches 가 (tournament_id, court_id) 복합 FK 를 걸 수 있게 열어 둔다.
    constraint hosted_tcourt_tid_id_unique unique (tournament_id, id)
);

comment on table public.hosted_tournament_courts is
    '대회 운영 코트. Control Center/Arena TV 의 코트 배열과 LIVE feature court 의 단일 출처.';
comment on column public.hosted_tournament_courts.court_no is
    '현장 코트 번호. 1~30 은 입력 오류 방어 범위이며 대회 규모를 규정하지 않는다.';
comment on column public.hosted_tournament_courts.is_feature_court is
    'LIVE 중계 코트. 대회당 최대 1면(partial unique index 로 강제).';

-- 대회당 feature court 는 최대 1면.
create unique index if not exists hosted_tcourt_feature_uniq
    on public.hosted_tournament_courts (tournament_id)
    where is_feature_court;

create index if not exists hosted_tcourt_order_idx
    on public.hosted_tournament_courts (tournament_id, display_order);


-- ── 권한 — 기존 hosted_* 와 동일 정책 ────────────────────────────────────────
alter table public.hosted_tournament_courts enable row level security;

revoke all on table public.hosted_tournament_courts from public, anon, authenticated;
grant  select on table public.hosted_tournament_courts to authenticated;

drop policy if exists hosted_tcourt_select_manager on public.hosted_tournament_courts;
create policy hosted_tcourt_select_manager on public.hosted_tournament_courts
    for select to authenticated
    using (public.can_manage_tournaments());


-- ── RPC 1: 코트 등록/수정 ────────────────────────────────────────────────────
--   (tournament_id, court_no) 기준 upsert. NULL 인자는 '변경하지 않음'.
--   p_display_order 를 생략하면 신규는 court_no 를 그대로 순서로 쓴다.
create or replace function public.upsert_tournament_court(
    p_slug          text,
    p_court_no      integer,
    p_display_name  text    default null,
    p_display_order integer default null,
    p_status        text    default null,
    p_clear_name    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_id     uuid;
    v_before jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    if p_court_no is null or p_court_no < 1 or p_court_no > 30 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_court_no');
    end if;
    if p_status is not null and p_status not in ('active', 'disabled') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_status');
    end if;
    if p_display_order is not null and p_display_order < 1 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_display_order');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-courts:' || v_tid::text));

    select id, jsonb_build_object('displayName', display_name,
                                  'displayOrder', display_order,
                                  'status', status)
      into v_id, v_before
      from public.hosted_tournament_courts
     where tournament_id = v_tid and court_no = p_court_no;

    begin
        if v_id is null then
            insert into public.hosted_tournament_courts
                (tournament_id, court_no, display_name, display_order, status)
            values (v_tid, p_court_no,
                    nullif(btrim(coalesce(p_display_name, '')), ''),
                    coalesce(p_display_order, p_court_no),
                    coalesce(p_status, 'active'))
            returning id into v_id;

            perform public.hosted_tournament_log_event(
                v_tid, 'court', v_id, 'create_court', null,
                jsonb_build_object('courtNo', p_court_no), p_slug);
        else
            update public.hosted_tournament_courts
               set display_name  = case when p_clear_name then null
                                        else coalesce(nullif(btrim(coalesce(p_display_name, '')), ''),
                                                      display_name) end,
                   display_order = coalesce(p_display_order, display_order),
                   status        = coalesce(p_status, status),
                   updated_at    = now()
             where id = v_id;

            perform public.hosted_tournament_log_event(
                v_tid, 'court', v_id, 'update_court', v_before,
                jsonb_build_object('displayName', p_display_name,
                                   'displayOrder', p_display_order,
                                   'status', p_status,
                                   'clearName', p_clear_name), p_slug);
        end if;
    exception
        when unique_violation then
            -- display_order 중복(지연 검사라 COMMIT 시점에 터질 수도 있다) 또는 court_no 경쟁.
            return jsonb_build_object('ok', false, 'reason', 'court_conflict');
    end;

    return jsonb_build_object('ok', true, 'courtId', v_id, 'courtNo', p_court_no);
end;
$$;

revoke execute on function public.upsert_tournament_court(text,integer,text,integer,text,boolean) from public;
revoke execute on function public.upsert_tournament_court(text,integer,text,integer,text,boolean) from anon;
grant  execute on function public.upsert_tournament_court(text,integer,text,integer,text,boolean) to authenticated;


-- ── RPC 2: LIVE 중계 코트 지정 ───────────────────────────────────────────────
--   p_court_no = NULL 이면 지정 해제. 대회당 1면이므로 먼저 전부 내리고 하나만 올린다.
create or replace function public.set_feature_court(
    p_slug     text,
    p_court_no integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_id   uuid;
    v_rows integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-courts:' || v_tid::text));

    -- 1) 전부 해제 (unique index 충돌을 피하려면 반드시 먼저)
    update public.hosted_tournament_courts
       set is_feature_court = false, updated_at = now()
     where tournament_id = v_tid and is_feature_court;

    -- 2) 해제만 요청한 경우
    if p_court_no is null then
        perform public.hosted_tournament_log_event(
            v_tid, 'tournament', v_tid, 'clear_feature_court', null, null, p_slug);
        return jsonb_build_object('ok', true, 'featureCourtNo', null);
    end if;

    update public.hosted_tournament_courts
       set is_feature_court = true, updated_at = now()
     where tournament_id = v_tid and court_no = p_court_no
     returning id into v_id;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'court_not_found');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'court', v_id, 'set_feature_court', null,
        jsonb_build_object('courtNo', p_court_no), p_slug);

    return jsonb_build_object('ok', true, 'featureCourtNo', p_court_no);
end;
$$;

revoke execute on function public.set_feature_court(text,integer) from public;
revoke execute on function public.set_feature_court(text,integer) from anon;
grant  execute on function public.set_feature_court(text,integer) to authenticated;


-- ── RPC 3: 코트 삭제 ─────────────────────────────────────────────────────────
--   ⚠ 후속 Batch 에서 matches.court_id 가 생기면, 해당 코트를 쓰는 경기가 있을 때
--     삭제를 차단하는 조건을 여기에 추가한다(현재는 참조 테이블이 없어 무조건 삭제 가능).
create or replace function public.delete_tournament_court(
    p_slug     text,
    p_court_no integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_id   uuid;
    v_rows integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-courts:' || v_tid::text));

    delete from public.hosted_tournament_courts
     where tournament_id = v_tid and court_no = p_court_no
     returning id into v_id;
    get diagnostics v_rows = row_count;

    if v_rows = 0 then
        return jsonb_build_object('ok', false, 'reason', 'court_not_found');
    end if;

    perform public.hosted_tournament_log_event(
        v_tid, 'court', v_id, 'delete_court',
        jsonb_build_object('courtNo', p_court_no), null, p_slug);

    return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.delete_tournament_court(text,integer) from public;
revoke execute on function public.delete_tournament_court(text,integer) from anon;
grant  execute on function public.delete_tournament_court(text,integer) to authenticated;


-- ── RPC 4: 코트 목록 (Admin) ─────────────────────────────────────────────────
create or replace function public.get_admin_tournament_courts(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case when not public.can_manage_tournaments() then null else
        coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id',             c.id,
                       'courtNo',        c.court_no,
                       'displayName',    c.display_name,
                       'displayOrder',   c.display_order,
                       'status',         c.status,
                       'isFeatureCourt', c.is_feature_court
                   ) order by c.display_order, c.court_no)
              from public.hosted_tournament_courts c
              join public.hosted_tournaments h on h.id = c.tournament_id
             where h.slug = p_slug
        ), '[]'::jsonb)
    end;
$$;

revoke execute on function public.get_admin_tournament_courts(text) from public;
revoke execute on function public.get_admin_tournament_courts(text) from anon;
grant  execute on function public.get_admin_tournament_courts(text) to authenticated;

commit;
