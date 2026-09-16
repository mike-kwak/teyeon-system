-- ============================================================================
--  2026 TEYEON OPEN — Tournament 운영 감사 로그 (Batch 1 / 1of4)
--
--  적용 순서: events → teams → courts → fixture
--    (teams/courts RPC 가 이 테이블에 기록하므로 반드시 먼저 적용한다)
--
--  왜 필요한가
--    대회 운영은 다중 운영자가 동시에 만지는 영역이다. "누가 언제 무엇을 바꿨는지"가
--    없으면 현장에서 분쟁이 났을 때 되돌릴 근거가 없다. 접수 도메인은 이미
--    hosted_tournament_registration_history 가 그 역할을 하고 있고, 운영 도메인에는
--    같은 급의 append-only 기록이 필요하다.
--
--  설계
--    · 엔티티별 history 테이블을 6개 만들지 않고 1개로 통합한다(폴리모픽).
--      감사 용도라 FK 무결성보다 "빠짐없이 남는 것"이 중요하다.
--    · append-only. UPDATE/DELETE 경로를 만들지 않는다.
--    · ⚠ 개인정보를 담지 않는다. 팀은 team_id 로만 참조한다.
--      (전화번호·입금·동의는 registrations 도메인에 있고 이 경계를 넘지 않는다)
--
--  ⚠ 기존 hosted_tournament_registration_history 는 접수 전용으로 그대로 둔다.
--    두 테이블을 합치지 않는다 — 보존 정책과 열람 권한의 성격이 다르다.
-- ============================================================================

begin;

create table if not exists public.hosted_tournament_events (
    id            uuid        primary key default gen_random_uuid(),
    tournament_id uuid        not null references public.hosted_tournaments(id) on delete cascade,

    -- 어떤 엔티티에 대한 기록인가. FK 를 걸지 않으므로 값 오염을 check 로 막는다.
    entity_type   text        not null
                              check (entity_type in ('tournament', 'team', 'court', 'group',
                                                     'membership', 'bracket_round', 'match')),
    -- 해당 엔티티의 id. tournament 레벨 동작이면 tournament_id 와 같은 값이 들어간다.
    entity_id     uuid        not null,

    action        text        not null check (length(btrim(action)) between 1 and 40),
    -- 변경 전/후. 스칼라 한 개만 바뀌어도 jsonb 로 통일한다(컬럼을 늘리지 않기 위해).
    from_value    jsonb,
    to_value      jsonb,

    actor_user_id uuid        references auth.users(id) on delete set null,
    actor_type    text        not null check (actor_type in ('admin', 'system')),
    note          text,
    created_at    timestamptz not null default now()
);

comment on table public.hosted_tournament_events is
    'Tournament 운영 감사 로그(append-only). ⚠ 개인정보 미포함 — 팀은 team_id 로만 참조한다.';
comment on column public.hosted_tournament_events.entity_id is
    'FK 없음(폴리모픽). tournament 레벨 동작에서는 tournament_id 와 동일한 값.';

create index if not exists hosted_tevent_tournament_idx
    on public.hosted_tournament_events (tournament_id, created_at desc);
create index if not exists hosted_tevent_entity_idx
    on public.hosted_tournament_events (entity_type, entity_id, created_at desc);


-- ── 권한 — 기존 hosted_* 3테이블과 동일한 잠금 정책 ──────────────────────────
--   ⚠ authenticated 에서 먼저 revoke 하지 않으면, Supabase 의 ALTER DEFAULT PRIVILEGES
--     때문에 이미 가진 권한이 남는다. revoke → grant select 순서를 지킨다.
alter table public.hosted_tournament_events enable row level security;

revoke all on table public.hosted_tournament_events from public, anon, authenticated;
grant  select on table public.hosted_tournament_events to authenticated;

-- 운영진(CEO/ADMIN)만 SELECT 실효. INSERT/UPDATE/DELETE 정책 없음
--   → 직접 쓰기 경로가 존재하지 않는다. 기록은 SECURITY DEFINER RPC 만 남긴다.
drop policy if exists hosted_tevent_select_manager on public.hosted_tournament_events;
create policy hosted_tevent_select_manager on public.hosted_tournament_events
    for select to authenticated
    using (public.can_manage_tournaments());


-- ── 내부 helper: 기록 1건 ────────────────────────────────────────────────────
--   ⚠ anon/authenticated 에서 직접 호출 불가. RPC 내부에서만 쓴다.
create or replace function public.hosted_tournament_log_event(
    p_tournament_id uuid,
    p_entity_type   text,
    p_entity_id     uuid,
    p_action        text,
    p_from          jsonb default null,
    p_to            jsonb default null,
    p_note          text  default null
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    insert into public.hosted_tournament_events
        (tournament_id, entity_type, entity_id, action, from_value, to_value,
         actor_user_id, actor_type, note)
    values
        (p_tournament_id, p_entity_type, p_entity_id, p_action, p_from, p_to,
         auth.uid(), case when auth.uid() is null then 'system' else 'admin' end, p_note);
$$;

revoke execute on function public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text) from public;
revoke execute on function public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text) from anon;
revoke execute on function public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text) from authenticated;

commit;
