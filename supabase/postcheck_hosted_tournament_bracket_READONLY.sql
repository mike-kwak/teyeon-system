-- =============================================================================
-- POSTCHECK (READ-ONLY) — add_hosted_tournament_bracket.sql 적용 후 확인 (Batch 4A)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / 함수 호출 없음.
--     개인정보를 읽지 않는다 — 건수와 구조만 본다.
--   확인: ① 스키마가 올라갔는가 ② 기존 예선 · 경기 데이터가 그대로인가
--         ③ 4A 가 데이터를 만들지 않았는가(본선은 아직 비어 있어야 한다)
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
m as (select x.stage, x.status, x.bracket_id, x.bracket_target_slot_id
        from public.hosted_tournament_matches x join t on t.id = x.tournament_id),
calc as (
    select
      (select count(*) from information_schema.tables
        where table_schema = 'public'
          and table_name in ('hosted_tournament_brackets', 'hosted_tournament_bracket_rounds',
                             'hosted_tournament_bracket_slots', 'hosted_tournament_bracket_entrants'))  as tbl,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_matches'
          and column_name in ('bracket_id', 'bracket_target_slot_id') and is_nullable = 'YES')          as cols,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname in ('hosted_tbslot_team_uniq', 'hosted_tmatch_bracket_target_uniq'))             as idx,
      (select count(*) from pg_constraint
        where conname in ('hosted_tbracket_tournament_uniq', 'hosted_tbslot_pos_uniq',
                          'hosted_tbentrant_team_uniq', 'hosted_tbslot_self_feed',
                          'hosted_tmatch_bracket_shape', 'hosted_tevent_entity_type_check'))            as cons,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_bracket', 'set_bracket_entrants', 'set_bracket_structure',
                            'assign_bracket_slot', 'replace_bracket_slots', 'validate_bracket',
                            'lock_bracket', 'unlock_bracket', 'get_admin_bracket',
                            'hosted_tournament_bracket_begin', 'hosted_tournament_bracket_bump',
                            'hosted_tournament_bracket_validate'))                                      as fns,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relrowsecurity
          and c.relname like 'hosted_tournament_bracket%')                                              as rls,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like '%bracket%'
          and has_function_privilege('anon', p.oid, 'EXECUTE'))                                         as anon_fns,
      (select count(*) from public.hosted_tournament_brackets)                                          as brackets_all,
      (select count(*) from public.hosted_tournament_bracket_slots)                                     as slots_all,
      (select count(*) from public.hosted_tournament_bracket_entrants)                                  as entrants_all,
      (select count(*) from m)                                                                          as prod_matches,
      (select count(*) from m where stage = 'preliminary')                                              as prod_prelim,
      (select count(*) from m where stage = 'placement')                                                as prod_place,
      (select count(*) from m where stage = 'knockout')                                                 as prod_knockout,
      (select count(*) from m where bracket_id is not null or bracket_target_slot_id is not null)        as prod_linked,
      (select count(*) from public.hosted_tournament_teams x join t on t.id = x.tournament_id)          as prod_teams,
      (select count(*) from public.hosted_tournament_groups x join t on t.id = x.tournament_id)         as prod_groups,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select r.registration_status || '=' || count(*) as s
            from public.hosted_tournament_registrations r join t on t.id = r.tournament_id
           group by r.registration_status) q)                                                           as reg_fingerprint,
      (select count(*) from public.hosted_tournament_events where entity_type in ('bracket', 'bracket_slot')) as evt_bracket
),
rows_out as (
    select 1 as ord, 'A. schema' as section, 'bracket 테이블 4개' as item, (select tbl::text from calc) as value
    union all select 2, 'A. schema', 'matches 연결 컬럼 2개(nullable)', (select cols::text from calc)
    union all select 3, 'A. schema', '핵심 인덱스 2종', (select idx::text from calc)
    union all select 4, 'A. schema', '핵심 제약 6종', (select cons::text from calc)
    union all select 5, 'A. schema', 'bracket RPC 12개', (select fns::text from calc)
    union all select 6, 'A. schema', 'RLS 활성 테이블', (select rls::text from calc)
    union all select 7, 'A. schema', 'anon 실행 가능한 bracket 함수(0 이어야 함)', (select anon_fns::text from calc)

    union all select 10, 'B. bracket data', 'brackets 행(4A 는 만들지 않음)', (select brackets_all::text from calc)
    union all select 11, 'B. bracket data', 'slots 행', (select slots_all::text from calc)
    union all select 12, 'B. bracket data', 'entrants 행', (select entrants_all::text from calc)
    union all select 13, 'B. bracket data', 'bracket 이벤트', (select evt_bracket::text from calc)

    union all select 20, 'C. existing', '2026-teyeon-open 경기 수', (select prod_matches::text from calc)
    union all select 21, 'C. existing', '  └ preliminary', (select prod_prelim::text from calc)
    union all select 22, 'C. existing', '  └ placement', (select prod_place::text from calc)
    union all select 23, 'C. existing', '  └ knockout', (select prod_knockout::text from calc)
    union all select 24, 'C. existing', 'bracket 컬럼이 채워진 경기', (select prod_linked::text from calc)
    union all select 25, 'C. existing', '팀 수', (select prod_teams::text from calc)
    union all select 26, 'C. existing', '조 수', (select prod_groups::text from calc)
    union all select 27, 'C. existing', '접수 상태 분포', (select reg_fingerprint from calc)

    union all select 90, 'VERDICT', 'SCHEMA APPLIED',
              (select case when tbl = 4 and cols = 2 and idx = 2 and cons = 6 and fns = 12
                                and rls = 4 and anon_fns = 0
                           then 'YES — 테이블 · 컬럼 · 인덱스 · 제약 · RPC · RLS 정상, 공개 노출 0'
                           else 'CHECK — 위 A 섹션 확인' end from calc)
    union all select 91, 'VERDICT', 'NO DATA CREATED BY MIGRATION',
              (select case when brackets_all = 0 and slots_all = 0 and entrants_all = 0
                                and prod_knockout = 0 and prod_linked = 0
                           then 'YES — 4A 는 데이터를 만들지 않았다(본선은 비어 있음)'
                           else 'CHECK — 위 B · C 섹션 확인' end from calc))
select section, item, value from rows_out order by ord;
