-- =============================================================================
-- P0 개인정보 보호 — members/profiles 민감 컬럼 column-level privilege + 관리자 RPC.
--
--   문제: RLS 는 row 만 제한하고 컬럼 제한이 없어, 일반 authenticated 회원이 PostgREST
--         직접 호출로 members.email/phone/"나이"/member_number/"비고", profiles.email 을
--         조회할 수 있었다(화면에는 미노출 — 데이터 접근 경계 문제).
--
--   조치: ① 민감 컬럼이 필요한 관리자 조회를 SECURITY DEFINER RPC 5종으로 이전
--         ② authenticated 의 테이블 SELECT 를 안전 컬럼 목록으로 제한(column-level GRANT)
--   RLS 정책·INSERT/UPDATE/DELETE 권한은 변경하지 않는다.
--
--   ⚠️ 적용 순서(필수): 코드 선배포(클라이언트 select('*') 제거 + RPC 전환, 폴백 내장)
--      → Production 반영 확인 → 이 SQL 실행 → verify → 역할별 실검증.
--      코드보다 먼저 실행하면 구버전 클라이언트의 select('*') 가 permission denied 로 깨진다.
--
--   실측 기준 실존 컬럼(2026-07-11 REST probe):
--     members  존재: id, nickname, role, position, club_id, avatar_url, affiliation, mbti,
--                    bio, achievements, auth_user_id, email, phone, "나이", member_number, "비고"
--     members  미존재: intro, is_admin, is_guest, created_at, updated_at, age
--     profiles 존재: id, nickname, role, avatar_url, profile_visibility_level, updated_at,
--                    email, created_at
--
--   rollback: supabase/secure_member_column_privileges_rollback.sql
--   verify  : supabase/secure_member_column_privileges_verify.sql
-- =============================================================================

-- ── 0. 관리자 판정 helper (기존 profiles.role 재사용) ─────────────────────────
create or replace function public.is_full_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.role in ('CEO', 'ADMIN')
    );
$$;
revoke execute on function public.is_full_admin() from public;
revoke execute on function public.is_full_admin() from anon;
grant  execute on function public.is_full_admin() to authenticated;

-- ── 1. 관리자: 회원 민감 프로필 단건(프로필 편집 화면) ─────────────────────────
create or replace function public.admin_get_member_private(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v jsonb;
begin
    if not public.is_full_admin() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    select jsonb_build_object(
        'nickname',            m.nickname,
        'affiliation',         m.affiliation,
        'mbti',                m.mbti,
        'birth_text',          m."나이",
        'bio',                 m.bio,
        'avatar_url',          m.avatar_url,
        'achievements_legacy', m.achievements
    ) into v
    from public.members m
    where m.id = p_member_id;
    if v is null then
        raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002';
    end if;
    return v;
end;
$$;
revoke execute on function public.admin_get_member_private(uuid) from public;
revoke execute on function public.admin_get_member_private(uuid) from anon;
grant  execute on function public.admin_get_member_private(uuid) to authenticated;

-- ── 2. 관리자: 앱 계정(profiles) 목록 — email 포함(계정 탭·미연결 계정) ────────
create or replace function public.admin_list_profiles()
returns table (id uuid, email text, nickname text, role text, avatar_url text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select p.id, p.email, p.nickname, p.role, p.avatar_url, p.updated_at
      from public.profiles p
     where public.is_full_admin()
     order by p.updated_at desc nulls last;
$$;
revoke execute on function public.admin_list_profiles() from public;
revoke execute on function public.admin_list_profiles() from anon;
grant  execute on function public.admin_list_profiles() to authenticated;

-- ── 3. 관리자: 회원 exact 후보 검색(등록·계정 연결 — email 매칭 포함) ──────────
--   조건 OR 매칭. 부분 일치 없음(기존 정책 유지). club 범위 검증 포함.
create or replace function public.admin_find_member_candidates(
    p_nickname     text    default null,
    p_email        text    default null,
    p_auth_user_id uuid    default null,
    p_member_id    uuid    default null
)
returns table (id uuid, nickname text, role text, email text, auth_user_id uuid, avatar_url text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
    if not public.is_full_admin() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return query
    select m.id, m.nickname, m.role, m.email, m.auth_user_id, m.avatar_url
      from public.members m
     where m.club_id = '512d047d-a076-4080-97e5-6bb5a2c07819'
       and (
            (p_nickname     is not null and m.nickname = btrim(p_nickname))
         or (p_email        is not null and m.email = btrim(p_email))
         or (p_auth_user_id is not null and m.auth_user_id = p_auth_user_id)
         or (p_member_id    is not null and m.id = p_member_id)
       );
end;
$$;
revoke execute on function public.admin_find_member_candidates(text, text, uuid, uuid) from public;
revoke execute on function public.admin_find_member_candidates(text, text, uuid, uuid) from anon;
grant  execute on function public.admin_find_member_candidates(text, text, uuid, uuid) to authenticated;

-- ── 4. 관리자: 연령 분포(개별 값 미반환 — 버킷 집계만) ────────────────────────
--   "나이" 는 출생연도 텍스트(예: '1988') — 서버에서 현재 나이로 환산해 버킷만 반환.
create or replace function public.admin_age_distribution()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_total  int := 0;
    v_filled int := 0;
    b20 int := 0; b30 int := 0; b40 int := 0; b50 int := 0; bna int := 0;
    r record;
    v_year int;
    v_age  int;
begin
    if not public.is_full_admin() then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    for r in select m."나이" as birth_text from public.members m
              where m.club_id = '512d047d-a076-4080-97e5-6bb5a2c07819'
    loop
        v_total := v_total + 1;
        v_year := case when r.birth_text ~ '^(19|20)\d{2}$' then r.birth_text::int else null end;
        if v_year is null then
            bna := bna + 1;
        else
            v_age := extract(year from now())::int - v_year;
            if v_age <= 0 then bna := bna + 1;
            elsif v_age < 30 then b20 := b20 + 1;
            elsif v_age < 40 then b30 := b30 + 1;
            elsif v_age < 50 then b40 := b40 + 1;
            else b50 := b50 + 1;
            end if;
        end if;
    end loop;
    v_filled := v_total - bna;
    return jsonb_build_object(
        'buckets', jsonb_build_array(
            jsonb_build_object('label', '20대 이하', 'count', b20),
            jsonb_build_object('label', '30대',      'count', b30),
            jsonb_build_object('label', '40대',      'count', b40),
            jsonb_build_object('label', '50대 이상', 'count', b50),
            jsonb_build_object('label', '미입력',    'count', bna)
        ),
        'total', v_total,
        'filled', v_filled
    );
end;
$$;
revoke execute on function public.admin_age_distribution() from public;
revoke execute on function public.admin_age_distribution() from anon;
grant  execute on function public.admin_age_distribution() to authenticated;

-- ── 5. KDK 운영: 출생연도 텍스트 일괄 조회(대진 설정·comparator 폴백) ──────────
--   KDK 세션 운영은 OPERATOR 도 수행하므로 CEO/ADMIN/OPERATOR 허용(가장 좁은 실사용 범위).
create or replace function public.admin_get_member_birth_years(p_member_ids uuid[])
returns table (member_id uuid, birth_text text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
    if not exists (
        select 1 from public.profiles p
         where p.id = auth.uid() and p.role in ('CEO', 'ADMIN', 'OPERATOR')
    ) then
        raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    return query
    select m.id, m."나이"
      from public.members m
     where m.id = any(p_member_ids)
       and m.club_id = '512d047d-a076-4080-97e5-6bb5a2c07819'
       and m."나이" is not null;
end;
$$;
revoke execute on function public.admin_get_member_birth_years(uuid[]) from public;
revoke execute on function public.admin_get_member_birth_years(uuid[]) from anon;
grant  execute on function public.admin_get_member_birth_years(uuid[]) to authenticated;

-- ── 6. column-level privilege — 민감 컬럼 SELECT 차단(실존 컬럼 기준) ──────────
--   RLS row 정책은 그대로(같은 club 만 조회) — 컬럼 축만 추가 제한.
--   INSERT/UPDATE/DELETE grant 는 변경하지 않는다(쓰기는 기존 RLS 가 관리자 한정).
revoke select on table public.members from authenticated;
grant select (
    id, nickname, role, position, club_id, avatar_url,
    affiliation, mbti, bio, achievements, auth_user_id
) on table public.members to authenticated;
-- 차단(미GRANT): email, phone, "나이", member_number, "비고"

revoke select on table public.profiles from authenticated;
grant select (
    id, nickname, role, avatar_url, profile_visibility_level, updated_at
) on table public.profiles to authenticated;
-- 차단(미GRANT): email, created_at(소비자 없음)

notify pgrst, 'reload schema';
