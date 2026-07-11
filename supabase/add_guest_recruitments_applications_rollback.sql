-- =============================================================================
-- ROLLBACK — add_guest_recruitments_applications.sql 되돌리기.
--   RPC → 정책 → 테이블(applications → recruitments) → helper 순.
-- ⚠ 실제 신청 데이터가 있으면 모두 삭제된다. 롤백 전 백업/확인 필수.
-- =============================================================================

drop function if exists public.set_guest_application_status(uuid,text,text);
drop function if exists public.get_admin_guest_recruitments();
drop function if exists public.upsert_guest_recruitment(uuid,text,int,timestamptz,text);
drop function if exists public.submit_guest_application(text,text,text,text,text,text,text,text,text,boolean);
drop function if exists public.get_open_guest_recruitments();

drop policy if exists guest_applications_select_manager on public.guest_applications;
drop policy if exists guest_recruitments_manage        on public.guest_recruitments;

drop table if exists public.guest_applications;
drop table if exists public.guest_recruitments;

drop function if exists public.gen_guest_public_token();
drop function if exists public.can_manage_guest_applications();

notify pgrst, 'reload schema';
