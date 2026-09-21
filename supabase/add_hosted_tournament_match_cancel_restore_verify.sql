-- ============================================================================
--  2026 TEYEON OPEN — 취소 경기 복구 (Batch 3C-2) 검증
--
--  사용법: Supabase SQL Editor 에 전체를 붙여넣고 1회 실행.
--          seq / check_name / result(PASS·FAIL) 한 개의 표가 나온다.
--
--  ⚠ 100% 읽기 전용. INSERT/UPDATE/DELETE/DDL 없음, 운영 RPC 호출 없음(카탈로그 조회만).
--
--  선행: Batch 3A matches + Batch 3B standings
--        + add_hosted_tournament_match_cancel_restore.sql
--
--  상태 전이 계약(CANCELLED→WAITING 성공 / 나머지 거부 / 필드 비움 / audit)은
--  이 파일이 아니라 verify_hosted_tournament_match_cancel_restore_fixture.sql 이
--  실제 데이터로 검증한다. 여기서는 구조 · 권한 · 본문 불변식만 본다.
-- ============================================================================

with
fn as (
    select
        to_regprocedure('public.restore_cancelled_match(uuid,text,integer)')              as f_restore,
        to_regprocedure('public.cancel_match(uuid,text,integer)')                         as f_cancel,
        to_regprocedure('public.hosted_tournament_match_begin(uuid,integer)')             as f_begin,
        to_regprocedure('public.amend_completed_match_score(uuid,integer,integer,text,integer)') as f_amend
),
src as (
    select
        (select prosrc from pg_proc where oid = (select f_restore from fn)) as s_restore,
        (select prosrc from pg_proc where oid = (select f_cancel  from fn)) as s_cancel,
        (select prosrc from pg_proc where oid = (select f_amend   from fn)) as s_amend
),
mcol as (select column_name
           from information_schema.columns
          where table_schema = 'public' and table_name = 'hosted_tournament_matches'),
prod as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
checks as (

-- ── 1. 함수 존재 / 하드닝 ───────────────────────────────────────────────────
select  1, '[fn] restore_cancelled_match(uuid,text,integer) 존재',
        (select f_restore is not null from fn)
union all select  2, '[fn] 인자 모양이 cancel_match 와 동일(uuid, text, integer)',
        (pg_get_function_identity_arguments((select f_restore from fn))
         = pg_get_function_identity_arguments((select f_cancel from fn)))
union all select  3, '[sec] SECURITY DEFINER',
        (select prosecdef from pg_proc where oid = (select f_restore from fn))
union all select  4, '[sec] search_path 고정',
        (select exists (select 1 from unnest(coalesce(proconfig, '{}')) c
                         where c like 'search\_path=%')
           from pg_proc where oid = (select f_restore from fn))
union all select  5, '[sec] PUBLIC EXECUTE 0건',
        (select count(*) = 0
           from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
          where p.oid = (select f_restore from fn)
            and x.grantee = 0 and x.privilege_type = 'EXECUTE')
union all select  6, '[sec] anon EXECUTE 불가',
        (not has_function_privilege('anon', (select f_restore from fn), 'EXECUTE'))
union all select  7, '[sec] authenticated EXECUTE 가능(RPC 경유)',
        (has_function_privilege('authenticated', (select f_restore from fn), 'EXECUTE'))
union all select  8, '[fn] VOLATILE(쓰기 함수)',
        (select provolatile = 'v' from pg_proc where oid = (select f_restore from fn))

-- ── 2. 진입점 / 락 ──────────────────────────────────────────────────────────
union all select 10, '[auth] 권한·락·version 을 match_begin 한 곳에서 처리',
        (select s_restore like '%hosted_tournament_match_begin(p_match_id, p_expected_version)%' from src)
union all select 11, '[lock] advisory lock 을 직접 다시 잡지 않음(중복 락 금지)',
        (select s_restore not like '%pg_advisory%' from src)
union all select 12, '[auth] match_begin 이 여전히 내부 전용(authenticated 실행 불가)',
        (not has_function_privilege('authenticated', (select f_begin from fn), 'EXECUTE'))

-- ── 3. 상태 전이 계약(본문 고정) ────────────────────────────────────────────
union all select 20, '[state] CANCELLED 가 아니면 거부(match_not_cancelled)',
        (select s_restore like '%match_not_cancelled%' from src)
union all select 21, '[state] 목적 상태는 WAITING 하나뿐',
        (select s_restore ~ 'set status\s+=\s+''waiting''' from src)
union all select 22, '[state] status 를 대입하는 곳이 정확히 1군데',
        (select (length(s_restore) - length(replace(s_restore, 'set status', '')))
                / length('set status') = 1 from src)
union all select 23, '[state] playing/calling/completed 로 되돌리는 경로 없음',
        (select s_restore !~ 'set status\s+=\s+''(playing|calling|completed|cancelled)'''
           from src)
union all select 24, '[state] UPDATE 조건에 status = cancelled 재확인이 있음',
        (select s_restore ~ 'where id = p_match_id and status = ''cancelled''' from src)
union all select 25, '[state] UPDATE 조건에 version 대조가 있음',
        (select s_restore like '%version = p_expected_version%' from src)

-- ── 4. 필드 초기화 ──────────────────────────────────────────────────────────
union all select 30, '[reset] cancelled_at 를 비운다',
        (select s_restore ~ 'cancelled_at\s+=\s+null' from src)
union all select 31, '[reset] called_at / started_at / completed_at 를 비운다',
        (select s_restore ~ 'called_at\s+=\s+null'
            and s_restore ~ 'started_at\s+=\s+null'
            and s_restore ~ 'completed_at\s+=\s+null' from src)
union all select 32, '[reset] court_id 를 비운다(코트 점유 반납)',
        (select s_restore ~ 'court_id\s+=\s+null' from src)
union all select 33, '[reset] score1 / score2 / winner_team_id 를 비운다',
        (select s_restore ~ 'score1\s+=\s+null'
            and s_restore ~ 'score2\s+=\s+null'
            and s_restore ~ 'winner_team_id\s+=\s+null' from src)
union all select 34, '[reset] 복구 전에 결과 잔존 여부를 확인(cancelled_match_has_result)',
        (select s_restore like '%cancelled_match_has_result%' from src)
union all select 35, '[ver] version + 1 / updated_at 갱신',
        (select s_restore ~ 'version\s+=\s+version \+ 1'
            and s_restore ~ 'updated_at\s+=\s+now\(\)' from src)

-- ── 5. 입력 검증 ────────────────────────────────────────────────────────────
union all select 40, '[in] expected_version 필수(version_required)',
        (select s_restore like '%version_required%' from src)
union all select 41, '[in] 사유 필수 · 최소 2자(reason_required)',
        (select s_restore like '%reason_required%'
            and s_restore like '%length(v_reason) < 2%' from src)
union all select 42, '[in] 동시 변경 시 already_changed',
        (select s_restore like '%already_changed%' from src)

-- ── 6. 감사 ─────────────────────────────────────────────────────────────────
union all select 50, '[audit] action = match_cancel_restored',
        (select s_restore like '%match_cancel_restored%' from src)
union all select 51, '[audit] payload 에 matchNo / fromStatus / toStatus',
        (select s_restore like '%''matchNo'', v_no%'
            and s_restore like '%''fromStatus'', ''cancelled''%'
            and s_restore like '%''toStatus'', ''waiting''%' from src)
union all select 52, '[audit] entity_type match 로 기록',
        (select s_restore like '%''match'', p_match_id%' from src)
union all select 53, '[PII] 감사에 선수명/연락처/나이 없음',
        (select s_restore not ilike '%player1_name%' and s_restore not ilike '%player2_name%'
            and s_restore not ilike '%phone%' and s_restore not ilike '%birth%'
            and s_restore not ilike '%dob%' from src)
union all select 54, '[PII] 접수 원장을 참조하지 않음',
        (select s_restore not like '%hosted_tournament_registrations%' from src)
union all select 55, '[events] action 길이 제한(1..40) 안에 들어옴',
        (length('match_cancel_restored') between 1 and 40)
union all select 56, '[events] entity_type 에 match 가 허용되어 있음',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_events'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%entity_type%'
            and pg_get_constraintdef(c.oid) ilike '%''match''%')

-- ── 7. 기존 계약 무변경 ─────────────────────────────────────────────────────
union all select 60, '[3A] matches 테이블 21컬럼 그대로',
        (select count(*) = 21 from mcol)
union all select 61, '[3A] matches RLS SELECT 정책 1개 / write 정책 0개',
        ((select count(*) = 1 from pg_policies
           where schemaname='public' and tablename='hosted_tournament_matches' and cmd='SELECT')
         and (select count(*) = 0 from pg_policies
               where schemaname='public' and tablename='hosted_tournament_matches'
                 and cmd in ('INSERT','UPDATE','DELETE','ALL')))
union all select 62, '[3A] cancel_match 는 여전히 완료 경기를 취소하지 못함',
        (select s_cancel like '%match_already_completed%' from src)
union all select 63, '[3B] amend 의 동률 확정 무효화 계약 유지',
        (select s_amend like '%invalidatedResolutions%' from src)
union all select 64, '[3B] 순위 RPC 가 그대로 존재',
        (to_regprocedure('public.get_preliminary_standings(text)') is not null
         and to_regprocedure('public.resolve_group_age_tie(text,integer,uuid[],text,text)') is not null)
union all select 65, '[scope] 이 follow-up 이 새 테이블을 만들지 않음',
        (to_regclass('public.hosted_tournament_match_restores') is null
         and to_regclass('public.hosted_tournament_cancel_restores') is null)

-- ── 8. Production 보호 ──────────────────────────────────────────────────────
union all select 100, '[prod] 2026-teyeon-open 경기 0건',
        (select count(*) = 0 from public.hosted_tournament_matches m, prod
          where m.tournament_id = prod.id)
union all select 101, '[prod] 2026-teyeon-open 복구 이벤트 0건',
        (select count(*) = 0 from public.hosted_tournament_events e, prod
          where e.tournament_id = prod.id and e.action = 'match_cancel_restored')
union all select 102, '[prod] 2026-teyeon-open 조편성 draft 유지',
        (select preliminary_draw_status = 'draft' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 103, '[prod] 대회 status registration_open 유지',
        (select status = 'registration_open' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 104, '[prod] 승격된 접수 0건',
        (select count(*) = 0 from public.hosted_tournament_teams
          where registration_id is not null)
union all select 105, '[prod] fixture self-test 잔재 없음',
        (select count(*) = 0 from public.hosted_tournaments
          where slug like 'zz-fixture-%')

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
