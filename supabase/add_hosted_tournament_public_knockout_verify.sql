-- =============================================================================
-- VERIFY — add_hosted_tournament_public_knockout.sql 적용 확인 (읽기 전용 · Batch 4D-2)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / RPC 호출 없음.
--   기대: 모든 행 pass = true, 마지막 행 'ALL PASS'.
-- =============================================================================

with
fn as (
    select p.proname, p.oid, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('publish_bracket', 'unpublish_bracket',
                         'get_public_knockout_bracket', 'hosted_tournament_public_slot_key')
),
untouched as (
    select p.proname, pg_get_functiondef(p.oid) as body
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                         'amend_knockout_match_score', 'resolve_bracket_qualifiers',
                         'unresolve_bracket_qualifier', 'lock_bracket', 'unlock_bracket',
                         'get_admin_bracket', 'get_public_preliminary_draw',
                         'publish_preliminary_draw', 'unpublish_preliminary_draw',
                         'hosted_tournament_bracket_validate')
),
checks as (

-- ── A. 함수 · 시그니처 ─────────────────────────────────────────────────────
select 1 as seq, 'A. 4D-2 함수 4개 생성' as check_name, '4' as expected,
       (select count(*)::text from fn) as actual
union all select 2, 'A. publish_bracket 시그니처', '1',
       (select count(*)::text from fn where proname = 'publish_bracket'
          and args = 'p_slug text, p_expected_version integer')
union all select 3, 'A. unpublish_bracket 시그니처', '1',
       (select count(*)::text from fn where proname = 'unpublish_bracket'
          and args = 'p_slug text, p_reason text, p_expected_version integer')
union all select 4, 'A. 공개 조회 RPC 시그니처', '1',
       (select count(*)::text from fn where proname = 'get_public_knockout_bracket'
          and args = 'p_slug text')
union all select 5, 'A. 전부 security definer', 'true',
       (select (bool_and(prosecdef))::text from fn where proname <> 'hosted_tournament_public_slot_key')
union all select 6, 'A. search_path 고정', 'true',
       (select (bool_and(cfg = 'search_path=public, pg_temp'))::text from fn
         where proname <> 'hosted_tournament_public_slot_key')
union all select 7, 'A. 공개 조회는 stable(쓰기 아님)', 'true',
       (select (p.provolatile = 's')::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'get_public_knockout_bracket')

-- ── B. 권한 ───────────────────────────────────────────────────────────────
union all select 10, 'B. 공개 조회만 anon 실행 가능', '1',
       (select count(*)::text from fn where has_function_privilege('anon', oid, 'EXECUTE'))
union all select 11, 'B.   └ 그 함수가 get_public_knockout_bracket', 'get_public_knockout_bracket',
       coalesce((select proname from fn where has_function_privilege('anon', oid, 'EXECUTE')), '(none)')
union all select 12, 'B. publish · unpublish 는 anon 불가', '0',
       (select count(*)::text from fn
         where proname in ('publish_bracket', 'unpublish_bracket')
           and has_function_privilege('anon', oid, 'EXECUTE'))
union all select 13, 'B. publish · unpublish 는 authenticated 실행 가능', '2',
       (select count(*)::text from fn
         where proname in ('publish_bracket', 'unpublish_bracket')
           and has_function_privilege('authenticated', oid, 'EXECUTE'))
union all select 14, 'B. 내부 키 helper 는 anon · authenticated 불가', 'true',
       (select (not has_function_privilege('anon', oid, 'EXECUTE')
                and not has_function_privilege('authenticated', oid, 'EXECUTE'))::text
          from fn where proname = 'hosted_tournament_public_slot_key')
union all select 15, 'B. PUBLIC 실행 가능 0', '0',
       (select count(*)::text from fn f
         where exists (select 1 from pg_proc p where p.oid = f.oid and p.proacl is null)
            or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                        where p.oid = f.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'))
union all select 16, 'B. bracket 테이블은 여전히 anon 접근 불가', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema = 'public' and grantee = 'anon'
           and table_name in ('hosted_tournament_brackets', 'hosted_tournament_bracket_rounds',
                              'hosted_tournament_bracket_slots', 'hosted_tournament_bracket_entrants',
                              'hosted_tournament_matches'))

-- ── C. 공개 규칙 ──────────────────────────────────────────────────────────
union all select 20, 'C. 확정 전에는 공개 불가', 'true',
       (select (body like '%bracket_not_locked%')::text from fn where proname = 'publish_bracket')
union all select 21, 'C. 중복 공개 거부', 'true',
       (select (body like '%already_published%')::text from fn where proname = 'publish_bracket')
union all select 22, 'C. 공개 직전 재검증', 'true',
       (select (body like '%hosted_tournament_bracket_validate%'
                and body like '%validation_failed%')::text from fn where proname = 'publish_bracket')
union all select 23, 'C. 미반영 qualifier 는 경고일 뿐 차단하지 않는다', 'true',
       (select (body like '%qualifiers_unresolved%')::text from fn where proname = 'publish_bracket')
union all select 24, 'C. 공개는 published_at 만 바꾼다(구조 · 자리 미변경)', '0',
       (select count(*)::text from fn where proname = 'publish_bracket'
           and (body like '%update public.hosted_tournament_bracket_slots%'
             or body like '%update public.hosted_tournament_matches%'
             or body like '%set status =%'))
union all select 25, 'C. 해제 사유 필수', 'true',
       (select (body like '%reason_required%')::text from fn where proname = 'unpublish_bracket')
union all select 26, 'C. 해제도 published_at 만 바꾼다', '0',
       (select count(*)::text from fn where proname = 'unpublish_bracket'
           and (body like '%update public.hosted_tournament_bracket_slots%'
             or body like '%update public.hosted_tournament_matches%'
             or body like '%set status =%'))
-- ⚠ 예선 DRAW 공개(publish_preliminary_draw)는 preliminary_draw_published_at 을 세운다 — 대상이 다르다.
union all select 27, 'C. 본선 자동 공개 경로 없음(publish_bracket 외에는 세우지 않음)', '0',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname <> 'publish_bracket'
           and pg_get_functiondef(p.oid) like '%hosted_tournament_brackets%'
           and pg_get_functiondef(p.oid) like '%set published_at = now()%')
union all select 28, 'C. 공개 상태 변경을 감사에 남긴다', 'true',
       (select (bool_and(body like '%hosted_tournament_log_event%'))::text from fn
         where proname in ('publish_bracket', 'unpublish_bracket'))

-- ── D. 공개 payload 안전성 ────────────────────────────────────────────────
union all select 30, 'D. 비공개 상태는 구조를 주지 않는다', 'true',
       (select (body like '%''available'', false%' and body like '%not_published%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 31, 'D. 공개 조건 3종(대회 공개 · 확정 · 공개시각)', 'true',
       (select (body like '%v_tstatus = ''draft''%'
                and body like '%status not in (''locked'', ''completed'')%'
                and body like '%published_at is null%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 32, 'D. registrations 를 읽지 않는다', '0',
       (select count(*)::text from fn where proname = 'get_public_knockout_bracket'
           and body like '%hosted_tournament_registrations%')
union all select 33, 'D. UUID 컬럼을 반환하지 않는다', '0',
       (select count(*)::text from fn where proname = 'get_public_knockout_bracket'
           and (body like '%''id'', s.id%' or body like '%''id'', m.id%'
             or body like '%''teamId''%' or body like '%''bracketId''%'
             or body like '%''slotId''%' or body like '%''matchId''%'))
union all select 34, 'D. 공개 키를 좌표로 만든다', 'true',
       (select (body like '%hosted_tournament_public_slot_key%'
                and body like '%''t'' || t.team_no%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 35, 'D. 코트는 진행 중일 때만', 'true',
       (select (body like '%when m.status = ''playing'' then c.court_no%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 36, 'D. 점수는 완료일 때만', 'true',
       (select (body like '%when m.status = ''completed'' then m.score1%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 37, 'D. 승자는 side 로만(UUID 아님)', 'true',
       (select (body like '%''winnerSide''%')::text from fn where proname = 'get_public_knockout_bracket')
union all select 38, 'D. 우승자는 본선 완료 후에만', 'true',
       (select (body like '%v_b.status = ''completed'' then%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 39, 'D. qualifier 출처를 그대로 내려 준다', 'true',
       (select (body like '%''sourceKind''%' and body like '%s.source_kind%'
                and body like '%''sourceLabel''%' and body like '%''resolved''%'
                and body like '%hosted_tournament_qualifier_label%')::text
          from fn where proname = 'get_public_knockout_bracket')
union all select 40, 'D. 검증 결과 · 운영 메모를 공개하지 않는다', '0',
       (select count(*)::text from fn where proname = 'get_public_knockout_bracket'
           and (body like '%''validation''%' or body like '%snapshot_note%'
             or body like '%hosted_tournament_events%'))
union all select 41, 'D. 취소된 경기는 공개하지 않는다', 'true',
       (select (body like '%m.status <> ''cancelled''%')::text
          from fn where proname = 'get_public_knockout_bracket')

-- ── E. 기존 기능 무변경 ───────────────────────────────────────────────────
union all select 50, 'E. 4C · 4D-0 · 예선 공개 함수 12개 그대로 존재', '12',
       (select count(*)::text from untouched)
union all select 51, 'E. 그 함수들에 공개 로직이 스며들지 않음', '0',
       (select count(*)::text from untouched where body like '%get_public_knockout_bracket%')
union all select 52, 'E. 예선 공개 RPC 는 여전히 anon 실행 가능', '1',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'get_public_preliminary_draw'
           and has_function_privilege('anon', p.oid, 'EXECUTE'))
union all select 53, 'E. 예선 공개 컬럼(preliminary_draw_published_at) 유지', '1',
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'hosted_tournaments'
           and column_name = 'preliminary_draw_published_at')
union all select 54, 'E. bracket 테이블 · 컬럼 불변', 'true',
       (select (count(*) = 4)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'hosted_tournament_brackets'
           and column_name in ('status', 'version', 'locked_at', 'published_at'))
union all select 55, 'E. qualifier 컬럼 유지(4D-0)', '4',
       (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'hosted_tournament_bracket_slots'
           and column_name in ('source_kind', 'source_group_no', 'source_rank', 'resolved_at'))

-- ── F. 운영 데이터 (읽기 전용) ────────────────────────────────────────────
union all select 90, 'F. 마이그레이션이 공개 상태를 바꾸지 않았다', '0',
       (select count(*)::text from public.hosted_tournament_brackets where published_at is not null)
union all select 91, 'F. 공개 관련 이벤트 0(적용 직후)', '0',
       (select count(*)::text from public.hosted_tournament_events
         where action in ('publish_bracket', 'unpublish_bracket'))
)
select seq, check_name, expected, actual, (expected = actual) as pass
  from checks
union all
select 999, (case when bool_and(expected = actual) then 'ALL PASS' else 'FAIL 있음' end)
            || ' · ' || count(*) filter (where expected = actual) || '/' || count(*),
       '', '', bool_and(expected = actual)
  from checks
 order by seq;
