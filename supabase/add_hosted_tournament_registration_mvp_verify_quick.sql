-- =============================================================================
-- QUICK VERIFY — add_hosted_tournament_registration_mvp.sql 적용 직후 1회 실행.
--
--   목적: 섹션 A~I, L 의 핵심 판정을 한 번의 실행으로 PASS/FAIL 표 하나로 만든다.
--         (상세 내역이 필요하면 add_hosted_tournament_registration_mvp_verify.sql 을 쓴다)
--
--   사용법: Supabase SQL Editor 에 이 파일 전체를 붙여넣고 실행 → 결과 표를 그대로 복사해 공유.
--   읽기 전용이다. 어떤 데이터도 변경하지 않는다.
--
--   ⚠ verdict 에 FAIL 이 하나라도 있으면 registration_open 전환을 진행하지 말 것.
--     특히 'G.' 로 시작하는 항목이 FAIL 이면 개인정보가 anon 에게 열려 있다는 뜻이므로 즉시 중단.
-- =============================================================================

with t3 as (
    select unnest(array['public.hosted_tournaments',
                        'public.hosted_tournament_registrations',
                        'public.hosted_tournament_registration_history']) as tbl
),
rpc_names as (
    select unnest(array['get_public_tournament','get_public_tournament_teams','submit_tournament_registration',
                        'get_admin_hosted_tournaments','get_admin_tournament_registrations',
                        'get_tournament_registration_history','set_tournament_registration_status',
                        'can_manage_tournaments','hosted_tournament_normalize_phone','hosted_tournament_pair_key',
                        -- add_hosted_tournament_player_change.sql 적용 후 추가된 2종.
                        --   아직 적용 전이라면 seq 16·17·18 이 FAIL 로 나온다(정상) — 적용 후 다시 실행할 것.
                        'set_tournament_registration_players','hosted_tournament_mask_phone']) as nm
),
checks as (

-- ── A. 테이블 ────────────────────────────────────────────────────────────────
select 1 as seq, 'A. hosted_* 테이블 3종 존재' as check_name, '3' as expected,
       (select count(*)::text from information_schema.tables
         where table_schema = 'public'
           and table_name in ('hosted_tournaments','hosted_tournament_registrations',
                              'hosted_tournament_registration_history')) as actual

-- ── B. 컬럼 / nullable ───────────────────────────────────────────────────────
union all select 2, 'B. club_name nullable(선택 입력)', 'YES',
       (select is_nullable from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registrations' and column_name='club_name')

union all select 3, 'B. 동의 4종 NOT NULL', '4',
       (select count(*)::text from information_schema.columns
         where table_schema='public' and table_name='hosted_tournament_registrations'
           and column_name in ('eligibility_confirmed_at','regulations_confirmed_at',
                               'privacy_agreed_at','media_notice_confirmed_at')
           and is_nullable='NO')

union all select 4, 'B. 금지 컬럼(나이/생년/SMS) 부재', '0',
       (select count(*)::text from information_schema.columns
         where table_schema='public'
           and table_name in ('hosted_tournaments','hosted_tournament_registrations')
           and column_name ~* 'age|birth|sms|sender|message')

-- ── C. CHECK 제약 ────────────────────────────────────────────────────────────
union all select 5, 'C. 정원순서/선수번호중복 CHECK', '2',
       (select count(*)::text from pg_constraint con
          join pg_class c on c.oid = con.conrelid
         where con.contype='c'
           and con.conname in ('hosted_tournaments_capacity_order','hosted_treg_distinct_phones'))

-- ── D. 인덱스 ────────────────────────────────────────────────────────────────
union all select 6, 'D. 활성 pair 부분 UNIQUE 존재', '1',
       (select count(*)::text from pg_indexes
         where schemaname='public' and indexname='hosted_treg_active_pair'
           and indexdef ilike '%unique%' and indexdef ilike '%applied%'
           and indexdef ilike '%waitlisted%' and indexdef ilike '%confirmed%')

union all select 7, 'D. 전화번호 단독 UNIQUE 부재', '0',
       (select count(*)::text from pg_indexes
         where schemaname='public' and tablename='hosted_tournament_registrations'
           and indexdef ilike '%unique%'
           and (indexdef ilike '%player1_phone%' or indexdef ilike '%player2_phone%')
           and indexdef not ilike '%pair_key%')

-- ── E. RLS ───────────────────────────────────────────────────────────────────
union all select 8, 'E. RLS enabled (3테이블)', '3',
       (select count(*)::text from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relrowsecurity
           and c.relname in ('hosted_tournaments','hosted_tournament_registrations',
                             'hosted_tournament_registration_history'))

union all select 9, 'E. FORCE RLS off (의도된 값)', '0',
       (select count(*)::text from pg_class c
          join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relforcerowsecurity
           and c.relname in ('hosted_tournaments','hosted_tournament_registrations',
                             'hosted_tournament_registration_history'))

-- ── F. 정책 ──────────────────────────────────────────────────────────────────
union all select 10, 'F. SELECT 정책 3개', '3',
       (select count(*)::text from pg_policies
         where schemaname='public' and cmd='SELECT'
           and tablename in ('hosted_tournaments','hosted_tournament_registrations',
                             'hosted_tournament_registration_history'))

union all select 11, 'F. 쓰기 정책 0개(INSERT/UPDATE/DELETE/ALL)', '0',
       (select count(*)::text from pg_policies
         where schemaname='public' and cmd <> 'SELECT'
           and tablename in ('hosted_tournaments','hosted_tournament_registrations',
                             'hosted_tournament_registration_history'))

-- ── G. anon 권한 (최우선 P0) ─────────────────────────────────────────────────
union all select 12, 'G. anon 테이블 권한 12개 전부 false', '0',
       (select count(*)::text from t3
         where has_table_privilege('anon', tbl, 'SELECT')
            or has_table_privilege('anon', tbl, 'INSERT')
            or has_table_privilege('anon', tbl, 'UPDATE')
            or has_table_privilege('anon', tbl, 'DELETE'))

union all select 13, 'G. authenticated 쓰기 권한 없음', '0',
       (select count(*)::text from t3
         where has_table_privilege('authenticated', tbl, 'INSERT')
            or has_table_privilege('authenticated', tbl, 'UPDATE')
            or has_table_privilege('authenticated', tbl, 'DELETE'))

union all select 14, 'G. authenticated SELECT 3개', '3',
       (select count(*)::text from t3 where has_table_privilege('authenticated', tbl, 'SELECT'))

-- ── H. RPC EXECUTE ───────────────────────────────────────────────────────────
union all select 15, 'H. anon 실행 가능 함수 = 공개 3종',
       'get_public_tournament,get_public_tournament_teams,submit_tournament_registration',
       coalesce((select string_agg(p.proname, ',' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname in (select nm from rpc_names)
                    and has_function_privilege('anon', p.oid, 'EXECUTE')), '(none)')

union all select 16, 'H. authenticated 실행 가능 함수 = 9종(helper 제외)',
       'can_manage_tournaments,get_admin_hosted_tournaments,get_admin_tournament_registrations,'
       || 'get_public_tournament,get_public_tournament_teams,get_tournament_registration_history,'
       || 'set_tournament_registration_players,set_tournament_registration_status,submit_tournament_registration',
       coalesce((select string_agg(p.proname, ',' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname in (select nm from rpc_names)
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')), '(none)')

-- ── I. SECURITY DEFINER / search_path ────────────────────────────────────────
union all select 17, 'I. SECURITY DEFINER 9종', '9',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.prosecdef and p.proname in (select nm from rpc_names))

union all select 18, 'I. search_path 고정 12종', '12',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname in (select nm from rpc_names)
           and array_to_string(p.proconfig, ',') like '%search_path=public, pg_temp%')

-- ── K. seed ──────────────────────────────────────────────────────────────────
union all select 19, 'K. seed status = draft (접수 미오픈)', 'draft',
       coalesce((select status from public.hosted_tournaments where slug='2026-teyeon-open'), '(no row)')

union all select 20, 'K. seed 정원/참가비', '48/60/40000',
       coalesce((select target_capacity || '/' || max_capacity || '/' || entry_fee
                   from public.hosted_tournaments where slug='2026-teyeon-open'), '(no row)')

union all select 21, 'K. seed 접수마감(KST)', '2026-10-19 17:00',
       coalesce((select to_char(registration_close_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
                   from public.hosted_tournaments where slug='2026-teyeon-open'), '(no row)')

union all select 22, 'K. seed 대회일/시작시각', '2026-10-25/09:00',
       coalesce((select event_date || '/' || to_char(event_start_time, 'HH24:MI')
                   from public.hosted_tournaments where slug='2026-teyeon-open'), '(no row)')

union all select 23, 'K. registration_open_at 미설정(요강에 없음)', 'null',
       coalesce((select coalesce(registration_open_at::text, 'null')
                   from public.hosted_tournaments where slug='2026-teyeon-open'), '(no row)')

-- ── L. 기존 Tournament Calendar 무변경 ───────────────────────────────────────
union all select 24, 'L. legacy 테이블 3종 그대로 존재', '3',
       (select count(*)::text from information_schema.tables
         where table_schema='public'
           and table_name in ('tournament_events','tournament_pairs','tournament_partner_requests'))

union all select 25, 'L. tournament_events 정책 개수 유지', '2',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='tournament_events')

union all select 26, 'L. hosted_* FK 부모에 legacy 없음', '0',
       (select count(*)::text from pg_constraint con
          join pg_class c on c.oid=con.conrelid
          join pg_class f on f.oid=con.confrelid
         where con.contype='f' and c.relname like 'hosted_tournament%'
           and f.relname in ('tournament_events','tournament_pairs','tournament_partner_requests'))

-- ── M. 선수 교체(P1) ─────────────────────────────────────────────────────────
--   add_hosted_tournament_player_change.sql 적용 후에만 PASS 한다.
union all select 27, 'M. history action CHECK = 10종(선수 교체 포함)', 'true',
       coalesce((select (pg_get_constraintdef(con.oid) like '%submit%'
                         and pg_get_constraintdef(con.oid) like '%registration_status%'
                         and pg_get_constraintdef(con.oid) like '%payment_status%'
                         and pg_get_constraintdef(con.oid) like '%admin_note%'
                         and pg_get_constraintdef(con.oid) like '%player1_name%'
                         and pg_get_constraintdef(con.oid) like '%player1_phone%'
                         and pg_get_constraintdef(con.oid) like '%player2_name%'
                         and pg_get_constraintdef(con.oid) like '%player2_phone%'
                         and pg_get_constraintdef(con.oid) like '%club_name%'
                         and pg_get_constraintdef(con.oid) like '%depositor_name%')::text
                   from pg_constraint con join pg_class c on c.oid=con.conrelid
                  where c.relname='hosted_tournament_registration_history' and con.contype='c'
                    and con.conkey = array[(select a.attnum from pg_attribute a
                                             where a.attrelid=c.oid and a.attname='action')]), '(none)')

union all select 28, 'M. 이력 전화번호 원문 저장 0건', '0',
       (select count(*)::text from public.hosted_tournament_registration_history
         where action in ('player1_phone','player2_phone')
           and (coalesce(from_value,'') ~ '[0-9]{7,}' or coalesce(to_value,'') ~ '[0-9]{7,}'))

)
select seq,
       check_name,
       expected,
       actual,
       case when actual is not distinct from expected then 'PASS' else '*** FAIL ***' end as verdict
  from checks
 order by seq;


-- =============================================================================
-- 위 표가 전부 PASS 인 것을 확인한 뒤, 아래 draft 동작 확인을 하나씩 실행한다.
-- (여기부터는 결과를 눈으로 확인하는 항목 — 여전히 읽기 전용)
-- =============================================================================

-- 1) draft 대회는 공개 RPC 에 노출되지 않는다.
select public.get_public_tournament('2026-teyeon-open');            -- 기대: NULL
select public.get_public_tournament_teams('2026-teyeon-open');       -- 기대: []

-- 2) draft 상태에서는 접수가 생성되지 않는다.
--    ⚠ 아래는 '실패해야 정상' 이다. TOURNAMENT_NOT_OPEN 오류가 나면 통과.
--       혹시라도 성공하면 즉시 중단하고 그 행을 cancelled 처리한 뒤 보고할 것.
select public.submit_tournament_registration(
    '2026-teyeon-open',
    '검증테스트', '01000000001',
    '검증테스트2', '01000000002',
    null, '검증', null,
    true, true, true, true
);
-- 기대: ERROR  TOURNAMENT_NOT_OPEN

-- 3) 접수 행이 실제로 하나도 생기지 않았는지 최종 확인.
select count(*) as registration_rows from public.hosted_tournament_registrations;  -- 기대: 0
