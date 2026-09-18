-- ============================================================================
--  2026 TEYEON OPEN — Batch 3A (예선 경기 엔진) 검증
--
--  사용법: Supabase SQL Editor 에 전체를 붙여넣고 1회 실행.
--          seq / check_name / result(PASS·FAIL) 한 개의 표가 나온다.
--
--  ⚠ 100% 읽기 전용. INSERT/UPDATE/DELETE/DDL 없음, 함수 호출 없음(카탈로그 조회만).
--
--  선행: Batch 1 4종 + Batch 2A + bulk follow-up + add_hosted_tournament_matches.sql
-- ============================================================================

with
fn as (
    select
        to_regprocedure('public.hosted_tournament_membership_fingerprint(uuid)')            as f_fp,
        to_regprocedure('public.hosted_tournament_match_begin(uuid,integer)')               as f_begin,
        to_regprocedure('public.generate_group_matches(text,integer)')                      as f_gen,
        to_regprocedure('public.call_match(uuid,integer)')                                  as f_call,
        to_regprocedure('public.uncall_match(uuid,integer)')                                as f_uncall,
        to_regprocedure('public.start_match(uuid,integer,integer)')                         as f_start,
        to_regprocedure('public.complete_match(uuid,integer,integer,integer)')              as f_complete,
        to_regprocedure('public.amend_completed_match_score(uuid,integer,integer,text,integer)') as f_amend,
        to_regprocedure('public.cancel_match(uuid,text,integer)')                           as f_cancel,
        to_regprocedure('public.get_admin_match_board(text)')                               as f_board,
        to_regprocedure('public.unlock_preliminary_draw(text,text,integer)')                as f_unlock
),
all_fn as (
    select unnest(array[f_fp, f_begin, f_gen, f_call, f_uncall, f_start,
                        f_complete, f_amend, f_cancel, f_board, f_unlock]) as oid
      from fn
),
pub_exec as (
    select count(*) as n
      from pg_proc p join all_fn a on a.oid = p.oid,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     where x.grantee = 0 and x.privilege_type = 'EXECUTE'
),
hardening as (
    select count(*) as total,
           count(*) filter (where p.prosecdef) as secdef,
           count(*) filter (where exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                           where c like 'search\_path=%')) as pinned
      from pg_proc p join all_fn a on a.oid = p.oid
),
mcon as (select conname, contype, pg_get_constraintdef(oid) as def, confdeltype, conkey
            from pg_constraint
           where conrelid = to_regclass('public.hosted_tournament_matches')),
prod as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
checks as (

-- ── 1. 테이블 / RLS ─────────────────────────────────────────────────────────
select  1, '[table] hosted_tournament_matches 존재',
        to_regclass('public.hosted_tournament_matches') is not null
union all select  2, '[RLS] RLS 활성',
        (select relrowsecurity from pg_class
          where relname = 'hosted_tournament_matches' and relnamespace = 'public'::regnamespace)
union all select  3, '[RLS] SELECT 정책 1개(운영진 전용)',
        (select count(*) = 1 from pg_policies
          where schemaname='public' and tablename='hosted_tournament_matches' and cmd='SELECT')
union all select  4, '[RLS] INSERT/UPDATE/DELETE 정책 0개',
        (select count(*) = 0 from pg_policies
          where schemaname='public' and tablename='hosted_tournament_matches' and cmd<>'SELECT')

-- ── 2. 테이블 권한 ──────────────────────────────────────────────────────────
union all select 10, '[grant] anon 은 matches SELECT 불가',
        not has_table_privilege('anon', 'public.hosted_tournament_matches', 'SELECT')
union all select 11, '[grant] anon 은 matches 쓰기 불가',
        not (has_table_privilege('anon','public.hosted_tournament_matches','INSERT')
          or has_table_privilege('anon','public.hosted_tournament_matches','UPDATE')
          or has_table_privilege('anon','public.hosted_tournament_matches','DELETE'))
union all select 12, '[grant] authenticated 는 SELECT 가능(RLS 2차 제한)',
        has_table_privilege('authenticated', 'public.hosted_tournament_matches', 'SELECT')
union all select 13, '[grant] authenticated 는 쓰기 불가',
        not (has_table_privilege('authenticated','public.hosted_tournament_matches','INSERT')
          or has_table_privilege('authenticated','public.hosted_tournament_matches','UPDATE')
          or has_table_privilege('authenticated','public.hosted_tournament_matches','DELETE'))

-- ── 3. 복합 FK (교차 대회 차단) ─────────────────────────────────────────────
union all select 20, '[fk] group 복합 FK(2컬럼) + cascade',
        (select count(*) = 1 from mcon
          where conname='hosted_tmatch_group_fk' and contype='f'
            and array_length(conkey,1)=2 and confdeltype='c')
union all select 21, '[fk] team1 복합 FK(2컬럼) + restrict',
        (select count(*) = 1 from mcon
          where conname='hosted_tmatch_team1_fk' and contype='f'
            and array_length(conkey,1)=2 and confdeltype='r')
union all select 22, '[fk] team2 복합 FK(2컬럼) + restrict',
        (select count(*) = 1 from mcon
          where conname='hosted_tmatch_team2_fk' and contype='f'
            and array_length(conkey,1)=2 and confdeltype='r')
union all select 23, '[fk] court 복합 FK(2컬럼) + set null',
        (select count(*) = 1 from mcon
          where conname='hosted_tmatch_court_fk' and contype='f'
            and array_length(conkey,1)=2 and confdeltype='n')

-- ── 4. unique / check 제약 ──────────────────────────────────────────────────
union all select 30, '[uniq] (tournament_id, match_no)',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_no_unique')
union all select 31, '[uniq] ★ (group_id, sequence_no) — 생성 멱등성 방어선',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_seq_unique')
union all select 32, '[uniq] (tournament_id, id) — 후속 복합 FK 대상',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_tid_id_unique')
union all select 33, '[uniq] ★ PLAYING 코트 중복 차단(partial index)',
        (select count(*) = 1 from pg_indexes
          where schemaname='public' and indexname='hosted_tmatch_playing_court_uniq'
            and indexdef ilike '%unique%' and indexdef ilike '%where%'
            and indexdef ilike '%playing%')
union all select 34, '[check] team1 <> team2',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_distinct_teams')
union all select 35, '[check] completed ↔ score·winner 동시 존재',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_completed_shape')
union all select 36, '[check] winner 는 두 팀 중 하나',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_winner_member')
union all select 37, '[check] ★ 6게임 규칙(승자 6 / 패자 0~5)',
        (select count(*) = 1 from mcon
          where conname='hosted_tmatch_score_rule' and def ilike '%greatest%' and def ilike '%least%')
union all select 38, '[check] PLAYING 만 코트 점유(완료·취소 시 반납 강제)',
        (select count(*) = 1 from mcon where conname='hosted_tmatch_court_shape')
union all select 39, '[check] status 5값만 허용',
        (select count(*) >= 1 from mcon
          where contype='c' and def ilike '%cancelled%' and def ilike '%calling%')
union all select 40, '[check] stage 3값만 허용',
        (select count(*) >= 1 from mcon
          where contype='c' and def ilike '%placement%' and def ilike '%knockout%')

-- ── 5. 지문 컬럼 ────────────────────────────────────────────────────────────
union all select 45, '[column] preliminary_matches_fingerprint 존재',
        (select count(*) = 1 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournaments'
            and column_name='preliminary_matches_fingerprint')
union all select 46, '[column] 기존 대회 행은 전부 null(미생성)',
        (select count(*) = 0 from public.hosted_tournaments
          where preliminary_matches_fingerprint is not null)

-- ── 6. 함수 존재 / 보안 ─────────────────────────────────────────────────────
union all select 50, '[fn] 11개 함수 모두 존재',
        (select count(*) = 11 from all_fn where oid is not null)
union all select 51, '[fn] 전 함수 security definer',
        (select total = 11 and secdef = 11 from hardening)
union all select 52, '[fn] 전 함수 search_path 고정',
        (select total = 11 and pinned = 11 from hardening)
union all select 53, '[fn] PUBLIC EXECUTE 잔존 0건',
        (select n = 0 from pub_exec)
union all select 54, '[fn] anon 은 11개 전부 실행 불가',
        (select bool_and(not has_function_privilege('anon', a.oid, 'EXECUTE'))
           from all_fn a where a.oid is not null)
union all select 55, '[fn] 내부 helper 2종은 authenticated 도 실행 불가',
        (select not has_function_privilege('authenticated', f_fp, 'EXECUTE')
            and not has_function_privilege('authenticated', f_begin, 'EXECUTE') from fn)
union all select 56, '[fn] 공개 RPC 8종은 authenticated 실행 가능',
        (select has_function_privilege('authenticated', f_gen,      'EXECUTE')
            and has_function_privilege('authenticated', f_call,     'EXECUTE')
            and has_function_privilege('authenticated', f_uncall,   'EXECUTE')
            and has_function_privilege('authenticated', f_start,    'EXECUTE')
            and has_function_privilege('authenticated', f_complete, 'EXECUTE')
            and has_function_privilege('authenticated', f_amend,    'EXECUTE')
            and has_function_privilege('authenticated', f_cancel,   'EXECUTE')
            and has_function_privilege('authenticated', f_board,    'EXECUTE') from fn)
union all select 57, '[fn] ★ 재생성한 unlock_preliminary_draw lockdown 재적용',
        (select not has_function_privilege('anon', f_unlock, 'EXECUTE')
            and has_function_privilege('authenticated', f_unlock, 'EXECUTE') from fn)

-- ── 7. 계약 (prosrc 정적 검사) ──────────────────────────────────────────────
union all select 60, '[generate] 조편성 LOCK 전제',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_gen
          and p.prosrc ilike '%draw_not_locked%')
union all select 61, '[generate] 검증 재실행',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_gen
          and p.prosrc ilike '%hosted_tournament_draw_validate%')
union all select 62, '[generate] 중복 생성 차단(조용한 재생성 없음)',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_gen
          and p.prosrc ilike '%already_generated%'
          and p.prosrc not ilike '%delete from public.hosted_tournament_matches%')
union all select 63, '[generate] 지문 저장',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_gen
          and p.prosrc ilike '%preliminary_matches_fingerprint%')
union all select 64, '[generate] 라운드로빈 일반식(조 크기 하드코딩 없음)',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_gen
          and p.prosrc ilike '%slot_no > m1.slot_no%'
          and p.prosrc not ilike '%expected_size = 3%')
union all select 65, '[call] CALLING 이 court_id 를 건드리지 않음',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_call
          and p.prosrc not ilike '%court_id%')
union all select 66, '[start] active 코트만 허용',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_start
          and p.prosrc ilike '%court_disabled%')
union all select 67, '[start] team busy authoritative 재검사',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_start
          and p.prosrc ilike '%team_busy%'
          and p.prosrc ilike '%team1_id in (v_t1, v_t2) or team2_id in (v_t1, v_t2)%')
union all select 68, '[start] 코트 충돌 23505 처리',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_start
          and p.prosrc ilike '%unique_violation%' and p.prosrc ilike '%court_conflict%')
union all select 69, '[complete] 서버가 winner 를 score 에서 파생',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_complete
          and p.prosrc ilike '%case when p_score1 > p_score2%')
union all select 70, '[complete] 6게임 점수 검증',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_complete
          and p.prosrc ilike '%invalid_score%' and p.prosrc ilike '%greatest(p_score1, p_score2) <> 6%')
union all select 71, '[complete] 완료 시 코트 반납',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_complete
          and p.prosrc ilike '%court_id = null%')
union all select 72, '[complete] expected_version 필수',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_complete
          and p.prosrc ilike '%version_required%')
union all select 73, '[amend] 사유 필수',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_amend
          and p.prosrc ilike '%reason_required%')
union all select 74, '[amend] completed 전제 + winner 재파생',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_amend
          and p.prosrc ilike '%match_not_completed%'
          and p.prosrc ilike '%case when p_score1 > p_score2%')
union all select 75, '[cancel] 완료 경기는 취소 불가 + 사유 필수',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_cancel
          and p.prosrc ilike '%match_already_completed%'
          and p.prosrc ilike '%reason_required%')
union all select 76, '[unlock] 진행/완료 경기 존재 시 차단',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_unlock
          and p.prosrc ilike '%matches_in_progress%')
union all select 77, '[unlock] CALLING → WAITING 초기화',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_unlock
          and p.prosrc ilike '%calling_reset%'
          and p.prosrc ilike '%status = ''waiting'', called_at = null%')
union all select 78, '[unlock] 경기를 삭제하지 않음',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_unlock
          and p.prosrc not ilike '%delete from public.hosted_tournament_matches%')
union all select 79, '[unlock] CANCELLED 는 자동 변경하지 않음',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_unlock
          and p.prosrc not ilike '%status = ''cancelled''%')
union all select 80, '[fingerprint] display_order 를 지문에 포함하지 않음',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_fp
          and p.prosrc not ilike '%display_order%'
          and p.prosrc ilike '%group_no%' and p.prosrc ilike '%slot_no%'
          and p.prosrc ilike '%team_id%')
union all select 81, '[fingerprint] 정렬 고정(결정적)',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_fp
          and p.prosrc ilike '%order by g.group_type, g.group_no, m.slot_no%')

-- ── 8. 기권/노쇼 별도 구조 없음 ─────────────────────────────────────────────
union all select 85, '[policy] WALKOVER/RET/DEF 컬럼 없음',
        (select count(*) = 0 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_matches'
            and (column_name ilike '%walkover%' or column_name ilike '%result_type%'
              or column_name ilike '%retire%' or column_name ilike '%default%'))
union all select 86, '[policy] status 에 walkover 계열 값 없음',
        (select count(*) = 0 from mcon
          where contype='c' and (def ilike '%walkover%' or def ilike '%retired%'))

-- ── 9. 개인정보 경계 ────────────────────────────────────────────────────────
union all select 90, '[PII] matches 컬럼이 설계된 21개와 정확히 일치',
        (select count(*) = 21
                and count(*) filter (where column_name::text <> all(array[
                    'called_at','cancelled_at','completed_at','court_id','created_at',
                    'group_id','id','match_no','round_no','score1','score2','sequence_no',
                    'stage','started_at','status','team1_id','team2_id','tournament_id',
                    'updated_at','version','winner_team_id'])) = 0
           from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_matches')
union all select 91, '[PII] matches 에 DOB/나이 컬럼 없음',
        (select count(*) = 0 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_matches'
            and (column_name ilike '%birth%' or column_name ilike '%age%'
              or column_name ilike '%dob%'))
union all select 92, '[PII] 경기 RPC 가 registrations 를 참조하지 않음',
        (select count(*) = 0 from pg_proc p join all_fn a on a.oid = p.oid
          where p.prosrc ilike '%hosted_tournament_registrations%')
union all select 93, '[PII] 조회 RPC 가 teams 스냅샷만 사용',
        (select count(*)=1 from pg_proc p, fn where p.oid=fn.f_board
          and p.prosrc ilike '%hosted_tournament_teams%'
          and p.prosrc not ilike '%phone%' and p.prosrc not ilike '%depositor%')

-- ── 10. Batch 1·2 회귀 없음 ─────────────────────────────────────────────────
union all select 95, '[regression] Batch 1·2 테이블 5종 존재',
        (to_regclass('public.hosted_tournament_teams') is not null
     and to_regclass('public.hosted_tournament_courts') is not null
     and to_regclass('public.hosted_tournament_events') is not null
     and to_regclass('public.hosted_tournament_groups') is not null
     and to_regclass('public.hosted_tournament_group_members') is not null)
union all select 96, '[regression] Batch 2 주요 RPC 존재',
        (to_regprocedure('public.assign_group_team(text,integer,uuid,integer,integer)') is not null
     and to_regprocedure('public.lock_preliminary_draw(text,integer)') is not null
     and to_regprocedure('public.replace_preliminary_group_assignments(text,jsonb,integer)') is not null
     and to_regprocedure('public.create_tournament_groups(text,integer,boolean,integer)') is not null)
union all select 97, '[regression] submit RPC lockdown 유지',
        (select count(*) >= 1
                and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
                and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname='submit_tournament_registration')
union all select 98, '[regression] events 스키마 변경 없음(match 이미 허용)',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_events'::regclass and c.contype='c'
            and pg_get_constraintdef(c.oid) ilike '%match%')

-- ── 11. Production 보호 ─────────────────────────────────────────────────────
union all select 100, '[prod] 2026-teyeon-open 경기 0건',
        (select count(*) = 0 from public.hosted_tournament_matches m, prod
          where m.tournament_id = prod.id)
union all select 101, '[prod] 2026-teyeon-open 지문 null(미생성)',
        (select preliminary_matches_fingerprint is null from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 102, '[prod] 2026-teyeon-open 조편성 draft 유지',
        (select preliminary_draw_status = 'draft' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 103, '[prod] 대회 status registration_open 유지',
        (select status = 'registration_open' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 104, '[prod] 승격된 접수 0건',
        (select count(*) = 0 from public.hosted_tournament_teams
          where registration_id is not null)

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
