-- [CLOSING SPRINT B1] 임원 직책(members.role) ↔ 앱 보안 역할(profiles.role) 매핑 대조 — 조회 전용 단일 SELECT(쓰기 · set_config 없음).
--   목적: B1 은 members.role 토큰(회장 · 부회장 · 총무 · 재무 · 경기 · 섭외)만 근거로 쓴다. profiles.role 의 OPERATOR · FINANCE_MANAGER 는
--         클럽 직책에서 자동 매핑되지 않고 지정 계정에 수동 부여된다(supabase/draft_add_operator_role.sql "클럽 직책 자동 매핑 금지").
--         이 조회로 두 집합이 실제로 같은지(B1 대신 profiles 역할을 써도 되는지)를 건수로만 확인한다.
--   개인정보 원문(이름 · 이메일 · ID)을 출력하지 않는다(계정 수만).
--   판정: M05 · M06 이 0 이면 두 집합이 일치. 0 이 아니면 profiles 역할로는 대상이 달라지므로 B1(직책 기준)을 유지한다.
with
c as (select '512d047d-a076-4080-97e5-6bb5a2c07819'::text as club_id),
tok as (
  select m.auth_user_id::text as uid, m.club_id::text as club_id, btrim(t.v) as tok
    from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) t(v)
   where m.auth_user_id is not null
),
wd as (select distinct uid from tok where tok = '탈회'),
officer as (  -- B1 직책 경로 대상(같은 클럽 · 탈회 아님 · GUEST 아님) — kdk_can_return_court 의 직책 분기와 같은 규칙
  select distinct t.uid from tok t
   where t.club_id = (select club_id from c)
     and t.tok in ('회장', '부회장', '총무', '재무', '경기', '섭외')
     and t.uid not in (select uid from wd)
     and upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = t.uid), ''))) <> 'GUEST'
),
approle as (
  select p.id::text as uid, upper(btrim(p.role::text)) as r from public.profiles p
   where upper(btrim(coalesce(p.role::text, ''))) in ('OPERATOR', 'FINANCE_MANAGER')
)
select 'M01' k, 'B1 직책 경로 대상 계정 수(임원 · 같은 클럽 · 탈회/GUEST 제외)' item, (select count(*) from officer)::text result
union all select 'M02', '임원 계정의 profiles.role 분포',
  (select coalesce(string_agg(r || '=' || n, ', ' order by r), '없음') from (
     select coalesce(nullif(upper(btrim(p.role::text)), ''), '(profiles 없음)') r, count(*) n
       from officer o left join public.profiles p on p.id::text = o.uid group by 1) x)
union all select 'M03', 'profiles.role = OPERATOR 계정 수', (select count(*) from approle where r = 'OPERATOR')::text
union all select 'M04', 'profiles.role = FINANCE_MANAGER 계정 수', (select count(*) from approle where r = 'FINANCE_MANAGER')::text
union all select 'M05', 'OPERATOR/FINANCE_MANAGER 인데 임원 직책 아님(profiles 기준이면 과다 부여)',
  (select count(*) from approle a where a.uid not in (select uid from officer))::text
union all select 'M06', '임원 직책인데 OPERATOR/FINANCE_MANAGER/CEO/ADMIN 아님(profiles 기준이면 누락)',
  (select count(*) from officer o where not exists (select 1 from public.profiles p where p.id::text = o.uid
     and upper(btrim(p.role::text)) in ('OPERATOR', 'FINANCE_MANAGER', 'CEO', 'ADMIN')))::text
union all select 'M07', '판정',
  case when (select count(*) from approle a where a.uid not in (select uid from officer)) = 0
        and (select count(*) from officer o where not exists (select 1 from public.profiles p where p.id::text = o.uid
              and upper(btrim(p.role::text)) in ('OPERATOR', 'FINANCE_MANAGER', 'CEO', 'ADMIN'))) = 0
       then 'MATCH — 두 집합 일치(B1 직책 기준 유지 권장 · 결과 동일)'
       else 'DIFFERS — profiles 역할은 6개 직책과 다름 → B1 직책 기준 유지' end;
