-- =============================================================================
-- KDK 35 — KDK 관리자 등록 대상(김영호 부회장) 계정 식별 — 읽기 전용(SELECT 1문장 · 쓰기 없음)
--   이메일 · UUID 원문은 출력하지 않는다. 계정은 "지문"(UID 의 md5 앞 12자리)으로만 표시 → 36 등록 SQL 에 그 지문을 넣어야 등록된다.
--   T01 이름 후보(members, 공백 무시 '김영호')      T02 후보별 연결 상태(직책 · 탈회 · auth 계정 · 프로필 · 앱 권한 · 지문)
--   T03 같은 계정에 연결된 members 행 수(중복 연결)  T04 프로필 닉네임만 '김영호' 이고 members 연결 없는 계정
--   T05 등록 가능 판정(정확히 1명 · 부회장 · 탈회 아님 · auth 계정 존재 · 프로필 MEMBER · 중복 연결 없음)
--   T06 kdk_managers 현재 등록 수 · 대상 이미 등록 여부   T07 앱 권한 분포(등록 전후 비교용 — 바뀌면 안 됨)
-- =============================================================================
with
cand as (
  select m.id as member_id, m.nickname, m.role::text as club_role, m.auth_user_id,
         exists (select 1 from unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v) where btrim(r.v) = '탈회') as withdrawn,
         exists (select 1 from unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v) where btrim(r.v) = '부회장') as vice
    from public.members m
   where replace(coalesce(m.nickname, ''), ' ', '') = '김영호'
),
c2 as (
  select c.*,
         (select count(*) from auth.users u where u.id::text = c.auth_user_id::text) as auth_n,
         (select to_jsonb(u) ->> 'last_sign_in_at' from auth.users u where u.id::text = c.auth_user_id::text) as last_sign_in,
         (select to_jsonb(u) ->> 'deleted_at' from auth.users u where u.id::text = c.auth_user_id::text) as deleted_at,
         (select count(*) from public.profiles p where p.id::text = c.auth_user_id::text) as profile_n,
         (select upper(btrim(coalesce(p.role::text, ''))) from public.profiles p where p.id::text = c.auth_user_id::text) as app_role,
         (select count(*) from public.members x where x.auth_user_id::text = c.auth_user_id::text) as linked_members_n,
         case when c.auth_user_id is null then null else left(md5(c.auth_user_id::text), 12) end as fp,
         case when c.auth_user_id is null or to_regclass('public.kdk_managers') is null then false
              else (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.kdk_managers where user_id::text = %L', c.auth_user_id::text), false, true, '')))[1]::text::int > 0 end as registered
    from cand c
),
ok as (
  select * from c2
   where vice and not withdrawn and auth_user_id is not null and auth_n = 1 and deleted_at is null
     and profile_n = 1 and app_role = 'MEMBER' and linked_members_n = 1
)
select 1 as o, 'T01 이름 후보(members · 공백 무시 김영호)' as item,
       case when (select count(*) from cand) = 1 then 'OK' when (select count(*) from cand) = 0 then 'BLOCK' else 'CHECK' end as verdict,
       (select count(*) from cand)::text || '명' || case when (select count(*) from cand) > 1 then ' — 동명이인: 아래 T02 에서 직책·연결로 구분' else '' end as detail
union all
select 2 + row_number() over (order by fp nulls last, club_role), 'T02 후보 상태',
       case when c.vice and not c.withdrawn and c.auth_user_id is not null and c.auth_n = 1 and c.deleted_at is null
                 and c.profile_n = 1 and c.app_role = 'MEMBER' and c.linked_members_n = 1 then 'OK' else 'BLOCK' end,
       concat_ws(' · ',
         '직책 ' || coalesce(nullif(btrim(c.club_role), ''), '(없음)'),
         case when c.withdrawn then '탈회' else '탈회 아님' end,
         case when c.auth_user_id is null then '계정 미연결'
              when c.auth_n = 0 then '연결 UID 가 auth 계정에 없음(UID 불일치)'
              when c.deleted_at is not null then 'auth 계정 삭제됨'
              else '계정 지문 ' || c.fp end,
         case when c.auth_user_id is null then null when c.profile_n = 0 then '프로필 없음' else '앱 권한 ' || coalesce(nullif(c.app_role, ''), '(빈 값)') end,
         case when c.auth_user_id is null then null else '같은 계정 연결 members ' || c.linked_members_n || '행' end,
         case when c.last_sign_in is null then '로그인 기록 없음' else '최근 로그인 ' || left(c.last_sign_in, 10) end,
         case when c.registered then '이미 KDK 관리자 등록됨' end)
  from c2 c
union all
select 20, 'T04 프로필 닉네임만 김영호(members 연결 없음)', 'INFO',
       (select count(*) from public.profiles p
         where replace(coalesce(p.nickname::text, ''), ' ', '') = '김영호'
           and not exists (select 1 from public.members m where m.auth_user_id::text = p.id::text))::text
       || '개 계정 — 이름만 같은 다른 계정은 등록 대상이 아님'
union all
select 30, 'T05 등록 가능 판정',
       case when (select count(*) from ok) = 1 and not (select registered from ok limit 1) then 'READY'
            when (select count(*) from ok) = 1 then 'ALREADY'
            else 'BLOCK' end,
       case when (select count(*) from ok) = 1 then '대상 1명 · 계정 지문 ' || (select fp from ok) || ' → 36 등록 SQL 의 v_expected_fp 에 이 값을 넣는다'
            else '조건을 모두 만족하는 후보 ' || (select count(*) from ok) || '명 — 정확히 1명이어야 등록 가능' end
union all
select 31, 'T06 kdk_managers 현재 등록',
       case when to_regclass('public.kdk_managers') is null then 'BLOCK' else 'INFO' end,
       case when to_regclass('public.kdk_managers') is null then '표 없음 — SQL 30 미적용'
            else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_managers', false, true, '')))[1]::text || '명' end
union all
select 32, 'T07 앱 권한 분포(profiles.role — 등록 전후 같아야 함)', 'INFO',
       (select string_agg(r || '=' || n, ' · ' order by r) from (select upper(btrim(coalesce(role::text, ''))) r, count(*) n from public.profiles group by 1) t)
order by 1;
