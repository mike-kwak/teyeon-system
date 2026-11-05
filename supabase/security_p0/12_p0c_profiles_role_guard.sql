-- =============================================================================
-- SECURITY P0-C — profiles.role 권한 상승 차단   [초안 · 사용자 승인 전 운영 실행 금지]
--
--   ① guard trigger (BEFORE INSERT/UPDATE on profiles, SECURITY INVOKER):
--      PostgREST 로 직접 들어온 쓰기(current_user = anon/authenticated)에서
--        - profiles.id 변경 금지
--        - role 변경 · CEO/ADMIN 행 생성은 CEO/ADMIN 만, 그리고 본인 role 은 본인이 바꿀 수 없음
--      → 운영 정책에 "본인 row 수정" 같은 permissive 정책이 섞여 있어도 role 상승이 막힌다(정책과 독립).
--      SECURITY DEFINER RPC(sync_my_profile 등, current_user = 소유자)와 SQL Editor·service_role 경로는 통과.
--      CEO 정책(2026-11-04 확정): CEO 부여·CEO 계정의 role 변경은 CEO 만. ADMIN 은 CEO 가 아닌 계정의
--        GUEST/MEMBER/ADMIN 등 변경만 가능(/admin/settings 의 기존 흐름 중 'ADMIN 이 CEO 지정'만 막힘).
--   ② sync_my_profile 의 "email 일치 row 를 내 uid 로 이전" 단계 축소:
--      기존: 같은 email 의 profile 이 1건이면 그 row(role 포함)를 내 uid 로 옮김 — 그 row 가 이미 다른 로그인
--            계정의 것이어도 옮겨져, 같은 email 의 JWT 를 얻은 사람이 그 계정의 role(CEO 등)을 가져갈 수 있음.
--      변경: (a) 그 row 의 id 가 auth.users 에 없는(아직 로그인 계정과 연결되지 않은 사전 등록) row 일 때만,
--            (b) 내 계정의 email 이 확인(email_confirmed_at)된 경우에만 이전. 그 외에는 기존처럼 신규 GUEST 생성.
--      본문 나머지(①표시정보 갱신 · ③신규 GUEST)는 한 글자도 바꾸지 않는다.
--      적용 전 운영 본문이 저장소 원본과 같은지 md5 로 확인 — 다르면 STOP(운영 본문을 덮어쓰지 않음).
--   rollback: 12_p0c_rollback.sql
-- =============================================================================
begin;
set local lock_timeout = '3s';

do $$
begin
  if to_regprocedure('public.sync_my_profile(text,text)') is null then
    raise exception 'STOP P0-C: sync_my_profile(text,text) 없음';
  end if;
  -- 원본(md5 일치) 또는 이미 P0-C 가 적용된 본문([P0-C] 표시)만 허용 → 재실행 안전.
  if (select md5(replace(prosrc, E'\r', '')) <> 'ee64b99b69f2ca8d535530786654c1f4' and prosrc not like '%[P0-C]%'
        from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')) then
    raise exception 'STOP P0-C: 운영 sync_my_profile 본문이 저장소 원본(add_secure_member_identity_rpcs.sql)과 다름 — 변경 없음';
  end if;
  if to_regclass('public.profiles') is null then raise exception 'STOP P0-C: profiles 없음'; end if;
end $$;

-- 행위자 role(로그인 uid 기준). RLS 와 무관하게 읽기 위해 DEFINER. anon 실행 불가.
create or replace function public.security_actor_profile_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select upper(btrim(coalesce((select p.role::text from public.profiles p where p.id = auth.uid()), '')));
$$;
revoke all on function public.security_actor_profile_role() from public, anon;
grant execute on function public.security_actor_profile_role() to authenticated, service_role;

create or replace function public.guard_profiles_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_new_role text := upper(btrim(coalesce(new.role::text, '')));
  v_old_role text;
begin
  -- 직접 API 쓰기만 검사. DEFINER RPC·SQL Editor·service_role 은 current_user 가 anon/authenticated 가 아니다.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if v_new_role in ('CEO', 'ADMIN') then
      v_actor := public.security_actor_profile_role();
      if v_actor not in ('CEO', 'ADMIN') or (v_new_role = 'CEO' and v_actor <> 'CEO') then
        raise exception 'profiles: CEO/ADMIN 계정 생성 권한 없음' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'profiles: id 는 직접 변경할 수 없습니다' using errcode = '42501';
  end if;

  v_old_role := upper(btrim(coalesce(old.role::text, '')));
  if v_new_role is distinct from v_old_role then
    v_actor := public.security_actor_profile_role();
    if v_actor not in ('CEO', 'ADMIN') then
      raise exception 'profiles: role 변경 권한 없음' using errcode = '42501';
    end if;
    if old.id = auth.uid() then
      raise exception 'profiles: 본인 role 은 변경할 수 없습니다' using errcode = '42501';
    end if;
    if (v_new_role = 'CEO' or v_old_role = 'CEO') and v_actor <> 'CEO' then
      raise exception 'profiles: CEO 권한 부여·변경은 CEO 만 가능합니다' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profiles_privileged_columns() from public, anon, authenticated;

drop trigger if exists guard_profiles_privileged_columns_trg on public.profiles;
create trigger guard_profiles_privileged_columns_trg
  before insert or update on public.profiles
  for each row execute function public.guard_profiles_privileged_columns();

-- ② sync_my_profile — 이전(②) 조건만 추가. 서명·권한·①③ 동일.
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
  --    [P0-C] 이전 대상은 "아직 어떤 로그인 계정과도 연결되지 않은(id 가 auth.users 에 없는) 사전 등록 row" 뿐이고,
  --           내 계정 email 이 확인된 경우에만 이전한다. 이미 다른 계정의 row 는 절대 옮기지 않는다.
  IF v_email IS NOT NULL
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL) THEN
    SELECT count(*) INTO v_found FROM public.profiles
     WHERE lower(trim(coalesce(email, ''))) = v_email AND id <> v_uid;
    IF v_found = 1 THEN
      UPDATE public.profiles SET
        id         = v_uid,
        email      = v_email,
        nickname   = COALESCE(v_nick, nickname),
        avatar_url = COALESCE(v_avatar, avatar_url)
      WHERE lower(trim(coalesce(email, ''))) = v_email
        AND id <> v_uid
        AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = public.profiles.id);
      GET DIAGNOSTICS v_found = ROW_COUNT;
      IF v_found = 1 THEN RETURN; END IF;
    END IF;
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

select (select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass
          and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D') = 1 as guard_trigger_on,
       has_function_privilege('anon', 'public.sync_my_profile(text,text)', 'execute') as anon_can_sync,  -- false
       (select prosrc like '%P0-C%' from pg_proc where oid = 'public.sync_my_profile(text,text)'::regprocedure) as sync_patched;
