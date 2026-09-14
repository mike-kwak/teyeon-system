-- =============================================================================
-- VERIFY — add_hosted_tournament_player_clubs.sql 적용 직후 1회 실행.
--   읽기 전용. 데이터를 변경하지 않고, 함수를 호출하지도 않는다.
--   ⚠ 실제 접수가 진행 중이므로 '접수 0건' 같은 기대값은 쓰지 않는다.
--   FAIL 이 하나라도 있으면 앱 배포를 진행하지 말 것.
-- =============================================================================

with checks as (

-- ── A. 컬럼 ──────────────────────────────────────────────────────────────────
select 1 as seq, 'A. 선수별 클럽 컬럼 2개 존재' as check_name, '2' as expected,
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registrations'
           and column_name in ('player1_club_name','player2_club_name')) as actual

union all select 2, 'A. 두 컬럼 모두 nullable', '2',
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registrations'
           and column_name in ('player1_club_name','player2_club_name') and is_nullable='YES')

union all select 3, 'A. legacy club_name 보존', '1',
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registrations'
           and column_name='club_name')

-- ── B. 기존 데이터 무변경 ────────────────────────────────────────────────────
--   backfill 하지 않았으므로, 적용 직후 시점엔 보정된 건이 0 이어야 한다.
--   ⚠ Admin 보정을 이미 시작했다면 이 두 항목은 자연히 늘어난다(그때는 FAIL 이 아님).
union all select 4, 'B. 적용 직후 player1 보정 0건', '0',
       (select count(player1_club_name)::text from public.hosted_tournament_registrations)

union all select 5, 'B. 적용 직후 player2 보정 0건', '0',
       (select count(player2_club_name)::text from public.hosted_tournament_registrations)

union all select 6, 'B. 접수번호 중복 없음(순번 무결)', '0',
       (select (count(*) - count(distinct registration_no))::text
          from public.hosted_tournament_registrations)

-- ── C. history CHECK 확장 ────────────────────────────────────────────────────
union all select 7, 'C. action CHECK 에 기존 10종 유지', 'true',
       coalesce((select (pg_get_constraintdef(con.oid) like '%submit%'
                         and pg_get_constraintdef(con.oid) like '%registration_status%'
                         and pg_get_constraintdef(con.oid) like '%payment_status%'
                         and pg_get_constraintdef(con.oid) like '%admin_note%'
                         and pg_get_constraintdef(con.oid) like '%player1_name%'
                         and pg_get_constraintdef(con.oid) like '%player1_phone%'
                         and pg_get_constraintdef(con.oid) like '%player2_name%'
                         and pg_get_constraintdef(con.oid) like '%player2_phone%'
                         and pg_get_constraintdef(con.oid) like '%''club_name''%'
                         and pg_get_constraintdef(con.oid) like '%depositor_name%')::text
                   from pg_constraint con join pg_class c on c.oid=con.conrelid
                  where c.relname='hosted_tournament_registration_history' and con.contype='c'
                    and con.conkey = array[(select a.attnum from pg_attribute a
                                             where a.attrelid=c.oid and a.attname='action')]), '(none)')

union all select 8, 'C. action CHECK 에 선수별 클럽 2종 추가', 'true',
       coalesce((select (pg_get_constraintdef(con.oid) like '%player1_club_name%'
                         and pg_get_constraintdef(con.oid) like '%player2_club_name%')::text
                   from pg_constraint con join pg_class c on c.oid=con.conrelid
                  where c.relname='hosted_tournament_registration_history' and con.contype='c'
                    and con.conkey = array[(select a.attnum from pg_attribute a
                                             where a.attrelid=c.oid and a.attname='action')]), '(none)')

union all select 9, 'C. action CHECK 은 정확히 1개', '1',
       (select count(*)::text from pg_constraint con join pg_class c on c.oid=con.conrelid
         where c.relname='hosted_tournament_registration_history' and con.contype='c'
           and con.conkey = array[(select a.attnum from pg_attribute a
                                    where a.attrelid=c.oid and a.attname='action')])

-- ── D. 함수 시그니처 (무중단 핵심) ───────────────────────────────────────────
union all select 10, 'D. submit 14인자 1개만 존재', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='submit_tournament_registration')

union all select 11, 'D. submit 인자 14개', '14',
       coalesce((select p.pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 12, 'D. submit 기본값 2개(구버전 12인자 호출 호환)', '2',
       coalesce((select p.pronargdefaults::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 13, 'D. set_players 11인자 1개만 존재', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='set_tournament_registration_players')

union all select 14, 'D. set_players 기본값 2개', '2',
       coalesce((select p.pronargdefaults::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_players'), '(none)')

-- ── E. 보안 — 재생성으로 되살아난 기본 권한이 다시 회수됐는가 (최우선) ───────
union all select 15, 'E. anon submit EXECUTE 불가', 'false',
       coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 16, 'E. authenticated submit EXECUTE 불가', 'false',
       coalesce((select has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 17, 'E. PUBLIC submit EXECUTE 없음', '0',
       (select count(*)::text from pg_proc p
          join pg_namespace n on n.oid=p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where n.nspname='public' and p.proname='submit_tournament_registration'
           and a.grantee = 0 and a.privilege_type='EXECUTE')

union all select 18, 'E. service_role submit EXECUTE 가능', 'true',
       coalesce((select has_function_privilege('service_role', p.oid, 'EXECUTE')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 19, 'E. set_players authenticated 만 실행 가능', 'true',
       coalesce((select (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                         and not has_function_privilege('anon', p.oid, 'EXECUTE'))::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_players'), '(none)')

union all select 20, 'E. anon 실행 가능 함수 = 공개 조회 2종만',
       'get_public_tournament,get_public_tournament_teams',
       coalesce((select string_agg(p.proname, ',' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public'
                    and p.proname in ('get_public_tournament','get_public_tournament_teams',
                                      'submit_tournament_registration','set_tournament_registration_players',
                                      'set_tournament_registration_status','get_admin_tournament_registrations')
                    and has_function_privilege('anon', p.oid, 'EXECUTE')), '(none)')

-- ── F. 핵심 로직 보존 (본문 문자열 존재 확인) ────────────────────────────────
union all select 21, 'F. submit 정원/대기/중복/락/동의 유지', 'true',
       coalesce((select (p.prosrc like '%pg_advisory_xact_lock%'
                         and p.prosrc like '%TOURNAMENT_FULL%'
                         and p.prosrc like '%DUPLICATE_REGISTRATION%'
                         and p.prosrc like '%target_capacity%'
                         and p.prosrc like '%max_capacity%'
                         and p.prosrc like '%CONSENT_REQUIRED%'
                         and p.prosrc like '%bank_account%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

union all select 22, 'F. set_players 게이트/사유/마스킹 유지', 'true',
       coalesce((select (p.prosrc like '%REGISTRATION_NOT_EDITABLE%'
                         and p.prosrc like '%PAYMENT_NOT_EDITABLE%'
                         and p.prosrc like '%REASON_REQUIRED%'
                         and p.prosrc like '%ELIGIBILITY_RECHECK_REQUIRED%'
                         and p.prosrc like '%hosted_tournament_mask_phone%'
                         and p.prosrc like '%pg_advisory_xact_lock%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='set_tournament_registration_players'), '(none)')

union all select 23, 'F. submit 이 선수별 클럽을 저장', 'true',
       coalesce((select (p.prosrc like '%player1_club_name%' and p.prosrc like '%player2_club_name%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='submit_tournament_registration'), '(none)')

-- ── G. 공개 payload — 개인정보 무노출 유지 ───────────────────────────────────
union all select 24, 'G. 공개 teams RPC 선수별 클럽 반환', 'true',
       coalesce((select (p.prosrc like '%player1ClubName%' and p.prosrc like '%player2ClubName%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='get_public_tournament_teams'), '(none)')

union all select 25, 'G. 공개 teams RPC 전화/입금/메모 미반환', 'true',
       coalesce((select (p.prosrc not like '%phone_norm%'
                         and p.prosrc not like '%depositor_name%'
                         and p.prosrc not like '%payment_status%'
                         and p.prosrc not like '%admin_note%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='get_public_tournament_teams'), '(none)')

union all select 26, 'G. Admin 목록 RPC 선수별 클럽 반환', 'true',
       coalesce((select (p.prosrc like '%player1ClubName%' and p.prosrc like '%player2ClubName%')::text
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='get_admin_tournament_registrations'), '(none)')

-- ── H. 테이블 권한(MVP 계약) 유지 ────────────────────────────────────────────
union all select 27, 'H. anon 3개 테이블 권한 없음', '0',
       (select count(*)::text from (select unnest(array[
                'public.hosted_tournaments','public.hosted_tournament_registrations',
                'public.hosted_tournament_registration_history']) as tbl) t
         where has_table_privilege('anon', tbl, 'SELECT') or has_table_privilege('anon', tbl, 'INSERT')
            or has_table_privilege('anon', tbl, 'UPDATE') or has_table_privilege('anon', tbl, 'DELETE'))

union all select 28, 'H. 대회 계좌 정정 상태 유지', '3333256163764',
       coalesce((select bank_account from public.hosted_tournaments where slug='2026-teyeon-open'), '(no row)')

)
select seq, check_name,
       case when actual is not distinct from expected then 'PASS'
            else '*** FAIL ***  expected=[' || coalesce(expected,'(null)')
                 || ']  actual=[' || coalesce(actual,'(null)') || ']' end as result
  from checks
 order by seq;


-- =============================================================================
-- 눈으로 확인 (읽기 전용)
-- =============================================================================
select p.proname,
       p.pronargs, p.pronargdefaults,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and p.proname in ('submit_tournament_registration','set_tournament_registration_players',
                     'get_public_tournament_teams','get_admin_tournament_registrations')
 order by p.proname;

-- 보정 진행 현황
select count(*)                                                     as total,
       count(*) filter (where player1_club_name is not null
                          and player2_club_name is not null)         as per_player_ready,
       count(*) filter (where player1_club_name is null
                          or  player2_club_name is null)             as legacy_fallback,
       count(club_name)                                              as legacy_club_present
  from public.hosted_tournament_registrations r
  join public.hosted_tournaments t on t.id = r.tournament_id
 where t.slug = '2026-teyeon-open';
