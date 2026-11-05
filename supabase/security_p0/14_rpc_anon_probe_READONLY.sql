-- =============================================================================
-- (선택) anon 실행 동작 확인 — 읽기 전용 트랜잭션 · 존재하지 않는 세션/경기 id · 마지막에 rollback
--   목적: "anon 이 delete_kdk_live_session 을 실행하면 실제 삭제까지 가는가"를 데이터 변경 없이 확인한다.
--   안전장치(이중):
--     ① BEGIN READ ONLY — 트랜잭션 안의 모든 INSERT/UPDATE/DELETE 는 실행 시점에 오류가 난다(행 수와 무관).
--     ② 존재하지 않는 id('SECURITY-PROBE-NONEXISTENT') — 설령 ①이 없어도 지울 행이 없다.
--   SQL Editor 에서 블록 전체를 실행하면 마지막 문장(probe 결과)이 표시된다. 오류가 나면 그 오류 문구가 결과다.
--
--   결과 해석(delete_kdk_live_session):
--     · 'not authorized: operator(CEO/ADMIN) role required ...' (42501) → 내부 운영자 검사가 삭제보다 먼저 막음 = 안전
--     · 'cannot execute DELETE in a read-only transaction'               → 운영자 검사 없이 삭제 단계까지 도달 = 위험(삭제는 일어나지 않음)
--     · 0 반환                                                           → 삭제 전에 0 을 반환(세션 id 검증 등) — 본문 확인 필요
--     · 'permission denied for function ...'                             → anon 실행 권한 자체가 없음(P0-B 적용 후 상태)
-- =============================================================================
begin read only;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select public.delete_kdk_live_session('SECURITY-PROBE-NONEXISTENT', null) as delete_probe_result;
rollback;

-- start_kdk_match 도 같은 방식으로 확인하려면 위 블록 대신 아래 블록을 실행한다(별도 실행).
--   기대: 'not authorized: login required' (42501)
-- begin read only;
-- set local role anon;
-- select set_config('request.jwt.claims', '{"role":"anon"}', true);
-- select public.start_kdk_match('SECURITY-PROBE-NONEXISTENT', 'SECURITY-PROBE-NONEXISTENT') as start_probe_result;
-- rollback;
