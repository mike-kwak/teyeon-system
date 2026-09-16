-- ============================================================================
--  2026 TEYEON OPEN — Tournament Batch 1 롤백
--
--  대상 migration 4종
--    add_hosted_tournament_events.sql
--    add_hosted_tournament_teams.sql
--    add_hosted_tournament_courts.sql
--    add_hosted_tournament_fixture.sql
--
--  ⚠ 파일을 4개로 나누지 않고 하나로 둔 이유
--    삭제 순서가 중요하다(fixture → courts → teams → events). 파일이 나뉘면 운영자가
--    순서를 틀릴 여지가 생긴다. 아래는 '역순 1회 실행'으로 안전하게 되돌린다.
--
--  ⚠⚠ 이 스크립트는 Tournament 운영 데이터(팀/코트/이벤트)를 '전부 삭제'한다.
--    Batch 1 은 신규 테이블만 만들므로 기존 접수 데이터에는 영향이 없지만,
--    승격된 팀이 있다면 그 팀 행은 사라진다(원본 접수는 그대로 남는다).
--
--  ⚠ 건드리지 않는 것 (확인용 — 아래 어떤 구문도 이들을 대상으로 하지 않는다)
--      hosted_tournaments (행 데이터)
--      hosted_tournament_registrations
--      hosted_tournament_registration_history
--      기존 RPC 10종 · RLS 정책 · submit lockdown
--
--    예외 1건: fixture 로 '생성된' 대회 행은 마지막 섹션에서 선택적으로 지운다
--    (slug like 'fixture-%' 인 draft 대회만. 운영 대회는 조건에 해당하지 않는다).
-- ============================================================================

begin;

-- ── 4of4 되돌리기: fixture ───────────────────────────────────────────────────
drop function if exists public.get_admin_fixture_tournaments();
drop function if exists public.seed_fixture_tournament(text, text, integer, boolean, integer);
drop function if exists public.hosted_tournament_fixture_guard(text);

-- ── 3of4 되돌리기: courts ────────────────────────────────────────────────────
drop function if exists public.get_admin_tournament_courts(text);
drop function if exists public.delete_tournament_court(text, integer);
drop function if exists public.set_feature_court(text, integer);
drop function if exists public.upsert_tournament_court(text, integer, text, integer, text, boolean);

drop policy if exists hosted_tcourt_select_manager on public.hosted_tournament_courts;
drop table if exists public.hosted_tournament_courts;   -- index/constraint 동반 삭제

-- ── 2of4 되돌리기: teams ─────────────────────────────────────────────────────
drop function if exists public.update_tournament_team(uuid, integer, integer, text, boolean);
drop function if exists public.get_admin_tournament_teams(text);
drop function if exists public.promote_confirmed_registrations(text);

drop policy if exists hosted_tteam_select_manager on public.hosted_tournament_teams;
drop table if exists public.hosted_tournament_teams;

-- ── 1of4 되돌리기: events ────────────────────────────────────────────────────
drop function if exists public.hosted_tournament_log_event(uuid, text, uuid, text, jsonb, jsonb, text);

drop policy if exists hosted_tevent_select_manager on public.hosted_tournament_events;
drop table if exists public.hosted_tournament_events;

commit;


-- ============================================================================
--  [선택] fixture 대회 행까지 제거
--
--  위 롤백으로 fixture '팀/코트'는 테이블과 함께 사라지지만,
--  hosted_tournaments 의 fixture 대회 행은 남는다(draft 라 공개되지 않으므로 방치해도 무해).
--  완전히 정리하려면 아래를 '내용 확인 후' 실행한다.
--
--  ⚠ 조건에 slug like 'fixture-%' 와 status='draft' 를 모두 걸어 둔다.
--    2026-teyeon-open 은 두 조건 어디에도 해당하지 않는다.
-- ============================================================================
-- -- 1) 먼저 대상 확인 (반드시 눈으로 볼 것)
-- select id, slug, title, status from public.hosted_tournaments
--  where slug like 'fixture-%' and status = 'draft';
--
-- -- 2) 위 결과가 fixture 대회만인 것을 확인한 뒤에 실행
-- delete from public.hosted_tournaments
--  where slug like 'fixture-%' and status = 'draft';
