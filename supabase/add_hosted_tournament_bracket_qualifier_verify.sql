-- =============================================================================
-- VERIFY — add_hosted_tournament_bracket_qualifier.sql 적용 확인 (읽기 전용 · Batch 4D-0)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / RPC 호출 없음.
--   기대: 모든 행 pass = true, 마지막 행 'ALL PASS'.
-- =============================================================================

with
col as (
    select column_name, is_nullable, data_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'hosted_tournament_bracket_slots'
),
fn as (
    select p.proname, p.oid, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                         'hosted_tournament_qualifier_label', 'hosted_tournament_qualifier_downstream',
                         'assign_bracket_slot', 'replace_bracket_slots',
                         'hosted_tournament_bracket_validate', 'get_admin_bracket')
),
ko as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                         'amend_knockout_match_score', 'hosted_tournament_knockout_create_match',
                         'hosted_tournament_knockout_advance', 'complete_match',
                         'cancel_match', 'amend_completed_match_score')
),
pre as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_preliminary_standings', 'hosted_tournament_preliminary_standings_core',
                         'get_public_preliminary_draw', 'generate_group_matches', 'call_match',
                         'start_match', 'uncall_match', 'lock_bracket', 'unlock_bracket',
                         'create_bracket', 'set_bracket_entrants', 'set_bracket_structure')
),
checks as (

-- ── A. 컬럼 ────────────────────────────────────────────────────────────────
select 1 as seq, 'A. qualifier 컬럼 4개' as check_name, '4' as expected,
       (select count(*)::text from col
         where column_name in ('source_kind', 'source_group_no', 'source_rank', 'resolved_at')) as actual
union all select 2, 'A. 전부 nullable(기존 행 영향 없음)', 'YES|YES|YES|YES',
       coalesce((select string_agg(is_nullable, '|' order by column_name) from col
                  where column_name in ('resolved_at', 'source_group_no', 'source_kind', 'source_rank')), '(none)')
union all select 3, 'A. 기존 slots 컬럼 유지', 'true',
       (select (count(*) = 6)::text from col
         where column_name in ('round_no', 'position', 'slot_type', 'team_id', 'entrant_id', 'feeds_slot_id'))

-- ── B. 제약 · 인덱스 ──────────────────────────────────────────────────────
union all select 10, 'B. slot_type 값 목록 CHECK 교체(4값)', 'true',
       (select (count(*) = 1)::text from pg_constraint
         where conname = 'hosted_tbslot_type_check'
           and pg_get_constraintdef(oid) like '%team%'
           and pg_get_constraintdef(oid) like '%bye%'
           and pg_get_constraintdef(oid) like '%tbd%'
           and pg_get_constraintdef(oid) like '%qualifier%')
union all select 11, 'B. 옛 3값 CHECK 제거', '0',
       (select count(*)::text from pg_constraint
         where conrelid = 'public.hosted_tournament_bracket_slots'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%slot_type%'
           and pg_get_constraintdef(oid) like '%tbd%'
           and pg_get_constraintdef(oid) not like '%qualifier%')
union all select 12, 'B. qualifier 정합성 CHECK 4종', 'true',
       (select (count(*) = 4)::text from pg_constraint
         where conname in ('hosted_tbslot_source_kind_check', 'hosted_tbslot_qualifier_shape',
                           'hosted_tbslot_qualifier_round', 'hosted_tbslot_resolved_shape'))
union all select 13, 'B. 같은 조·순위 중복 방지 인덱스', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tbslot_source_uniq')
union all select 14, 'B. 4A · 4C 기존 제약 유지', 'true',
       (select (count(*) = 3)::text from pg_constraint
         where conname in ('hosted_tbslot_team_shape', 'hosted_tbslot_entrant_shape', 'hosted_tbslot_self_feed'))
union all select 15, 'B. 4C 라운드 팀 unique 유지', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tbslot_team_round_uniq')
union all select 16, 'B. 경기 멱등 키 유지', '1',
       (select count(*)::text from pg_indexes
         where schemaname = 'public' and indexname = 'hosted_tmatch_bracket_target_uniq')

-- ── C. 함수 존재 · 시그니처 ───────────────────────────────────────────────
union all select 20, 'C. 4D-0 신규 함수 4개', '4',
       (select count(*)::text from fn
         where proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                           'hosted_tournament_qualifier_label', 'hosted_tournament_qualifier_downstream'))
union all select 21, 'C. assign_bracket_slot 두 버전(5인자 호환 + 7인자)', '2',
       (select count(*)::text from fn where proname = 'assign_bracket_slot')
union all select 22, 'C. 5인자 호환 래퍼 존재', '1',
       (select count(*)::text from fn where proname = 'assign_bracket_slot'
          and args = 'p_slug text, p_slot_id uuid, p_slot_type text, p_team_id uuid, p_expected_version integer')
union all select 23, 'C. 7인자 신규 버전 존재', '1',
       (select count(*)::text from fn where proname = 'assign_bracket_slot'
          and args = 'p_slug text, p_slot_id uuid, p_slot_type text, p_team_id uuid, '
                     || 'p_source_group_no integer, p_source_rank integer, p_expected_version integer')
union all select 24, 'C. 5인자가 7인자에 위임', 'true',
       (select (body like '%null::integer, null::integer, p_expected_version%')::text
          from fn where proname = 'assign_bracket_slot'
           and args = 'p_slug text, p_slot_id uuid, p_slot_type text, p_team_id uuid, p_expected_version integer')
union all select 25, 'C. resolve 시그니처', '1',
       (select count(*)::text from fn where proname = 'resolve_bracket_qualifiers'
          and args = 'p_slug text, p_expected_version integer')
union all select 26, 'C. unresolve 시그니처', '1',
       (select count(*)::text from fn where proname = 'unresolve_bracket_qualifier'
          and args = 'p_slug text, p_position integer, p_reason text, p_expected_version integer')
union all select 27, 'C. security definer', 'true',
       (select (bool_and(prosecdef))::text from fn
         where proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                           'hosted_tournament_qualifier_downstream', 'assign_bracket_slot',
                           'replace_bracket_slots', 'hosted_tournament_bracket_validate', 'get_admin_bracket'))
union all select 28, 'C. search_path 고정', 'true',
       (select (bool_and(cfg = 'search_path=public, pg_temp'))::text from fn
         where proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                           'hosted_tournament_qualifier_downstream', 'assign_bracket_slot',
                           'replace_bracket_slots', 'hosted_tournament_bracket_validate', 'get_admin_bracket'))

-- ── D. 권한 ───────────────────────────────────────────────────────────────
union all select 30, 'D. 운영 RPC authenticated 실행(resolve · unresolve)', '2',
       (select count(*)::text from fn
         where proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier')
           and has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 31, 'D. assign 두 버전 모두 authenticated 실행', '2',
       (select count(*)::text from fn where proname = 'assign_bracket_slot'
           and has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 32, 'D. 내부 helper 는 authenticated 실행 불가', '2',
       (select count(*)::text from fn
         where proname in ('hosted_tournament_qualifier_label', 'hosted_tournament_qualifier_downstream')
           and not has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 33, 'D. validate 는 authenticated 직접 실행 불가(4A 그대로)', '1',
       (select count(*)::text from fn where proname = 'hosted_tournament_bracket_validate'
           and not has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 34, 'D. anon 실행 가능 0', '0',
       (select count(*)::text from fn where has_function_privilege('anon', oid, 'EXECUTE'))
union all select 35, 'D. PUBLIC 실행 가능 0', '0',
       (select count(*)::text from fn f
         where f.oid in (select oid from pg_proc p where p.proacl is null)
            or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                        where p.oid = f.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'))

-- ── E. validate 규칙 ──────────────────────────────────────────────────────
union all select 40, 'E. 진출팀 0 + qualifier 있으면 no_entrants 아님', 'true',
       (select (body like '%v_entrants = 0 and v_qualifiers = 0%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 41, 'E. qualifier 조 존재 검사', 'true',
       (select (body like '%qualifier_group_missing%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 42, 'E. qualifier 순위 범위 검사', 'true',
       (select (body like '%qualifier_rank_out_of_range%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 43, 'E. 진출 인원 초과 순위는 warning', 'true',
       (select (body like '%qualifier_rank_beyond_qualify%' and body like '%''severity'', ''warning''%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 44, 'E. 조편성 locked 여부로 심각도 결정', 'true',
       (select (body like '%preliminary_draw_status%' and body like '%v_draw = ''locked''%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 45, 'E. qualify 상수를 다시 적지 않는다(코어 값 사용)', 'true',
       (select (body like '%qualifyPerGroup%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 46, 'E. 기존 구조 규칙 유지', 'true',
       (select (body like '%bye_vs_bye%' and body like '%bye_outside_first_round%'
                and body like '%unassigned_first_round_slot%' and body like '%non_tbd_future_slot%'
                and body like '%slot_team_not_entrant%' and body like '%entrant_not_placed%'
                and body like '%feeder_count_invalid%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')
union all select 47, 'E. summary 에 qualifiers · resolved 추가', 'true',
       (select (body like '%''qualifiers'', v_qualifiers%' and body like '%''resolved'', v_resolved%')::text
          from fn where proname = 'hosted_tournament_bracket_validate')

-- ── F. resolve 규칙 ───────────────────────────────────────────────────────
union all select 50, 'F. 확정(lock) 전에는 반영 불가', 'true',
       (select (body like '%bracket_not_locked%')::text from fn where proname = 'resolve_bracket_qualifiers')
union all select 51, 'F. 완료된 본선은 반영 불가', 'true',
       (select (body like '%bracket_completed%')::text from fn where proname = 'resolve_bracket_qualifiers')
union all select 52, 'F. 공식 확정 조건 4종', 'true',
       (select (body like '%rank_not_final%' and body like '%tie_unresolved%'
                and body like '%cancelled_present%' and body like '%rank_out_of_range%')::text
          from fn where proname = 'resolve_bracket_qualifiers')
union all select 53, 'F. 같은 팀 중복 배치 차단', 'true',
       (select (body like '%team_already_placed%')::text from fn where proname = 'resolve_bracket_qualifiers')
union all select 54, 'F. 순위를 새로 계산하지 않고 코어를 읽는다', 'true',
       (select (body like '%hosted_tournament_preliminary_standings_core%')::text
          from fn where proname = 'resolve_bracket_qualifiers')
union all select 55, 'F. source 를 지우지 않는다(보존)', '0',
       (select count(*)::text from fn where proname = 'resolve_bracket_qualifiers'
           and body like '%source_kind = null%')
union all select 56, 'F. 진출팀 스냅샷을 함께 남긴다', 'true',
       (select (body like '%insert into public.hosted_tournament_bracket_entrants%')::text
          from fn where proname = 'resolve_bracket_qualifiers')
union all select 57, 'F. 경기를 만들지 않는다', '0',
       (select count(*)::text from fn where proname = 'resolve_bracket_qualifiers'
           and body like '%insert into public.hosted_tournament_matches%')
union all select 58, 'F. 자동 실행 트리거 없음', '0',
       (select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal
           and c.relname in ('hosted_tournament_matches', 'hosted_tournament_bracket_slots',
                             'hosted_tournament_groups'))

-- ── G. unresolve 규칙 ─────────────────────────────────────────────────────
union all select 60, 'G. 사유 필수', 'true',
       (select (body like '%reason_required%')::text from fn where proname = 'unresolve_bracket_qualifier')
union all select 61, 'G. 하위 진행 거부 3종', 'true',
       (select (body like '%downstream_%' and body like '%calling%'
                and body like '%playing%' and body like '%completed%')::text
          from fn where proname = 'unresolve_bracket_qualifier')
union all select 62, 'G. 대기 경기만 삭제(status 한정)', 'true',
       (select (body like '%and stage = ''knockout'' and status = ''waiting''%')::text
          from fn where proname = 'unresolve_bracket_qualifier')
union all select 63, 'G. 삭제 전 기록(silent delete 금지)', 'true',
       (select (strpos(body, 'knockout_match_removed')
                < strpos(body, 'delete from public.hosted_tournament_matches'))::text
          from fn where proname = 'unresolve_bracket_qualifier')
union all select 64, 'G. 잠금 순서 matches → bracket', 'true',
       (select (strpos(body, 'hosted-tournament-matches:') > 0
                and strpos(body, 'hosted-tournament-matches:')
                    < strpos(body, 'hosted_tournament_bracket_begin'))::text
          from fn where proname = 'unresolve_bracket_qualifier')
union all select 65, 'G. resolve 는 matches 를 잠그지 않는다(경기 미접근)', '0',
       (select count(*)::text from fn where proname = 'resolve_bracket_qualifiers'
           and body like '%hosted-tournament-matches:%')
union all select 66, 'G. 예선 경기는 삭제 대상이 아니다', '0',
       (select count(*)::text from fn where proname = 'unresolve_bracket_qualifier'
           and body like '%stage = ''preliminary''%')

-- ── H. 4C 엔진 · 예선 무변경 ──────────────────────────────────────────────
union all select 70, 'H. 4C · guard 함수 8개 그대로 존재', '8',
       (select count(*)::text from ko)
union all select 71, 'H. 4C 함수에 qualifier 가 스며들지 않음', '0',
       (select count(*)::text from ko where body like '%qualifier%')
union all select 72, 'H. 예선 · bracket 기본 함수 12개 그대로 존재', '12',
       (select count(*)::text from pre)
union all select 73, 'H. 예선 함수에 qualifier 가 스며들지 않음', '0',
       (select count(*)::text from pre
         where proname in ('get_preliminary_standings', 'hosted_tournament_preliminary_standings_core',
                           'get_public_preliminary_draw', 'generate_group_matches')
           and body like '%qualifier%')
union all select 74, 'H. 경기 생성은 여전히 team feeder 만', 'true',
       (select (body like '%v_a.slot_type <> ''team'' or v_b.slot_type <> ''team''%')::text
          from ko where proname = 'hosted_tournament_knockout_create_match')

-- ── I. get_admin_bracket 확장 ─────────────────────────────────────────────
union all select 80, 'I. slots 에 source 필드 추가', 'true',
       (select (body like '%''sourceKind'', s.source_kind%' and body like '%''sourceLabel''%'
                and body like '%''resolvedAt'', s.resolved_at%')::text
          from fn where proname = 'get_admin_bracket')
union all select 81, 'I. 순위 정정 감지(qualifierDrift) 추가', 'true',
       (select (body like '%qualifier_resolution_stale%' and body like '%''qualifierDrift'', v_qdrift%')::text
          from fn where proname = 'get_admin_bracket')
union all select 82, 'I. 기존 반환 키 유지', 'true',
       (select (body like '%''matches'', v_matches%' and body like '%''entrantDrift'', v_drift%'
                and body like '%''validation''%' and body like '%''entrants'', v_entrants%')::text
          from fn where proname = 'get_admin_bracket')
union all select 83, 'I. registrations 를 읽지 않는다', '0',
       (select count(*)::text from fn where proname = 'get_admin_bracket'
           and body like '%hosted_tournament_registrations%')

-- ── J. 운영 데이터 (읽기 전용) ────────────────────────────────────────────
union all select 90, 'J. 마이그레이션이 qualifier 자리를 만들지 않았다', '0',
       (select count(*)::text from public.hosted_tournament_bracket_slots where slot_type = 'qualifier')
union all select 91, 'J. 반영된 자리 0', '0',
       (select count(*)::text from public.hosted_tournament_bracket_slots where resolved_at is not null)
union all select 92, 'J. source 가 채워진 자리 0', '0',
       (select count(*)::text from public.hosted_tournament_bracket_slots where source_kind is not null)
union all select 93, 'J. 같은 조·순위 중복 0', '0',
       (select count(*)::text from (
            select bracket_id, source_group_no, source_rank
              from public.hosted_tournament_bracket_slots
             where source_kind = 'group_rank' group by 1, 2, 3 having count(*) > 1) d)
)
select seq, check_name, expected, actual, (expected = actual) as pass
  from checks
union all
select 999, (case when bool_and(expected = actual) then 'ALL PASS' else 'FAIL 있음' end)
            || ' · ' || count(*) filter (where expected = actual) || '/' || count(*),
       '', '', bool_and(expected = actual)
  from checks
 order by seq;
