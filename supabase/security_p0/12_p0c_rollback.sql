-- =============================================================================
-- ROLLBACK — SECURITY P0-C. guard trigger·helper 제거, sync_my_profile 을 저장소 원본
--   (add_secure_member_identity_rpcs.sql) 그대로 복원. profiles 데이터·정책·권한은 건드리지 않는다.
-- =============================================================================
begin;
set local lock_timeout = '3s';
drop trigger if exists guard_profiles_privileged_columns_trg on public.profiles;
drop function if exists public.guard_profiles_privileged_columns();
drop function if exists public.security_actor_profile_role();

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

commit;
select (select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'guard_profiles_privileged_columns_trg') = 0 as guard_removed,
       (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = 'public.sync_my_profile(text,text)'::regprocedure) as sync_my_profile_md5;
