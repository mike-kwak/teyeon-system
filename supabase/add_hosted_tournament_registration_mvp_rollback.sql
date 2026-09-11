-- =============================================================================
-- ROLLBACK — add_hosted_tournament_registration_mvp.sql 되돌리기.
--   순서: RPC → 정책 → 테이블(history → registrations → tournaments) → helper.
--
-- ⚠ 실제 참가신청 데이터가 있으면 전부 삭제된다(개인정보 포함). 롤백 전 백업/확인 필수.
--   접수를 잠깐 멈추고 싶은 것뿐이라면 롤백하지 말고 상태만 되돌린다:
--     update public.hosted_tournaments set status = 'registration_closed', updated_at = now()
--      where slug = '2026-teyeon-open';
--
-- ⚠ 이 스크립트는 public.tournament_events / tournament_pairs / tournament_partner_requests
--   (= /tournament-calendar 사용 테이블)를 절대 건드리지 않는다.
-- =============================================================================

-- 1) RPC
drop function if exists public.set_tournament_registration_status(uuid,text,text,text);
drop function if exists public.get_tournament_registration_history(uuid);
drop function if exists public.get_admin_tournament_registrations(text);
drop function if exists public.get_admin_hosted_tournaments();
drop function if exists public.submit_tournament_registration(
    text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean);
drop function if exists public.get_public_tournament_teams(text);
drop function if exists public.get_public_tournament(text);

-- 2) 정책(테이블과 함께 사라지지만 명시적으로)
drop policy if exists hosted_treg_history_select_manager on public.hosted_tournament_registration_history;
drop policy if exists hosted_treg_select_manager         on public.hosted_tournament_registrations;
drop policy if exists hosted_tournaments_select_manager  on public.hosted_tournaments;

-- 3) 테이블 — FK 역순(history → registrations → tournaments)
drop table if exists public.hosted_tournament_registration_history;
drop table if exists public.hosted_tournament_registrations;
drop table if exists public.hosted_tournaments;

-- 4) helper
drop function if exists public.hosted_tournament_pair_key(text,text);
drop function if exists public.hosted_tournament_normalize_phone(text);
drop function if exists public.can_manage_tournaments();

notify pgrst, 'reload schema';
