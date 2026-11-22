-- ════════════════════════════════════════════════════════════════════════════
-- [CLOSING SPRINT B1] KDK 코트 복귀(투입 취소) — 클럽 임원진 최소 권한
--   ⚠ 운영 적용 전 사용자 승인 필요. 적용 전 B1_..._precheck_READONLY.sql 실행 결과를 확인한다.
--   검증: scripts/verify_closing_sprint_b1_sql.mjs — 격리된 PGlite 메모리 DB(가상 계정)에서 설치 · 재실행 · 직책별 권한 ·
--         클럽 범위 · 탈회 · 안전 조건 · 기존 직접 UPDATE 차단 유지 · 롤백을 시험(운영 DB 미검증 — 적용 전 precheck 필수).
--
-- 권한 대상(확정)
--   - 기존 유지: CEO · ADMIN(profiles.role) · KDK 관리자(kdk_managers) = public.can_manage_kdk() — 변경 없음.
--   - 추가: 클럽 임원 직책 — members.role(쉼표 다중값, 토큰 trim 후 정확 일치) 에 다음 6개 중 하나:
--       회장 · 부회장 · 총무 · 재무 · 경기 · 섭외      (예: 'CEO, 재무' → '재무' 토큰으로 허용)
--     · 연결: members.auth_user_id = auth.uid() (이메일 추정 연결 사용 안 함 — kdk_actor_withdrawn 과 같은 기준)
--     · 클럽 범위: 그 직책 행의 members.club_id = 요청한 경기의 club_id 일 때만(다른 클럽 직책으로는 불가)
--     · 거부: 연결된 members 행 어디에든 '탈회' 토큰 · profiles.role = GUEST
--     · profiles.role(OPERATOR · FINANCE_MANAGER 등 앱 보안 역할)은 이 권한의 근거로 쓰지 않는다.
--   - 이 권한만을 위해 kdk_managers 등재나 can_manage_kdk 를 부여하지 않는다.
--   - 임원 직책 경로의 안전 조건: 경기 'playing' + 결과 미저장 + 타이머 미시작(started_at null)일 때만.
--     타이머가 시작된 경기의 복귀(타이머 초기화)는 기존대로 KDK 관리자 이상만(진행 정보 손실 방지).
--   - 일반 회원(정회원 · 준회원 등): 기존 그대로(투입 · 타이머 시작 · 최초 결과 저장 가능, 코트 복귀 불가).
--
-- 변경 범위
--   1) public.kdk_can_return_court(p_club_id text)     — 판정 함수(STABLE, DEFINER, authenticated 만 실행)
--   2) public.return_kdk_match_to_waiting(text, text)  — 원자적 복귀 RPC(DEFINER)
--   기존 테이블 · RLS · 트리거(kdk_p1_score_guard) · start_kdk_match · can_manage_kdk 는 수정하지 않는다.
--   DEFINER RPC 의 UPDATE 는 함수 소유자 권한으로 실행되어 kdk_p1_score_guard 의 anon/authenticated 분기를 타지 않는다
--   (기존 start_kdk_match 와 같은 구조). 따라서 권한 판정은 반드시 이 함수 안에서 끝낸다.
--   앱(lib/kdk/courtReturnAccess.ts)은 같은 6개 직책 목록으로 "RPC 조회 여부"만 정하고, 버튼 노출은 이 함수 결과를 따른다.
--
-- 동시성
--   - start_kdk_match 와 같은 세션 단위 advisory xact lock(club_id:session_id)으로 투입 · 복귀를 직렬화.
--   - 상태 재검증 후 UPDATE ... WHERE status='playing' — 다른 운영자가 먼저 처리했으면 not_playing.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- 초안(OPERATOR · FINANCE_MANAGER 기준, 인자 없음) 시그니처가 남아 있으면 제거 — 운영 미적용 초안이라 일반적으로 no-op.
drop function if exists public.kdk_can_return_court();

create or replace function public.kdk_can_return_court(p_club_id text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  -- 코트 복귀 권한: KDK 관리자 이상(can_manage_kdk — 기존 그대로) 또는
  --   해당 클럽의 임원 직책(members.role 토큰 ∈ 회장·부회장·총무·재무·경기·섭외) · 탈회 아님 · GUEST 아님.
  select auth.uid() is not null and (
           public.can_manage_kdk()
        or (    p_club_id is not null and length(btrim(p_club_id)) > 0
            and upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = auth.uid()::text), ''))) <> 'GUEST'
            and not public.kdk_actor_withdrawn()
            and exists (select 1
                          from public.members m,
                               unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v)
                         where m.auth_user_id::text = auth.uid()::text
                           and m.club_id::text = btrim(p_club_id)
                           and btrim(r.v) in ('회장', '부회장', '총무', '재무', '경기', '섭외'))));
$$;
revoke all on function public.kdk_can_return_court(text) from public, anon;
grant execute on function public.kdk_can_return_court(text) to authenticated, service_role;

create or replace function public.return_kdk_match_to_waiting(
    p_match_id text,
    p_club_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_manager boolean;
  v_session_id text;
  v_status text;
  v_started_at text;
  v_has_started_col boolean;
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'not authorized: login required' using errcode = '42501';
  end if;
  if not public.kdk_can_return_court(p_club_id) then
    raise exception 'not authorized: court return requires club officer position or KDK manager' using errcode = '42501';
  end if;
  v_is_manager := public.can_manage_kdk();

  if p_match_id is null or length(btrim(p_match_id)) = 0
     or p_club_id is null or length(btrim(p_club_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;

  select session_id into v_session_id
    from public.matches
   where id::text = p_match_id and club_id = p_club_id
   limit 1;
  if v_session_id is null or length(v_session_id) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- start_kdk_match 와 같은 키 — 같은 세션의 투입 · 복귀 직렬화.
  perform pg_advisory_xact_lock(hashtextextended(p_club_id || ':' || v_session_id, 0));

  select m.status::text, to_jsonb(m) ->> 'started_at'
    into v_status, v_started_at
    from public.matches m
   where m.id::text = p_match_id and m.club_id = p_club_id
   for update;

  if v_status is distinct from 'playing' then
    return jsonb_build_object('ok', false, 'reason', 'not_playing');
  end if;
  if public.kdk_p1_result_recorded(p_match_id) then
    return jsonb_build_object('ok', false, 'reason', 'result_recorded');
  end if;
  -- 임원 직책 경로: 타이머가 시작된 경기는 복귀 불가(타이머 초기화 = 진행 정보 손실). KDK 관리자 이상은 기존 정책 A 그대로 허용.
  if not v_is_manager and v_started_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'timer_started');
  end if;

  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'matches' and column_name = 'started_at'
  ) into v_has_started_col;

  -- 기존 클라이언트 복귀(resetMatchToWaiting)와 같은 값: waiting · court null · 1:1 · started_at null.
  if v_has_started_col then
    update public.matches
       set status = 'waiting', court = null, score1 = 1, score2 = 1, started_at = null
     where id::text = p_match_id and club_id = p_club_id and status = 'playing';
  else
    update public.matches
       set status = 'waiting', court = null, score1 = 1, score2 = 1
     where id::text = p_match_id and club_id = p_club_id and status = 'playing';
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'not_playing');
  end if;

  return jsonb_build_object('ok', true, 'matchId', p_match_id, 'by', case when v_is_manager then 'manager' else 'officer' end);
end;
$$;
revoke all on function public.return_kdk_match_to_waiting(text, text) from public, anon;
grant execute on function public.return_kdk_match_to_waiting(text, text) to authenticated, service_role;

commit;
