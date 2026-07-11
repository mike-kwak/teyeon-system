-- =============================================================================
-- 검증 SQL — secure_member_column_privileges.sql 적용 후 확인(읽기 전용).
-- =============================================================================

-- 1) authenticated 의 members "테이블 전체" SELECT 권한이 사라졌는지
select has_table_privilege('authenticated', 'public.members',  'SELECT') as members_table_select,   -- 기대 false
       has_table_privilege('authenticated', 'public.profiles', 'SELECT') as profiles_table_select;  -- 기대 false

-- 2) members 컬럼별 SELECT 권한(허용 11개 true / 민감 5개 false)
select col, has_column_privilege('authenticated', 'public.members', col, 'SELECT') as can_select
from unnest(array[
    'id','nickname','role','position','club_id','avatar_url',
    'affiliation','mbti','bio','achievements','auth_user_id',   -- 기대 true
    'email','phone','나이','member_number','비고'               -- 기대 false
]) as col;

-- 3) profiles 컬럼별 SELECT 권한(허용 6개 true / email·created_at false)
select col, has_column_privilege('authenticated', 'public.profiles', col, 'SELECT') as can_select
from unnest(array[
    'id','nickname','role','avatar_url','profile_visibility_level','updated_at',  -- 기대 true
    'email','created_at'                                                          -- 기대 false
]) as col;

-- 4) 신규 RPC 존재 + owner + SECURITY DEFINER + search_path
select p.proname,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef                 as security_definer,   -- 기대 true
       p.proconfig                                          -- 기대 search_path=public,pg_temp 포함
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_full_admin','admin_get_member_private','admin_list_profiles',
                     'admin_find_member_candidates','admin_age_distribution','admin_get_member_birth_years')
 order by p.proname;   -- 기대 6행

-- 5) RPC 실행 권한 — anon 전부 false / authenticated 전부 true
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
 where n.nspname = 'public'
   and p.proname in ('is_full_admin','admin_get_member_private','admin_list_profiles',
                     'admin_find_member_candidates','admin_age_distribution','admin_get_member_birth_years')
 order by p.proname, r.rolname;
-- 기대: anon=false ×6, authenticated=true ×6 (권한 게이트는 함수 내부 role 재검증이 담당)

-- 6) RLS 정책 무변경 확인(기존 정책 그대로)
select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename in ('members','profiles')
 order by tablename, policyname;
-- 기대: 기존 members_select_same_club / members_*_admin / profiles_select_auth / profiles_*_admin 유지

-- 7) 실호출 스모크(SQL Editor = postgres 이므로 role 게이트는 세션별 수동 확인 항목):
--    · CEO/ADMIN 세션:   select public.admin_list_profiles();                → 행 반환
--    · MEMBER 세션:      select public.admin_list_profiles();                → FORBIDDEN(42501)
--    · MEMBER 세션 REST: GET /rest/v1/profiles?select=email                  → 42501 permission denied
--    · MEMBER 세션 REST: GET /rest/v1/members?select=email,phone             → 42501 permission denied
--    · MEMBER 세션 REST: GET /rest/v1/members?select=id,nickname,avatar_url  → 200
--    · OPERATOR 세션:    select public.admin_get_member_birth_years(array[]::uuid[]); → 0행(허용)
