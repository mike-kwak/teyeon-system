-- =============================================================================
-- delete_kdk_live_session 의 "JWT email 로 운영진 판정" 위험 조건 확인 — 읽기 전용 · SELECT 1개 · 6행 · 개수만
--   운영 본문은 auth.uid() 외에 JWT email 이 CEO/ADMIN profile 의 email 과 같으면 운영진으로 본다(9c 결과).
--   아래 조건이 모두 0 이면 email 경로로 운영진이 아닌 사람이 통과할 수 있는 현실적 경로가 없다.
-- =============================================================================
with adm as (
  select p.id, lower(btrim(coalesce(p.email::text, ''))) as em
    from public.profiles p where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
),
au as (select u.id, lower(btrim(coalesce(u.email::text, ''))) as em from auth.users u),
r as (
  select 1 as o, 'E01 CEO·ADMIN profile 중 email 이 비어 있음(빈 문자열 비교 구현이면 email 없는 JWT 가 통과할 위험)' as chk,
         (select count(*) from adm where em = '')::text as n
  union all
  select 2, 'E02 CEO·ADMIN profile email 이 "다른" 로그인 계정의 email 과 같음(그 계정이 운영진으로 판정됨)',
         (select count(*) from adm a join au u on u.em = a.em and u.id <> a.id where a.em <> '')::text
  union all
  select 3, 'E03 CEO·ADMIN profile email ≠ 본인 로그인 계정 email(오래된 email 이 남아 있음)',
         (select count(*) from adm a join au u on u.id = a.id where a.em <> u.em)::text
  union all
  select 4, 'E04 로그인 계정 email 중복(대소문자·공백 무시) 그룹 수',
         (select count(*) from (select em from au where em <> '' group by em having count(*) > 1) x)::text
  union all
  select 5, 'E05 같은 email 의 profile 이 2개 이상인 CEO·ADMIN 수',
         (select count(*) from adm a where a.em <> '' and (select count(*) from public.profiles q where lower(btrim(coalesce(q.email::text, ''))) = a.em) > 1)::text
  union all
  select 6, 'E06 email 미확인 로그인 계정 수(이메일 변경 확인 없이 JWT email 을 바꿀 수 있는지와 함께 판단)',
         (select count(*) from auth.users where email_confirmed_at is null)::text
)
select chk as "check", n as count from r order by o;
