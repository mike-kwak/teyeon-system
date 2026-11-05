-- =============================================================================
-- KDK 37 — KDK 관리자 등록 후 확인 — 읽기 전용(SELECT 1문장 · 이메일/UUID 원문 출력 없음)
--   V01 등록 수 = 1        V02 등록 계정 지문(35 의 T05 와 같아야 함)
--   V03 등록 계정 상태: 김영호 · 부회장 · 탈회 아님 · 앱 권한 MEMBER(CEO/ADMIN 아님) · auth 계정 존재
--   V04 관리 권한 판정 요소(can_manage_kdk 와 같은 규칙) · 코트 운영 판정 요소
--   V05 앱 권한 분포(35 T07 과 같아야 함 — profiles.role 무변경)   V06 CEO·ADMIN 인원(무변경)
--   V07 공식 저장 기록(31) 건수 — 등록 직후 0, 실사용 후 관리자 경로 건수 증가
-- =============================================================================
with
k as (
  select k.user_id, k.granted_at, left(md5(k.user_id::text), 12) as fp,
         upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = k.user_id::text), ''))) as app_role,
         (select count(*) from auth.users u where u.id = k.user_id and (to_jsonb(u) ->> 'deleted_at') is null) as auth_n,
         (select string_agg(coalesce(m.nickname, '') || '/' || coalesce(m.role::text, ''), ' ; ') from public.members m where m.auth_user_id::text = k.user_id::text) as member_info,
         exists (select 1 from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v)
                  where m.auth_user_id::text = k.user_id::text and btrim(r.v) = '탈회') as withdrawn
    from public.kdk_managers k
)
select 1 as o, 'V01 KDK 관리자 등록 수' as item,
       case when (select count(*) from k) = 1 then 'OK' else 'CHECK' end as verdict,
       (select count(*) from k)::text || '명(1명이어야 함)' as detail
union all
select 2, 'V02 등록 계정 지문', 'INFO', coalesce((select string_agg(fp || ' · 등록 ' || left(granted_at::text, 16), ' | ') from k), '(없음)')
union all
select 3, 'V03 등록 계정 상태',
       case when (select count(*) from k where replace(member_info, ' ', '') like '김영호/%' and member_info like '%부회장%'
                    and not withdrawn and app_role = 'MEMBER' and auth_n = 1) = (select count(*) from k) and (select count(*) from k) = 1 then 'OK' else 'BLOCK' end,
       coalesce((select string_agg(concat_ws(' · ', '회원 ' || coalesce(member_info, '(연결 없음)'), '앱 권한 ' || app_role,
                                             case when withdrawn then '탈회' else '탈회 아님' end, case when auth_n = 1 then 'auth 계정 있음' else 'auth 계정 없음' end), ' | ') from k), '(없음)')
union all
select 4, 'V04 권한 판정 요소',
       case when (select count(*) from k where app_role in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER') and not withdrawn) = (select count(*) from k) then 'OK' else 'CHECK' end,
       'KDK 관리 = 등재 + 앱 권한 MEMBER·OPERATOR·FINANCE_MANAGER + 탈회 아님 · 코트 운영 = 앱 권한 MEMBER 이상 + 탈회 아님 — 실제 동작은 실계정 화면으로 확인'
union all
select 5, 'V05 앱 권한 분포(35 T07 과 같아야 함)', 'INFO',
       (select string_agg(r || '=' || n, ' · ' order by r) from (select upper(btrim(coalesce(role::text, ''))) r, count(*) n from public.profiles group by 1) t)
union all
select 6, 'V06 CEO·ADMIN 인원', 'INFO',
       'CEO ' || (select count(*) from public.profiles where upper(btrim(coalesce(role::text, ''))) = 'CEO')
       || ' · ADMIN ' || (select count(*) from public.profiles where upper(btrim(coalesce(role::text, ''))) = 'ADMIN') || ' — 등록 전과 같아야 함'
union all
select 7, 'V07 공식 저장 기록(31)', 'INFO',
       case when to_regclass('public.kdk_official_saves') is null then '표 없음'
            else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_official_saves', false, true, '')))[1]::text || '건 · 관리자 경로 '
              || (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_official_saves where via_manager', false, true, '')))[1]::text || '건' end
order by 1;
