-- =============================================================================
-- ROLLBACK — add_hosted_tournament_submit_lockdown.sql 되돌리기
--
--   submit_tournament_registration EXECUTE 권한을 anon · authenticated 에 복구한다
--   (원본 add_hosted_tournament_registration_mvp.sql 의 grant 와 동일한 상태로 되돌린다).
--
--   ⚠ 이 rollback 을 실행하면 봇 방어 게이트가 무력해진다.
--     anon key 는 공개 번들에 있으므로, 누구든 서버 route(Turnstile 검증)를 우회해
--     PostgREST 로 직접 제출할 수 있게 된다.
--     서버 route 나 Turnstile 구성이 깨져 접수를 급히 살려야 하는 비상 상황에만 쓴다.
--
--   ⚠ 함수 본문은 이 파일에서도 건드리지 않는다(권한만 되돌린다).
-- =============================================================================

begin;

grant execute on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean) to anon, authenticated;

comment on function public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean) is null;

commit;


-- 확인 — 기대: true
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute_restored
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'submit_tournament_registration';
