-- =============================================================================
-- PRECHECK (READ-ONLY) — add_hosted_tournament_public_knockout.sql 적용 전 (Batch 4D-2)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / CALL / 사용자 RPC 호출 없음.
--     advisory lock 없음. 트랜잭션 제어 없음. Production 에 쓰기 위험 0.
--     개인정보(이름 · 전화 · 입금자 · 메모)를 읽지 않는다 — 건수 · 상태 · 스키마 메타만 본다.
--   목적: 4A~4D-0 baseline drift 탐지 + 공개 경계 · 공개 현황 확인.
--   마지막 3개 행이 판정이다.
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
keep as (
    select p.proname, md5(pg_get_functiondef(p.oid)) as fdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                         'amend_knockout_match_score', 'resolve_bracket_qualifiers',
                         'unresolve_bracket_qualifier', 'lock_bracket', 'unlock_bracket',
                         'get_admin_bracket', 'get_public_preliminary_draw',
                         'hosted_tournament_bracket_validate')
),
calc as (
    select
      -- ── A. 전제 ─────────────────────────────────────────────────────────
      (select count(*) from keep)                                                                as fns_keep,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_brackets'
          and column_name = 'published_at')                                                      as col_published,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_bracket_slots'
          and column_name in ('source_kind', 'source_group_no', 'source_rank', 'resolved_at'))    as cols_qualifier,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('hosted_tournament_qualifier_label', 'hosted_tournament_bracket_begin',
                            'hosted_tournament_bracket_bump'))                                    as fns_helper,

      -- ── B. 4D-2 미적용 확인 ─────────────────────────────────────────────
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('publish_bracket', 'unpublish_bracket',
                            'get_public_knockout_bracket', 'hosted_tournament_public_slot_key'))  as fns_4d2,

      -- ── C. 공개 경계 ────────────────────────────────────────────────────
      (select count(*) from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'
          and table_name like 'hosted_tournament_bracket%')                                       as anon_bracket_tables,
      (select count(*) from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'
          and table_name = 'hosted_tournament_matches')                                           as anon_match_table,
      (select count(*) from keep where anon_exec and proname <> 'get_public_preliminary_draw')     as anon_admin_fns,
      (select count(*) from keep where anon_exec and proname = 'get_public_preliminary_draw')      as anon_prelim_fn,
      (select coalesce(string_agg(proname || '=' || left(fdef, 8), ' · ' order by proname), '(none)')
         from keep)                                                                               as keep_md5,

      -- ── D. 운영 데이터 ──────────────────────────────────────────────────
      (select count(*) from public.hosted_tournament_brackets)                                    as brackets_all,
      (select count(*) from public.hosted_tournament_brackets where published_at is not null)      as brackets_published,
      (select coalesce(string_agg(b.status || '(v' || b.version || ')'
              || case when b.published_at is null then ' · 비공개' else ' · 공개중' end, ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)               as prod_bracket,
      (select count(*) from public.hosted_tournament_bracket_slots s
         join public.hosted_tournament_brackets b on b.id = s.bracket_id
         join t on t.id = b.tournament_id)                                                        as prod_slots,
      (select count(*) from public.hosted_tournament_matches m join t on t.id = m.tournament_id
        where m.stage = 'knockout')                                                               as prod_knockout,
      (select coalesce(string_agg(preliminary_draw_status || ' / '
              || case when preliminary_draw_published_at is null then '비공개' else '공개중' end, ''), '(none)')
         from public.hosted_tournaments where slug = '2026-teyeon-open')                          as prod_prelim_pub,
      (select count(*) from public.hosted_tournaments where slug like 'zz-fixture%')              as fixture_left
),
rows_out as (
    select 1 as ord, 'A. 전제' as section, '유지돼야 할 함수 10개' as item, (select fns_keep::text from calc) as value
    union all select 2, 'A. 전제', 'brackets.published_at 컬럼', (select col_published::text from calc)
    union all select 3, 'A. 전제', 'qualifier 컬럼 4개(4D-0)', (select cols_qualifier::text from calc)
    union all select 4, 'A. 전제', 'bracket helper 3개', (select fns_helper::text from calc)

    union all select 10, 'B. 4D-2 미적용', '공개 관련 함수(0 이어야 함)', (select fns_4d2::text from calc)

    union all select 20, 'C. 공개 경계', 'anon 의 bracket 테이블 권한(0)', (select anon_bracket_tables::text from calc)
    union all select 21, 'C. 공개 경계', 'anon 의 matches 테이블 권한(0)', (select anon_match_table::text from calc)
    union all select 22, 'C. 공개 경계', 'anon 실행 가능한 운영 함수(0)', (select anon_admin_fns::text from calc)
    union all select 23, 'C. 공개 경계', 'anon 실행 가능한 예선 공개 RPC(1 — 기존)', (select anon_prelim_fn::text from calc)
    union all select 24, 'C. 공개 경계', '유지 함수 지문(적용 후 대조용)', (select keep_md5 from calc)

    union all select 30, 'D. 운영 데이터', 'bracket 전체 / 공개 중',
              (select brackets_all::text || ' / ' || brackets_published::text from calc)
    union all select 31, 'D. 운영 데이터', '2026-teyeon-open bracket', (select prod_bracket from calc)
    union all select 32, 'D. 운영 데이터', '  └ 자리 수 / 본선 경기 수',
              (select prod_slots::text || ' / ' || prod_knockout::text from calc)
    union all select 33, 'D. 운영 데이터', '예선 조편성 / 공개 상태', (select prod_prelim_pub from calc)
    union all select 34, 'D. 운영 데이터', 'self-test 잔재 대회(0)', (select fixture_left::text from calc)

    union all select 90, 'VERDICT', 'SAFE TO APPLY',
              (select case when fns_keep = 10 and col_published = 1 and cols_qualifier = 4
                                and fns_helper = 3 and fns_4d2 = 0
                                and anon_bracket_tables = 0 and anon_match_table = 0
                                and anon_admin_fns = 0 and anon_prelim_fn = 1
                           then 'YES — 4A~4D-0 정상 · 4D-2 미적용 · 공개 경계 정상'
                           else 'NO — 위 A~C 중 기대값과 다른 항목이 있다. 적용하지 말고 먼저 확인하라' end from calc)
    union all select 91, 'VERDICT', 'NO BRACKET PUBLISHED YET',
              (select case when brackets_published = 0
                           then 'YES — 공개 중인 본선 0(마이그레이션이 공개 상태를 만들 여지가 없다)'
                           else 'CHECK — 이미 공개 상태인 본선이 있다. 값을 먼저 확인하라' end from calc)
    union all select 92, 'VERDICT', 'MIGRATION CREATES NO DATA',
              (select case when fns_4d2 = 0
                           then 'YES — 함수만 추가한다. 테이블 · 컬럼 · 행을 만들지 않는다'
                           else 'CHECK — 이미 적용된 흔적이 있다' end from calc))
select section, item, value from rows_out order by ord;
