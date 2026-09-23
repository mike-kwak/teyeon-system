-- =============================================================================
-- VERIFY — add_hosted_tournament_waitlist_integrity.sql 적용 확인 (읽기 전용)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL 없음.
--     공개 조회 RPC(STABLE)는 반환 키 화이트리스트 확인에만 호출한다(값 미출력).
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
    select p.oid, p.prosecdef, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'promote_waitlisted_tournament_registration'
),
pubt as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_public_tournament_teams'
),
adm as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_admin_tournament_registrations'
),
admteam as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'get_admin_tournament_teams'
),
upteam as (
    select pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'update_tournament_team'
),
allfn as (   -- 대기 순번을 계산하는 다른 함수가 남아 있는지 전수 검사용
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
),
team_keys as (
    select distinct k
      from jsonb_array_elements(coalesce(public.get_public_tournament_teams('2026-teyeon-open'), '[]'::jsonb)) e,
           jsonb_object_keys(e) k
),
pub_keys as (
    select k from jsonb_object_keys(coalesce(public.get_public_tournament('2026-teyeon-open'), '{}'::jsonb)) k
),
regs as (
    select r.* from public.hosted_tournament_registrations r
      join public.hosted_tournaments t on t.id = r.tournament_id
     where t.slug = '2026-teyeon-open'
),
sig_submit as (select 'public.submit_tournament_registration(text,text,text,text,text,text,text,text,boolean,boolean,boolean,boolean,text,text)'::text as s),
checks as (

-- ── A. 스키마 ─────────────────────────────────────────────────────────────
select 1 as seq, 'A. registrations.waitlisted_at (timestamptz · nullable)' as check_name, 'timestamp with time zone|YES' as expected,
       coalesce((select data_type || '|' || is_nullable from information_schema.columns
                  where table_schema = 'public' and table_name = 'hosted_tournament_registrations'
                    and column_name = 'waitlisted_at'), '(none)') as actual
union all select 2, 'A. teams.withdrawn_reason (text · nullable)', 'text|YES',
       coalesce((select data_type || '|' || is_nullable from information_schema.columns
                  where table_schema = 'public' and table_name = 'hosted_tournament_teams'
                    and column_name = 'withdrawn_reason'), '(none)')
union all select 3, 'A. withdrawn_reason CHECK (허용값 2종 + status=withdrawn)', 'true',
       coalesce((select (pg_get_constraintdef(oid) like '%registration_cancelled%'
                         and pg_get_constraintdef(oid) like '%manual%'
                         and pg_get_constraintdef(oid) like '%withdrawn%')::text
                   from pg_constraint where conname = 'hosted_tteam_withdrawn_reason_check'), '(none)')
union all select 4, 'A. 대기열 부분 인덱스', 'true',
       coalesce((select (indexdef like '%waitlisted_at%' and indexdef like '%sequence_no%'
                         and indexdef like '%waitlisted%')::text
                   from pg_indexes where schemaname = 'public'
                    and indexname = 'hosted_treg_waitlist_order_idx'), '(none)')
union all select 5, 'A. waitlist_order 같은 정수 순번 컬럼 없음', '0',
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'hosted_tournament_registrations'
           and column_name in ('waitlist_order', 'waitlist_no', 'waitlist_position'))
union all select 6, 'A. registration_no / sequence_no UNIQUE 유지', '2',
       (select count(*)::text from pg_constraint
         where conname in ('hosted_treg_seq_unique', 'hosted_treg_no_unique') and contype = 'u')
union all select 7, 'A. 팀 승격 멱등 인덱스 유지', '1',
       (select count(*)::text from pg_indexes where schemaname = 'public'
         and indexname = 'hosted_tteam_registration_uniq')

-- ── B. submit ─────────────────────────────────────────────────────────────
union all select 10, 'B. submit 14인자 시그니처 · default 2 유지', 'true|2',
       (to_regprocedure((select s from sig_submit)) is not null)::text || '|'
       || coalesce((select pronargdefaults::text from sub), '?')
union all select 11, 'B. submit 대기 저장 시 waitlisted_at = clock_timestamp()', 'true',
       coalesce((select (body like '%when v_status = ''waitlisted'' then clock_timestamp()%')::text from sub), '(none)')
union all select 12, 'B. submit 판정 불변(정상 < max 이고 대기 0)', 'true',
       coalesce((select (body like '%v_normal < v_t.max_capacity and v_waiting = 0%')::text from sub), '(none)')
union all select 13, 'B. submit 에 정원 차단(TOURNAMENT_FULL) 없음', 'false',
       coalesce((select (body like '%TOURNAMENT_FULL%')::text from sub), '(none)')
union all select 14, 'B. submit SECURITY DEFINER + search_path', 'true',
       coalesce((select (prosecdef and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%')::text from sub), '(none)')
union all select 15, 'B. submit anon/authenticated EXECUTE 없음', 'false|false',
       has_function_privilege('anon', (select s from sig_submit), 'EXECUTE')::text || '|'
       || has_function_privilege('authenticated', (select s from sig_submit), 'EXECUTE')::text

-- ── C. set_status — 대기 시각 + 팀 동기화 ────────────────────────────────
union all select 20, 'C. 대기 진입 시 waitlisted_at = clock_timestamp()', 'true',
       coalesce((select (body like '%p_registration_status = ''waitlisted''%then clock_timestamp()%')::text from sts), '(none)')
union all select 21, 'C. 대기 이탈 시 waitlisted_at = null', 'true',
       coalesce((select (body like '%waitlisted_at       = case when%then null%')::text from sts), '(none)')
union all select 22, 'C. updated_at 을 대기 순서로 쓰지 않음(정렬식 없음)', 'false',
       coalesce((select (body like '%order by%updated_at%')::text from sts), '(none)')
union all select 23, 'C. 잠금 순서 = registration → teams', 'true',
       coalesce((select (strpos(body, 'hosted-tournament-registration:') > 0
                         and strpos(body, 'hosted-tournament-teams:') > 0
                         and strpos(body, 'hosted-tournament-registration:') < strpos(body, 'hosted-tournament-teams:'))::text
                   from sts), '(none)')
union all select 24, 'C. 취소·거절 → 자동 기권(registration_cancelled)', 'true',
       coalesce((select (body like '%''withdrawn'', withdrawn_reason = ''registration_cancelled''%')::text from sts), '(none)')
union all select 25, 'C. 조/경기 사용 팀은 자동 변경 금지(blocked_in_use)', 'true',
       coalesce((select (body like '%hosted_tournament_group_members%'
                         and body like '%hosted_tournament_matches%'
                         and body like '%blocked_in_use%')::text from sts), '(none)')
union all select 26, 'C. 복구는 registration_cancelled 인 팀만(manual 보호)', 'true',
       coalesce((select (body like '%v_team_reason = ''registration_cancelled''%'
                         and body like '%blocked_manual%')::text from sts), '(none)')
union all select 27, 'C. 팀 행 삭제 없음', 'false',
       coalesce((select (body like '%delete from public.hosted_tournament_teams%')::text from sts), '(none)')
union all select 28, 'C. team_no / team id 변경 없음', 'false',
       coalesce((select (body like '%set team_no%' or body like '%team_no =%')::text from sts), '(none)')
union all select 29, 'C. 정상 슬롯 가드 · 입금 전이 matrix 유지', 'true',
       coalesce((select (body like '%NORMAL_CAPACITY_FULL%'
                         and body like '%INVALID_PAYMENT_TRANSITION%')::text from sts), '(none)')
union all select 30, 'C. set_status anon 없음 / authenticated 있음', 'false|true',
       has_function_privilege('anon', 'public.set_tournament_registration_status(uuid,text,text,text)', 'EXECUTE')::text || '|'
       || has_function_privilege('authenticated', 'public.set_tournament_registration_status(uuid,text,text,text)', 'EXECUTE')::text

-- ── D. promote ────────────────────────────────────────────────────────────
union all select 40, 'D. 승격 시 waitlisted_at 해제', 'true',
       coalesce((select (body like '%waitlisted_at       = null%')::text from pro), '(none)')
union all select 41, 'D. 대기 순번을 waitlisted_at 기준으로 계산', 'true',
       coalesce((select (body like '%coalesce(r.waitlisted_at, r.submitted_at)%')::text from pro), '(none)')
union all select 42, 'D. 정원 차단 · 예외 사유 필수 유지', 'true',
       coalesce((select (body like '%NORMAL_CAPACITY_FULL%'
                         and body like '%PROMOTION_REASON_REQUIRED%'
                         and body like '%NOT_WAITLISTED%')::text from pro), '(none)')
union all select 43, 'D. payment_status 를 바꾸지 않음', 'false',
       coalesce((select (body ~ 'set[^;]*payment_status\s*=')::text from pro), '(none)')
union all select 44, 'D. promote anon 없음 / authenticated 있음', 'false|true',
       coalesce(has_function_privilege('anon', to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)'), 'EXECUTE')::text, '?') || '|'
       || coalesce(has_function_privilege('authenticated', to_regprocedure('public.promote_waitlisted_tournament_registration(uuid,text)'), 'EXECUTE')::text, '?')

-- ── E. 조회 RPC 대기 순번 ─────────────────────────────────────────────────
union all select 50, 'E. 공개 참가팀: waitlisted_at 기준 정렬', 'true',
       coalesce((select (body like '%order by coalesce(r.waitlisted_at, r.submitted_at)%')::text from pubt), '(none)')
union all select 51, 'E. 공개 참가팀: waitlisted_at 원본 미반환', 'false',
       coalesce((select (body like '%''waitlistedAt''%')::text from pubt), '(none)')
union all select 52, 'E. Admin 목록: waitlisted_at 기준 정렬 + waitlistedAt 제공', 'true',
       coalesce((select (body like '%order by coalesce(r.waitlisted_at, r.submitted_at)%'
                         and body like '%''waitlistedAt''%')::text from adm), '(none)')
union all select 53, 'E. 대기 순번을 sequence_no 만으로 계산하는 함수 0개', '0',
       (select count(*)::text from allfn
         where body like '%registration_status = ''waitlisted''%'
           and body like '%row_number() over%'
           and body not like '%coalesce(r.waitlisted_at, r.submitted_at)%')
union all select 54, 'E. legacy fallback(coalesce) 존재 — rollback · 구버전 행 보호', '2',
       (select count(*)::text from allfn
         where body like '%coalesce(r.waitlisted_at, r.submitted_at)%'
           and proname in ('get_public_tournament_teams', 'get_admin_tournament_registrations'))

-- ── F. Team RPC ───────────────────────────────────────────────────────────
union all select 60, 'F. Admin 팀 목록: withdrawnReason · registrationId 제공', 'true',
       coalesce((select (body like '%''withdrawnReason''%' and body like '%''registrationId''%')::text from admteam), '(none)')
union all select 61, 'F. Admin 팀 목록 anon EXECUTE 없음', 'false',
       has_function_privilege('anon', 'public.get_admin_tournament_teams(text)', 'EXECUTE')::text
union all select 62, 'F. 수동 기권 → manual · 수동 복구 → NULL', 'true',
       coalesce((select (body like '%when p_status = ''withdrawn'' then ''manual''%'
                         and body like '%when p_status = ''active'' then null%')::text from upteam), '(none)')
union all select 63, 'F. 팀 수정 RPC anon 없음 / authenticated 있음', 'false|true',
       has_function_privilege('anon', 'public.update_tournament_team(uuid,integer,integer,text,boolean)', 'EXECUTE')::text || '|'
       || has_function_privilege('authenticated', 'public.update_tournament_team(uuid,integer,integer,text,boolean)', 'EXECUTE')::text
union all select 64, 'F. 승격 RPC(promote_confirmed_registrations)는 INSERT 전용 유지', 'false',
       coalesce((select (body like '%update public.hosted_tournament_teams%'
                         or body like '%delete from public.hosted_tournament_teams%')::text
                   from allfn where proname = 'promote_confirmed_registrations'), '(none)')

-- ── G. 공개 페이로드 · 권한 ───────────────────────────────────────────────
union all select 70, 'G. 공개 참가팀 키 화이트리스트(withdrawnReason·waitlistedAt 없음)', '0',
       (select count(*)::text from team_keys where k not in (
            'sequenceNo','player1Name','player2Name','clubName','player1ClubName','player2ClubName',
            'publicStatus','waitlistPosition'))
union all select 71, 'G. 공개 대회 RPC 키 화이트리스트', '0',
       (select count(*)::text from pub_keys where k not in (
            'slug','title','subtitle','status','eventDate','eventStartTime','registrationOpenAt',
            'registrationCloseAt','venueName','organizerName','sponsorName','entryFee',
            'targetCapacity','maxCapacity','appliedCount','normalCount','waitlistedCount','remaining',
            'nextRegistrationWaitlisted','bankName','bankAccount','bankHolder','isRegistrationOpen'))
union all select 72, 'G. anon raw 테이블 접근 없음(registrations · teams)', 'false',
       (has_table_privilege('anon', 'public.hosted_tournament_registrations', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.hosted_tournament_teams', 'SELECT,INSERT,UPDATE,DELETE'))::text
union all select 73, 'G. authenticated 쓰기 권한 없음(registrations · teams)', 'false',
       (has_table_privilege('authenticated', 'public.hosted_tournament_registrations', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.hosted_tournament_teams', 'INSERT,UPDATE,DELETE'))::text
union all select 74, 'G. RLS 활성(registrations · teams · history · tournaments)', '4',
       (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relrowsecurity
           and c.relname in ('hosted_tournaments', 'hosted_tournament_registrations',
                             'hosted_tournament_registration_history', 'hosted_tournament_teams'))

-- ── H. 운영 데이터(읽기 전용 · 개인정보 없음) ─────────────────────────────
union all select 80, 'H. 대기 중인데 waitlisted_at 이 비어 있는 행 0', '0',
       (select count(*)::text from regs where registration_status = 'waitlisted' and waitlisted_at is null)
union all select 81, 'H. 대기가 아닌데 waitlisted_at 이 남아 있는 행 0', '0',
       (select count(*)::text from regs where registration_status <> 'waitlisted' and waitlisted_at is not null)
union all select 82, 'H. active 인데 기권 사유가 남은 팀 0', '0',
       (select count(*)::text from public.hosted_tournament_teams
         where status = 'active' and withdrawn_reason is not null)
)
select seq, check_name, expected, actual, (expected = actual) as pass
  from checks
union all
select 999, (case when bool_and(expected = actual) then 'ALL PASS' else 'FAIL 있음' end)
            || ' · ' || count(*) filter (where expected = actual) || '/' || count(*),
       '', '', bool_and(expected = actual)
  from checks
 order by seq;
