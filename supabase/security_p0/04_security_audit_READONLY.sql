-- =============================================================================
-- TEYEON public.matches 보안 노출 점검 (읽기 전용 · SELECT 1개 · 데이터·권한 변경 없음)
--   Supabase SQL Editor 에 전체 붙여넣고 Run → 결과 표(20행)를 그대로 복사해 전달.
--   행 내용(이름·점수·id)은 출력하지 않는다. 카탈로그(구조·권한)와 개수만.
--   risk 열: HIGH / MED / INFO
-- =============================================================================
with
mt as (select to_regclass('public.matches') as oid),
roles(r) as (values ('anon'), ('authenticated'), ('service_role')),
privs(p) as (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')),
grid as (
  select r, string_agg(left(p, 1) || case when p = 'TRUNCATE' then 'r' when p = 'TRIGGER' then 'g' else '' end, '' order by p) as g,
         bool_or(p in ('INSERT','UPDATE','DELETE','TRUNCATE')) filter (where has_table_privilege(r, 'public.matches', p)) as can_write
    from roles, privs
   where has_table_privilege(r, 'public.matches', p)
   group by r
),
fn as (   -- matches 를 본문에서 참조하는 public 함수
  select p.oid, p.proname::text as name, p.oid::regprocedure::text as sig, p.prosecdef as definer,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         coalesce(array_to_string(p.proconfig, ' '), '') as cfg,
         p.prosrc ~* '(auth\.uid\(\)|is_admin|role\s*(in|=))' as has_auth_check
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f'
     and p.prosrc ~* '\mmatches\M'
     and p.proname not like 'kdk_match_lifecycle_%' and p.proname not like '%spotlight%'
),
pubt as (   -- public 스키마 전체: RLS 꺼짐 + anon 쓰기 가능 테이블
  select c.relname::text as t
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
     and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE')
          or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE'))
),
r as (
  select 1 as o, 'S01 PostgREST(authenticator) 설정' as chk, 'INFO' as risk,
         coalesce((select array_to_string(rolconfig, ' ; ') from pg_roles where rolname = 'authenticator'), '(rolconfig 없음 → Supabase 기본: public 노출)') as detail
  union all
  select 2, 'S02 API 노출 스키마 설정값(pgrst.db_schemas)', 'INFO',
         coalesce(current_setting('pgrst.db_schemas', true), '(DB 에서 조회 불가 → Dashboard Settings > API > Exposed schemas 확인)')
  union all
  select 3, 'S03 matches RLS enabled / forced / owner',
         case when (select relrowsecurity from pg_class where oid = (select oid from mt)) then 'INFO' else 'HIGH' end,
         (select relrowsecurity::text || ' / ' || relforcerowsecurity::text || ' / owner=' || pg_get_userbyid(relowner)
            from pg_class where oid = (select oid from mt))
  union all
  select 4, 'S04 matches 테이블 권한 (S I U D Tr R Tg)',
         case when (select coalesce(bool_or(can_write), false) from grid where r = 'anon')
               and not (select relrowsecurity from pg_class where oid = (select oid from mt)) then 'HIGH' else 'INFO' end,
         (select string_agg(r || '=' || g, ', ' order by r) from grid)
  union all
  select 5, 'S05 matches 컬럼 단위 권한(anon/authenticated)', 'INFO',
         coalesce((select string_agg(distinct grantee || ':' || privilege_type, ', ')
                     from information_schema.column_privileges
                    where table_schema = 'public' and table_name = 'matches' and grantee in ('anon','authenticated')
                      and not has_table_privilege(grantee, 'public.matches', privilege_type)), '(테이블 권한 외 추가 없음)')
  union all
  select 6, 'S06 matches RLS 정책(RLS 꺼져 있으면 효력 없음)', 'INFO',
         coalesce((select string_agg(policyname::text || '[' || cmd || ' ' || roles::text || ' ' || permissive || '] using=' || coalesce(qual, '-')
                                     || ' check=' || coalesce(with_check, '-'), ' || ' order by policyname)
                     from pg_policies where schemaname = 'public' and tablename = 'matches'), '(none)')
  union all
  select 7, 'S07 matches 현재 행 수 · 세션 수(내용 미출력)', 'INFO',
         (select count(*) || '행 / ' || count(distinct session_id) || '세션 / SP- ' || count(*) filter (where session_id::text like 'SP-%') || '행'
            from public.matches)
  union all
  select 8, 'S08 Realtime publication(RLS 꺼짐이면 구독자에게 전 행 변경 전달)',
         case when exists (select 1 from pg_publication_tables where schemaname = 'public' and tablename = 'matches')
               and not (select relrowsecurity from pg_class where oid = (select oid from mt)) then 'MED' else 'INFO' end,
         coalesce((select string_agg(pubname::text, ', ') from pg_publication_tables where schemaname = 'public' and tablename = 'matches'), '(none)')
  union all
  select 9, 'S09 anon 실행 가능 + SECURITY DEFINER + matches 참조 함수',
         case when exists (select 1 from fn where anon_exec and definer) then 'HIGH' else 'INFO' end,
         coalesce((select string_agg(sig || case when has_auth_check then ' [권한검사 흔적]' else ' [권한검사 없음]' end, ', ' order by sig)
                     from fn where anon_exec and definer), '(none)')
  union all
  select 10, 'S10 anon 실행 가능 + INVOKER + matches 참조 함수', 'INFO',
         coalesce((select string_agg(sig, ', ' order by sig) from fn where anon_exec and not definer), '(none)')
  union all
  select 11, 'S11 authenticated 전용(anon 불가) matches 참조 함수', 'INFO',
         coalesce((select string_agg(sig || case when definer then ' [definer]' else '' end
                                     || case when has_auth_check then ' [권한검사 흔적]' else ' [권한검사 없음]' end, ', ' order by sig)
                     from fn where auth_exec and not anon_exec), '(none)')
  union all
  select 12, 'S12 SECURITY DEFINER 함수 중 search_path 미고정', case when exists (select 1 from fn where definer and cfg not like '%search_path%') then 'MED' else 'INFO' end,
         coalesce((select string_agg(sig, ', ' order by sig) from fn where definer and cfg not like '%search_path%'), '(none)')
  union all
  select 13, 'S13 matches 기존 trigger', 'INFO',
         coalesce((select string_agg(tgname::text || '[' || tgenabled::text || ']', ', ' order by tgname)
                     from pg_trigger where tgrelid = (select oid from mt) and not tgisinternal), '(none)')
  union all
  select 14, 'S14 matches 참조 view (노출 경로)', 'INFO',
         coalesce((select string_agg(distinct v.relname::text || case when has_table_privilege('anon', v.oid, 'SELECT') then '[anon S]' else '' end, ', ')
                     from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_class v on v.oid = rw.ev_class
                    where d.refobjid = (select oid from mt) and v.oid <> (select oid from mt)), '(none)')
  union all
  select 15, 'S15 matches 외래키(참조하는/되는)', 'INFO',
         coalesce((select string_agg(conname::text || ':' || conrelid::regclass::text || '→' || confrelid::regclass::text, ', ')
                     from pg_constraint where contype = 'f' and (conrelid = (select oid from mt) or confrelid = (select oid from mt))), '(none)')
  union all
  select 16, 'S16 public 전체: RLS 꺼짐 + anon 쓰기 가능 테이블 수',
         case when (select count(*) from pubt) > 0 then 'HIGH' else 'INFO' end,
         (select count(*) || '개: ' || coalesce(string_agg(t, ', ' order by t), '-') from pubt)
  union all
  select 17, 'S17 public 기본 권한(새 테이블에 anon 자동 부여 여부)', 'INFO',
         coalesce((select string_agg(pg_get_userbyid(defaclrole) || ':' || defaclobjtype::text || '=' || array_to_string(defaclacl, ' '), ' || ')
                     from pg_default_acl a join pg_namespace s on s.oid = a.defaclnamespace where s.nspname = 'public'), '(none)')
  union all
  select 18, 'S18 anon/authenticated 역할 속성(bypassrls 이면 위험)',
         case when exists (select 1 from pg_roles where rolname in ('anon','authenticated') and rolbypassrls) then 'HIGH' else 'INFO' end,
         (select string_agg(rolname || ' bypassrls=' || rolbypassrls, ', ') from pg_roles where rolname in ('anon','authenticated','authenticator'))
  union all
  select 19, 'S19 profiles RLS · anon 권한(관리자 판정 근거 테이블)',
         case when to_regclass('public.profiles') is not null
               and (has_table_privilege('anon', 'public.profiles', 'UPDATE') or has_table_privilege('anon', 'public.profiles', 'INSERT'))
               and not (select relrowsecurity from pg_class where oid = to_regclass('public.profiles')) then 'HIGH' else 'INFO' end,
         (select relrowsecurity::text from pg_class where oid = to_regclass('public.profiles'))
         || ' / anon=' || concat_ws('',
              case when has_table_privilege('anon', 'public.profiles', 'SELECT') then 'S' end,
              case when has_table_privilege('anon', 'public.profiles', 'INSERT') then 'I' end,
              case when has_table_privilege('anon', 'public.profiles', 'UPDATE') then 'U' end,
              case when has_table_privilege('anon', 'public.profiles', 'DELETE') then 'D' end)
         || ' / authenticated=' || concat_ws('',
              case when has_table_privilege('authenticated', 'public.profiles', 'SELECT') then 'S' end,
              case when has_table_privilege('authenticated', 'public.profiles', 'INSERT') then 'I' end,
              case when has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then 'U' end,
              case when has_table_privilege('authenticated', 'public.profiles', 'DELETE') then 'D' end)
  union all
  select 20, 'S20 profiles 정책(role 컬럼 자기 수정 가능 여부 판단용)', 'INFO',
         coalesce((select string_agg(policyname::text || '[' || cmd || ' ' || roles::text || '] using=' || coalesce(qual, '-')
                                     || ' check=' || coalesce(with_check, '-'), ' || ' order by policyname)
                     from pg_policies where schemaname = 'public' and tablename = 'profiles'), '(none)')
)
select chk as "check", risk, detail from r order by o;
