-- =============================================================================
-- ROLLBACK — secure_member_column_privileges.sql 되돌리기 (1분 내 원복).
--   ① 테이블 SELECT 를 전체 컬럼으로 복원(가장 급한 원복 — 이것만으로 기존 동작 복귀)
--   ② 신규 RPC 제거(클라이언트는 미존재 시 자동 폴백하므로 제거해도 무해)
-- =============================================================================

-- ① 전체 컬럼 SELECT 복원(즉시 원복 핵심)
grant select on table public.members  to authenticated;
grant select on table public.profiles to authenticated;

-- ② 신규 RPC 제거(시그니처 정확 명시)
drop function if exists public.admin_get_member_birth_years(uuid[]);
drop function if exists public.admin_age_distribution();
drop function if exists public.admin_find_member_candidates(text, text, uuid, uuid);
drop function if exists public.admin_list_profiles();
drop function if exists public.admin_get_member_private(uuid);
drop function if exists public.is_full_admin();

notify pgrst, 'reload schema';
