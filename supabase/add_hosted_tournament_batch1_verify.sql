-- ============================================================================
--  2026 TEYEON OPEN — Tournament Batch 1 통합 검증 (읽기 전용)
--
--  사용법: Supabase SQL Editor 에 이 파일 '전체'를 붙여넣고 한 번 실행한다.
--          seq / check_name / result(PASS·FAIL) 한 개의 표가 나온다.
--
--  ⚠ 100% 읽기 전용이다.
--      · INSERT / UPDATE / DELETE / DDL 없음
--      · 데이터를 바꾸는 RPC 를 호출하지 않는다
--      · 유일하게 호출하는 함수는 hosted_tournament_fixture_guard (STABLE, 조회만)
--        — 운영 대회가 fixture 가드에 '막히는지'를 실제로 확인하기 위함이다.
--
--  선행 조건: events → teams → courts → fixture 4개 migration 적용 완료.
-- ============================================================================

with
-- 함수 OID 를 미리 해석한다. 없으면 NULL 이 되어 FAIL 로 잡힌다(캐스트 예외 없음).
fn as (
    select
        to_regprocedure('public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text)') as log_event,
        to_regprocedure('public.promote_confirmed_registrations(text)')                             as promote,
        to_regprocedure('public.get_admin_tournament_teams(text)')                                  as get_teams,
        to_regprocedure('public.update_tournament_team(uuid,integer,integer,text,boolean)')         as upd_team,
        to_regprocedure('public.upsert_tournament_court(text,integer,text,integer,text,boolean)')   as ups_court,
        to_regprocedure('public.set_feature_court(text,integer)')                                   as set_feat,
        to_regprocedure('public.delete_tournament_court(text,integer)')                             as del_court,
        to_regprocedure('public.get_admin_tournament_courts(text)')                                 as get_courts,
        to_regprocedure('public.hosted_tournament_fixture_guard(text)')                             as fx_guard,
        to_regprocedure('public.seed_fixture_tournament(text,text,integer,boolean,integer)')        as fx_seed,
        to_regprocedure('public.get_admin_fixture_tournaments()')                                   as fx_list
),
-- PUBLIC(role oid 0) 에게 EXECUTE 가 남아 있는 함수 수.
--   ⚠ has_function_privilege('public', ...) 는 'public' 이 유효한 role 명이 아니라 오류가 난다.
--     그래서 aclexplode 로 grantee = 0 을 직접 센다.
pub_exec as (
    select count(*) as n
      from pg_proc p, fn,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.oid in (fn.log_event, fn.promote, fn.get_teams, fn.upd_team, fn.ups_court,
                     fn.set_feat, fn.del_court, fn.get_courts, fn.fx_guard, fn.fx_seed, fn.fx_list)
       and a.grantee = 0
       and a.privilege_type = 'EXECUTE'
),
-- 전 함수가 security definer + search_path 고정인지.
fn_hardening as (
    select
        count(*)                                                   as total,
        count(*) filter (where p.prosecdef)                        as secdef,
        count(*) filter (where exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                        where c like 'search\_path=%')) as pinned
      from pg_proc p, fn
     where p.oid in (fn.log_event, fn.promote, fn.get_teams, fn.upd_team, fn.ups_court,
                     fn.set_feat, fn.del_court, fn.get_courts, fn.fx_guard, fn.fx_seed, fn.fx_list)
),
prod as (
    select id from public.hosted_tournaments where slug = '2026-teyeon-open'
),
checks as (

-- ── 1. 테이블 / RLS ─────────────────────────────────────────────────────────
select  1, '[table] hosted_tournament_events 존재',
        to_regclass('public.hosted_tournament_events') is not null
union all select  2, '[table] hosted_tournament_teams 존재',
        to_regclass('public.hosted_tournament_teams') is not null
union all select  3, '[table] hosted_tournament_courts 존재',
        to_regclass('public.hosted_tournament_courts') is not null
union all select  4, '[RLS] 3개 테이블 모두 RLS 활성',
        (select count(*) = 3 from pg_class
          where relname in ('hosted_tournament_events','hosted_tournament_teams','hosted_tournament_courts')
            and relnamespace = 'public'::regnamespace and relrowsecurity)
union all select  5, '[RLS] SELECT 정책 3개 존재(운영진 전용)',
        (select count(*) = 3 from pg_policies
          where schemaname = 'public'
            and tablename in ('hosted_tournament_events','hosted_tournament_teams','hosted_tournament_courts')
            and cmd = 'SELECT')
union all select  6, '[RLS] INSERT/UPDATE/DELETE 정책 0개(직접 쓰기 경로 없음)',
        (select count(*) = 0 from pg_policies
          where schemaname = 'public'
            and tablename in ('hosted_tournament_events','hosted_tournament_teams','hosted_tournament_courts')
            and cmd <> 'SELECT')

-- ── 2. 테이블 권한 ──────────────────────────────────────────────────────────
union all select 10, '[grant] anon 은 teams SELECT 불가',
        not has_table_privilege('anon', 'public.hosted_tournament_teams', 'SELECT')
union all select 11, '[grant] anon 은 courts SELECT 불가',
        not has_table_privilege('anon', 'public.hosted_tournament_courts', 'SELECT')
union all select 12, '[grant] anon 은 events SELECT 불가',
        not has_table_privilege('anon', 'public.hosted_tournament_events', 'SELECT')
union all select 13, '[grant] anon 은 teams INSERT/UPDATE/DELETE 불가',
        not (has_table_privilege('anon', 'public.hosted_tournament_teams', 'INSERT')
          or has_table_privilege('anon', 'public.hosted_tournament_teams', 'UPDATE')
          or has_table_privilege('anon', 'public.hosted_tournament_teams', 'DELETE'))
union all select 14, '[grant] anon 은 courts INSERT/UPDATE/DELETE 불가',
        not (has_table_privilege('anon', 'public.hosted_tournament_courts', 'INSERT')
          or has_table_privilege('anon', 'public.hosted_tournament_courts', 'UPDATE')
          or has_table_privilege('anon', 'public.hosted_tournament_courts', 'DELETE'))
union all select 15, '[grant] authenticated 는 teams SELECT 가능(RLS 로 2차 제한)',
        has_table_privilege('authenticated', 'public.hosted_tournament_teams', 'SELECT')
union all select 16, '[grant] authenticated 는 teams 쓰기 불가',
        not (has_table_privilege('authenticated', 'public.hosted_tournament_teams', 'INSERT')
          or has_table_privilege('authenticated', 'public.hosted_tournament_teams', 'UPDATE')
          or has_table_privilege('authenticated', 'public.hosted_tournament_teams', 'DELETE'))
union all select 17, '[grant] authenticated 는 events 쓰기 불가(append-only)',
        not (has_table_privilege('authenticated', 'public.hosted_tournament_events', 'INSERT')
          or has_table_privilege('authenticated', 'public.hosted_tournament_events', 'UPDATE')
          or has_table_privilege('authenticated', 'public.hosted_tournament_events', 'DELETE'))

-- ── 3. 제약 / 인덱스 ────────────────────────────────────────────────────────
union all select 20, '[uniq] teams (tournament_id, team_no)',
        (select count(*) = 1 from pg_constraint where conname = 'hosted_tteam_no_unique')
union all select 21, '[uniq] teams (tournament_id, registration_id) partial — 멱등 승격 방어선',
        (select count(*) = 1 from pg_indexes
          where schemaname='public' and indexname = 'hosted_tteam_registration_uniq'
            and indexdef ilike '%where (registration_id IS NOT NULL)%')
union all select 22, '[uniq] teams (tournament_id, id) — 후속 복합 FK 용',
        (select count(*) = 1 from pg_constraint where conname = 'hosted_tteam_tid_id_unique')
union all select 23, '[uniq] courts (tournament_id, court_no)',
        (select count(*) = 1 from pg_constraint where conname = 'hosted_tcourt_no_unique')
union all select 24, '[uniq] courts feature court 대회당 1면(partial)',
        (select count(*) = 1 from pg_indexes
          where schemaname='public' and indexname = 'hosted_tcourt_feature_uniq'
            and indexdef ilike '%where is_feature_court%')
union all select 25, '[uniq] courts display_order 는 지연 검사(재정렬 가능)',
        (select count(*) = 1 from pg_constraint
          where conname = 'hosted_tcourt_order_unique' and condeferrable and condeferred)
union all select 26, '[check] courts.court_no 범위 제약 존재',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_courts'::regclass
            and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%court_no%')
union all select 27, '[check] teams.source 3값 제약 존재',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_teams'::regclass
            and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%fixture%')

-- ── 4. 개인정보 방화벽 ──────────────────────────────────────────────────────
union all select 30, '[PII] teams 에 전화번호 컬럼 없음',
        (select count(*) = 0 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_teams'
            and column_name ilike '%phone%')
union all select 31, '[PII] teams 에 입금/결제 컬럼 없음',
        (select count(*) = 0 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_teams'
            and (column_name ilike '%payment%' or column_name ilike '%depositor%'))
union all select 32, '[PII] teams 에 동의/관리자메모 컬럼 없음',
        (select count(*) = 0 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_teams'
            and (column_name ilike '%agreed%' or column_name ilike '%confirmed_at%'
                 or column_name ilike '%admin_note%'))
union all select 33, '[PII] events 컬럼이 설계된 11개와 정확히 일치',
        -- ⚠ ilike '%name%' 를 쓰지 않는다. 'tournament_id' 안의 'name' 에 걸려 오탐이 난다
        --   (t o u r [n a m e] n t _ i d). 집합을 통째로 대조하면 부분문자열 사고가 없고,
        --   PII 든 아니든 컬럼이 하나라도 추가되면 즉시 잡히므로 기존 패턴 검사보다 엄격하다.
        --   ⚠ 정렬 배열 비교(order by)는 쓰지 않는다. collation 에 따라 '_' 취급이 달라져
        --     to_value / tournament_id 순서가 뒤집힐 수 있다. 순서 무관한 집합 비교로 한다.
        (select count(*) = 11
                and count(*) filter (
                        where column_name::text <> all(array[
                            'action','actor_type','actor_user_id','created_at','entity_id',
                            'entity_type','from_value','id','note','to_value','tournament_id'])
                    ) = 0
           from information_schema.columns
          where table_schema = 'public' and table_name = 'hosted_tournament_events')
union all select 34, '[PII] get_admin_tournament_teams 가 registrations 를 join 하지 않음',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.get_teams
            and p.prosrc not ilike '%hosted_tournament_registrations%')

-- ── 5. 함수 존재 / 보안 ─────────────────────────────────────────────────────
union all select 40, '[fn] 11개 함수 모두 존재',
        (select log_event is not null and promote is not null and get_teams is not null
            and upd_team is not null and ups_court is not null and set_feat is not null
            and del_court is not null and get_courts is not null and fx_guard is not null
            and fx_seed is not null and fx_list is not null from fn)
union all select 41, '[fn] 전 함수 security definer',
        (select total = secdef and total = 11 from fn_hardening)
union all select 42, '[fn] 전 함수 search_path 고정',
        (select total = pinned and total = 11 from fn_hardening)
union all select 43, '[fn] PUBLIC 에 EXECUTE 잔존 0건',
        (select n = 0 from pub_exec)
union all select 44, '[fn] anon 은 promote 실행 불가',
        not has_function_privilege('anon', (select promote from fn), 'EXECUTE')
union all select 45, '[fn] anon 은 seed_fixture 실행 불가',
        not has_function_privilege('anon', (select fx_seed from fn), 'EXECUTE')
union all select 46, '[fn] anon 은 upsert_court 실행 불가',
        not has_function_privilege('anon', (select ups_court from fn), 'EXECUTE')
union all select 47, '[fn] anon 은 update_team 실행 불가',
        not has_function_privilege('anon', (select upd_team from fn), 'EXECUTE')
union all select 48, '[fn] anon 은 delete_court 실행 불가',
        not has_function_privilege('anon', (select del_court from fn), 'EXECUTE')
union all select 49, '[fn] log_event 는 authenticated 도 직접 실행 불가(내부 전용)',
        not has_function_privilege('authenticated', (select log_event from fn), 'EXECUTE')
union all select 50, '[fn] authenticated 는 promote 실행 가능(내부에서 CEO/ADMIN 재검증)',
        has_function_privilege('authenticated', (select promote from fn), 'EXECUTE')
union all select 51, '[fn] promote 내부에 can_manage_tournaments 재검증 존재',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.promote and p.prosrc ilike '%can_manage_tournaments%')
union all select 52, '[fn] promote 는 confirmed 만 대상',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.promote and p.prosrc ilike '%registration_status = ''confirmed''%')
union all select 53, '[fn] promote 는 registrations 를 수정하지 않음(INSERT 만)',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.promote
            and p.prosrc not ilike '%update public.hosted_tournament_registrations%'
            and p.prosrc not ilike '%delete from public.hosted_tournament_registrations%')

-- ── 6. Fixture 3중 가드 ─────────────────────────────────────────────────────
union all select 60, '[fixture] 가드에 slug 규칙 포함',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.fx_guard and p.prosrc ilike '%fixture-%%')
union all select 61, '[fixture] 가드에 draft 조건 포함',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.fx_guard and p.prosrc ilike '%not_draft%')
union all select 62, '[fixture] 가드에 실접수 존재 조건 포함',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.fx_guard and p.prosrc ilike '%has_real_registrations%')
union all select 63, '[fixture] 운영 대회는 가드에서 차단됨(실제 호출·읽기전용)',
        (select (public.hosted_tournament_fixture_guard('2026-teyeon-open') ->> 'ok')::boolean = false)
union all select 64, '[fixture] 차단 사유 = not_a_fixture_slug',
        (select public.hosted_tournament_fixture_guard('2026-teyeon-open') ->> 'reason'
                = 'not_a_fixture_slug')
union all select 65, '[fixture] reset 은 source=fixture 만 삭제',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.fx_seed and p.prosrc ilike '%source = ''fixture''%')

-- ── 7. 운영 데이터 무변경 ───────────────────────────────────────────────────
union all select 70, '[prod] 2026-teyeon-open 에 생성된 Team 0건',
        (select count(*) = 0 from public.hosted_tournament_teams t, prod
          where t.tournament_id = prod.id)
union all select 71, '[prod] 2026-teyeon-open 에 생성된 Court 0건',
        (select count(*) = 0 from public.hosted_tournament_courts c, prod
          where c.tournament_id = prod.id)
union all select 72, '[prod] 접수 데이터 여전히 존재(삭제되지 않음)',
        (select count(*) > 0 from public.hosted_tournament_registrations r, prod
          where r.tournament_id = prod.id)
union all select 73, '[prod] 대회 상태 registration_open 유지',
        (select status = 'registration_open' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 74, '[prod] 기존 접수 RPC 6종 그대로 존재',
        (to_regprocedure('public.get_public_tournament(text)') is not null
     and to_regprocedure('public.get_public_tournament_teams(text)') is not null
     and to_regprocedure('public.get_admin_tournament_registrations(text)') is not null
     and to_regprocedure('public.get_tournament_registration_history(uuid)') is not null
     and to_regprocedure('public.set_tournament_registration_status(uuid,text,text,text)') is not null
     and to_regprocedure('public.get_admin_hosted_tournaments()') is not null)
union all select 75, '[prod] submit RPC lockdown 유지(anon 실행 불가)',
        -- ⚠ 시그니처를 문자열로 박지 않는다. 인자 목록이 한 칸만 달라도 42883 으로 검증 자체가 죽는다.
        --   이름으로 찾아 oid 로 검사하면 오버로드가 남아 있어도 전부 걸린다.
        --   함수가 아예 없으면 count=0 → false (FAIL) 로 떨어진다.
        (select count(*) >= 1
                and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'submit_tournament_registration')
union all select 76, '[prod] submit RPC lockdown 유지(authenticated 실행 불가)',
        (select count(*) >= 1
                and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname = 'submit_tournament_registration')

)
select seq, check_name, case when ok then 'PASS' else 'FAIL' end as result
  from checks as c(seq, check_name, ok)
union all
select 999, 'SUMMARY  PASS=' || (select count(*) filter (where ok) from checks as c2(seq, check_name, ok))
         || ' / FAIL=' || (select count(*) filter (where not ok or ok is null) from checks as c3(seq, check_name, ok))
         || ' / TOTAL=' || (select count(*) from checks as c4(seq, check_name, ok)),
       case when (select count(*) filter (where not ok or ok is null) from checks as c5(seq, check_name, ok)) = 0
            then 'ALL PASS' else 'CHECK FAILED' end
 order by 1;
