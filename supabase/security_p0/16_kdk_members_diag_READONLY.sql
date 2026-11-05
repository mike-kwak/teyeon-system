-- =============================================================================
-- KDK 회원 조회 장애 진단 — 읽기 전용 · SELECT 1개 · 아무것도 바꾸지 않음
--   KDK(app/kdk/page.tsx fetchMembers)가 요청하는 members 컬럼 8개에 대해 로그인 사용자(authenticated)의
--   SELECT 권한을 확인한다. 회원 목록 화면(app/members)은 achievements 를 요청하지 않으므로,
--   K02 가 FAIL 이면 "회원 목록은 열리는데 KDK 만 LINK INTERRUPTED + 전원 GUEST" 증상과 정확히 일치한다.
-- =============================================================================
with cols(o, col) as (
  values (1,'id'),(2,'nickname'),(3,'role'),(4,'position'),(5,'club_id'),(6,'avatar_url'),(7,'achievements'),(8,'auth_user_id')
),
r as (
  select 1 as o, 'K01 KDK 요청 컬럼 중 authenticated SELECT 불가' as item,
         case when exists (select 1 from cols where not exists (select 1 from information_schema.columns x
                             where x.table_schema='public' and x.table_name='members' and x.column_name=cols.col)
                              or not has_column_privilege('authenticated', 'public.members', cols.col, 'SELECT')) then 'FAIL' else 'OK' end as verdict,
         coalesce((select string_agg(col || case when not exists (select 1 from information_schema.columns x
                             where x.table_schema='public' and x.table_name='members' and x.column_name=cols.col) then '(컬럼 없음)' else '(권한 없음)' end, ', ' order by o)
                     from cols where not exists (select 1 from information_schema.columns x
                             where x.table_schema='public' and x.table_name='members' and x.column_name=cols.col)
                              or not has_column_privilege('authenticated', 'public.members', cols.col, 'SELECT')), '(none)') as detail
  union all
  select 2, 'K02 achievements 컬럼 authenticated SELECT',
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='members' and column_name='achievements')
                   and has_column_privilege('authenticated', 'public.members', 'achievements', 'SELECT') then 'OK' else 'FAIL' end,
         coalesce((select 'type=' || format_type(a.atttypid, a.atttypmod) || ' · acl=' || coalesce(a.attacl::text, '(없음)')
                     from pg_attribute a where a.attrelid = 'public.members'::regclass and a.attname = 'achievements' and not a.attisdropped), '(컬럼 없음)')
  union all
  select 3, 'K03 members 테이블 수준 authenticated SELECT(참고: 컬럼 grant 방식이면 false 정상)', 'INFO',
         has_table_privilege('authenticated', 'public.members', 'SELECT')::text
  union all
  select 4, 'K04 CEO 계정 ↔ members 연결(auth_user_id) — 0 이면 RLS 로 0행',
         case when exists (select 1 from public.members m join public.profiles p on p.id = m.auth_user_id where p.role = 'CEO') then 'OK' else 'FAIL' end,
         coalesce((select string_agg(m.nickname || ' club=' || coalesce(m.club_id::text, 'null'), ', ')
                     from public.members m join public.profiles p on p.id = m.auth_user_id where p.role = 'CEO'), '(연결 없음)')
  union all
  select 5, 'K05 current_user_club_ids() authenticated 실행',
         case when to_regprocedure('public.current_user_club_ids()') is not null
                   and has_function_privilege('authenticated', 'public.current_user_club_ids()', 'EXECUTE') then 'OK' else 'FAIL' end, ''
  union all
  select 6, 'K06 matches authenticated SELECT(활성 세션 동기화)',
         case when has_table_privilege('authenticated', 'public.matches', 'SELECT') then 'OK' else 'FAIL' end, ''
  union all
  select 7, 'K07 members 정책', 'INFO',
         coalesce((select string_agg(policyname || '(' || cmd || ':' || array_to_string(roles, '/') || ')', ', ' order by policyname)
                     from pg_policies where schemaname='public' and tablename='members'), '(none)')
  union all
  select 8, 'K08 members 컬럼별 authenticated SELECT 가능 목록', 'INFO',
         coalesce((select string_agg(a.attname::text, ', ' order by a.attnum) from pg_attribute a
                     where a.attrelid = 'public.members'::regclass and a.attnum > 0 and not a.attisdropped
                       and has_column_privilege('authenticated', 'public.members', a.attname::text, 'SELECT')), '(none)')
)
select item, verdict, detail from r order by o;
