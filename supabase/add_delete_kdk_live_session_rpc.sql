-- =========================================================================
-- delete_kdk_live_session — 진행 중(LIVE) KDK 세션 안전 삭제 RPC
-- =========================================================================
-- 배경:
--   matches 테이블은 RLS 가 켜져 있고 SELECT 정책만 열려 있다.
--   경기 생성/수정은 SECURITY DEFINER RPC(sync_tournament_matches / update_match_status)로
--   처리돼 RLS 를 우회하지만, 세션 삭제는 클라이언트의 직접 DELETE 라 RLS 에 막혀
--   "삭제해도 세션이 다시 나타나는" 증상이 있었다.
--
-- 보안 설계(중요):
--   - SECURITY DEFINER 이므로 search_path 를 명시적으로 고정한다(public, pg_temp).
--   - 전달받은 club_id 만 신뢰하지 않는다. 호출자가 실제 로그인한 운영자(CEO/ADMIN)인지
--     profiles.role 로 서버에서 검증한다. (profiles.id = auth.uid())
--   - anon(비로그인) 에게는 실행 권한을 주지 않는다 → authenticated 만 호출 가능.
--   - 라이브 matches 행만 삭제하고, 공식 기록 teyeon_archive_v1 은 절대 건드리지 않는다.
--   - club_id 가 주어지면 해당 클럽으로 스코프를 제한해 타 클럽 데이터 삭제를 차단한다.
--   - 삭제된 행 수를 반환해 클라이언트가 0건(대상없음)을 구분할 수 있게 한다.
-- =========================================================================

create or replace function public.delete_kdk_live_session(
    p_session_id text,
    p_club_id text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer := 0;
  v_is_admin boolean := false;
begin
  if p_session_id is null or length(p_session_id) = 0 then
    return 0;
  end if;

  -- 호출자 권한 검증: 로그인한 운영자(CEO/ADMIN)만 허용.
  -- 전달된 club_id 가 아니라 실제 인증 사용자(auth.uid())의 역할을 신뢰한다.
  select exists (
    select 1
      from public.profiles pr
     where pr.id = auth.uid()
       and upper(coalesce(pr.role, '')) in ('CEO', 'ADMIN')
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'not authorized: operator(CEO/ADMIN) role required to delete a live session'
      using errcode = '42501';
  end if;

  -- 라이브 matches 만 삭제. 공식 Archive(teyeon_archive_v1)는 절대 삭제하지 않음.
  -- club_id 가 주어지면 해당 클럽 행만 삭제(타 클럽 데이터 보호).
  delete from public.matches
   where session_id = p_session_id
     and (p_club_id is null or club_id = p_club_id);
  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

-- 실행 권한: anon 차단, 로그인 사용자/service_role 만 (함수 내부에서 운영자 역할 재검증).
revoke all on function public.delete_kdk_live_session(text, text) from public;
grant execute on function public.delete_kdk_live_session(text, text) to authenticated, service_role;
