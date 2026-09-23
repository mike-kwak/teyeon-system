-- =============================================================================
-- PRECHECK (READ-ONLY) — add_hosted_tournament_knockout_engine.sql 적용 전 (Batch 4C)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / CALL / 사용자 RPC 호출 없음.
--     advisory lock 없음. 트랜잭션 제어 없음. Production 에 쓰기 위험 0.
--     개인정보(이름 · 전화 · 입금자 · 메모)를 읽지 않는다 — 건수 · 상태 · 스키마 메타만 본다.
--   대상: 2026-teyeon-open (+ 스키마 전역)
--   목적: Production drift 탐지. 기대 baseline 과 한 군데라도 다르면 SAFE TO APPLY = NO.
--   마지막 3개 행이 판정이다.
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
m as (select x.stage, x.status, x.bracket_id, x.bracket_target_slot_id
        from public.hosted_tournament_matches x join t on t.id = x.tournament_id),
-- 4C 가 교체(CREATE OR REPLACE)할 기존 함수 4개의 현재 baseline.
fn4 as (
    select p.proname, p.prosecdef, p.proacl,
           array_to_string(p.proconfig, ',')                              as cfg,
           has_function_privilege('authenticated', p.oid, 'EXECUTE')      as auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE')               as anon_exec,
           pg_get_functiondef(p.oid)                                      as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('complete_match', 'amend_completed_match_score',
                         'cancel_match', 'get_admin_bracket')
),
calc as (
    select
      -- ── A. Batch 4A foundation ──────────────────────────────────────────
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
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tmatch_bracket_target_uniq')                                            as idx_target,
      -- ★ 3. matches 연결 컬럼을 직접 확인(존재 + nullable). 둘 다 YES 여야 2.
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_matches'
          and column_name in ('bracket_id', 'bracket_target_slot_id')
          and is_nullable = 'YES')                                                                      as match_cols_nullable,
      (select coalesce(string_agg(column_name || '=' || is_nullable, ' · ' order by column_name), '(none)')
         from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_matches'
          and column_name in ('bracket_id', 'bracket_target_slot_id'))                                  as match_cols_detail,
      (select count(*) from pg_constraint where conname = 'hosted_tmatch_bracket_shape')                as cons_shape,

      -- ── B. 4C 미적용 확인 ───────────────────────────────────────────────
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                            'amend_knockout_match_score',
                            'hosted_tournament_knockout_create_match',
                            'hosted_tournament_knockout_advance'))                                      as fns_4c,
      (select count(*) from fn4 where proname <> 'get_admin_bracket')                                   as fns_guarded,
      (select count(*) from fn4
        where proname in ('complete_match', 'amend_completed_match_score')
          and def like '%knockout_requires_bracket_rpc%')                                               as guard_two_now,
      (select count(*) from fn4
        where proname = 'cancel_match' and def like '%knockout_cancel_not_supported%')                  as guard_cancel_now,
      -- ★ 5. get_admin_bracket 이 이미 4C 확장(matches 키)을 갖고 있는지.
      (select count(*) from fn4
        where proname = 'get_admin_bracket' and def like '%''matches'', v_matches%')                    as admin_bracket_4c,

      -- ── C. 교체 대상 함수 ACL / definition baseline ──────────────────────
      (select count(*) from fn4)                                                                        as fn4_found,
      (select count(*) from fn4 where prosecdef)                                                        as fn4_secdef,
      (select count(*) from fn4 where cfg = 'search_path=public, pg_temp')                              as fn4_searchpath,
      (select count(*) from fn4 where auth_exec)                                                        as fn4_auth_exec,
      (select count(*) from fn4 where anon_exec)                                                        as fn4_anon_exec,
      -- proacl 이 NULL 이면 PostgreSQL 기본값(PUBLIC EXECUTE)이라 노출된 것으로 본다.
      (select count(*) from fn4 f
        where f.proacl is null
           or exists (select 1 from aclexplode(f.proacl) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE'))                           as fn4_public_exec,
      (select coalesce(string_agg(proname || ':' || case when prosecdef then 'SD' else 'SI' end
                                  || '/' || case when auth_exec then 'auth' else 'no-auth' end,
                                  ' · ' order by proname), '(none)') from fn4)                          as fn4_detail,

      -- ── D. 인덱스 교체 안전성 ───────────────────────────────────────────
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tbslot_team_uniq')                                                      as idx_old,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tbslot_team_round_uniq')                                                as idx_new,
      (select count(*) from (
          select bracket_id, round_no, team_id from public.hosted_tournament_bracket_slots
           where team_id is not null group by 1, 2, 3 having count(*) > 1) d)                           as dup_in_round,
      (select count(*) from (
          select bracket_id, team_id from public.hosted_tournament_bracket_slots
           where team_id is not null group by 1, 2 having count(*) > 1) d)                              as dup_in_bracket,

      -- ── E. 현재 knockout 운영 상태 ──────────────────────────────────────
      (select count(*) from public.hosted_tournament_matches where stage = 'knockout')                  as ko_all,
      (select count(*) from public.hosted_tournament_matches where bracket_id is not null)              as ko_linked,
      (select count(*) from public.hosted_tournament_matches
        where bracket_target_slot_id is not null)                                                       as ko_targeted,

      -- ── F. 2026-teyeon-open bracket 상태 ────────────────────────────────
      (select count(*) from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)       as brk_rows,
      (select coalesce(string_agg(b.status, ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)                     as brk_status,
      (select coalesce(string_agg('v' || b.version, ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)                     as brk_version,
      (select count(*) from public.hosted_tournament_bracket_entrants e
         join public.hosted_tournament_brackets b on b.id = e.bracket_id join t on t.id = b.tournament_id) as brk_entrants,
      (select count(*) from public.hosted_tournament_bracket_rounds r
         join public.hosted_tournament_brackets b on b.id = r.bracket_id join t on t.id = b.tournament_id) as brk_rounds,
      (select count(*) from public.hosted_tournament_bracket_slots s
         join public.hosted_tournament_brackets b on b.id = s.bracket_id join t on t.id = b.tournament_id) as brk_slots,

      -- ── G. 기존 운영 baseline (건수만 · 개인정보 없음) ──────────────────
      (select count(*) from public.hosted_tournament_registrations r join t on t.id = r.tournament_id)   as reg_total,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select r.registration_status || '=' || count(*) as s
            from public.hosted_tournament_registrations r join t on t.id = r.tournament_id
           group by r.registration_status) q)                                                           as reg_dist,
      (select count(*) from public.hosted_tournament_teams x join t on t.id = x.tournament_id)           as team_total,
      (select count(*) from public.hosted_tournament_teams x join t on t.id = x.tournament_id
        where x.status = 'active')                                                                      as team_active,
      (select count(*) from public.hosted_tournament_groups x join t on t.id = x.tournament_id)          as group_total,
      (select count(*) from m)                                                                           as prod_matches,
      (select count(*) from m where stage = 'preliminary')                                               as prod_prelim,
      (select count(*) from m where stage = 'placement')                                                 as prod_place,
      (select count(*) from m where stage = 'knockout')                                                  as prod_knockout,
      (select count(*) from m where status = 'playing')                                                  as prod_playing,
      (select count(*) from m where status = 'completed')                                                as prod_completed
),
rows_out as (
    select 1 as ord, 'A. 4A foundation' as section, 'bracket 테이블 4개' as item,
           (select tbl_4a::text from calc) as value
    union all select 2, 'A. 4A foundation', 'bracket RPC 12개', (select fns_4a::text from calc)
    union all select 3, 'A. 4A foundation', '경기 멱등 키 인덱스(destination unique)', (select idx_target::text from calc)
    union all select 4, 'A. 4A foundation', 'matches 연결 컬럼 nullable 2개', (select match_cols_nullable::text from calc)
    union all select 5, 'A. 4A foundation', '  └ 상세', (select match_cols_detail from calc)
    union all select 6, 'A. 4A foundation', 'hosted_tmatch_bracket_shape CHECK', (select cons_shape::text from calc)

    union all select 10, 'B. 4C 미적용' , '4C 함수(0 이어야 함)', (select fns_4c::text from calc)
    union all select 11, 'B. 4C 미적용' , '교체 대상 함수 3개 존재', (select fns_guarded::text from calc)
    union all select 12, 'B. 4C 미적용' , 'complete/amend guard 문구(0 이어야 함)', (select guard_two_now::text from calc)
    union all select 13, 'B. 4C 미적용' , 'cancel guard 문구(0 이어야 함)', (select guard_cancel_now::text from calc)
    union all select 14, 'B. 4C 미적용' , 'get_admin_bracket 4C 확장(0 이어야 함)', (select admin_bracket_4c::text from calc)

    union all select 20, 'C. 교체 대상 ACL', '대상 함수 4개 존재', (select fn4_found::text from calc)
    union all select 21, 'C. 교체 대상 ACL', 'SECURITY DEFINER 4', (select fn4_secdef::text from calc)
    union all select 22, 'C. 교체 대상 ACL', 'search_path 고정 4', (select fn4_searchpath::text from calc)
    union all select 23, 'C. 교체 대상 ACL', 'authenticated 실행 가능 4', (select fn4_auth_exec::text from calc)
    union all select 24, 'C. 교체 대상 ACL', 'anon 실행 가능(0 이어야 함)', (select fn4_anon_exec::text from calc)
    union all select 25, 'C. 교체 대상 ACL', 'PUBLIC 실행 가능(0 이어야 함)', (select fn4_public_exec::text from calc)
    union all select 26, 'C. 교체 대상 ACL', '  └ 상세', (select fn4_detail from calc)

    union all select 30, 'D. 인덱스 교체', 'hosted_tbslot_team_uniq(제거 예정 · 1 이어야 함)', (select idx_old::text from calc)
    union all select 31, 'D. 인덱스 교체', 'hosted_tbslot_team_round_uniq(신설 예정 · 0 이어야 함)', (select idx_new::text from calc)
    union all select 32, 'D. 인덱스 교체', '라운드 내 동일 팀 중복(0 이어야 신설 가능)', (select dup_in_round::text from calc)
    union all select 33, 'D. 인덱스 교체', '참고: bracket 전체 동일 팀 중복', (select dup_in_bracket::text from calc)

    union all select 40, 'E. knockout 상태', 'stage=knockout 경기(전 대회)', (select ko_all::text from calc)
    union all select 41, 'E. knockout 상태', 'bracket_id 연결 경기', (select ko_linked::text from calc)
    union all select 42, 'E. knockout 상태', 'bracket_target_slot_id 연결 경기', (select ko_targeted::text from calc)

    union all select 50, 'F. bracket(운영 대회)', 'bracket 행 수', (select brk_rows::text from calc)
    union all select 51, 'F. bracket(운영 대회)', 'status', (select brk_status from calc)
    union all select 52, 'F. bracket(운영 대회)', 'version', (select brk_version from calc)
    union all select 53, 'F. bracket(운영 대회)', 'entrants', (select brk_entrants::text from calc)
    union all select 54, 'F. bracket(운영 대회)', 'rounds', (select brk_rounds::text from calc)
    union all select 55, 'F. bracket(운영 대회)', 'slots', (select brk_slots::text from calc)

    union all select 60, 'G. 운영 baseline', '접수 총 건수', (select reg_total::text from calc)
    union all select 61, 'G. 운영 baseline', '  └ 상태 분포', (select reg_dist from calc)
    union all select 62, 'G. 운영 baseline', '팀 수(전체 / active)',
              (select team_total::text || ' / ' || team_active::text from calc)
    union all select 63, 'G. 운영 baseline', '조 수', (select group_total::text from calc)
    union all select 64, 'G. 운영 baseline', '경기 총 수', (select prod_matches::text from calc)
    union all select 65, 'G. 운영 baseline', '  └ preliminary', (select prod_prelim::text from calc)
    union all select 66, 'G. 운영 baseline', '  └ placement', (select prod_place::text from calc)
    union all select 67, 'G. 운영 baseline', '  └ knockout', (select prod_knockout::text from calc)
    union all select 68, 'G. 운영 baseline', '  └ 진행 중 / 완료',
              (select prod_playing::text || ' / ' || prod_completed::text from calc)

    -- ── 판정 3종 ────────────────────────────────────────────────────────────
    --   ⚠ 빈 draft bracket 행이 있는 것 자체는 실패 조건이 아니다(4B 에서 만든 행).
    union all select 90, 'VERDICT', 'SAFE TO APPLY',
              (select case when tbl_4a = 4 and fns_4a = 12 and idx_target = 1
                                and match_cols_nullable = 2 and cons_shape = 1
                                and fns_4c = 0 and fns_guarded = 3
                                and guard_two_now = 0 and guard_cancel_now = 0 and admin_bracket_4c = 0
                                and fn4_found = 4 and fn4_secdef = 4 and fn4_searchpath = 4
                                and fn4_auth_exec = 4 and fn4_anon_exec = 0 and fn4_public_exec = 0
                                and idx_old = 1 and idx_new = 0 and dup_in_round = 0
                                and ko_all = 0 and ko_linked = 0 and ko_targeted = 0
                           then 'YES — 4A 정상 · 4C 미적용 · 함수 ACL drift 없음 · 인덱스 교체 가능 · 본선 경기 0'
                           else 'NO — 위 A~E 중 기대값과 다른 항목이 있다. 적용하지 말고 먼저 확인하라' end from calc)
    union all select 91, 'VERDICT', 'NO KNOCKOUT MATCHES YET',
              (select case when ko_all = 0 and ko_linked = 0 and ko_targeted = 0
                           then 'YES — knockout 경기 0 · bracket 연결 경기 0 · destination 연결 경기 0'
                           else 'NO — 이미 본선 경기 또는 연결이 있다. 적용 전 상태를 먼저 확인하라' end from calc)
    union all select 92, 'VERDICT', 'INDEX REPLACEMENT SAFE',
              (select case when dup_in_round = 0
                           then 'YES — (bracket, round, team) 중복 0 → round unique 신설 가능'
                           else 'NO — 같은 라운드에 같은 팀이 두 자리에 있다. 인덱스를 바꾸면 실패한다' end from calc))
select section, item, value from rows_out order by ord;
