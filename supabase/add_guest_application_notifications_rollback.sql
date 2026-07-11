-- =============================================================================
-- ROLLBACK — add_guest_application_notifications.sql 되돌리기.
--   RPC → 정책 → 테이블 순. ⚠️ 알림 기록(발송 이력)이 삭제된다.
--   순서: (1) Database Webhook 삭제 → (2) Edge Function 삭제(supabase functions delete
--   guest-application-notify) → (3) secrets 제거 → (4) 이 SQL 실행.
-- =============================================================================

drop function if exists public.claim_guest_application_notification(uuid, text);
drop policy if exists guest_app_notifications_select_manager on public.guest_application_notifications;
drop table if exists public.guest_application_notifications;
drop function if exists public.get_pending_guest_application_count();

notify pgrst, 'reload schema';
