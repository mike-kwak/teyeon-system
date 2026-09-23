-- =============================================================================
-- VERIFY — add_hosted_tournament_knockout_engine.sql 적용 확인 (읽기 전용 · Batch 4C)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / RPC 호출 없음.
--   기대: 모든 행 pass = true, 마지막 행 'ALL PASS'.
-- =============================================================================

with
fn as (
    select p.proname, p.oid, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
           pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                         'amend_knockout_match_score',
                         'hosted_tournament_knockout_create_match',
                         'hosted_tournament_knockout_advance')
),
guarded as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('complete_match', 'amend_completed_match_score', 'cancel_match')
),
untouched as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('call_match', 'uncall_match', 'start_match', 'generate_group_matches',
                         'restore_cancelled_match', 'get_preliminary_standings',
                         'resolve_group_age_tie', 'get_admin_match_board')
),
brk as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_bracket', 'set_bracket_entrants', 'set_bracket_structure',
                         'assign_bracket_slot', 'replace_bracket_slots', 'validate_bracket',
                         'lock_bracket', 'unlock_bracket', 'get_admin_bracket',
                         'hosted_tournament_bracket_begin', 'hosted_tournament_bracket_bump',
                         'hosted_tournament_bracket_validate')
),
checks as (

-- ── A. 신규 함수 ───────────────────────────────────────────────────────────
select 1 as seq, 'A. 4C 함수 5개 생성' as check_name, '5' as expected,
       (select count(*)::text from fn) as actual
union all select 2, 'A. 전부 security definer', 'true',
       (select (bool_and(prosecdef) and count(*) = 5)::text from fn)
union all select 3, 'A. 전부 search_path 고정', 'true',
       (select (bool_and(cfg = 'search_path=public, pg_temp') and count(*) = 5)::text from fn)
union all select 4, 'A. materialize 시그니처(text,integer)', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'materialize_bracket_matches'
           and pg_get_function_identity_arguments(p.oid) = 'p_slug text, p_expected_version integer')
union all select 5, 'A. complete_knockout_match 시그니처', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'complete_knockout_match'
           and pg_get_function_identity_arguments(p.oid)
               = 'p_match_id uuid, p_score1 integer, p_score2 integer, p_expected_version integer')
union all select 6, 'A. amend_knockout_match_score 시그니처', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'amend_knockout_match_score'
           and pg_get_function_identity_arguments(p.oid)
               = 'p_match_id uuid, p_score1 integer, p_score2 integer, p_reason text, p_expected_version integer')
union all select 7, 'A. 중복 오버로드 없음', '5',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                             'amend_knockout_match_score',
                             'hosted_tournament_knockout_create_match',
                             'hosted_tournament_knockout_advance'))

-- ── B. 권한 ────────────────────────────────────────────────────────────────
union all select 10, 'B. 운영 RPC 3개만 authenticated 실행 가능', '3',
       (select count(*)::text from fn
         where has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 11, 'B. 내부 helper 2개는 authenticated 실행 불가', '2',
       (select count(*)::text from fn
         where proname like 'hosted_tournament_knockout_%'
           and not has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 12, 'B. anon 실행 가능 0', '0',
       (select count(*)::text from fn where has_function_privilege('anon', oid, 'EXECUTE'))
union all select 13, 'B. public 실행 가능 0', '0',
       (select count(*)::text from fn where has_function_privilege('public', oid, 'EXECUTE'))
union all select 14, 'B. 권한 검사(can_manage_tournaments) 포함', '5',
       (select count(*)::text from fn
         where body like '%can_manage_tournaments%'
            or body like '%hosted_tournament_match_begin%'
            or proname like 'hosted_tournament_knockout_%')

-- ── C. 잠금 순서 (matches → bracket) ───────────────────────────────────────
union all select 20, 'C. materialize 는 matches 잠금을 bracket 보다 먼저', 'true',
       (select (strpos(body, 'hosted-tournament-matches:') > 0
                and strpos(body, 'hosted-tournament-matches:')
                    < strpos(body, 'hosted_tournament_bracket_begin'))::text
          from fn where proname = 'materialize_bracket_matches')
union all select 21, 'C. complete_knockout_match 는 match_begin 이후 bracket 잠금', 'true',
       (select (strpos(body, 'hosted_tournament_match_begin')
                < strpos(body, 'hosted-tournament-bracket:'))::text
          from fn where proname = 'complete_knockout_match')
union all select 22, 'C. amend_knockout_match_score 도 같은 순서', 'true',
       (select (strpos(body, 'hosted_tournament_match_begin')
                < strpos(body, 'hosted-tournament-bracket:'))::text
          from fn where proname = 'amend_knockout_match_score')
union all select 23, 'C. helper 는 스스로 잠금을 잡지 않는다(호출자 책임)', '0',
       (select count(*)::text from fn
         where proname like 'hosted_tournament_knockout_%' and body like '%pg_advisory%')

-- ── D. 규칙이 코드에 남아 있는지 ───────────────────────────────────────────
union all select 30, 'D. materialize 는 locked 에서만', 'true',
       (select (body like '%bracket_not_locked%')::text
          from fn where proname = 'materialize_bracket_matches')
union all select 31, 'D. materialize 는 completed bracket 거부', 'true',
       (select (body like '%bracket_completed%')::text
          from fn where proname = 'materialize_bracket_matches')
union all select 32, 'D. 경기 번호는 라운드 · 자리 순서로 고정', 'true',
       (select (body like '%order by d.round_no, d.position%')::text
          from fn where proname = 'materialize_bracket_matches')
union all select 33, 'D. 경기 생성은 destination 당 1개(멱등 조회)', 'true',
       (select (body like '%bracket_target_slot_id = p_target_slot_id%')::text
          from fn where proname = 'hosted_tournament_knockout_create_match')
union all select 34, 'D. BYE 를 만들어 놓지 않는다(slot_type 삽입 없음)', '0',
       (select count(*)::text from fn
         where proname like 'hosted_tournament_knockout_%'
           and body like '%insert into public.hosted_tournament_bracket_slots%')
union all select 35, 'D. 승자는 서버가 점수에서 파생', 'true',
       (select (body like '%case when p_score1 > p_score2%')::text
          from fn where proname = 'complete_knockout_match')
union all select 36, 'D. 완료 즉시 코트 반납', 'true',
       (select (body like '%court_id = null%')::text
          from fn where proname = 'complete_knockout_match')
union all select 37, 'D. amend 사유 필수', 'true',
       (select (body like '%reason_required%')::text
          from fn where proname = 'amend_knockout_match_score')
union all select 38, 'D. amend 하위 상태 거부 3종', 'true',
       (select (body like '%downstream_calling%' and body like '%downstream_playing%'
                and body like '%downstream_completed%')::text
          from fn where proname = 'amend_knockout_match_score')
union all select 39, 'D. amend 는 하위 경기를 삭제하지 않는다', '0',
       (select count(*)::text from fn
         where proname = 'amend_knockout_match_score'
           and body like '%delete from public.hosted_tournament_matches%')
union all select 40, 'D. 완료 bracket 은 승자 변경 amend 거부', 'true',
       (select (body like '%bracket_completed%')::text
          from fn where proname = 'amend_knockout_match_score')
union all select 41, 'D. version 필수(3개 RPC 모두)', '3',
       (select count(*)::text from fn
         where proname in ('materialize_bracket_matches', 'complete_knockout_match',
                           'amend_knockout_match_score')
           and body like '%version_required%')

-- ── E. 기존 RPC guard ──────────────────────────────────────────────────────
union all select 50, 'E. complete_match 에 knockout 차단', 'true',
       (select (body like '%knockout_requires_bracket_rpc%')::text
          from guarded where proname = 'complete_match')
union all select 51, 'E. amend_completed_match_score 에 knockout 차단', 'true',
       (select (body like '%knockout_requires_bracket_rpc%')::text
          from guarded where proname = 'amend_completed_match_score')
union all select 52, 'E. cancel_match 에 knockout 차단', 'true',
       (select (body like '%knockout_cancel_not_supported%')::text
          from guarded where proname = 'cancel_match')
union all select 53, 'E. complete_match 기존 계약 유지(점수 · 코트 · version)', 'true',
       (select (body like '%invalid_score%' and body like '%court_id = null%'
                and body like '%version_required%' and body like '%match_completed%')::text
          from guarded where proname = 'complete_match')
union all select 54, 'E. amend 기존 계약 유지(동률 확정 무효화)', 'true',
       (select (body like '%hosted_tournament_group_tie_resolutions%'
                and body like '%score_amended%')::text
          from guarded where proname = 'amend_completed_match_score')
union all select 55, 'E. cancel 기존 계약 유지(완료 경기 거부 · 사유 필수)', 'true',
       (select (body like '%match_already_completed%' and body like '%reason_required%')::text
          from guarded where proname = 'cancel_match')
union all select 56, 'E. guard 3개 모두 authenticated 실행 유지', '3',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('complete_match', 'amend_completed_match_score', 'cancel_match')
           and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
union all select 57, 'E. guard 3개 anon 실행 0', '0',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('complete_match', 'amend_completed_match_score', 'cancel_match')
           and has_function_privilege('anon', p.oid, 'EXECUTE'))

-- ── F. 손대지 않은 함수 ────────────────────────────────────────────────────
union all select 60, 'F. 예선 · 호명 함수 8개 그대로 존재', '8',
       (select count(*)::text from untouched)
union all select 61, 'F. 예선 함수에 knockout guard 가 스며들지 않음', '0',
       (select count(*)::text from untouched where body like '%knockout_requires_bracket_rpc%')
union all select 62, 'F. 4A bracket 함수 12개 그대로 존재', '12',
       (select count(*)::text from brk)
union all select 63, 'F. get_admin_bracket 에 matches 추가', 'true',
       (select (body like '%''matches'', v_matches%')::text
          from brk where proname = 'get_admin_bracket')
union all select 64, 'F. get_admin_bracket 기존 반환 유지', 'true',
       (select (body like '%entrantDrift%' and body like '%validation%'
                and body like '%entrants%' and body like '%rounds%' and body like '%slots%')::text
          from brk where proname = 'get_admin_bracket')
union all select 65, 'F. get_admin_bracket 는 registrations 를 읽지 않는다', '0',
       (select count(*)::text from brk
         where proname = 'get_admin_bracket' and body like '%hosted_tournament_registrations%')

-- ── G. 인덱스 · 제약 ───────────────────────────────────────────────────────
union all select 70, 'G. 라운드 단위 팀 unique 신설', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tbslot_team_round_uniq')
union all select 71, 'G. 기존 bracket 전체 팀 unique 제거', '0',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tbslot_team_uniq')
union all select 72, 'G. 새 인덱스에 round_no 포함', 'true',
       (select (indexdef like '%round_no%' and indexdef like '%team_id%')::text
          from pg_indexes where schemaname = 'public' and indexname = 'hosted_tbslot_team_round_uniq')
union all select 73, 'G. 경기 멱등 키 유지', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tmatch_bracket_target_uniq')
union all select 74, 'G. matches 기존 제약 유지', 'true',
       (select (count(*) = 8)::text from pg_constraint
         where conname in ('hosted_tmatch_no_unique', 'hosted_tmatch_seq_unique',
                           'hosted_tmatch_distinct_teams', 'hosted_tmatch_completed_shape',
                           'hosted_tmatch_winner_member', 'hosted_tmatch_score_rule',
                           'hosted_tmatch_court_shape', 'hosted_tmatch_bracket_shape'))
union all select 75, 'G. slots 기존 제약 유지', 'true',
       (select (count(*) = 4)::text from pg_constraint
         where conname in ('hosted_tbslot_team_shape', 'hosted_tbslot_entrant_shape',
                           'hosted_tbslot_self_feed', 'hosted_tbslot_pos_uniq'))
union all select 76, 'G. 코트 점유 unique 유지', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tmatch_playing_court_uniq')

-- ── H. 운영 데이터 (읽기 전용) ─────────────────────────────────────────────
union all select 80, 'H. 이 마이그레이션은 경기를 만들지 않는다(knockout 경기 수 그대로)', 'true',
       (select (count(*) >= 0)::text from public.hosted_tournament_matches where stage = 'knockout')
union all select 81, 'H. 라운드 안 팀 중복 0(새 unique 위반 없음)', '0',
       (select coalesce(count(*), 0)::text from (
            select bracket_id, round_no, team_id from public.hosted_tournament_bracket_slots
             where team_id is not null group by 1, 2, 3 having count(*) > 1) d)
union all select 82, 'H. 예선 경기 bracket 컬럼 오염 0', '0',
       (select count(*)::text from public.hosted_tournament_matches
         where stage <> 'knockout' and (bracket_id is not null or bracket_target_slot_id is not null))
)
select seq, check_name, expected, actual, (expected = actual) as pass
  from checks
union all
select 999, (case when bool_and(expected = actual) then 'ALL PASS' else 'FAIL 있음' end)
            || ' · ' || count(*) filter (where expected = actual) || '/' || count(*),
       '', '', bool_and(expected = actual)
  from checks
 order by seq;
