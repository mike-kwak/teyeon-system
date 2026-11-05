-- =============================================================================
-- P0-C 적용 직전 확인 — 읽기 전용 · SELECT 1개 · 10행
--   verdict 에 STOP 이 하나라도 있으면 P0-C 를 실행하지 않는다.
--   R07(역할별 계정 수)은 적용 후 12_p0c_verify_READONLY.sql 의 V07 과 같아야 한다(P0-C 는 데이터를 바꾸지 않음).
-- =============================================================================
with r as (
  select 1 as o, 'R01 sync_my_profile 본문 = 저장소 원본' as chk,
         case when (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')) = 'ee64b99b69f2ca8d535530786654c1f4'
              then 'OK' else 'STOP' end as verdict,
         coalesce((select left(md5(replace(prosrc, E'\r', '')), 12) from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')), '함수 없음') as detail
  union all
  select 2, 'R02 guard trigger 미설치(설치돼 있으면 이미 적용됨)',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg') then 'CHECK' else 'OK' end,
         coalesce((select tgenabled::text from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg'), '없음')
  union all
  select 3, 'R03 profiles 의 다른 사용자 trigger(없어야 정상)',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and not tgisinternal and tgname <> 'guard_profiles_privileged_columns_trg') then 'CHECK' else 'OK' end,
         coalesce((select string_agg(tgname::text, ', ') from pg_trigger where tgrelid = to_regclass('public.profiles') and not tgisinternal and tgname <> 'guard_profiles_privileged_columns_trg'), '(none)')
  union all
  select 4, 'R04 같은 이름 helper 함수 사전 존재',
         case when to_regprocedure('public.security_actor_profile_role()') is not null or to_regprocedure('public.guard_profiles_privileged_columns()') is not null then 'CHECK' else 'OK' end,
         coalesce(to_regprocedure('public.security_actor_profile_role()')::text, '-') || ' / ' || coalesce(to_regprocedure('public.guard_profiles_privileged_columns()')::text, '-')
  union all
  select 5, 'R05 CEO 계정 1개 이상(적용 후 CEO 만 CEO 를 부여할 수 있음)',
         case when (select count(*) from public.profiles where upper(btrim(coalesce(role::text, ''))) = 'CEO') >= 1 then 'OK' else 'STOP' end,
         (select count(*)::text from public.profiles where upper(btrim(coalesce(role::text, ''))) = 'CEO') || '명'
  union all
  select 6, 'R06 CEO 계정이 로그인 계정과 연결됨(auth.users 에 같은 id)',
         case when exists (select 1 from public.profiles p where upper(btrim(coalesce(p.role::text, ''))) = 'CEO'
                             and exists (select 1 from auth.users u where u.id = p.id)) then 'OK' else 'STOP' end,
         (select count(*)::text from public.profiles p where upper(btrim(coalesce(p.role::text, ''))) = 'CEO'
            and exists (select 1 from auth.users u where u.id = p.id)) || '명 연결'
  union all
  select 7, 'R07 역할별 계정 수(적용 후 V07 과 비교)', 'INFO',
         coalesce((select string_agg(k || '=' || n, ', ' order by k) from (
            select upper(btrim(coalesce(role::text, ''))) k, count(*) n from public.profiles group by 1) x), '-')
  union all
  select 8, 'R08 본인 UPDATE 정책(role 제한 없음 = P0-C 필요 근거)', 'INFO',
         coalesce((select string_agg(policyname::text || ' using=' || coalesce(qual, '-'), ' || ')
                     from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd in ('UPDATE','ALL')
                       and coalesce(qual, '') !~* '(CEO|ADMIN)'), '(none)')
          || ' | authenticated role UPDATE=' || has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  union all
  select 9, 'R09 profiles 잠금 대기(적용 시 3초 lock_timeout)', 'INFO',
         (select count(*)::text from pg_locks where relation = to_regclass('public.profiles') and pid <> pg_backend_pid()) || '개 잠금(다른 세션)'
  union all
  select 10, 'R10 auth.users email 미확인 / 미연결 사전 등록 profile(② 이전 단계 영향)', 'INFO',
         (select count(*)::text from auth.users where email_confirmed_at is null) || ' / '
         || (select count(*)::text from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id))
)
select chk as "check", verdict, detail from r order by o;
