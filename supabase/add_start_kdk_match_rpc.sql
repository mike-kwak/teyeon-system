-- =========================================================================
-- start_kdk_match — 원자적 경기 투입 RPC (다중 운영자 동시 투입 안정화 2차)
-- =========================================================================
-- 목적:
--   - 서로 다른 경기를 동시에 투입해도 같은 코트에 중복 배정되지 않게 한다.
--   - 동일 경기 중복 투입 / 경기 중 선수 중복 투입을 DB 에서 차단한다.
--   - 코트 번호는 클라이언트가 아니라 DB(이 함수)가 최종 결정한다.
-- 방식:
--   - 세션(club_id + session_id) 단위 TRANSACTION advisory lock 으로 투입을 직렬화.
--   - 락 이후 대상 경기 상태/선수 재검증 → 빈 최저 코트 계산 → status 전제조건 update.
-- 보안:
--   - SECURITY DEFINER + search_path 고정 + 운영자(CEO/ADMIN) 검증 + anon revoke.
--   - 권한 실패는 SQLSTATE 42501. (delete_kdk_live_session 과 동일 정책)
-- 조별 전용 코트(kdk_session_meta.group_courts):
--   - 활성(enabled=true)이면 대상 경기 group_name 을 A/B 로 정규화 후, 그 조에 지정된
--     코트 목록 안에서만 빈 최저 코트를 배정한다(다른 조 빈 코트로 우회하지 않음).
--   - 그 조 코트가 모두 사용 중이면 group_courts_full, 조 설정이 없으면
--     group_court_config_missing 으로 차단한다.
--   - 비활성/미설정({} 또는 enabled=false)이면 기존 전체 코트 자동 배정.
-- 반환(jsonb 단일 객체):
--   성공: { ok:true,  reason:'started', match_id, session_id, court }
--   실패: { ok:false, reason:'not_found' | 'not_waiting' | 'already_changed'
--                            | 'player_busy' | 'invalid_session'
--                            | 'group_courts_full' (+group) | 'group_court_config_missing' }
-- =========================================================================

create or replace function public.start_kdk_match(
    p_match_id text,
    p_club_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_admin boolean := false;
  v_session_id text;
  v_status text;
  v_player_ids text[];
  v_court int;
  v_rows int;
  v_group_name text;       -- 대상 경기의 원본 group_name (예: 'A', 'A조', 'BLUE')
  v_group text;            -- 정규화된 조 키 ('A' | 'B' | '')
  v_group_courts jsonb;    -- kdk_session_meta.group_courts (래핑형)
  v_group_arr jsonb;       -- 해당 조 코트 배열
  v_group_enabled boolean; -- 조별 전용 코트 활성 여부
begin
  -- 1) 권한: 로그인 운영자(CEO/ADMIN)만. profiles.id = auth.uid().
  if auth.uid() is null then
    raise exception 'not authorized: login required' using errcode = '42501';
  end if;
  -- profiles.id / auth.uid() 타입이 환경별로 uuid/text 로 다를 수 있어 양쪽 모두 text 로 비교.
  select exists (
    select 1 from public.profiles pr
     where pr.id::text = auth.uid()::text
       and upper(btrim(coalesce(pr.role, ''))) in ('CEO', 'ADMIN')
  ) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized: operator(CEO/ADMIN) role required to start a match'
      using errcode = '42501';
  end if;

  -- 입력 방어: match_id / club_id 가 null·빈 문자열이면 invalid_session.
  if p_match_id is null or length(btrim(p_match_id)) = 0
     or p_club_id is null or length(btrim(p_club_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  -- 2) 락 전 session_id 확인(락 키 구성용).
  select session_id into v_session_id
    from public.matches
   where id::text = p_match_id and club_id = p_club_id
   limit 1;
  if v_session_id is null or length(v_session_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- 3) 세션 단위 TRANSACTION advisory lock — 같은 club+session 투입 직렬화(커밋 시 자동 해제).
  --    session-level lock 이 아닌 xact lock 사용. 키는 club_id + session_id 결합.
  perform pg_advisory_xact_lock(hashtextextended(p_club_id || ':' || v_session_id, 0));

  -- 4) 락 이후 대상 경기 재조회 + 상태 재검증(락 전 값 신뢰하지 않음).
  select session_id, status, player_ids, group_name
    into v_session_id, v_status, v_player_ids, v_group_name
    from public.matches
   where id::text = p_match_id and club_id = p_club_id
   limit 1;

  if v_session_id is null or length(v_session_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_status is distinct from 'waiting' then
    return jsonb_build_object('ok', false, 'reason', 'not_waiting');
  end if;
  if v_player_ids is null or array_length(v_player_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  -- 5) 선수 중복 출전 차단 — 같은 세션의 playing 경기와 player_ids 교집합(게스트 ID 포함).
  if exists (
    select 1 from public.matches m
     where m.club_id = p_club_id
       and m.session_id = v_session_id
       and m.status = 'playing'
       and m.id::text <> p_match_id
       and coalesce(m.player_ids, '{}'::text[]) && v_player_ids
  ) then
    return jsonb_build_object('ok', false, 'reason', 'player_busy');
  end if;

  -- 6) 코트 배정. 조별 전용 코트 설정이 활성이면 그 조의 코트 목록 안에서만, 아니면 전체.
  --    설정 조회: 세션 메타. 컬럼/행이 없으면 v_group_courts = null → 전체 코트 fallback.
  select group_courts into v_group_courts
    from public.kdk_session_meta
   where session_id = v_session_id
   limit 1;

  v_group_enabled := coalesce((v_group_courts ->> 'enabled')::boolean, false);

  -- 'groups' 객체 존재 확인. jsonb `?` 연산자는 일부 쿼리 러너가 바인드 파라미터로 오해할 수 있어
  --   동등한 jsonb_typeof 비교로 대체(재배포 안전성).
  if v_group_enabled and jsonb_typeof(v_group_courts -> 'groups') = 'object' then
    -- 6a) 대상 경기 group_name 정규화 → 'A' | 'B'.
    --     클라이언트 normalizeStoredKdkGroup 의 우선순위를 그대로 1:1 포트(source of truth):
    --       1) BLUE 포함 | 정확히 'B' | 'B조' 로 시작 → B
    --       2) GOLD 포함 | 정확히 'A' | 'A조' 로 시작 → A
    --       3) 'B' 포함 → B   4) 'A' 포함 → A   5) 그 외 ''
    v_group := upper(btrim(coalesce(v_group_name, '')));
    if v_group like '%BLUE%' or v_group = 'B' or v_group like 'B조%' then
      v_group := 'B';
    elsif v_group like '%GOLD%' or v_group = 'A' or v_group like 'A조%' then
      v_group := 'A';
    elsif position('B' in v_group) > 0 then
      v_group := 'B';
    elsif position('A' in v_group) > 0 then
      v_group := 'A';
    else
      v_group := '';
    end if;

    -- 6b) 해당 조 코트 배열. 활성인데 조 설정이 없으면 차단(전체 fallback 금지).
    v_group_arr := v_group_courts -> 'groups' -> v_group;
    if v_group = '' or v_group_arr is null or jsonb_typeof(v_group_arr) <> 'array' then
      return jsonb_build_object('ok', false, 'reason', 'group_court_config_missing');
    end if;

    -- 6c) 그 조 코트 목록 중 빈 최저 코트. 다른 조 빈 코트로 우회하지 않음.
    select min(gc) into v_court
      from (
        select (jsonb_array_elements_text(v_group_arr))::int as gc
      ) g
     where gc > 0
       and gc not in (
         select court from public.matches
          where club_id = p_club_id and session_id = v_session_id
            and status = 'playing' and court is not null
       );

    if v_court is null then
      return jsonb_build_object('ok', false, 'reason', 'group_courts_full', 'group', v_group);
    end if;
  else
    -- 6d) 미설정/비활성 — 기존 전체 빈 최저 코트(중간 빈 번호 우선).
    select min(c) into v_court
      from generate_series(1, (
        select coalesce(max(court), 0) + 1
          from public.matches
         where club_id = p_club_id and session_id = v_session_id
           and status = 'playing' and court is not null
      )) as c
     where c not in (
        select court from public.matches
         where club_id = p_club_id and session_id = v_session_id
           and status = 'playing' and court is not null
      );
    v_court := coalesce(v_court, 1);
  end if;

  -- 7) 원자적 update — waiting 전제. row_count = 1 일 때만 성공.
  update public.matches
     set status = 'playing', court = v_court
   where id::text = p_match_id and club_id = p_club_id
     and session_id = v_session_id and status = 'waiting';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'already_changed');
  end if;

  return jsonb_build_object(
    'ok', true, 'reason', 'started',
    'match_id', p_match_id, 'session_id', v_session_id, 'court', v_court
  );
end;
$$;

-- 실행 권한: anon 차단, 로그인 사용자/service_role 만(함수 내부에서 운영자 역할 재검증).
revoke all on function public.start_kdk_match(text, text) from public;
grant execute on function public.start_kdk_match(text, text) to authenticated, service_role;


-- =========================================================================
-- [선택·후속] 코트 중복 DB 하드 방어 — partial unique index
-- =========================================================================
-- advisory lock 은 이 RPC 경로의 동시 투입만 직렬화한다. 다른 직접 update 경로가
-- 남아 있거나 과거 데이터에 중복이 있으면 코트가 겹칠 수 있으므로, 아래 index 로
-- DB 차원에서 (club_id, session_id, court) playing 유일성을 강제할 수 있다.
--
-- ⚠️ 바로 실행하지 말 것. 먼저 아래로 현재 중복 여부를 확인한다(중복 있으면 생성 실패):
--   select club_id, session_id, court, count(*)
--     from public.matches
--    where status = 'playing' and court is not null
--    group by club_id, session_id, court
--   having count(*) > 1;
-- 위 결과가 0행일 때만 아래를 실행. (기존 중복 데이터는 임의 삭제/수정하지 말고 먼저 보고)
--
-- create unique index if not exists matches_playing_court_uniq
--   on public.matches (club_id, session_id, court)
--   where status = 'playing' and court is not null;
