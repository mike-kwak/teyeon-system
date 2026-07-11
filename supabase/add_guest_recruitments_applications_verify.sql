-- =============================================================================
-- 검증 SQL — add_guest_recruitments_applications.sql 적용 후 확인(읽기 전용).
-- =============================================================================

-- 1. 테이블 2개 존재
select table_name from information_schema.tables
 where table_schema = 'public' and table_name in ('guest_recruitments', 'guest_applications') order by table_name;  -- 기대 2행

-- 2. public_token 컬럼 존재 + unique
select column_name, is_nullable from information_schema.columns
 where table_schema = 'public' and table_name = 'guest_recruitments' and column_name = 'public_token';  -- 기대 1행, NO
select indexname, indexdef from pg_indexes
 where tablename = 'guest_recruitments' and indexdef ilike '%public_token%' and indexdef ilike '%unique%';  -- 기대: unique index

-- 3. RLS 활성화
select relname, relrowsecurity from pg_class where relname in ('guest_recruitments', 'guest_applications');  -- true

-- 4. anon 원본 테이블 권한 없음
select table_name, privilege_type from information_schema.role_table_grants
 where grantee = 'anon' and table_name in ('guest_recruitments', 'guest_applications');  -- 기대 0행

-- 5. active duplicate index 에 on_hold 포함
select indexdef from pg_indexes where tablename = 'guest_applications' and indexname = 'guest_applications_active_dup';
-- 기대 WHERE (status = ANY (ARRAY['pending','on_hold','approved']))

-- 6. RPC 실행 권한(anon 은 공개 조회/제출만)
select p.proname,
       array_agg(distinct r.rolname order by r.rolname) filter (where has_function_privilege(r.oid, p.oid, 'EXECUTE')) as can_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
 where n.nspname = 'public'
   and p.proname in ('get_open_guest_recruitments','submit_guest_application','set_guest_application_status',
                     'upsert_guest_recruitment','get_admin_guest_recruitments','can_manage_guest_applications','gen_guest_public_token')
 group by p.proname order by p.proname;
-- 기대:
--   get_open_guest_recruitments   → {anon, authenticated}
--   submit_guest_application      → {anon, authenticated}
--   그 외(set_.../upsert_.../get_admin.../can_manage.../gen_...) → {authenticated}  (anon 없음)

-- 7. SECURITY DEFINER + 고정 search_path (토큰 함수 포함)
select p.proname, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_open_guest_recruitments','submit_guest_application','set_guest_application_status',
                     'upsert_guest_recruitment','get_admin_guest_recruitments',
                     'can_manage_guest_applications','gen_guest_public_token');
-- 기대 prosecdef=true, proconfig 에 search_path 고정.
--   gen_guest_public_token → search_path=public,extensions,pg_temp  (gen_random_bytes 가 extensions 소속)
--   그 외                  → search_path=public,pg_temp

-- 8. get_open_guest_recruitments 응답에 내부 UUID 키 없음(수동 확인)
--    select public.get_open_guest_recruitments();  →  각 원소 키가 publicToken/title/date/.../guestFee/canApply 만.
--    recruitmentId / scheduleId / clubId / id / created_by 가 없어야 함.

-- 9. 공개 토큰 발급 동작 확인(URL-safe: A-Z a-z 0-9 - _ 만, 16자, '+' '/' '=' 없음)
with g as (select public.gen_guest_public_token() as tok)
select tok as sample_token,
       (tok ~ '^[A-Za-z0-9_-]+$') as url_safe,
       (tok !~ '[+/=]')           as no_base64_pad,
       length(tok)                as len
  from g;  -- 기대 url_safe=true, no_base64_pad=true, len=16

-- =============================================================================
-- 실 호출 검증(세션별):
--   · anon        : get_open_guest_recruitments() 성공(내부 UUID 없음) / submit_guest_application(public_token,...) 성공(테스트 신청자)
--                   / guest_applications·guest_recruitments 직접 SELECT → 0행 또는 권한 오류
--   · MEMBER      : guest_applications SELECT → 0행 / upsert_guest_recruitment → FORBIDDEN / set_guest_application_status → FORBIDDEN
--   · FINANCE_MANAGER(단독) : upsert_guest_recruitment / get_admin_guest_recruitments → FORBIDDEN
--   · OPERATOR/CEO/ADMIN : upsert_guest_recruitment 성공(정모 1건당 1건) / get_admin_guest_recruitments 성공 / 상태변경 성공
--   · 정모 1건당 1건 : 같은 schedule_id 로 upsert 2회 → 두 번째는 UPDATE(중복 row 미생성)
--   · open 제출 : status='open' 모집만 submit 성공 / closed·cancelled·completed·마감 후 → RECRUITMENT_NOT_OPEN/CLOSED
--   · 승인 정원 : max_guests 만큼 approved 후 추가 approved → RECRUITMENT_FULL
--   · public_token : 클라이언트가 upsert 로 token 변경 불가(수정 시 token 불변 확인)
-- =============================================================================
