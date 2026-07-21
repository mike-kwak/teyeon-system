-- =========================================================================
-- KDK 경기 시작 타이머 — matches.started_at 컬럼 + start_kdk_match_timer RPC
-- =========================================================================
-- 목적:
--   - NOW PLAYING 카드에서 운영자가 "시작"을 누른 시각을 DB server now() 로 1회 저장.
--   - 운영 화면(/kdk)과 전광판(/kdk/display)이 같은 started_at 기준으로 경과 시간 표시.
-- 원칙:
--   - started_at 은 한 번 설정되면 덮어쓰지 않는다(동시 클릭/중복 클릭 안전).
--   - 시작 시각은 client time 이 아니라 DB now() 기준.
--   - 복귀(waiting 리셋) 시 초기화는 클라이언트 update 가 started_at = null 로 수행(정책 A).
-- 보안:
--   - SECURITY DEFINER + search_path 고정 + 운영자(CEO/ADMIN) 검증 + anon revoke.
--   - 권한 실패는 SQLSTATE 42501 (start_kdk_match / delete_kdk_live_session 과 동일 정책).
-- 반환(jsonb 단일 객체):
--   성공: { ok:true,  reason:'timer_started'|'already_started', match_id, started_at, already_started }
--   실패: { ok:false, reason:'invalid_session' | 'not_found' | 'not_playing' }
-- =========================================================================

-- 1) 컬럼 추가 — 기존 row 는 null 유지(시작 전). 인덱스 불필요:
--    조회는 항상 club_id+session_id 로 하고 started_at 은 표시용으로만 읽는다.
alter table public.matches
  add column if not exists started_at timestamptz;

comment on column public.matches.started_at is
  'KDK 경기 타이머 시작 시각(DB now()). 운영자가 NOW PLAYING 카드에서 "시작"을 누른 순간 1회 저장. '
  'null = 아직 시작 안 함(시작 대기). waiting 복귀 시 클라이언트가 null 로 초기화.';

-- 2) 시작 RPC — 원자적 1회 설정.
--    ⚠️ 기존 start_kdk_match(코트 투입 RPC)와는 별개 함수. 투입 로직은 건드리지 않는다.
create or replace function public.start_kdk_match_timer(
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
  v_status text;
  v_started_at timestamptz;
begin
  -- 권한: 로그인 운영자(CEO/ADMIN)만. profiles.id = auth.uid(). (start_kdk_match 와 동일)
  if auth.uid() is null then
    raise exception 'not authorized: login required' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.profiles pr
     where pr.id::text = auth.uid()::text
       and upper(btrim(coalesce(pr.role, ''))) in ('CEO', 'ADMIN')
  ) into v_is_admin;
  if not v_is_admin then
    raise exception 'not authorized: operator(CEO/ADMIN) role required to start match timer'
      using errcode = '42501';
  end if;

  if p_match_id is null or length(btrim(p_match_id)) = 0
     or p_club_id is null or length(btrim(p_club_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  -- 원자적 1회 설정: playing + started_at is null 일 때만 now() 저장.
  --   동시 클릭은 row lock 으로 직렬화되어 첫 update 만 반영되고, 나머지는 0행 → 아래 분기.
  update public.matches
     set started_at = now()
   where id::text = p_match_id
     and club_id = p_club_id
     and status = 'playing'
     and started_at is null
  returning started_at into v_started_at;

  if v_started_at is not null then
    return jsonb_build_object(
      'ok', true, 'reason', 'timer_started',
      'match_id', p_match_id, 'started_at', v_started_at, 'already_started', false
    );
  end if;

  -- update 0행 — 이미 시작(멱등) / playing 아님 / 없음 을 구분해 반환.
  select status, started_at into v_status, v_started_at
    from public.matches
   where id::text = p_match_id and club_id = p_club_id
   limit 1;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_started_at is not null then
    -- 다른 운영자가 먼저 시작 — 기존 값을 덮어쓰지 않고 그대로 반환(성공 취급).
    return jsonb_build_object(
      'ok', true, 'reason', 'already_started',
      'match_id', p_match_id, 'started_at', v_started_at, 'already_started', true
    );
  end if;
  return jsonb_build_object('ok', false, 'reason', 'not_playing');
end;
$$;

-- 3) 실행 권한: anon 차단, 로그인 사용자/service_role 만(함수 내부에서 운영자 역할 재검증).
revoke all on function public.start_kdk_match_timer(text, text) from public;
revoke all on function public.start_kdk_match_timer(text, text) from anon;
grant execute on function public.start_kdk_match_timer(text, text) to authenticated, service_role;

-- 4) PostgREST schema cache reload — 새 컬럼/함수를 API 가 즉시 인식하도록.
notify pgrst, 'reload schema';
