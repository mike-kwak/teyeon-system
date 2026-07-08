-- Phase 2 (lockdown) — members / profiles anon 개인정보 노출 P0 잠금.
--   ⚠️ 사용자 승인 후 실행. Phase 1(add_secure_member_identity_rpcs.sql) 적용 + RPC 전환 코드가
--   Production 에 배포·검증된 뒤에만 실행. 이 파일은 direct 본인 write 를 막으므로 코드 전환 없이
--   실행하면 로그인/프로필 저장이 실패한다.
--
--   전제: current_user_club_ids() 배포됨(재사용). anon 은 정책 미부여 = 기본 거부.
--   추가로 anon 의 테이블 GRANT 도 명시 revoke(정책+권한 이중 차단).
--   공개 화면은 SECURITY DEFINER 공개 RPC(get_public_member_directory / get_public_kdk_session /
--   get_kdk_live_official_ranking)로만 접근 → 잠금 영향 없음.

-- ═══════════════════════════ members ═══════════════════════════
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

-- anon 테이블 권한 회수(정책 부재로도 막히지만 이중 방어). authenticated 는 RLS 로 거른다.
REVOKE ALL ON TABLE public.members FROM anon;

DROP POLICY IF EXISTS members_select_same_club ON public.members;
CREATE POLICY members_select_same_club ON public.members
    FOR SELECT TO authenticated
    USING (
        club_id = ANY(public.current_user_club_ids())
        OR auth_user_id = auth.uid()
    );

DROP POLICY IF EXISTS members_insert_admin ON public.members;
CREATE POLICY members_insert_admin ON public.members
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS members_update_admin ON public.members;
CREATE POLICY members_update_admin ON public.members
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN'))
        AND club_id = ANY(public.current_user_club_ids())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS members_delete_admin ON public.members;
CREATE POLICY members_delete_admin ON public.members
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN'))
        AND club_id = ANY(public.current_user_club_ids())
    );
-- 본인 direct UPDATE 정책 없음 — claim_my_member() / fill_my_member_avatars() RPC 로만.

-- ═══════════════════════════ profiles ═══════════════════════════
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM anon;

DROP POLICY IF EXISTS profiles_select_auth ON public.profiles;
CREATE POLICY profiles_select_auth ON public.profiles
    FOR SELECT TO authenticated
    USING (true);   -- P0: 로그인 사용자 조회 허용(아바타/닉네임 매칭). P1: email 최소화.

DROP POLICY IF EXISTS profiles_insert_admin ON public.profiles;
CREATE POLICY profiles_insert_admin ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN')));

DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
    FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN')));

DROP POLICY IF EXISTS profiles_delete_admin ON public.profiles;
CREATE POLICY profiles_delete_admin ON public.profiles
    FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN')));
-- 본인 프로필 생성/갱신은 sync_my_profile() / set_my_profile_visibility() RPC 로만(role 불변).
-- 참고: 위 RPC 들은 SECURITY DEFINER(owner=postgres) → RLS 를 우회해 본인 row 를 안전 범위로만 수정.

NOTIFY pgrst, 'reload schema';
