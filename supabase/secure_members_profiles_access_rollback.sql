-- Phase 2 rollback — 잠금(RLS 정책)만 되돌린다. RPC(Phase 1)는 유지(코드가 사용 중이므로 제거 금지).
--   ⚠️ 원칙: anon 쓰기를 다시 열지 않는다. authenticated 기능 우선 복구.
--   전체 RLS disable(= anon 재개방)은 이 파일 하단의 '최후 수단' 블록으로 분리 — 기본은 실행하지 않음.

-- ── 1순위 완화: Phase 2 정책만 제거 (RLS 는 enabled 유지 → 정책 없으면 authenticated 도 거부되므로
--    아래 '안전 임시 정책'을 함께 적용해 authenticated 기능만 복구하고 anon 은 계속 차단) ──
DROP POLICY IF EXISTS members_select_same_club ON public.members;
DROP POLICY IF EXISTS members_insert_admin ON public.members;
DROP POLICY IF EXISTS members_update_admin ON public.members;
DROP POLICY IF EXISTS members_delete_admin ON public.members;
DROP POLICY IF EXISTS profiles_select_auth ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_admin ON public.profiles;

-- 안전 임시 정책 — authenticated 전체 접근 허용(club scope 문제로 장애 시 우선 복구용).
--   anon 은 여전히 정책 없음 + GRANT revoke 로 차단된 상태 유지(개인정보 재노출 안 함).
CREATE POLICY members_tmp_auth_all ON public.members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY profiles_tmp_auth_all ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════ 최후 수단(기본 미실행) ═══════════════════════════
--   authenticated 기능까지 전면 장애일 때만 아래 블록을 수동 실행. anon 개인정보/쓰기가 다시
--   완전 개방되므로 즉시 원인 수정 후 재잠금할 것. RPC 는 남겨둔다(코드가 사용 중).
--
--   DROP POLICY IF EXISTS members_tmp_auth_all ON public.members;
--   DROP POLICY IF EXISTS profiles_tmp_auth_all ON public.profiles;
--   ALTER TABLE public.members  DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.members  TO anon;  -- ⚠️ 개방 복구
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO anon;  -- ⚠️ 개방 복구
--   NOTIFY pgrst, 'reload schema';
