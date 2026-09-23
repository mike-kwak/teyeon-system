-- =============================================================================
-- VERIFY — add_hosted_tournament_bracket.sql 적용 확인 (읽기 전용 · Batch 4A)
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
       and p.proname in ('create_bracket', 'set_bracket_entrants', 'set_bracket_structure',
                         'assign_bracket_slot', 'replace_bracket_slots', 'validate_bracket',
                         'lock_bracket', 'unlock_bracket', 'get_admin_bracket',
                         'hosted_tournament_bracket_begin', 'hosted_tournament_bracket_bump',
                         'hosted_tournament_bracket_validate')
),
matchfn as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('complete_match', 'start_match', 'call_match', 'generate_group_matches',
                         'amend_completed_match_score', 'cancel_match', 'get_preliminary_standings')
),
col as (
    select table_name, column_name, data_type, is_nullable
      from information_schema.columns where table_schema = 'public'
),
checks as (

-- ── A. 테이블 · 컬럼 ───────────────────────────────────────────────────────
select 1 as seq, 'A. bracket 테이블 4개 생성' as check_name, '4' as expected,
       (select count(*)::text from information_schema.tables
         where table_schema = 'public'
           and table_name in ('hosted_tournament_brackets', 'hosted_tournament_bracket_rounds',
                              'hosted_tournament_bracket_slots', 'hosted_tournament_bracket_entrants')) as actual
union all select 2, 'A. brackets 주요 컬럼', 'true',
       (select (count(*) = 6)::text from col where table_name = 'hosted_tournament_brackets'
         and column_name in ('declared_entrant_count', 'status', 'version', 'locked_at', 'published_at', 'completed_at'))
union all select 3, 'A. slots 주요 컬럼', 'true',
       (select (count(*) = 6)::text from col where table_name = 'hosted_tournament_bracket_slots'
         and column_name in ('round_no', 'position', 'slot_type', 'team_id', 'entrant_id', 'feeds_slot_id'))
union all select 4, 'A. entrants 스냅샷 컬럼', 'true',
       (select (count(*) = 5)::text from col where table_name = 'hosted_tournament_bracket_entrants'
         and column_name in ('source', 'source_group_no', 'source_rank', 'seed_no', 'snapshot_note'))
union all select 5, 'A. matches 연결 컬럼 2개 · nullable', 'YES|YES',
       coalesce((select string_agg(is_nullable, '|' order by column_name) from col
                  where table_name = 'hosted_tournament_matches'
                    and column_name in ('bracket_id', 'bracket_target_slot_id')), '(none)')
union all select 6, 'A. size 컬럼 없음(구조를 숫자로 만들지 않는다)', '0',
       (select count(*)::text from col where table_name = 'hosted_tournament_brackets' and column_name = 'size')
union all select 7, 'A. rounds 에 slot_count 저장 안 함', '0',
       (select count(*)::text from col where table_name = 'hosted_tournament_bracket_rounds'
         and column_name in ('slot_count', 'slots'))

-- ── B. 제약 · 인덱스 ──────────────────────────────────────────────────────
union all select 10, 'B. 대회당 bracket 1개 unique', '1',
       (select count(*)::text from pg_constraint where conname = 'hosted_tbracket_tournament_uniq')
union all select 11, 'B. 복합 FK 대상 unique 4종', '4',
       (select count(*)::text from pg_constraint
         where conname in ('hosted_tbracket_tid_id_uniq', 'hosted_tbround_tid_id_uniq',
                           'hosted_tbslot_tid_id_uniq', 'hosted_tbentrant_tid_id_uniq'))
union all select 12, 'B. slot 자리 unique (bracket, round, position)', '1',
       (select count(*)::text from pg_constraint where conname = 'hosted_tbslot_pos_uniq')
union all select 13, 'B. 한 팀은 한 자리 partial unique', '1',
       (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'hosted_tbslot_team_uniq')
union all select 14, 'B. 진출팀 중복 unique', '1',
       (select count(*)::text from pg_constraint where conname = 'hosted_tbentrant_team_uniq')
union all select 15, 'B. slot_type ↔ team_id 일관성 CHECK', 'true',
       coalesce((select (pg_get_constraintdef(oid) like '%slot_type%team_id%')::text
                   from pg_constraint where conname = 'hosted_tbslot_team_shape'), '(none)')
union all select 16, 'B. 자기 자신 연결 금지 CHECK', '1',
       (select count(*)::text from pg_constraint where conname = 'hosted_tbslot_self_feed')
union all select 17, 'B. feeds FK(같은 대회 slot)', '1',
       (select count(*)::text from pg_constraint where conname = 'hosted_tbslot_feeds_fk')
union all select 18, 'B. matches bracket FK 2종 + shape CHECK', '3',
       (select count(*)::text from pg_constraint
         where conname in ('hosted_tmatch_bracket_fk', 'hosted_tmatch_bracket_slot_fk', 'hosted_tmatch_bracket_shape'))
union all select 19, 'B. 본선 경기 멱등 키(destination 당 1경기)', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tmatch_bracket_target_uniq')
union all select 20, 'B. events entity_type 에 bracket · bracket_slot 추가', 'true',
       coalesce((select (pg_get_constraintdef(oid) like '%bracket%'
                         and pg_get_constraintdef(oid) like '%bracket_slot%'
                         and pg_get_constraintdef(oid) like '%tournament%'
                         and pg_get_constraintdef(oid) like '%match%')::text
                   from pg_constraint where conname = 'hosted_tevent_entity_type_check'), '(none)')

-- ── C. 기존 matches 제약 불변 ─────────────────────────────────────────────
union all select 30, 'C. team1/team2 NOT NULL 유지', 'NO|NO',
       coalesce((select string_agg(is_nullable, '|' order by column_name) from col
                  where table_name = 'hosted_tournament_matches'
                    and column_name in ('team1_id', 'team2_id')), '(none)')
union all select 31, 'C. distinct teams · score rule · completed shape · winner member 유지', '4',
       (select count(*)::text from pg_constraint
         where conname in ('hosted_tmatch_distinct_teams', 'hosted_tmatch_score_rule',
                           'hosted_tmatch_completed_shape', 'hosted_tmatch_winner_member'))
union all select 32, 'C. 코트 점유 partial unique 유지', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tmatch_playing_court_uniq')
union all select 33, 'C. group 필수 CHECK(knockout 예외) 유지', 'true',
       coalesce((select (pg_get_constraintdef(oid) like '%knockout%')::text
                   from pg_constraint where conname = 'hosted_tmatch_group_required'), '(none)')
union all select 34, 'C. 기존 Match Engine 함수에 bracket 로직 없음(4A 는 건드리지 않음)', 'false',
       (select bool_or(body like '%bracket%')::text from matchfn)

-- ── D. RPC 존재 · 보안 ────────────────────────────────────────────────────
union all select 40, 'D. bracket RPC 12개', '12', (select count(*)::text from fn)
union all select 41, 'D. 전부 SECURITY DEFINER + search_path 고정', 'true',
       (select bool_and(prosecdef and cfg like '%search_path=public, pg_temp%')::text from fn)
union all select 42, 'D. 운영진 검사 포함(공개 RPC 아님)', 'true',
       (select bool_and(body like '%can_manage_tournaments()%')::text from fn
         where proname in ('create_bracket', 'validate_bracket', 'get_admin_bracket',
                           'hosted_tournament_bracket_begin'))
union all select 43, 'D. 잠금 키 = hosted-tournament-bracket', 'true',
       coalesce((select (body like '%hosted-tournament-bracket:%')::text from fn
                  where proname = 'hosted_tournament_bracket_begin'), '(none)')
union all select 44, 'D. bracket 함수가 matches 잠금을 잡지 않음(잠금 순서 보호)', 'false',
       (select bool_or(body like '%hosted-tournament-matches:%')::text from fn)
union all select 45, 'D. version 필수 가드', 'true',
       (select bool_and(body like '%version_required%')::text from fn
         where proname in ('set_bracket_entrants', 'set_bracket_structure', 'assign_bracket_slot',
                           'replace_bracket_slots', 'lock_bracket', 'unlock_bracket'))
union all select 46, 'D. lock 상태 편집 차단', 'true',
       (select bool_and(body like '%bracket_locked%')::text from fn
         where proname in ('set_bracket_entrants', 'set_bracket_structure', 'assign_bracket_slot',
                           'replace_bracket_slots'))
union all select 47, 'D. unlock 사유 필수 + knockout 경기 가드', 'true',
       coalesce((select (body like '%reason_required%' and body like '%knockout_matches_exist%')::text
                   from fn where proname = 'unlock_bracket'), '(none)')
union all select 48, 'D. 구조 변경은 배치가 있으면 거부(자동 초기화 없음)', 'true',
       coalesce((select (body like '%slots_in_use%')::text from fn where proname = 'set_bracket_structure'), '(none)')
union all select 49, 'D. 연결을 서버가 만들지 않음(connections 필수)', 'true',
       coalesce((select (body like '%connections_required%')::text from fn where proname = 'set_bracket_structure'), '(none)')
union all select 50, 'D. 2라운드 이상 직접 편집 금지', 'true',
       coalesce((select (body like '%slot_not_editable%')::text from fn where proname = 'assign_bracket_slot'), '(none)')
union all select 51, 'D. 진출팀을 서버가 예선에서 자동 산출하지 않음', 'false',
       coalesce((select (body like '%get_preliminary_standings%')::text
                   from fn where proname = 'set_bracket_entrants'), '(none)')
union all select 52, 'D. BYE 자동 배치 코드 없음(자리 타입을 서버가 bye 로 바꾸지 않음)', 'false',
       (select bool_or(body like '%''bye''%' and proname in ('set_bracket_structure', 'lock_bracket'))::text from fn)
union all select 53, 'D. 4A 는 경기를 만들지 않음(본선 match INSERT 없음)', 'false',
       (select bool_or(body like '%insert into public.hosted_tournament_matches%')::text from fn)
union all select 54, 'D. 감사 기록 호출', 'true',
       (select bool_and(body like '%hosted_tournament_log_event%')::text from fn
         where proname in ('create_bracket', 'set_bracket_entrants', 'set_bracket_structure',
                           'assign_bracket_slot', 'replace_bracket_slots', 'lock_bracket', 'unlock_bracket'))

-- ── E. 권한 ───────────────────────────────────────────────────────────────
union all select 60, 'E. 내부 helper 3종 authenticated 실행 불가', 'false|false|false',
       has_function_privilege('authenticated', 'public.hosted_tournament_bracket_begin(text,integer)', 'EXECUTE')::text
       || '|' || has_function_privilege('authenticated', 'public.hosted_tournament_bracket_bump(uuid)', 'EXECUTE')::text
       || '|' || has_function_privilege('authenticated', 'public.hosted_tournament_bracket_validate(uuid)', 'EXECUTE')::text
union all select 61, 'E. 운영 RPC anon 실행 불가', 'false',
       (has_function_privilege('anon', 'public.create_bracket(text,text,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.set_bracket_entrants(text,jsonb,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.set_bracket_structure(text,jsonb,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.assign_bracket_slot(text,uuid,text,uuid,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.replace_bracket_slots(text,jsonb,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.validate_bracket(text)', 'EXECUTE')
        or has_function_privilege('anon', 'public.lock_bracket(text,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.unlock_bracket(text,text,integer)', 'EXECUTE')
        or has_function_privilege('anon', 'public.get_admin_bracket(text)', 'EXECUTE'))::text
union all select 62, 'E. 운영 RPC authenticated 실행 가능', 'true',
       (has_function_privilege('authenticated', 'public.create_bracket(text,text,integer)', 'EXECUTE')
        and has_function_privilege('authenticated', 'public.lock_bracket(text,integer)', 'EXECUTE')
        and has_function_privilege('authenticated', 'public.get_admin_bracket(text)', 'EXECUTE'))::text
union all select 63, 'E. anon 테이블 권한 0', 'false',
       (has_table_privilege('anon', 'public.hosted_tournament_brackets', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.hosted_tournament_bracket_rounds', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.hosted_tournament_bracket_slots', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.hosted_tournament_bracket_entrants', 'SELECT,INSERT,UPDATE,DELETE'))::text
union all select 64, 'E. authenticated 쓰기 권한 0', 'false',
       (has_table_privilege('authenticated', 'public.hosted_tournament_brackets', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.hosted_tournament_bracket_rounds', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.hosted_tournament_bracket_slots', 'INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.hosted_tournament_bracket_entrants', 'INSERT,UPDATE,DELETE'))::text
union all select 65, 'E. RLS 활성 4개 테이블', '4',
       (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relrowsecurity
           and c.relname in ('hosted_tournament_brackets', 'hosted_tournament_bracket_rounds',
                             'hosted_tournament_bracket_slots', 'hosted_tournament_bracket_entrants'))
union all select 66, 'E. SELECT 정책 4개(운영진 전용) · 쓰기 정책 0', '4|0',
       (select count(*) filter (where polcmd = 'r')::text || '|'
            || count(*) filter (where polcmd <> 'r')::text
          from pg_policy p join pg_class c on c.oid = p.polrelid
         where c.relname in ('hosted_tournament_brackets', 'hosted_tournament_bracket_rounds',
                             'hosted_tournament_bracket_slots', 'hosted_tournament_bracket_entrants'))
union all select 67, 'E. 공개(anon) bracket RPC 없음', '0',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like '%bracket%'
           and has_function_privilege('anon', p.oid, 'EXECUTE'))

-- ── F. 운영 데이터 (읽기 전용) ────────────────────────────────────────────
union all select 80, 'F. 2026-teyeon-open bracket 0개(4A 는 데이터를 만들지 않음)', '0',
       (select count(*)::text from public.hosted_tournament_brackets b
          join public.hosted_tournaments t on t.id = b.tournament_id
         where t.slug = '2026-teyeon-open')
union all select 81, 'F. bracket 컬럼이 채워진 기존 경기 0', '0',
       (select count(*)::text from public.hosted_tournament_matches
         where bracket_id is not null or bracket_target_slot_id is not null)
union all select 82, 'F. knockout 경기 0(4C 범위)', '0',
       (select count(*)::text from public.hosted_tournament_matches where stage = 'knockout')
)
select seq, check_name, expected, actual, (expected = actual) as pass
  from checks
union all
select 999, (case when bool_and(expected = actual) then 'ALL PASS' else 'FAIL 있음' end)
            || ' · ' || count(*) filter (where expected = actual) || '/' || count(*),
       '', '', bool_and(expected = actual)
  from checks
 order by seq;
