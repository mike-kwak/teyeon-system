-- =============================================================================
-- VERIFY — add_hosted_tournament_waitlist_policy.sql 적용 확인 (읽기 전용)
--
--   ⚠ 이 파일은 SELECT 하나다. INSERT / UPDATE / DELETE / DDL 이 없다.
--     공개 조회 RPC(get_public_tournament · get_public_tournament_teams)는 STABLE 이며
--     반환 키 화이트리스트 확인에만 호출한다(값은 출력하지 않는다).
--   기대: 모든 행 pass = true, 마지막 행 'ALL PASS'.
-- =============================================================================

with
sub as (
    select p.oid, p.prosecdef, p.proconfig, p.pronargdefaults, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'submit_tournament_registration'
),
sts as (
    select p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'set_tournament_registration_status'
),
pro as (
    select p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'promote_waitlisted_tournament_registration'
),
pub as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_public_tournament'
),
adm as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_admin_tournament_registrations'
),
admt as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_admin_hosted_tournaments'
),
pub_keys as (
    select k from jsonb_object_keys(coalesce(public.get_public_tournament('2026-teyeon-open'), '{}'::jsonb)) k
),
team_keys as (
    select distinct k
      from jsonb_array_elements(coalesce(public.get_public_tournament_teams('2026-teyeon-open'), '[]'::jsonb)) e,
           jsonb_object_keys(e) k
),
regs as (
    select r.* from public.hosted_tournament_registrations r
      join public.hosted_tournaments t on t.id = r.tournament_id
     where t.slug = '2026-teyeon-open'
),
sig_submit as (select 'public.submit_tournament_registration(text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text)'::text as s),
checks as (

-- ── A. submit_tournament_registration ─────────────────────────────────────
select 1 as seq, 'A. submit 함수가 1개(오버로드 없음)' as check_name, '1' as expected,
       (select count(*)::text from sub) as actual
union all select 2, 'A. submit 14인자 시그니처 그대로', 'true',
       (to_regprocedure((select s from sig_submit)) is not null)::text
union all select 3, 'A. submit default 인자 2개 유지', '2',
       coalesce((select pronargdefaults::text from sub), '(none)')
union all select 4, 'A. submit SECURITY DEFINER + search_path 고정', 'true',
       coalesce((select (prosecdef and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%')::text from sub), '(none)')
union all select 5, 'A. submit 에 TOURNAMENT_FULL 없음(정원으로 신청을 막지 않음)', 'false',
       coalesce((select (body like '%TOURNAMENT_FULL%')::text from sub), '(none)')
union all select 6, 'A. submit 판정 = 정상 < max 그리고 대기 0 일 때만 applied', 'true',
       coalesce((select (body like '%v_normal < v_t.max_capacity and v_waiting = 0%')::text from sub), '(none)')
union all select 7, 'A. submit 정상 슬롯 = applied + confirmed', 'true',
       coalesce((select (body like '%filter (where r.registration_status in (''applied'', ''confirmed''))%')::text from sub), '(none)')
union all select 8, 'A. submit 판정에 target_capacity 미사용', 'false',
       coalesce((select (body like '%target_capacity%')::text from sub), '(none)')
union all select 9, 'A. submit advisory lock 이 집계보다 먼저', 'true',
       coalesce((select (strpos(body, 'pg_advisory_xact_lock(hashtext(''hosted-tournament-registration:''') > 0
                         and strpos(body, 'pg_advisory_xact_lock') < strpos(body, 'into v_normal, v_waiting'))::text from sub), '(none)')
union all select 10, 'A. submit 계좌는 applied 응답에만', 'true',
       coalesce((select (body like '%when v_status = ''applied'' then jsonb_build_object(%'
                         and body like '%''bankAccount'', v_t.bank_account%')::text from sub), '(none)')
union all select 11, 'A. submit 응답 waitlistPosition', 'true',
       coalesce((select (body like '%''waitlistPosition''%')::text from sub), '(none)')
union all select 12, 'A. submit 중복 pair 차단 유지', 'true',
       coalesce((select (body like '%DUPLICATE_REGISTRATION%')::text from sub), '(none)')
union all select 13, 'A. submit 순번 max+1 유지', 'true',
       coalesce((select (body like '%coalesce(max(r.sequence_no), 0) + 1%')::text from sub), '(none)')
union all select 14, 'A. submit 이력(submit) 기록 유지', 'true',
       coalesce((select (body like '%''submit'', null, v_status, ''public''%')::text from sub), '(none)')
union all select 15, 'A. submit anon EXECUTE 없음', 'false',
       has_function_privilege('anon', (select s from sig_submit), 'EXECUTE')::text
union all select 16, 'A. submit authenticated EXECUTE 없음', 'false',
       has_function_privilege('authenticated', (select s from sig_submit), 'EXECUTE')::text
union all select 17, 'A. submit PUBLIC EXECUTE 없음', 'false',
       coalesce((select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                                 where p.oid = sub.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE')::text from sub), '(none)')

-- ── B. set_tournament_registration_status ─────────────────────────────────
union all select 20, 'B. set_status 함수가 1개(오버로드 없음)', '1',
       (select count(*)::text from sts)
union all select 21, 'B. set_status NORMAL_CAPACITY_FULL 가드', 'true',
       coalesce((select (body like '%NORMAL_CAPACITY_FULL%'
                         and body like '%if v_will_normal and not v_was_normal then%')::text from sts), '(none)')
union all select 22, 'B. set_status 에 TOURNAMENT_FULL 없음', 'false',
       coalesce((select (body like '%TOURNAMENT_FULL%')::text from sts), '(none)')
union all select 23, 'B. set_status advisory lock 이 정원 집계보다 먼저', 'true',
       coalesce((select (strpos(body, 'pg_advisory_xact_lock') > 0
                         and strpos(body, 'pg_advisory_xact_lock') < strpos(body, 'into v_normal'))::text from sts), '(none)')
union all select 24, 'B. set_status 입금 전이 matrix 유지', 'true',
       coalesce((select (body like '%INVALID_PAYMENT_TRANSITION%'
                         and body like '%(v_r.payment_status = ''refund_pending'' and p_payment_status in (''paid'', ''refunded''))%')::text from sts), '(none)')
union all select 25, 'B. set_status 비활성→활성 중복 pair 차단 유지', 'true',
       coalesce((select (body like '%if v_will_active and not v_was_active then%'
                         and body like '%DUPLICATE_REGISTRATION%')::text from sts), '(none)')
union all select 26, 'B. set_status SECURITY DEFINER + search_path', 'true',
       coalesce((select (prosecdef and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%')::text from sts), '(none)')
union all select 27, 'B. set_status anon EXECUTE 없음', 'false',
       has_function_privilege('anon', 'public.set_tournament_registration_status(uuid,text,text,text)', 'EXECUTE')::text
union all select 28, 'B. set_status authenticated EXECUTE 있음(내부 CEO/ADMIN 검사)', 'true',
       has_function_privilege('authenticated', 'public.set_tournament_registration_status(uuid,text,text,text)', 'EXECUTE')::text

-- ── C. promote_waitlisted_tournament_registration ─────────────────────────
union all select 30, 'C. promote 함수 존재(1개)', '1',
       (select count(*)::text from pro)
union all select 31, 'C. promote SECURITY DEFINER + search_path', 'true',
       coalesce((select (prosecdef and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%')::text from pro), '(none)')
union all select 32, 'C. promote CEO/ADMIN 검사', 'true',
       coalesce((select (body like '%can_manage_tournaments()%' and body like '%FORBIDDEN%')::text from pro), '(none)')
union all select 33, 'C. promote advisory lock 이 집계보다 먼저(같은 키)', 'true',
       coalesce((select (strpos(body, 'pg_advisory_xact_lock(hashtext(''hosted-tournament-registration:''') > 0
                         and strpos(body, 'pg_advisory_xact_lock') < strpos(body, 'into v_normal, v_waiting, v_pos'))::text from pro), '(none)')
union all select 34, 'C. promote 정원 차단 + 예외 사유 필수', 'true',
       coalesce((select (body like '%NORMAL_CAPACITY_FULL%' and body like '%PROMOTION_REASON_REQUIRED%'
                         and body like '%NOT_WAITLISTED%')::text from pro), '(none)')
union all select 35, 'C. promote 이력 note 기록', 'true',
       coalesce((select (body like '%actor_user_id, actor_type, note)%')::text from pro), '(none)')
union all select 36, 'C. promote payment_status 를 바꾸지 않음', 'false',
       coalesce((select (body ~ 'set\s+payment_status' or body like '%payment_status =%')::text from pro), '(none)')
union all select 37, 'C. promote anon EXECUTE 없음', 'false',
       coalesce(has_function_privilege('anon', to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)'), 'EXECUTE')::text, '(none)')
union all select 38, 'C. promote authenticated EXECUTE 있음', 'true',
       coalesce(has_function_privilege('authenticated', to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)'), 'EXECUTE')::text, '(none)')

-- ── D. 공개 RPC ───────────────────────────────────────────────────────────
union all select 40, 'D. get_public_tournament anon EXECUTE 유지', 'true',
       has_function_privilege('anon', 'public.get_public_tournament(text)', 'EXECUTE')::text
union all select 41, 'D. isRegistrationOpen 에 정원 조건 없음', 'false',
       coalesce((select (body like '%v_active < v_t.max_capacity%' or body like '%v_normal < v_t.max_capacity%')::text from pub), '(none)')
union all select 42, 'D. get_public_tournament normalCount / nextRegistrationWaitlisted', 'true',
       coalesce((select (body like '%''normalCount''%' and body like '%''nextRegistrationWaitlisted''%')::text from pub), '(none)')
union all select 43, 'D. get_public_tournament 반환 키 화이트리스트 밖 0개', '0',
       (select count(*)::text from pub_keys where k not in (
            'slug','title','subtitle','status','eventDate','eventStartTime','registrationOpenAt',
            'registrationCloseAt','venueName','organizerName','sponsorName','entryFee',
            'targetCapacity','maxCapacity','appliedCount','normalCount','waitlistedCount','remaining',
            'nextRegistrationWaitlisted','bankName','bankAccount','bankHolder','isRegistrationOpen'))
union all select 44, 'D. get_public_tournament_teams anon EXECUTE 유지', 'true',
       has_function_privilege('anon', 'public.get_public_tournament_teams(text)', 'EXECUTE')::text
union all select 45, 'D. get_public_tournament_teams 반환 키 화이트리스트 밖 0개', '0',
       (select count(*)::text from team_keys where k not in (
            'sequenceNo','player1Name','player2Name','clubName','player1ClubName','player2ClubName',
            'publicStatus','waitlistPosition'))

-- ── E. 운영 RPC ───────────────────────────────────────────────────────────
union all select 50, 'E. admin 목록 waitlistPosition', 'true',
       coalesce((select (body like '%''waitlistPosition''%' and body like '%FORBIDDEN%')::text from adm), '(none)')
union all select 51, 'E. admin 목록 anon EXECUTE 없음', 'false',
       has_function_privilege('anon', 'public.get_admin_tournament_registrations(text)', 'EXECUTE')::text
union all select 52, 'E. admin 대회 목록 normalCount', 'true',
       coalesce((select (body like '%''normalCount''%' and body like '%FORBIDDEN%')::text from admt), '(none)')
union all select 53, 'E. admin 대회 목록 anon EXECUTE 없음', 'false',
       has_function_privilege('anon', 'public.get_admin_hosted_tournaments()', 'EXECUTE')::text

-- ── F. raw table · RLS · 제약 (변경 없음 확인) ─────────────────────────────
union all select 60, 'F. anon raw 권한 0 (3개 테이블 · SELECT/INSERT/UPDATE/DELETE)', 'false',
       (has_table_privilege('anon', 'public.hosted_tournament_registrations', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.hosted_tournaments', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.hosted_tournament_registration_history', 'SELECT,INSERT,UPDATE,DELETE'))::text
union all select 61, 'F. authenticated 쓰기 권한 0 (3개 테이블)', 'false',
       (has_table_privilege('authenticated', 'public.hosted_tournament_registrations', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.hosted_tournaments', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.hosted_tournament_registration_history', 'INSERT,UPDATE,DELETE'))::text
union all select 62, 'F. RLS 활성 (3개 테이블)', '3',
       (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relrowsecurity
           and c.relname in ('hosted_tournaments', 'hosted_tournament_registrations', 'hosted_tournament_registration_history'))
union all select 63, 'F. sequence_no / registration_no UNIQUE 유지', '2',
       (select count(*)::text from pg_constraint
         where conname in ('hosted_treg_seq_unique', 'hosted_treg_no_unique') and contype = 'u')
union all select 64, 'F. 활성 pair partial unique index 유지', '1',
       (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'hosted_treg_active_pair')
union all select 65, 'F. registration_status CHECK 5종 그대로', 'true',
       (select (count(*) = 1)::text from pg_constraint c
         where c.conrelid = 'public.hosted_tournament_registrations'::regclass and c.contype = 'c'
           and pg_get_constraintdef(c.oid) like '%applied%waitlisted%confirmed%cancelled%rejected%')
union all select 66, 'F. waitlist 전용 컬럼을 만들지 않음', '0',
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'hosted_tournament_registrations'
           and column_name like '%waitlist%')

-- ── G. Production 데이터 (읽기 전용 집계 · 개인정보 없음) ────────────────────
union all select 70, 'G. 2026-teyeon-open 접수번호 중복 0', '0',
       (select (count(*) - count(distinct registration_no))::text from regs)
union all select 71, 'G. 2026-teyeon-open 정상 슬롯 ≤ max_capacity', 'true',
       (select (count(*) filter (where registration_status in ('applied', 'confirmed'))
                <= (select max_capacity from public.hosted_tournaments where slug = '2026-teyeon-open'))::text from regs)
)
select seq, check_name, expected, actual, (expected = actual) as pass
  from checks
union all
select 999, (case when bool_and(expected = actual) then 'ALL PASS' else 'FAIL 있음' end)
            || ' · ' || count(*) filter (where expected = actual) || '/' || count(*),
       '', '', bool_and(expected = actual)
  from checks
 order by seq;

-- 참고(개인정보 없음): 적용 전후 비교용 상태 분포
-- select registration_status, payment_status, count(*) from public.hosted_tournament_registrations r
--   join public.hosted_tournaments t on t.id = r.tournament_id
--  where t.slug = '2026-teyeon-open' group by 1, 2 order by 1, 2;
