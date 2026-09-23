-- =============================================================================
-- POSTCHECK (READ-ONLY) — add_hosted_tournament_knockout_engine.sql 적용 후 (Batch 4C)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / 함수 호출 없음.
--     개인정보를 읽지 않는다 — 건수와 구조만 본다.
--   확인: ① 4C 함수 · guard 가 올라갔는가 ② 인덱스가 교체됐는가
--         ③ 마이그레이션이 데이터를 만들지 않았는가(본선 경기는 여전히 0)
--         ④ 예선 · 기존 경기가 그대로인가
--
--   ⚠ 참고: 4A postcheck 를 다시 돌리면 '핵심 인덱스 2종' 이 1 로 나온다.
--     hosted_tbslot_team_uniq → hosted_tbslot_team_round_uniq 로 교체했기 때문이며
--     4C 의 의도된 변경이다(아래 B 섹션이 정상 상태를 보여 준다).
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
m as (select x.stage, x.status, x.bracket_id, x.bracket_target_slot_id
        from public.hosted_tournament_matches x join t on t.id = x.tournament_id),
calc as (
    select
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                            'amend_knockout_match_score',
                            'hosted_tournament_knockout_create_match',
                            'hosted_tournament_knockout_advance'))                                      as fns_4c,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                            'amend_knockout_match_score')
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'))                                as fns_4c_auth,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and (p.proname like '%knockout%' or p.proname like '%bracket%')
          and has_function_privilege('anon', p.oid, 'EXECUTE'))                                         as anon_fns,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('hosted_tournament_knockout_create_match', 'hosted_tournament_knockout_advance')
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'))                                as helper_auth,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('complete_match', 'amend_completed_match_score')
          and pg_get_functiondef(p.oid) like '%knockout_requires_bracket_rpc%')                          as guard_two,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'cancel_match'
          and pg_get_functiondef(p.oid) like '%knockout_cancel_not_supported%')                          as guard_cancel,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_admin_bracket'
          and pg_get_functiondef(p.oid) like '%''matches'', v_matches%')                                 as admin_matches,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('call_match', 'uncall_match', 'start_match', 'generate_group_matches',
                            'restore_cancelled_match', 'get_preliminary_standings',
                            'resolve_group_age_tie', 'get_admin_match_board'))                          as fns_untouched,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tbslot_team_round_uniq')                                                as idx_new,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tbslot_team_uniq')                                                      as idx_old,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname in ('hosted_tmatch_bracket_target_uniq', 'hosted_tmatch_playing_court_uniq'))     as idx_keep,
      (select count(*) from pg_constraint
        where conname in ('hosted_tmatch_no_unique', 'hosted_tmatch_seq_unique',
                          'hosted_tmatch_distinct_teams', 'hosted_tmatch_completed_shape',
                          'hosted_tmatch_winner_member', 'hosted_tmatch_score_rule',
                          'hosted_tmatch_court_shape', 'hosted_tmatch_bracket_shape'))                   as cons_match,
      (select count(*) from m)                                                                          as prod_matches,
      (select count(*) from m where stage = 'preliminary')                                              as prod_prelim,
      (select count(*) from m where stage = 'placement')                                                as prod_place,
      (select count(*) from m where stage = 'knockout')                                                 as prod_knockout,
      (select count(*) from m where status = 'completed')                                               as prod_completed,
      (select count(*) from m where bracket_id is not null or bracket_target_slot_id is not null)        as prod_linked,
      (select coalesce(string_agg(b.status || '(v' || b.version || ')', ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)                     as prod_bracket,
      (select count(*) from public.hosted_tournament_bracket_slots)                                      as slots_all,
      (select count(*) from public.hosted_tournament_bracket_slots where slot_type = 'team')             as slots_team,
      (select count(*) from public.hosted_tournament_events
        where action in ('knockout_match_created', 'bracket_slot_advanced',
                         'bracket_matches_materialized'))                                               as evt_4c,
      (select count(*) from public.hosted_tournaments where slug like 'zz-fixture%')                     as fixture_left,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select r.registration_status || '=' || count(*) as s
            from public.hosted_tournament_registrations r join t on t.id = r.tournament_id
           group by r.registration_status) q)                                                           as reg_fingerprint
),
rows_out as (
    select 1 as ord, 'A. schema' as section, '4C 함수 5개' as item, (select fns_4c::text from calc) as value
    union all select 2, 'A. schema', '운영 RPC 3개 authenticated 실행', (select fns_4c_auth::text from calc)
    union all select 3, 'A. schema', '내부 helper authenticated 실행(0 이어야 함)', (select helper_auth::text from calc)
    union all select 4, 'A. schema', 'anon 실행 가능한 bracket · knockout 함수(0)', (select anon_fns::text from calc)
    union all select 5, 'A. schema', 'complete_match · amend guard', (select guard_two::text from calc)
    union all select 6, 'A. schema', 'cancel_match guard', (select guard_cancel::text from calc)
    union all select 7, 'A. schema', 'get_admin_bracket 경기 목록 확장', (select admin_matches::text from calc)
    union all select 8, 'A. schema', '손대지 않은 예선 · 호명 함수 8개', (select fns_untouched::text from calc)

    union all select 10, 'B. index', 'hosted_tbslot_team_round_uniq(신설)', (select idx_new::text from calc)
    union all select 11, 'B. index', 'hosted_tbslot_team_uniq(제거됨 → 0)', (select idx_old::text from calc)
    union all select 12, 'B. index', '유지돼야 할 인덱스 2종', (select idx_keep::text from calc)
    union all select 13, 'B. index', 'matches 핵심 제약 8종', (select cons_match::text from calc)

    union all select 20, 'C. 데이터', '2026-teyeon-open 경기 수', (select prod_matches::text from calc)
    union all select 21, 'C. 데이터', '  └ preliminary / placement',
              (select prod_prelim::text || ' / ' || prod_place::text from calc)
    union all select 22, 'C. 데이터', '  └ knockout(마이그레이션은 만들지 않는다)', (select prod_knockout::text from calc)
    union all select 23, 'C. 데이터', '  └ 완료 경기', (select prod_completed::text from calc)
    union all select 24, 'C. 데이터', 'bracket 컬럼이 채워진 경기', (select prod_linked::text from calc)
    union all select 25, 'C. 데이터', 'bracket 상태', (select prod_bracket from calc)
    union all select 26, 'C. 데이터', 'bracket 자리 수 / 팀이 놓인 자리',
              (select slots_all::text || ' / ' || slots_team::text from calc)
    union all select 27, 'C. 데이터', '4C 운영 이벤트(적용 직후 0)', (select evt_4c::text from calc)
    union all select 28, 'C. 데이터', 'self-test 잔재 대회(0)', (select fixture_left::text from calc)
    union all select 29, 'C. 데이터', '접수 상태 분포', (select reg_fingerprint from calc)

    union all select 90, 'VERDICT', 'SCHEMA APPLIED',
              (select case when fns_4c = 5 and fns_4c_auth = 3 and helper_auth = 0 and anon_fns = 0
                                and guard_two = 2 and guard_cancel = 1 and admin_matches = 1
                                and fns_untouched = 8 and idx_new = 1 and idx_old = 0
                                and idx_keep = 2 and cons_match = 8
                           then 'YES — 함수 · 권한 · guard · 인덱스 · 기존 제약 모두 정상'
                           else 'CHECK — 위 A · B 섹션 확인' end from calc)
    union all select 91, 'VERDICT', 'NO DATA CREATED BY MIGRATION',
              (select case when prod_knockout = 0 and prod_linked = 0 and evt_4c = 0 and fixture_left = 0
                           then 'YES — 4C 는 데이터를 만들지 않았다(본선 경기는 운영자가 만든다)'
                           else 'CHECK — 위 C 섹션 확인' end from calc))
select section, item, value from rows_out order by ord;
