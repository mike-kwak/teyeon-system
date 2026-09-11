-- =============================================================================
-- VERIFY — add_hosted_tournament_player_change.sql 적용 직후 1회 실행.
--
--   읽기 전용이다. 어떤 데이터도 변경하지 않는다.
--   verdict 에 FAIL 이 하나라도 있으면 Admin '선수 정보 변경' 기능을 쓰지 말 것.
--
--   사용법: Supabase SQL Editor 에 전체를 붙여넣고 실행 → 결과 표를 그대로 복사해 공유.
-- =============================================================================

with checks as (

-- ── A. 스키마: 컬럼이 늘지 않았는가 ──────────────────────────────────────────
select 1 as seq, 'A. registrations 컬럼 26개(신규 컬럼 없음)' as check_name, '26' as expected,
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registrations') as actual

union all select 2, 'A. history 컬럼 9개(신규 컬럼 없음)', '9',
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registration_history')

-- ── B. history.action CHECK 확장 ─────────────────────────────────────────────
union all select 3, 'B. action CHECK 에 기존 4종 유지', 'true',
       (select (pg_get_constraintdef(con.oid) like '%submit%'
                and pg_get_constraintdef(con.oid) like '%registration_status%'
                and pg_get_constraintdef(con.oid) like '%payment_status%'
                and pg_get_constraintdef(con.oid) like '%admin_note%')::text
          from pg_constraint con join pg_class c on c.oid=con.conrelid
         where c.relname='hosted_tournament_registration_history' and con.contype='c'
           and con.conkey = array[(select a.attnum from pg_attribute a
                                    where a.attrelid=c.oid and a.attname='action')])

union all select 4, 'B. action CHECK 에 신규 6종 추가', 'true',
       (select (pg_get_constraintdef(con.oid) like '%player1_name%'
                and pg_get_constraintdef(con.oid) like '%player1_phone%'
                and pg_get_constraintdef(con.oid) like '%player2_name%'
                and pg_get_constraintdef(con.oid) like '%player2_phone%'
                and pg_get_constraintdef(con.oid) like '%club_name%'
                and pg_get_constraintdef(con.oid) like '%depositor_name%')::text
          from pg_constraint con join pg_class c on c.oid=con.conrelid
         where c.relname='hosted_tournament_registration_history' and con.contype='c'
           and con.conkey = array[(select a.attnum from pg_attribute a
                                    where a.attrelid=c.oid and a.attname='action')])

union all select 5, 'B. action CHECK 은 정확히 1개', '1',
       (select count(*)::text from pg_constraint con join pg_class c on c.oid=con.conrelid
         where c.relname='hosted_tournament_registration_history' and con.contype='c'
           and con.conkey = array[(select a.attnum from pg_attribute a
                                    where a.attrelid=c.oid and a.attname='action')])

-- ── C. 신규 함수 존재 / SECURITY DEFINER / search_path ───────────────────────
union all select 6, 'C. 신규 함수 2종 존재', '2',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public'
           and p.proname in ('set_tournament_registration_players','hosted_tournament_mask_phone'))

union all select 7, 'C. set_..._players 는 SECURITY DEFINER', 'true',
       coalesce((select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_players'), '(none)')

union all select 8, 'C. mask_phone 은 SECURITY DEFINER 아님', 'false',
       coalesce((select p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='hosted_tournament_mask_phone'), '(none)')

union all select 9, 'C. 신규 함수 2종 search_path 고정', '2',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public'
           and p.proname in ('set_tournament_registration_players','hosted_tournament_mask_phone')
           and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%')

-- ── D. 권한 ──────────────────────────────────────────────────────────────────
union all select 10, 'D. anon 은 신규 RPC 실행 불가', 'false',
       coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_players'), '(none)')

union all select 11, 'D. authenticated 는 신규 RPC 실행 가능', 'true',
       coalesce((select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_players'), '(none)')

union all select 12, 'D. mask_phone 은 anon/authenticated 모두 실행 불가', '0',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='hosted_tournament_mask_phone'
           and (has_function_privilege('anon', p.oid, 'EXECUTE')
                or has_function_privilege('authenticated', p.oid, 'EXECUTE')))

-- PUBLIC 은 has_function_privilege() 에 role 이름으로 넘길 수 없으므로 ACL 을 직접 편다(grantee 0 = PUBLIC).
union all select 13, 'D. PUBLIC 에 신규 RPC EXECUTE 없음', '0',
       (select count(*)::text
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where n.nspname='public' and p.proname='set_tournament_registration_players'
           and a.grantee = 0 and a.privilege_type = 'EXECUTE')

-- ── E. 기존 자산 무변경 ──────────────────────────────────────────────────────
union all select 14, 'E. 기존 RPC 7종 그대로 존재', '7',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname in
               ('get_public_tournament','get_public_tournament_teams','submit_tournament_registration',
                'get_admin_hosted_tournaments','get_admin_tournament_registrations',
                'get_tournament_registration_history','set_tournament_registration_status'))

union all select 15, 'E. anon 실행 가능 함수는 여전히 공개 3종뿐',
       'get_public_tournament,get_public_tournament_teams,submit_tournament_registration',
       coalesce((select string_agg(p.proname, ',' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public'
                    and p.proname in ('get_public_tournament','get_public_tournament_teams',
                                      'submit_tournament_registration','get_admin_hosted_tournaments',
                                      'get_admin_tournament_registrations','get_tournament_registration_history',
                                      'set_tournament_registration_status','set_tournament_registration_players',
                                      'can_manage_tournaments','hosted_tournament_normalize_phone',
                                      'hosted_tournament_pair_key','hosted_tournament_mask_phone')
                    and has_function_privilege('anon', p.oid, 'EXECUTE')), '(none)')

union all select 16, 'E. 활성 페어 부분 unique index 유지', '1',
       (select count(*)::text from pg_indexes
         where schemaname='public' and indexname='hosted_treg_active_pair')

union all select 17, 'E. 순번/접수번호 unique 제약 유지', '2',
       (select count(*)::text from pg_constraint con join pg_class c on c.oid=con.conrelid
         where c.relname='hosted_tournament_registrations'
           and con.conname in ('hosted_treg_seq_unique','hosted_treg_no_unique'))

union all select 18, 'E. 동일번호 금지 CHECK 유지', '1',
       (select count(*)::text from pg_constraint con join pg_class c on c.oid=con.conrelid
         where c.relname='hosted_tournament_registrations'
           and con.conname='hosted_treg_distinct_phones')

-- ── F. 테이블 권한 (MVP 계약 유지) ───────────────────────────────────────────
union all select 19, 'F. anon 은 3개 테이블 어떤 권한도 없음', '0',
       (select count(*)::text from (select unnest(array[
                'public.hosted_tournaments','public.hosted_tournament_registrations',
                'public.hosted_tournament_registration_history']) as tbl) t
         where has_table_privilege('anon', tbl, 'SELECT') or has_table_privilege('anon', tbl, 'INSERT')
            or has_table_privilege('anon', tbl, 'UPDATE') or has_table_privilege('anon', tbl, 'DELETE'))

union all select 20, 'F. authenticated 쓰기 권한 없음', '0',
       (select count(*)::text from (select unnest(array[
                'public.hosted_tournaments','public.hosted_tournament_registrations',
                'public.hosted_tournament_registration_history']) as tbl) t
         where has_table_privilege('authenticated', tbl, 'INSERT')
            or has_table_privilege('authenticated', tbl, 'UPDATE')
            or has_table_privilege('authenticated', tbl, 'DELETE'))

-- ── G. 이력에 전화번호 원문이 없는가 (적용 후 상시 감시용) ───────────────────
union all select 21, 'G. player*_phone 이력에 원문 숫자 11자리 없음', '0',
       (select count(*)::text from public.hosted_tournament_registration_history
         where action in ('player1_phone','player2_phone')
           and (coalesce(from_value,'') ~ '[0-9]{7,}' or coalesce(to_value,'') ~ '[0-9]{7,}'))

union all select 22, 'G. player*_phone 이력은 전부 마스킹 형식', '0',
       (select count(*)::text from public.hosted_tournament_registration_history
         where action in ('player1_phone','player2_phone')
           and not (coalesce(to_value,'') ~ '^01[0-9]-\*\*\*\*-[0-9]{4}$'))

-- 운영진이 '변경 사유'에 전화번호를 그대로 적었는지 탐지한다.
--   ⚠ 탐지만 한다 — note 저장을 막는 DB 제약은 이번 범위가 아니다.
--   패턴은 01x + 3~4자리 + 4자리(구분자 유무 무관). 날짜(2026-10-25)·금액이 오탐되지 않도록 좁혔다.
--   FAIL 이면 해당 행을 찾아 운영진과 확인하고 note 를 정정할 것.
union all select 23, 'G. 이력 note 에 전화번호 원문 없음', '0',
       (select count(*)::text from public.hosted_tournament_registration_history
         where coalesce(note, '') ~ '01[0-9][^0-9]?[0-9]{3,4}[^0-9]?[0-9]{4}')

)
select seq, check_name, expected, actual,
       case when actual = expected then 'PASS' else 'FAIL' end as verdict
  from checks
 order by seq;


-- =============================================================================
-- 아래는 눈으로 확인하는 항목 (여전히 읽기 전용).
-- =============================================================================

-- 1) 신규 RPC 시그니처 확인.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('set_tournament_registration_players', 'hosted_tournament_mask_phone');

-- 2) action CHECK 전문.
select pg_get_constraintdef(con.oid) as action_check
  from pg_constraint con join pg_class c on c.oid = con.conrelid
 where c.relname = 'hosted_tournament_registration_history' and con.contype = 'c';

-- 3) 권한 없는 계정으로 호출하면 FORBIDDEN 이어야 한다.
--    ⚠ CEO/ADMIN 이 아닌 계정 세션에서 실행할 것. CEO/ADMIN 세션에서는
--       REGISTRATION_NOT_FOUND 가 나오는 것이 정상이다(둘 다 '데이터 변경 없음').
select public.set_tournament_registration_players(
    '00000000-0000-0000-0000-000000000000'::uuid,
    null, null, null, null, null, null, '권한 테스트', true);
-- 기대: ERROR FORBIDDEN (비관리자) 또는 ERROR REGISTRATION_NOT_FOUND (관리자)

-- 4) 사유 없이 호출하면 거부되어야 한다.
select public.set_tournament_registration_players(
    '00000000-0000-0000-0000-000000000000'::uuid,
    null, null, null, null, null, null, '   ', true);
-- 기대: ERROR REASON_REQUIRED (관리자 세션 기준)

-- 5) 참가자격 재확인 체크 없이 호출하면 거부되어야 한다.
select public.set_tournament_registration_players(
    '00000000-0000-0000-0000-000000000000'::uuid,
    null, null, null, null, null, null, '사유 있음', false);
-- 기대: ERROR ELIGIBILITY_RECHECK_REQUIRED (관리자 세션 기준)

-- 6) 접수 행이 그대로인지 최종 확인(접수 오픈 전이면 0).
select count(*) as registration_rows from public.hosted_tournament_registrations;
