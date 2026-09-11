-- =============================================================================
-- 주최 대회 — anon 직접 제출 차단 (봇 방어 게이트 강제)  [P1]
--
--   배경:
--     NEXT_PUBLIC_SUPABASE_ANON_KEY 는 클라이언트 번들에 그대로 들어 있다(공개값).
--     따라서 anon 에게 submit_tournament_registration EXECUTE 가 남아 있는 한,
--     누구든 PostgREST 를 직접 호출해 폼·CAPTCHA·서버 route 를 전부 우회할 수 있다.
--     정원이 60팀뿐이라 스크립트 한 번으로 접수를 고갈시킬 수 있다.
--
--   이 마이그레이션이 하는 일:
--     submit_tournament_registration EXECUTE 권한을 anon · authenticated 양쪽에서 회수.
--     원본 migration 은 'to anon, authenticated' 로 grant 했다. 서버 route 가 service_role 로만
--     호출하므로 둘 다 필요 없고, authenticated 를 남겨 두면 로그인 회원이 게이트를 우회할 수 있다.
--
--   ⚠ 함수 본문을 변경하지 않는다.
--     정원(48/60)·대기·중복·advisory lock·동의 검증·순번 발급 로직 전부 그대로다.
--     이 파일에는 create/alter function 이 없다.
--   ⚠ 공개 조회 RPC 2종(get_public_tournament, get_public_tournament_teams)의
--     anon 권한은 그대로 유지한다. Hub·TEAMS 화면이 그 위에서 동작한다.
--
--   ⚠⚠ 적용 순서 주의 — 이 SQL 을 먼저 적용하면 접수가 즉시 불가능해진다.
--      반드시 아래 순서를 지킬 것:
--        1) Vercel 환경변수 3종 등록 + 재배포 (서버 route 가 살아 있어야 함)
--           NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY
--        2) 이 SQL 적용
--        3) add_hosted_tournament_submit_lockdown_verify.sql 로 확인
--      역순으로 하면 route 가 아직 없거나 키가 없어 접수 경로가 통째로 막힌다.
--      (대회가 draft 인 동안에는 어차피 접수가 닫혀 있으므로 지금 적용해도 사용자 영향은 없다.)
--
--   선행 조건: add_hosted_tournament_registration_mvp.sql 적용 완료
--   되돌리기 : add_hosted_tournament_submit_lockdown_rollback.sql
-- =============================================================================

begin;

-- ── 0. 선행 조건 확인 ─────────────────────────────────────────────────────────
do $$
begin
    if to_regprocedure('public.submit_tournament_registration('
                       'text,text,text,text,text,text,text,text,'
                       'boolean,boolean,boolean,boolean)') is null then
        raise exception 'submit_tournament_registration RPC 가 없습니다. 선행 마이그레이션을 먼저 적용하세요.';
    end if;
end $$;


-- ── 1. 클라이언트 role 의 직접 제출 차단 ──────────────────────────────────────
--   이후 이 함수를 호출할 수 있는 것은 service_role(및 함수 소유자)뿐이다.
--   서버 route(app/api/tournaments/[slug]/register)가 service_role 로 호출한다.
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean) from anon;
revoke execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean) from authenticated;

comment on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean) is
    '공개 참가신청 제출. anon·authenticated 직접 호출 불가 — 서버 route 가 Turnstile 검증 후 service_role 로만 호출한다.';

commit;


-- ── 확인 ──────────────────────────────────────────────────────────────────────
-- 기대: submit 은 anon/authenticated 모두 false, 공개 조회 2종은 anon true
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('submit_tournament_registration',
                     'get_public_tournament', 'get_public_tournament_teams')
 order by p.proname;
