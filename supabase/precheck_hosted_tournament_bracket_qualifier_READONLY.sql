-- =============================================================================
-- PRECHECK (READ-ONLY) — add_hosted_tournament_bracket_qualifier.sql 적용 전 (Batch 4D-0)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / CALL / 사용자 RPC 호출 없음.
--     advisory lock 없음. 트랜잭션 제어 없음. Production 에 쓰기 위험 0.
--     개인정보(이름 · 전화 · 입금자 · 메모)를 읽지 않는다 — 건수 · 상태 · 스키마 메타만 본다.
--   목적: 4A~4C baseline drift 탐지 + slot_type CHECK 이름 식별.
--   마지막 4개 행이 판정이다.
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
m as (select x.stage, x.status, x.bracket_id, x.bracket_target_slot_id
        from public.hosted_tournament_matches x join t on t.id = x.tournament_id),
-- 4D-0 이 교체(CREATE OR REPLACE)할 기존 함수들의 현재 baseline.
fn4 as (
    select p.proname, p.prosecdef, p.proacl,
           array_to_string(p.proconfig, ',')                         as cfg,
           pg_get_function_identity_arguments(p.oid)                 as args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
           md5(pg_get_functiondef(p.oid))                            as fdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('hosted_tournament_bracket_validate', 'assign_bracket_slot',
                         'replace_bracket_slots', 'get_admin_bracket')
),
-- 4D-0 이 건드리지 않아야 할 4C 엔진 + guard.
ko as (
    select p.proname, md5(pg_get_functiondef(p.oid)) as fdef,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                         'amend_knockout_match_score', 'hosted_tournament_knockout_create_match',
                         'hosted_tournament_knockout_advance', 'complete_match',
                         'cancel_match', 'amend_completed_match_score')
),
calc as (
    select
      -- ── A. 4A · 4C foundation ───────────────────────────────────────────
      (select count(*) from information_schema.tables
        where table_schema = 'public'
          and table_name in ('hosted_tournament_brackets', 'hosted_tournament_bracket_rounds',
                             'hosted_tournament_bracket_slots', 'hosted_tournament_bracket_entrants'))  as tbl_4a,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('create_bracket', 'set_bracket_entrants', 'set_bracket_structure',
                            'assign_bracket_slot', 'replace_bracket_slots', 'validate_bracket',
                            'lock_bracket', 'unlock_bracket', 'get_admin_bracket',
                            'hosted_tournament_bracket_begin', 'hosted_tournament_bracket_bump',
                            'hosted_tournament_bracket_validate'))                                      as fns_4a,
      (select count(*) from ko)                                                                         as fns_4c,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname in ('hosted_tmatch_bracket_target_uniq', 'hosted_tbslot_team_round_uniq'))        as idx_keep,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_matches'
          and column_name in ('bracket_id', 'bracket_target_slot_id') and is_nullable = 'YES')          as match_cols,
      -- 예선 순위 계산 코어(resolve 의 전제)
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('hosted_tournament_preliminary_standings_core',
                            'get_preliminary_standings', 'get_public_preliminary_draw'))                as fns_pre,

      -- ── B. 4D-0 미적용 확인 ─────────────────────────────────────────────
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_bracket_slots'
          and column_name in ('source_kind', 'source_group_no', 'source_rank', 'resolved_at'))          as cols_4d,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                            'hosted_tournament_qualifier_label',
                            'hosted_tournament_qualifier_downstream'))                                  as fns_4d,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tbslot_source_uniq')                                                    as idx_4d,
      (select count(*) from pg_constraint
        where conname in ('hosted_tbslot_source_kind_check', 'hosted_tbslot_qualifier_shape',
                          'hosted_tbslot_qualifier_round', 'hosted_tbslot_resolved_shape'))             as cons_4d,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'assign_bracket_slot')                               as assign_overloads,

      -- ── C. slot_type CHECK 식별(이름을 추정해서 지우지 않기 위해) ───────
      (select coalesce(string_agg(c.conname, ' · '), '(none)')
         from pg_constraint c
        where c.conrelid = 'public.hosted_tournament_bracket_slots'::regclass and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%slot_type%'
          and pg_get_constraintdef(c.oid) like '%tbd%')                                                 as slot_check_name,
      (select count(*) from pg_constraint c
        where c.conrelid = 'public.hosted_tournament_bracket_slots'::regclass and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%slot_type%'
          and pg_get_constraintdef(c.oid) like '%tbd%')                                                 as slot_check_cnt,
      (select count(*) from pg_constraint
        where conname in ('hosted_tbslot_team_shape', 'hosted_tbslot_entrant_shape',
                          'hosted_tbslot_self_feed', 'hosted_tbslot_pos_uniq'))                         as cons_4a,

      -- ── D. 교체 대상 함수 baseline ──────────────────────────────────────
      (select count(*) from fn4)                                                                        as fn4_cnt,
      (select count(*) from fn4 where prosecdef)                                                        as fn4_secdef,
      (select count(*) from fn4 where cfg = 'search_path=public, pg_temp')                              as fn4_path,
      (select count(*) from fn4 where auth_exec and proname <> 'hosted_tournament_bracket_validate')    as fn4_auth,
      (select count(*) from fn4 where anon_exec)                                                        as fn4_anon,
      (select count(*) from fn4 f
        where f.proacl is null
           or exists (select 1 from aclexplode(f.proacl) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE'))                           as fn4_public,
      (select coalesce(string_agg(proname || '=' || left(fdef, 8), ' · ' order by proname, args), '(none)')
         from fn4)                                                                                      as fn4_md5,
      (select coalesce(string_agg(proname || '=' || left(fdef, 8), ' · ' order by proname), '(none)')
         from ko)                                                                                       as ko_md5,
      (select count(*) from ko where anon_exec)                                                         as ko_anon,

      -- ── E. 운영 데이터 ──────────────────────────────────────────────────
      (select count(*) from public.hosted_tournament_bracket_slots)                                     as slots_all,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select slot_type || '=' || count(*) as s
            from public.hosted_tournament_bracket_slots group by slot_type) q)                          as slot_types,
      (select coalesce(string_agg(b.status || '(v' || b.version || ')', ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)                     as prod_bracket,
      (select count(*) from public.hosted_tournament_bracket_rounds r
         join public.hosted_tournament_brackets b on b.id = r.bracket_id join t on t.id = b.tournament_id) as prod_rounds,
      (select count(*) from public.hosted_tournament_bracket_entrants e
         join public.hosted_tournament_brackets b on b.id = e.bracket_id join t on t.id = b.tournament_id) as prod_entrants,
      (select count(*) from m where stage = 'knockout')                                                 as prod_knockout,
      (select count(*) from m)                                                                          as prod_matches,
      (select count(*) from m where stage = 'preliminary')                                              as prod_prelim,
      (select count(*) from m where stage = 'placement')                                                as prod_place,
      (select count(*) from public.hosted_tournament_groups x join t on t.id = x.tournament_id)         as prod_groups,
      (select coalesce(string_agg(preliminary_draw_status, ''), '(none)')
         from public.hosted_tournaments where slug = '2026-teyeon-open')                                as prod_draw_status,
      (select count(*) from public.hosted_tournament_teams x join t on t.id = x.tournament_id)          as prod_teams,
      (select count(*) from public.hosted_tournament_registrations r join t on t.id = r.tournament_id)   as reg_total,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select r.registration_status || '=' || count(*) as s
            from public.hosted_tournament_registrations r join t on t.id = r.tournament_id
           group by r.registration_status) q)                                                           as reg_dist,
      (select count(*) from public.hosted_tournaments where slug like 'zz-fixture%')                     as fixture_left
),
rows_out as (
    select 1 as ord, 'A. 4A · 4C 전제' as section, 'bracket 테이블 4개' as item, (select tbl_4a::text from calc) as value
    union all select 2, 'A. 4A · 4C 전제', 'bracket RPC 12개', (select fns_4a::text from calc)
    union all select 3, 'A. 4A · 4C 전제', '4C 엔진 · guard 함수 8개', (select fns_4c::text from calc)
    union all select 4, 'A. 4A · 4C 전제', '유지돼야 할 인덱스 2종', (select idx_keep::text from calc)
    union all select 5, 'A. 4A · 4C 전제', 'matches 연결 컬럼 2개(nullable)', (select match_cols::text from calc)
    union all select 6, 'A. 4A · 4C 전제', '예선 순위 코어 · 공개 RPC 3개', (select fns_pre::text from calc)
    union all select 7, 'A. 4A · 4C 전제', 'slots 기존 제약 4종', (select cons_4a::text from calc)

    union all select 10, 'B. 4D-0 미적용', 'qualifier 컬럼(0 이어야 함)', (select cols_4d::text from calc)
    union all select 11, 'B. 4D-0 미적용', 'qualifier 함수(0 이어야 함)', (select fns_4d::text from calc)
    union all select 12, 'B. 4D-0 미적용', 'source unique 인덱스(0 이어야 함)', (select idx_4d::text from calc)
    union all select 13, 'B. 4D-0 미적용', 'qualifier 제약(0 이어야 함)', (select cons_4d::text from calc)
    union all select 14, 'B. 4D-0 미적용', 'assign_bracket_slot 오버로드(1 이어야 함)', (select assign_overloads::text from calc)

    union all select 20, 'C. slot_type CHECK', '이름(교체 대상)', (select slot_check_name from calc)
    union all select 21, 'C. slot_type CHECK', '개수(정확히 1)', (select slot_check_cnt::text from calc)

    union all select 30, 'D. 교체 대상 baseline', '대상 함수 4개', (select fn4_cnt::text from calc)
    union all select 31, 'D. 교체 대상 baseline', 'SECURITY DEFINER 4', (select fn4_secdef::text from calc)
    union all select 32, 'D. 교체 대상 baseline', 'search_path 고정 4', (select fn4_path::text from calc)
    union all select 33, 'D. 교체 대상 baseline', 'authenticated 실행 3(validate 제외)', (select fn4_auth::text from calc)
    union all select 34, 'D. 교체 대상 baseline', 'anon 실행(0 이어야 함)', (select fn4_anon::text from calc)
    union all select 35, 'D. 교체 대상 baseline', 'PUBLIC 실행(0 이어야 함)', (select fn4_public::text from calc)
    union all select 36, 'D. 교체 대상 baseline', '정의 지문(적용 후 대조용)', (select fn4_md5 from calc)
    union all select 37, 'D. 4C 무변경 기준', '4C 정의 지문(적용 후 동일해야 함)', (select ko_md5 from calc)
    union all select 38, 'D. 4C 무변경 기준', '4C anon 실행(0)', (select ko_anon::text from calc)

    union all select 50, 'E. 운영 데이터', 'bracket 상태', (select prod_bracket from calc)
    union all select 51, 'E. 운영 데이터', 'rounds / entrants', (select prod_rounds::text || ' / ' || prod_entrants::text from calc)
    union all select 52, 'E. 운영 데이터', '전체 slots 행', (select slots_all::text from calc)
    union all select 53, 'E. 운영 데이터', '  └ slot_type 분포', (select slot_types from calc)
    union all select 54, 'E. 운영 데이터', '예선 조편성 상태', (select prod_draw_status from calc)
    union all select 55, 'E. 운영 데이터', '조 수 / 팀 수', (select prod_groups::text || ' / ' || prod_teams::text from calc)
    union all select 56, 'E. 운영 데이터', '경기 총 수(예선/순위전/본선)',
              (select prod_matches::text || ' (' || prod_prelim::text || '/' || prod_place::text
                      || '/' || prod_knockout::text || ')' from calc)
    union all select 57, 'E. 운영 데이터', '접수 총 건수', (select reg_total::text from calc)
    union all select 58, 'E. 운영 데이터', '  └ 상태 분포', (select reg_dist from calc)
    union all select 59, 'E. 운영 데이터', 'self-test 잔재 대회(0)', (select fixture_left::text from calc)

    union all select 90, 'VERDICT', 'SAFE TO APPLY',
              (select case when tbl_4a = 4 and fns_4a = 12 and fns_4c = 8 and idx_keep = 2
                                and match_cols = 2 and fns_pre = 3 and cons_4a = 4
                                and cols_4d = 0 and fns_4d = 0 and idx_4d = 0 and cons_4d = 0
                                and assign_overloads = 1
                                and slot_check_cnt = 1
                                and fn4_cnt = 4 and fn4_secdef = 4 and fn4_path = 4
                                and fn4_auth = 3 and fn4_anon = 0 and fn4_public = 0
                                and ko_anon = 0
                           then 'YES — 4A · 4C 정상 · 4D-0 미적용 · 교체 대상 ACL drift 없음'
                           else 'NO — 위 A~D 중 기대값과 다른 항목이 있다. 적용하지 말고 먼저 확인하라' end from calc)
    union all select 91, 'VERDICT', 'SLOT_TYPE CHECK IDENTIFIED',
              (select case when slot_check_cnt = 1
                           then 'YES — ' || slot_check_name || ' (이 이름만 교체한다)'
                           else 'NO — CHECK 를 하나로 특정하지 못했다. 적용 중단' end from calc)
    union all select 92, 'VERDICT', 'NO QUALIFIER DATA YET',
              (select case when cols_4d = 0
                           then 'YES — qualifier 컬럼 자체가 없다(새로 도입)'
                           else 'CHECK — 이미 컬럼이 있다. 적용 상태를 먼저 확인하라' end from calc)
    union all select 93, 'VERDICT', 'MIGRATION TOUCHES NO ROWS',
              (select case when slots_all = 0
                           then 'YES — slots 0행: 컬럼 · CHECK 추가가 어떤 행도 건드리지 않는다'
                           else 'CHECK — slots ' || slots_all || '행에 CHECK 가 검증된다(값 분포는 위 53 확인)' end from calc))
select section, item, value from rows_out order by ord;
