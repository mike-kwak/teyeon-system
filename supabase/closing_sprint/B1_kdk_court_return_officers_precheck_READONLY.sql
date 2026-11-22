-- [CLOSING SPRINT B1] 적용 전/후 점검 — 조회 전용(쓰기 없음). 개인정보 원문을 출력하지 않는다(건수 · 존재 여부만).

-- 1) 의존 함수 존재(B1 이 호출하는 기존 함수)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_manage_kdk', 'kdk_actor_withdrawn', 'kdk_p1_result_recorded', 'start_kdk_match',
                     'kdk_can_return_court', 'return_kdk_match_to_waiting')
 order by p.proname;

-- 2) matches.started_at 컬럼 존재 여부(없어도 B1 은 동작 — 분기 처리)
select count(*) as has_started_at
  from information_schema.columns
 where table_schema = 'public' and table_name = 'matches' and column_name = 'started_at';

-- 3) 임원 직책 대상 인원(직책별 건수만 — 이름 미출력). 계정 미연결(auth_user_id null) · 탈회 겸직은 권한 없음.
select btrim(r.v) as position,
       count(*) as n_rows,
       count(*) filter (where m.auth_user_id is not null) as n_linked,
       count(*) filter (where exists (select 1 from unnest(string_to_array(coalesce(m.role::text, ''), ',')) w(x) where btrim(w.x) = '탈회')) as n_withdrawn
  from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v)
 where btrim(r.v) in ('회장', '부회장', '총무', '재무', '경기', '섭외')
 group by 1 order by 1;

-- 4) 적용 후: 실행 권한(anon 불가, authenticated 가능)
select routine_name, grantee, privilege_type
  from information_schema.routine_privileges
 where routine_schema = 'public'
   and routine_name in ('kdk_can_return_court', 'return_kdk_match_to_waiting')
 order by routine_name, grantee;

-- 5) 현재 진행 중 경기 수(적용 시점 판단용 — 진행 중 세션이 있으면 경기 없는 시간에 적용 권장)
select count(*) filter (where status = 'playing') as playing, count(*) filter (where status = 'waiting') as waiting
  from public.matches;
