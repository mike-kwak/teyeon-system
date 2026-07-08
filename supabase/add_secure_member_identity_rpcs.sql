-- Phase 1 (bootstrap) — 본인 프로필/회원 연결 제한 RPC 4개.
--   ⚠️ 사용자 승인 후 실행. 이 파일은 members/profiles RLS·GRANT 를 건드리지 않으므로
--   기존 Production 코드에 영향이 없다(direct UPDATE 계속 동작). RPC 전환 코드 배포 전에 먼저 올린다.
--
--   공통 보안: SECURITY DEFINER · SET search_path = public, pg_temp · schema-qualified ·
--   동적 SQL 없음 · PUBLIC/anon EXECUTE revoke · authenticated 만 grant ·
--   auth.uid() null 이면 안전 종료 · role/club_id/member_number 변경 불가 · 반환값에 타인 개인정보 없음.

-- (1) 본인 profile 생성/동기화 (AuthContext.syncProfile 의 3개 direct write 대체).
--     email 은 파라미터가 아니라 JWT 에서 취득(위조 불가). nickname/avatar 만 파라미터.
--     동작 우선순위(기존 syncProfile 로직 보존):
--       ① auth.uid() row 있으면 → email/nickname/avatar 만 COALESCE 갱신(role 절대 불변)
--       ② 없고 JWT email 과 일치하는 기존 row 있으면 → 그 row 의 id 를 auth.uid() 로 이전(role 보존, reconcile)
--       ③ 그래도 없으면 → role 'GUEST' 로 신규 생성
--     어느 경로도 클라이언트가 role 을 지정할 수 없음(권한 상승·강등 차단).
CREATE OR REPLACE FUNCTION public.sync_my_profile(p_nickname text, p_avatar_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := NULLIF(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '');
  v_nick text := left(NULLIF(trim(p_nickname), ''), 100);
  v_avatar text := left(NULLIF(trim(p_avatar_url), ''), 2000);
  v_found int;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                        -- 비로그인 안전 종료
  -- ① 본인 row 존재 → 표시정보만 갱신(role 미포함)
  UPDATE public.profiles SET
    email      = COALESCE(v_email, email),
    nickname   = COALESCE(v_nick, nickname),
    avatar_url = COALESCE(v_avatar, avatar_url)
  WHERE id = v_uid;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found > 0 THEN RETURN; END IF;
  -- ② JWT email 일치 기존 row 를 auth.uid() 로 이전(role 보존).
  --    ⚠️ 같은 email 의 profile 이 정확히 1건일 때만 이전한다 — 복수면 데이터 이상이므로
  --    임의 첫 행을 고르지 않고 중단하고 ③ 신규 생성으로 폴백(id 충돌/오연결 방지).
  IF v_email IS NOT NULL THEN
    SELECT count(*) INTO v_found FROM public.profiles
     WHERE lower(trim(coalesce(email, ''))) = v_email AND id <> v_uid;
    IF v_found = 1 THEN
      UPDATE public.profiles SET
        id         = v_uid,
        email      = v_email,
        nickname   = COALESCE(v_nick, nickname),
        avatar_url = COALESCE(v_avatar, avatar_url)
      WHERE lower(trim(coalesce(email, ''))) = v_email
        AND id <> v_uid;
      RETURN;
    END IF;
    -- v_found = 0(이전 대상 없음) 또는 > 1(복수 → 안전 중단) → ③ 로 진행
  END IF;
  -- ③ 신규 — GUEST
  INSERT INTO public.profiles (id, email, nickname, avatar_url, role)
  VALUES (v_uid, v_email, v_nick, v_avatar, 'GUEST')
  ON CONFLICT (id) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.sync_my_profile(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_my_profile(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_my_profile(text, text) TO authenticated;

-- (2) 본인 프로필 공개범위 설정 (PlayerCardModal 대체). 없는 row 는 생성 없이 무효(로그인 시 이미 생성됨).
CREATE OR REPLACE FUNCTION public.set_my_profile_visibility(p_level text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  IF p_level NOT IN ('public','partial','private') THEN
    RAISE EXCEPTION 'invalid visibility level';
  END IF;
  UPDATE public.profiles SET profile_visibility_level = p_level WHERE id = v_uid;
END; $$;
REVOKE ALL ON FUNCTION public.set_my_profile_visibility(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_profile_visibility(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_profile_visibility(text) TO authenticated;

-- (3) 본인 회원 연결 (AuthContext.confirmIdentity 대체).
--     본인 증명 = JWT email(소문자·trim) 이 members.email(소문자·trim) 과 정확히 일치.
--     대상 auth_user_id 가 null 또는 이미 내 uid 일 때만 연결. 타 계정 연결분은 실패(탈취 방지).
--     role/club_id/member_number/등록일 불변. 오류 문구는 최소화(타 회원 이메일 존재 여부 비노출).
CREATE OR REPLACE FUNCTION public.claim_my_member(p_member_id uuid, p_avatar_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_avatar text := left(NULLIF(trim(p_avatar_url), ''), 2000);
  v_updated int;
BEGIN
  IF v_uid IS NULL OR v_email = '' OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'cannot verify identity';
  END IF;
  UPDATE public.members SET
    auth_user_id = v_uid,
    email        = COALESCE(NULLIF(trim(email), ''), v_email),
    avatar_url   = COALESCE(NULLIF(trim(avatar_url), ''), v_avatar)
  WHERE id = p_member_id
    AND lower(trim(coalesce(email, ''))) = v_email        -- 본인 증명(email exact)
    AND (auth_user_id IS NULL OR auth_user_id = v_uid);   -- 타 계정 연결분 차단
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'cannot link this member';             -- 문구 최소화(존재 여부 비노출)
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.claim_my_member(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_my_member(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_my_member(uuid, text) TO authenticated;

-- (4) 본인 email 의 아바타 없는 회원 채우기 (AuthContext.syncMemberAvatarIfMissing 대체).
--     auth_user_id 가 null 또는 내 uid 인 row 만(타 계정 연결분 미수정). avatar 있으면 덮어쓰지 않음.
--     ⚠️ 같은 email 의 member 가 2건 이상이면 데이터 이상 신호 → 안전하게 중단(아무것도 안 함).
CREATE OR REPLACE FUNCTION public.fill_my_member_avatars(p_avatar_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_avatar text := left(NULLIF(trim(p_avatar_url), ''), 2000);
  v_cnt int;
BEGIN
  IF v_uid IS NULL OR v_email = '' OR v_avatar IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_cnt FROM public.members
   WHERE lower(trim(coalesce(email, ''))) = v_email
     AND (auth_user_id IS NULL OR auth_user_id = v_uid);
  IF v_cnt <> 1 THEN RETURN; END IF;                        -- 0건 또는 다건이면 안전 중단
  UPDATE public.members SET avatar_url = v_avatar
   WHERE lower(trim(coalesce(email, ''))) = v_email
     AND (auth_user_id IS NULL OR auth_user_id = v_uid)
     AND NULLIF(trim(coalesce(avatar_url, '')), '') IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.fill_my_member_avatars(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fill_my_member_avatars(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fill_my_member_avatars(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
