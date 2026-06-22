-- ────────────────────────────────────────────────────────────────────────────
-- club_schedule_attendances.display_name_snapshot
--
-- 참석 row 저장 시점의 표시명을 함께 보관한다 (members.nickname 우선).
-- 회원 lookup 실패(탈퇴/auth_user_id 미매핑/profile RLS 차단 등)에도
-- 참석 명단에 사람 이름을 표시할 수 있도록 한다.
--
-- 사용 규칙:
--   - INSERT/UPDATE 시 클라이언트가 members.nickname 을 함께 저장.
--   - 화면에서는 resolver 매핑 결과를 우선 사용하고, null 일 때만 snapshot 으로 fallback.
--   - snapshot 만 보이는 row 는 운영진이 회원 매핑(member_id / auth_user_id)을 보강할 신호.
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행해야 한다. idempotent — 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.club_schedule_attendances
  add column if not exists display_name_snapshot text;

comment on column public.club_schedule_attendances.display_name_snapshot is
  '참석 저장 시점의 표시명 (members.nickname 우선). 회원 lookup 실패 시 fallback 으로 사용. ' ||
  '카카오 닉네임/이메일/UUID 는 저장하지 않는다.';
