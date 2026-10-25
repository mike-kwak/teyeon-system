-- =============================================================================
-- 코트별 NEXT UP 서버 저장 (본부 지정 → 별도 PC 코트 전광판 표시)
--
--   추가만 한다: 새 테이블 1 + 함수 2. 기존 테이블 · 함수 · 경기 데이터는 바꾸지 않는다.
--   · hosted_tournament_court_next_ups — 코트당 1경기 · 경기당 1코트. 지정일 뿐이다(경기 상태 · 호명 · 코트 점유와 무관).
--   · set_court_next_ups(slug, items)  — CEO/ADMIN. 이 대회의 지정 전체를 items 로 바꾼다(한 트랜잭션 · 이벤트 1행).
--   · get_court_next_ups(slug)         — CEO/ADMIN 만 읽는다(권한 없으면 null). 코트 · 경기 id · 경기 번호만 준다(선수명 없음).
--   ⚠ 테이블은 RLS 로 직접 접근을 막고 함수로만 읽고 쓴다.
--   ⚠ 표시 판단(대기 · 호명 경기만 NEXT)은 화면이 한다. 여기서는 경기 상태로 거르지 않는다(본부 지정 그대로 보관).
-- =============================================================================

begin;

create table if not exists public.hosted_tournament_court_next_ups (
    tournament_id uuid        not null references public.hosted_tournaments(id) on delete cascade,
    court_no      integer     not null check (court_no > 0),
    match_id      uuid        not null references public.hosted_tournament_matches(id) on delete cascade,
    set_at        timestamptz not null default now(),
    set_by        uuid,
    primary key (tournament_id, court_no),
    unique (tournament_id, match_id)
);

alter table public.hosted_tournament_court_next_ups enable row level security;
revoke all on public.hosted_tournament_court_next_ups from public, anon, authenticated;

-- 지정 전체 바꾸기 — items = [{ "courtNo": 1, "matchId": "<uuid>" }, ...] (빈 배열 = 모두 해제)
create or replace function public.set_court_next_ups(p_slug text, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_before jsonb;
    v_after  jsonb;
    v_n      integer;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_items');
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    -- 모양 · 소속 검사(하나라도 틀리면 아무것도 바꾸지 않는다)
    if exists (
        select 1 from jsonb_array_elements(p_items) e
         where jsonb_typeof(e -> 'courtNo') <> 'number' or jsonb_typeof(e -> 'matchId') <> 'string'
            or (e ->> 'matchId') !~ '^[0-9a-fA-F-]{36}$'
    ) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_items');
    end if;
    if exists (
        select 1 from jsonb_array_elements(p_items) e
         where not exists (select 1 from public.hosted_tournament_courts c
                            where c.tournament_id = v_tid and c.court_no = (e ->> 'courtNo')::integer)
            or not exists (select 1 from public.hosted_tournament_matches m
                            where m.tournament_id = v_tid and m.id = (e ->> 'matchId')::uuid)
    ) then
        return jsonb_build_object('ok', false, 'reason', 'court_or_match_not_found');
    end if;
    if (select count(distinct (e ->> 'courtNo')) <> count(*) or count(distinct (e ->> 'matchId')) <> count(*)
          from jsonb_array_elements(p_items) e) then
        return jsonb_build_object('ok', false, 'reason', 'duplicate_court_or_match');
    end if;

    -- 같은 대회 NEXT UP 저장끼리 직렬화(경기 조작 잠금과는 다른 키 — 투입 · 점수를 기다리게 하지 않는다)
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-next-up:' || v_tid::text));

    select coalesce(jsonb_agg(jsonb_build_object('courtNo', court_no, 'matchId', match_id) order by court_no), '[]'::jsonb)
      into v_before from public.hosted_tournament_court_next_ups where tournament_id = v_tid;

    delete from public.hosted_tournament_court_next_ups where tournament_id = v_tid;
    insert into public.hosted_tournament_court_next_ups (tournament_id, court_no, match_id, set_by)
    select v_tid, (e ->> 'courtNo')::integer, (e ->> 'matchId')::uuid, auth.uid()
      from jsonb_array_elements(p_items) e;
    get diagnostics v_n = row_count;

    select coalesce(jsonb_agg(jsonb_build_object('courtNo', court_no, 'matchId', match_id) order by court_no), '[]'::jsonb)
      into v_after from public.hosted_tournament_court_next_ups where tournament_id = v_tid;

    if v_before is distinct from v_after then
        perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'court_next_ups_set',
            jsonb_build_object('items', v_before), jsonb_build_object('items', v_after), null);
    end if;
    return jsonb_build_object('ok', true, 'count', v_n, 'changed', v_before is distinct from v_after);
end;
$$;

-- 지정 읽기 — 코트 · 경기 id · 경기 번호만(선수명 · 상태는 화면이 기존 경기판에서 가져온다)
create or replace function public.get_court_next_ups(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
begin
    if not public.can_manage_tournaments() then
        return null;
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;
    return jsonb_build_object(
        'items', coalesce((
            select jsonb_agg(jsonb_build_object('courtNo', n.court_no, 'matchId', n.match_id, 'matchNo', m.match_no,
                                                'setAt', n.set_at) order by n.court_no)
              from public.hosted_tournament_court_next_ups n
              join public.hosted_tournament_matches m on m.id = n.match_id
             where n.tournament_id = v_tid), '[]'::jsonb),
        'serverNow', now());
end;
$$;

revoke all on function public.set_court_next_ups(text, jsonb) from public, anon;
revoke all on function public.get_court_next_ups(text) from public, anon;
grant execute on function public.set_court_next_ups(text, jsonb) to authenticated;
grant execute on function public.get_court_next_ups(text) to authenticated;

commit;
