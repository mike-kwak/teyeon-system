-- ────────────────────────────────────────────────────────────────────────────
-- /club 공개 둘러보기 전용 RPC 모음
--
-- 원칙:
--   - anon SELECT 정책을 넓히지 않는다 (원본 테이블은 그대로 인증 회원만).
--   - 공개 가능한 컬럼만 jsonb 로 반환하는 RPC 만 anon 에 GRANT.
--   - 모든 RPC: security definer + search_path locked + public. prefix.
--   - 입력값 clamp (least/greatest) — anon 이 큰 limit 으로 과도 조회 시도 차단.
--   - 개인정보 (이메일/전화/auth_user_id/created_by/updated_by/내부 ID/메모/공식 미확정) 반환 금지.
--   - 원본 matches 의 player_ids 는 절대 반환하지 않는다 (member UUID 노출 금지).
--     player_names 만 사용. 게스트는 '(G)' 접미사 부여.
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행해야 한다. 재실행 안전 (REPLACE).
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. 공개 일정 목록 (Club Schedule) ─────────────────────────────────────
create or replace function public.get_public_club_schedules(
  p_window_past_days   integer default 14,
  p_window_future_days integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_past integer := greatest(0, least(coalesce(p_window_past_days, 14), 30));
  v_future integer := greatest(1, least(coalesce(p_window_future_days, 60), 180));
  v_today date := current_date;
  v_from  date := v_today - v_past;
  v_to    date := v_today + v_future;
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',           cs.id,
      'title',        cs.title,
      'type',         cs.schedule_type,
      'date',         to_char(cs.schedule_date, 'YYYY-MM-DD'),
      'startTime',    case when cs.start_time is null then null else to_char(cs.start_time, 'HH24:MI') end,
      'endTime',      case when cs.end_time   is null then null else to_char(cs.end_time,   'HH24:MI') end,
      'location',     cs.location,
      'courtCount',   cs.court_count,
      'courtMode',    cs.court_mode,
      'isPast',       cs.schedule_date < v_today
    ) order by cs.schedule_date asc, cs.start_time asc nulls last), '[]'::jsonb)
    from public.club_schedules cs
    where cs.schedule_date >= v_from
      and cs.schedule_date <= v_to
  );
end;
$$;
revoke execute on function public.get_public_club_schedules(integer, integer) from public;
grant  execute on function public.get_public_club_schedules(integer, integer) to anon, authenticated;

-- ── 2. 공개 멤버 디렉토리 (UUID 미노출) ──────────────────────────────────
-- profiles.profile_visibility_level = 'public' 인 회원만 노출.
-- 응답 필드: nickname / avatarUrl / role (CEO/ADMIN 뱃지) — 내부 members.id 미포함.
-- 'partial' / 'private' 는 외부 공개 X.
create or replace function public.get_public_member_directory()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'nickname',   m.nickname,
      'avatarUrl',  case
        when m.avatar_url is not null and m.avatar_url <> '' then
          regexp_replace(m.avatar_url, '^http://(img1|t1|k)\.kakaocdn\.net', 'https://\1.kakaocdn.net')
        else null
      end,
      'role',       case when m.role in ('CEO', 'ADMIN') then m.role else null end
    ) order by m.nickname asc nulls last), '[]'::jsonb)
    from public.members m
    where m.auth_user_id is not null
      and m.nickname is not null
      and exists (
        select 1 from public.profiles p
         where p.id = m.auth_user_id
           and coalesce(p.profile_visibility_level, 'public') = 'public'
      )
  );
end;
$$;
revoke execute on function public.get_public_member_directory() from public;
grant  execute on function public.get_public_member_directory() to anon, authenticated;

-- ── 3. 공개 KDK 세션 목록 ────────────────────────────────────────────────
-- 공식 확정 (is_official=true, is_test=false) 만. limit clamp 1~30.
create or replace function public.get_public_kdk_sessions(
  p_limit integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 30));
begin
  return (
    select coalesce(jsonb_agg(item order by item->>'createdAt' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'sessionId',  a.id,
        'title',      coalesce(a.raw_data->>'title', '경기'),
        'createdAt',  to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'isOfficial', true,
        'state',      'finished'
      ) as item
      from public.teyeon_archive_v1 a
      where a.is_official = true
        and a.is_test = false
        and a.archive_type = 'kdk'
      order by a.created_at desc
      limit v_limit
    ) sub
  );
end;
$$;
revoke execute on function public.get_public_kdk_sessions(integer) from public;
grant  execute on function public.get_public_kdk_sessions(integer) to anon, authenticated;

-- ── 4. 공개 KDK 세션 상세 — 상태별 DTO ─────────────────────────────────
-- 상태 결정:
--   1) archive (is_official=true, is_test=false)     → finished
--   2) matches.session_id 존재 + 'playing'           → in_progress
--   3) matches.session_id 존재 + 'waiting' 만        → ready
--   4) matches.session_id 존재 + 모두 'complete'     → settling (공식 미확정 임시 결과 공개 금지)
--   5) 없으면                                         → null
--
-- 응답 DTO (공개 가능 필드만, player_ids/UUID 절대 미포함):
--   - finished:    finalRanking[] / matches[] (내부 ID 제거 후 명시적 안전 가공)
--   - ready:       bracket[] = [{ matchNo, round, court, group, playerNames[], status }]
--   - in_progress: nowPlaying[], waiting[], ranking[]
--   - settling:    counts 만
create or replace function public.get_public_kdk_session(p_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_archive record;
  v_state text;
  v_title text;
  v_matches_total int;
  v_matches_playing int;
  v_matches_waiting int;
  v_matches_complete int;
  v_bracket jsonb;
  v_now jsonb;
  v_waiting jsonb;
  v_ranking jsonb;
  v_final_ranking jsonb;
  v_finished_matches jsonb;
begin
  if p_session_id is null or length(p_session_id) = 0 then
    return null;
  end if;

  -- ── archive 우선 ───────────────────────────────────────────────────────
  select id, raw_data, created_at, confirmed_at, is_official, is_test
    into v_archive
    from public.teyeon_archive_v1
   where id = p_session_id and archive_type = 'kdk'
   limit 1;

  if v_archive.id is not null and v_archive.is_official = true and v_archive.is_test = false then
    select coalesce(jsonb_agg(jsonb_build_object(
      'rank',   ranked.rank,
      'name',   ranked.name,
      'group',  ranked.group_name,
      'wins',   ranked.wins,
      'losses', ranked.losses,
      'diff',   ranked.diff
    ) order by ranked.rank), '[]'::jsonb)
      into v_final_ranking
      from (
        select
          ranking_item.ordinality::int as rank,
          coalesce(nullif(btrim(ranking_item.item->>'name'), ''), '이름 미공개') as name,
          nullif(coalesce(
            ranking_item.item->>'group',
            v_archive.raw_data->'player_metadata'->(ranking_item.item->>'id')->>'group'
          ), '') as group_name,
          case when coalesce(ranking_item.item->>'wins', '') ~ '^-?[0-9]+$'
               then (ranking_item.item->>'wins')::int else 0 end as wins,
          case when coalesce(ranking_item.item->>'losses', '') ~ '^-?[0-9]+$'
               then (ranking_item.item->>'losses')::int else 0 end as losses,
          case when coalesce(ranking_item.item->>'diff', '') ~ '^-?[0-9]+$'
               then (ranking_item.item->>'diff')::int else 0 end as diff
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_archive.raw_data->'ranking_data') = 'array'
              then v_archive.raw_data->'ranking_data'
            else '[]'::jsonb
          end
        ) with ordinality as ranking_item(item, ordinality)
      ) ranked;

    select coalesce(jsonb_agg(jsonb_build_object(
      'matchNo',     finished_match.match_no,
      'round',       finished_match.round_no,
      'court',       finished_match.court_no,
      'group',       finished_match.group_name,
      'playerNames', finished_match.player_names,
      'status',      'complete',
      'score1',      finished_match.score1,
      'score2',      finished_match.score2
    ) order by finished_match.match_no), '[]'::jsonb)
      into v_finished_matches
      from (
        select
          snapshot_item.ordinality::int as match_no,
          case when coalesce(snapshot_item.item->>'round', '') ~ '^[0-9]+$'
               then (snapshot_item.item->>'round')::int else null end as round_no,
          case when coalesce(snapshot_item.item->>'court', '') ~ '^[0-9]+$'
               then (snapshot_item.item->>'court')::int else null end as court_no,
          nullif(coalesce(
            snapshot_item.item->>'group_name',
            snapshot_item.item->>'groupName',
            snapshot_item.item->>'group'
          ), '') as group_name,
          coalesce((
            select jsonb_agg(to_jsonb(player_name.name) order by player_name.ordinality)
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(snapshot_item.item->'player_names') = 'array'
                  then snapshot_item.item->'player_names'
                when jsonb_typeof(snapshot_item.item->'playerNames') = 'array'
                  then snapshot_item.item->'playerNames'
                else '[]'::jsonb
              end
            ) with ordinality as player_name(name, ordinality)
            where nullif(btrim(player_name.name), '') is not null
          ), '[]'::jsonb) as player_names,
          case when coalesce(snapshot_item.item->>'score1', '') ~ '^-?[0-9]+$'
               then (snapshot_item.item->>'score1')::int else 0 end as score1,
          case when coalesce(snapshot_item.item->>'score2', '') ~ '^-?[0-9]+$'
               then (snapshot_item.item->>'score2')::int else 0 end as score2
        from jsonb_array_elements(
          case
            when jsonb_typeof(v_archive.raw_data->'snapshot_data') = 'array'
              then v_archive.raw_data->'snapshot_data'
            else '[]'::jsonb
          end
        ) with ordinality as snapshot_item(item, ordinality)
        where snapshot_item.item->>'status' = 'complete'
      ) finished_match;

    return jsonb_build_object(
      'sessionId',    v_archive.id,
      'title',        coalesce(v_archive.raw_data->>'title', '경기'),
      'state',        'finished',
      'isOfficial',   true,
      'createdAt',    to_char(v_archive.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'confirmedAt',  case when v_archive.confirmed_at is null then null
                           else to_char(v_archive.confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                      end,
      'finalRanking', v_final_ranking,
      'matches',      v_finished_matches
    );
  end if;

  -- ── 라이브 매치 카운트 ─────────────────────────────────────────────────
  select
    count(*)                                  ,
    count(*) filter (where status = 'playing'),
    count(*) filter (where status = 'waiting'),
    count(*) filter (where status = 'complete')
    into v_matches_total, v_matches_playing, v_matches_waiting, v_matches_complete
    from public.matches
   where session_id = p_session_id;

  if v_matches_total = 0 then
    return null;
  end if;

  if v_matches_playing > 0 then
    v_state := 'in_progress';
  elsif v_matches_waiting > 0 then
    v_state := 'ready';
  else
    v_state := 'settling';
  end if;

  select coalesce(
    (select session_title from public.matches
      where session_id = p_session_id and session_title is not null
      limit 1),
    '경기'
  ) into v_title;

  -- ── ready: 전체 대진표 ────────────────────────────────────────────────
  if v_state = 'ready' then
    v_bracket := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matchNo',      bracket_row.match_no,
        'round',        bracket_row.round_no,
        'court',        bracket_row.court_no,
        'group',        bracket_row.group_name,
        'playerNames',  bracket_row.player_names,
        'status',       bracket_row.status
      ) order by bracket_row.match_no), '[]'::jsonb)
      from (
        select
          row_number() over (
            order by coalesce(m.round, 0), coalesce(m.court, 0), m.created_at
          ) as match_no,
          m.round as round_no,
          m.court as court_no,
          m.group_name,
          coalesce(m.player_names, '{}'::text[]) as player_names,
          m.status
        from public.matches m
        where m.session_id = p_session_id
      ) bracket_row
    );
    return jsonb_build_object(
      'sessionId',  p_session_id,
      'title',      v_title,
      'state',      'ready',
      'isOfficial', false,
      'bracket',    v_bracket,
      'liveCounts', jsonb_build_object(
        'total', v_matches_total, 'playing', v_matches_playing,
        'waiting', v_matches_waiting, 'complete', v_matches_complete
      )
    );
  end if;

  -- ── in_progress: 현재 + 대기 + 순위 ───────────────────────────────────
  if v_state = 'in_progress' then
    -- 현재 진행 중 (코트별)
    v_now := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court',        m.court,
        'group',        m.group_name,
        'round',        m.round,
        'playerNames',  coalesce(m.player_names, '{}'::text[]),
        'score1',       m.score1,
        'score2',       m.score2
      ) order by coalesce(m.court, 0)), '[]'::jsonb)
      from public.matches m
      where m.session_id = p_session_id and m.status = 'playing'
    );

    -- 다음 대기
    v_waiting := (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matchNo',      waiting_row.match_no,
        'court',        waiting_row.court_no,
        'group',        waiting_row.group_name,
        'round',        waiting_row.round_no,
        'playerNames',  waiting_row.player_names,
        'status',       'waiting'
      ) order by waiting_row.match_no), '[]'::jsonb)
      from (
        select
          row_number() over (
            order by coalesce(m.round, 0), coalesce(m.court, 0), m.created_at
          ) as match_no,
          m.court as court_no,
          m.group_name,
          m.round as round_no,
          coalesce(m.player_names, '{}'::text[]) as player_names
        from public.matches m
        where m.session_id = p_session_id and m.status = 'waiting'
      ) waiting_row
    );

    -- 공개 순위 (완료된 매치만, 이름 기준 집계, 상위 16)
    -- KDK: 4명 매치, [0,1] = team1, [2,3] = team2. score1/score2 비교.
    v_ranking := (
      with completed as (
        select
          coalesce(player_names, '{}'::text[]) as names,
          coalesce(score1, 0) as s1,
          coalesce(score2, 0) as s2
        from public.matches
        where session_id = p_session_id and status = 'complete'
      ),
      per_player as (
        -- team1 (positions 0,1 → array_position 1,2)
        select names[1] as name, s1 as my_score, s2 as opp_score, (s1 > s2)::int as win, (s1 < s2)::int as loss
          from completed where names[1] is not null
        union all
        select names[2] as name, s1, s2, (s1 > s2)::int, (s1 < s2)::int
          from completed where names[2] is not null
        -- team2 (positions 2,3 → array_position 3,4)
        union all
        select names[3] as name, s2, s1, (s2 > s1)::int, (s2 < s1)::int
          from completed where names[3] is not null
        union all
        select names[4] as name, s2, s1, (s2 > s1)::int, (s2 < s1)::int
          from completed where names[4] is not null
      ),
      agg as (
        select
          name,
          sum(win)::int    as wins,
          sum(loss)::int   as losses,
          sum(my_score)::int  as points_for,
          sum(opp_score)::int as points_against
        from per_player
        where name is not null and name <> ''
        group by name
      ),
      ranked as (
        select
          row_number() over (order by wins desc, (points_for - points_against) desc, points_for desc) as rank,
          name, wins, losses, points_for, points_against
        from agg
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'rank',           r.rank,
        'name',           r.name,
        'wins',           r.wins,
        'losses',         r.losses,
        'pointsFor',      r.points_for,
        'pointsAgainst',  r.points_against
      ) order by r.rank), '[]'::jsonb)
      from ranked r
      where r.rank <= 16
    );

    return jsonb_build_object(
      'sessionId',  p_session_id,
      'title',      v_title,
      'state',      'in_progress',
      'isOfficial', false,
      'nowPlaying', v_now,
      'waiting',    v_waiting,
      'ranking',    v_ranking,
      'liveCounts', jsonb_build_object(
        'total', v_matches_total, 'playing', v_matches_playing,
        'waiting', v_matches_waiting, 'complete', v_matches_complete
      )
    );
  end if;

  -- ── settling: 카운트만. 임시 결과 공개 금지. ─────────────────────────
  return jsonb_build_object(
    'sessionId',  p_session_id,
    'title',      v_title,
    'state',      'settling',
    'isOfficial', false,
    'liveCounts', jsonb_build_object(
      'total', v_matches_total, 'playing', v_matches_playing,
      'waiting', v_matches_waiting, 'complete', v_matches_complete
    )
  );
end;
$$;
revoke execute on function public.get_public_kdk_session(text) from public;
grant  execute on function public.get_public_kdk_session(text) to anon, authenticated;

-- ── 5. Guest Pass 정모 → KDK 상태 (RPC chain) ────────────────────────────
create or replace function public.get_public_schedule_kdk_state(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session_id text;
begin
  if p_schedule_id is null then
    return null;
  end if;
  select session_id into v_session_id
    from public.kdk_session_meta
   where club_schedule_id = p_schedule_id
   order by updated_at desc nulls last
   limit 1;
  if v_session_id is null then
    return null;
  end if;
  return public.get_public_kdk_session(v_session_id);
end;
$$;
revoke execute on function public.get_public_schedule_kdk_state(uuid) from public;
grant  execute on function public.get_public_schedule_kdk_state(uuid) to anon, authenticated;

-- ── 6. 공개 스페셜 매치 목록 ──────────────────────────────────────────────
create or replace function public.get_public_special_sessions(
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 30));
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='teyeon_special_sessions'
  ) then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(item order by item->>'updatedAt' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'sessionId', s.session_id,
        'title',     coalesce(s.session_title, '스페셜 매치'),
        'updatedAt', to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ) as item
      from public.teyeon_special_sessions s
      order by s.updated_at desc
      limit v_limit
    ) sub
  );
end;
$$;
revoke execute on function public.get_public_special_sessions(integer) from public;
grant  execute on function public.get_public_special_sessions(integer) to anon, authenticated;

-- ── 7. Guest Pass token → 연결된 KDK 세션 상태 ───────────────────────────
create or replace function public.get_public_guest_pass_kdk_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule_id uuid;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;
  select schedule_id into v_schedule_id
    from public.club_schedule_guest_passes
   where public_token = p_token and is_active = true
   limit 1;
  if v_schedule_id is null then
    return null;
  end if;
  return public.get_public_schedule_kdk_state(v_schedule_id);
end;
$$;
revoke execute on function public.get_public_guest_pass_kdk_state(text) from public;
grant  execute on function public.get_public_guest_pass_kdk_state(text) to anon, authenticated;
