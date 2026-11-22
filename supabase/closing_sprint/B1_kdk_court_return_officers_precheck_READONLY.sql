-- [CLOSING SPRINT B1] 적용 전/후 점검 — 조회 전용 단일 SELECT(쓰기 · set_config 없음). SQL Editor 결과 1개 표.
--   개인정보 원문(이름 · 이메일 · ID)을 출력하지 않는다(건수 · 판정만).
--   수정 이력: 트리거 이름을 실제 이름 kdk_p1_score_guard_trg(실행 함수 kdk_p1_score_guard(), 활성)로 검사하도록 정정
--             (이전 판은 함수 이름으로 트리거를 찾아 STOP 오탐).
--   G 구역: 임원 직책자별 "기존 코트 복귀 권한 근거"를 can_manage_kdk()/kdk_p1_can_manage_results() 정의
--           (security_p1/20 · 30)와 같은 규칙으로 계산 — B1 없이도 복귀 가능한지, B1 이 필요한 계정이 있는지 판정.
with
c as (select '512d047d-a076-4080-97e5-6bb5a2c07819'::text as club_id),
pos(p) as (values ('회장'), ('부회장'), ('총무'), ('재무'), ('경기'), ('섭외')),
tok as (
  select m.id::text as member_id, m.auth_user_id::text as uid, m.club_id::text as club_id, btrim(t.v) as tok
    from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) t(v)
),
wd as (select distinct uid from tok where tok = '탈회' and uid is not null),
offx as (
  select o.member_id, o.uid, o.tok as position,
         o.club_id = (select club_id from c) as in_club,
         o.uid is not null as linked,
         exists (select 1 from auth.users u where u.id::text = o.uid) as auth_exists,
         exists (select 1 from wd where wd.uid = o.uid) as withdrawn,
         upper(btrim(coalesce((select pr.role::text from public.profiles pr where pr.id::text = o.uid), ''))) as prole,
         exists (select 1 from public.kdk_managers k where k.user_id::text = o.uid) as is_kdkm
    from tok o join pos on pos.p = o.tok
),
g as (
  select *,
         (in_club and linked and auth_exists and not withdrawn and prole <> 'GUEST') as granted,
         -- 기존 권한(B1 무관) = can_manage_kdk() 정의: CEO/ADMIN 또는 (kdk_managers 등재 + MEMBER/OPERATOR/FINANCE_MANAGER + 탈회 아님)
         case when prole in ('CEO', 'ADMIN') then '1 profiles ' || prole
              when is_kdkm and prole in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER') and not withdrawn then '2 kdk_managers + ' || prole
              when is_kdkm then '3 kdk_managers 등재 · 역할 부적격(' || coalesce(nullif(prole, ''), '없음') || ')'
              else '4 기존 권한 없음(profiles ' || coalesce(nullif(prole, ''), '없음') || ')' end as basis
    from offx
),
uid1 as (  -- 계정 단위(겸직 · 다중 직책은 1명으로)
  select uid, bool_or(granted) as granted, min(basis) as basis
    from g where uid is not null group by uid
)
select * from (
  -- A. B1 이 의존하는 기존 객체(모두 OK 여야 적용 가능)
  select 1 as ord, 'A 의존 객체' as section, x.name as item, x.val as value, x.expect as expected,
         case when x.val = x.expect then 'OK' else 'STOP' end as flag
    from (values
      ('can_manage_kdk()',             case when to_regprocedure('public.can_manage_kdk()') is not null then 'yes' else 'no' end, 'yes'),
      ('kdk_actor_withdrawn()',        case when to_regprocedure('public.kdk_actor_withdrawn()') is not null then 'yes' else 'no' end, 'yes'),
      ('kdk_p1_result_recorded(text)', case when to_regprocedure('public.kdk_p1_result_recorded(text)') is not null then 'yes' else 'no' end, 'yes'),
      ('kdk_p1_can_manage_results()',  case when to_regprocedure('public.kdk_p1_can_manage_results()') is not null then 'yes' else 'no' end, 'yes'),
      ('start_kdk_match(text,text)',   case when to_regprocedure('public.start_kdk_match(text,text)') is not null then 'yes' else 'no' end, 'yes'),
      ('table kdk_managers',           case when to_regclass('public.kdk_managers') is not null then 'yes' else 'no' end, 'yes'),
      -- 실제 트리거 이름 · 실행 함수 · 활성 상태(tgenabled: O=활성, D=비활성)
      ('trigger kdk_p1_score_guard_trg (enabled, → kdk_p1_score_guard())',
        coalesce((select case when t.tgenabled <> 'D' and t.tgfoid = to_regprocedure('public.kdk_p1_score_guard()') then 'enabled'
                              when t.tgenabled = 'D' then 'disabled' else 'other_function' end
                    from pg_trigger t
                   where t.tgrelid = 'public.matches'::regclass and t.tgname = 'kdk_p1_score_guard_trg' and not t.tgisinternal), 'missing'),
        'enabled')
    ) x(name, val, expect)
  union all
  -- A2. can_manage_kdk 정의가 저장소(security_p1/30) 규칙과 같은지(정의 본문 핵심 문구 검사 — 본문 출력 없음)
  select 1, 'A 의존 객체', 'can_manage_kdk 정의 = CEO/ADMIN 또는 kdk_managers(+MEMBER/OPERATOR/FINANCE_MANAGER, 탈회 아님)',
         case when ok then 'match' else 'differs' end, 'match', case when ok then 'OK' else 'CHECK' end
    from (select d ilike '%(''CEO'', ''ADMIN'')%' and d ilike '%kdk_managers%'
                 and d ilike '%(''MEMBER'', ''OPERATOR'', ''FINANCE_MANAGER'')%' and d ilike '%kdk_actor_withdrawn%' as ok
            from (select coalesce(pg_get_functiondef(to_regprocedure('public.can_manage_kdk()')), '') as d) f0) f
  union all
  -- B. B1 함수가 아직 없어야 함(적용 전)
  select 2, 'B B1 함수(적용 전)', x.name, case when x.ok then 'exists' else 'absent' end, 'absent',
         case when x.ok then 'CHECK' else 'OK' end
    from (values
      ('kdk_can_return_court(text)',             to_regprocedure('public.kdk_can_return_court(text)') is not null),
      ('kdk_can_return_court() [초안]',           to_regprocedure('public.kdk_can_return_court()') is not null),
      ('return_kdk_match_to_waiting(text,text)', to_regprocedure('public.return_kdk_match_to_waiting(text,text)') is not null)
    ) x(name, ok)
  union all
  -- C. matches.started_at 컬럼(없어도 B1 동작 — 분기)
  select 3, 'C 컬럼', 'matches.started_at',
         case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'started_at') then 'yes' else 'no' end,
         'yes(없어도 동작)', 'OK'
  union all
  -- D. 직책별 상태(행 기준). B1부여대상 = 같은 클럽 + 계정 연결 + auth 존재 + 탈회 아님 + GUEST 아님
  select 4, 'D 직책별', p.p,
         format('rows=%s · 클럽내=%s · 연결=%s · auth존재=%s · 탈회=%s · GUEST=%s · B1부여대상=%s',
                count(g.member_id), count(*) filter (where g.in_club), count(*) filter (where g.in_club and g.linked),
                count(*) filter (where g.in_club and g.auth_exists), count(*) filter (where g.withdrawn),
                count(*) filter (where g.prole = 'GUEST'), count(*) filter (where g.granted)),
         '공석이면 rows=0',
         case when count(*) filter (where g.in_club and not g.linked and not g.withdrawn) > 0 then 'CHECK' else 'OK' end
    from pos p left join g on g.position = p.p
   group by p.p
  union all
  -- E. 이상 징후
  select 5, 'E 이상', '클럽 내 임원 직책인데 계정 미연결(탈회 제외)', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from g where in_club and not linked and not withdrawn
  union all
  select 5, 'E 이상', '연결 uid 가 auth.users 에 없음', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from g where linked and not auth_exists
  union all
  select 5, 'E 이상', '임원 직책 + 탈회 겸직(권한 없음)', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from g where withdrawn
  union all
  select 5, 'E 이상', '임원 직책인데 profiles.role = GUEST(권한 없음)', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from g where prole = 'GUEST'
  union all
  select 5, 'E 이상', '다른 클럽 소속 임원 직책 행', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from g where not in_club
  union all
  select 5, 'E 이상', '한 계정에 members 행 2개 이상 연결(임원)', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from (select m.auth_user_id from public.members m where m.auth_user_id::text in (select uid from g where uid is not null)
           group by m.auth_user_id having count(*) > 1) d
  union all
  select 5, 'E 이상', 'B1 부여 대상 중 profiles 행 없음', count(*)::text, '0', case when count(*) > 0 then 'CHECK' else 'OK' end
    from uid1 u where granted and not exists (select 1 from public.profiles pr where pr.id::text = u.uid)
  union all
  -- F. 적용 시점 판단
  select 6, 'F 경기 상태', '현재 playing 경기 수', count(*)::text, '0 권장(적용 시점)', case when count(*) > 0 then 'CHECK' else 'OK' end
    from public.matches where status::text = 'playing'
  union all
  -- G. 기존 코트 복귀 권한 근거(계정 단위) — B1 필요성 판정
  select 7, 'G 기존 권한 근거(계정 수)', substr(basis, 3), count(*)::text,
         case when basis like '3%' or basis like '4%' then '0이면 B1 불필요' else '정보' end,
         case when basis like '3%' or basis like '4%' then 'B1_NEEDED' else 'INFO' end
    from uid1 where granted group by basis
  union all
  select 7, 'G 판정', 'B1 부여 대상 계정 중 기존 복귀 권한이 없는 계정 수',
         count(*) filter (where basis like '3%' or basis like '4%')::text, '0 → B1 불필요 / 1 이상 → B1 필요',
         case when count(*) filter (where basis like '3%' or basis like '4%') = 0 then 'B1_NOT_NEEDED' else 'B1_NEEDED' end
    from uid1 where granted
  union all
  select 7, 'G 판정', 'B1 부여 대상 계정 수(고유)', count(*)::text, '임원 수(겸직 시 더 적음)', 'INFO' from uid1 where granted
) r
order by ord, section, item;
