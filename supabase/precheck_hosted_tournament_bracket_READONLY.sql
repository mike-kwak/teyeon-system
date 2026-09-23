-- =============================================================================
-- PRECHECK (READ-ONLY) — add_hosted_tournament_bracket.sql 적용 전 확인 (Batch 4A)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / 함수 호출 없음.
--     개인정보(이름 · 전화 · 입금자 · 메모)를 읽지 않는다 — 건수와 구조만 본다.
--   대상: 2026-teyeon-open (+ 스키마 전역)
--   마지막 행이 판정이다.
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
m as (select x.stage, x.status from public.hosted_tournament_matches x join t on t.id = x.tournament_id),
calc as (
    select
      (select count(*) from information_schema.tables
        where table_schema = 'public' and table_name like 'hosted_tournament_bracket%')       as bracket_tables,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_matches'
          and column_name in ('bracket_id', 'bracket_target_slot_id'))                         as match_bracket_cols,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like '%bracket%')                             as bracket_fns,
      (select count(*) from m)                                                                 as prod_matches,
      (select count(*) from m where stage = 'knockout')                                        as prod_knockout,
      (select count(*) from m where stage = 'preliminary')                                     as prod_prelim,
      (select count(*) from m where stage = 'placement')                                       as prod_place,
      (select count(*) from public.hosted_tournament_teams x join t on t.id = x.tournament_id) as prod_teams,
      (select count(*) from public.hosted_tournament_teams x join t on t.id = x.tournament_id
        where x.status = 'active')                                                             as prod_teams_active,
      (select count(*) from public.hosted_tournament_groups x join t on t.id = x.tournament_id) as prod_groups,
      (select count(*) from pg_constraint
        where conname in ('hosted_tmatch_distinct_teams', 'hosted_tmatch_score_rule',
                          'hosted_tmatch_completed_shape', 'hosted_tmatch_winner_member',
                          'hosted_tmatch_group_required'))                                     as match_checks,
      (select count(*) from pg_indexes
        where schemaname = 'public' and indexname = 'hosted_tmatch_playing_court_uniq')        as court_uniq,
      (select count(*) from pg_constraint where conname = 'hosted_tevent_entity_type_check')   as evt_check_named,
      (select count(*) from public.hosted_tournament_events x join t on t.id = x.tournament_id
        where x.entity_type in ('bracket', 'bracket_slot'))                                    as evt_bracket_rows,
      (select string_agg(distinct entity_type, ',' order by entity_type)
         from public.hosted_tournament_events)                                                 as evt_types_used
),
rows_out as (
    select 1 as ord, 'schema' as section, 'bracket 테이블(있으면 이미 적용됨)' as item,
           (select bracket_tables::text from calc) as value
    union all select 2, 'schema', 'matches 의 bracket 연결 컬럼', (select match_bracket_cols::text from calc)
    union all select 3, 'schema', 'bracket 관련 함수', (select bracket_fns::text from calc)
    union all select 4, 'schema', 'events entity_type CHECK 이름 존재(적용 후 형태)', (select evt_check_named::text from calc)
    union all select 5, 'schema', '현재 events 에 쓰인 entity_type', (select coalesce(evt_types_used, '(none)') from calc)

    union all select 10, 'existing', '기존 matches 핵심 CHECK 5종', (select match_checks::text from calc)
    union all select 11, 'existing', '코트 점유 partial unique', (select court_uniq::text from calc)
    union all select 12, 'existing', '2026-teyeon-open 경기 수(전체)', (select prod_matches::text from calc)
    union all select 13, 'existing', '  └ preliminary', (select prod_prelim::text from calc)
    union all select 14, 'existing', '  └ placement', (select prod_place::text from calc)
    union all select 15, 'existing', '  └ knockout(4A 적용 전에는 0 이어야 함)', (select prod_knockout::text from calc)
    union all select 16, 'existing', '2026-teyeon-open 팀 수(전체 / active)',
              (select prod_teams::text || ' / ' || prod_teams_active::text from calc)
    union all select 17, 'existing', '2026-teyeon-open 조 수', (select prod_groups::text from calc)
    union all select 18, 'existing', 'bracket entity 이벤트(적용 전 0)', (select evt_bracket_rows::text from calc)

    union all select 90, 'VERDICT', 'SAFE TO APPLY',
              (select case when bracket_tables = 0 and match_bracket_cols = 0 and prod_knockout = 0
                                and match_checks = 5 and court_uniq = 1
                           then 'YES — 미적용 상태 · 기존 경기 제약 정상 · knockout 경기 0'
                           else 'CHECK — 위 항목 확인 필요(이미 적용됐거나 기존 제약이 다름)' end from calc))
select section, item, value from rows_out order by ord;
