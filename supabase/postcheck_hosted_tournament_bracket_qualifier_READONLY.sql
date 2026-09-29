-- =============================================================================
-- POSTCHECK (READ-ONLY) — add_hosted_tournament_bracket_qualifier.sql 적용 후 (Batch 4D-0)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / 사용자 RPC 호출 없음.
--     개인정보를 읽지 않는다 — 건수 · 상태 · 스키마 메타만 본다.
--   확인: ① 컬럼 · 제약 · 인덱스 · 함수가 올라갔는가
--         ② 4C 엔진 정의 지문이 precheck 값과 같은가(무변경 증명)
--         ③ 마이그레이션이 데이터를 만들지 않았는가
--         ④ 구 프런트 호환(assign_bracket_slot 5인자)이 살아 있는가
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
m as (select x.stage, x.bracket_id from public.hosted_tournament_matches x join t on t.id = x.tournament_id),
fn as (
    select p.proname, p.prosecdef, p.proacl,
           array_to_string(p.proconfig, ',')                         as cfg,
           pg_get_function_identity_arguments(p.oid)                 as args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
           has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
           md5(pg_get_functiondef(p.oid))                            as fdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                         'hosted_tournament_qualifier_label', 'hosted_tournament_qualifier_downstream',
                         'assign_bracket_slot', 'replace_bracket_slots',
                         'hosted_tournament_bracket_validate', 'get_admin_bracket')
),
ko as (
    select p.proname, md5(pg_get_functiondef(p.oid)) as fdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('materialize_bracket_matches', 'complete_knockout_match',
                         'amend_knockout_match_score', 'hosted_tournament_knockout_create_match',
                         'hosted_tournament_knockout_advance', 'complete_match',
                         'cancel_match', 'amend_completed_match_score')
),
calc as (
    select
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_bracket_slots'
          and column_name in ('source_kind', 'source_group_no', 'source_rank', 'resolved_at')
          and is_nullable = 'YES')                                                                      as cols_4d,
      (select count(*) from pg_constraint
        where conname in ('hosted_tbslot_type_check', 'hosted_tbslot_source_kind_check',
                          'hosted_tbslot_qualifier_shape', 'hosted_tbslot_qualifier_round',
                          'hosted_tbslot_resolved_shape'))                                              as cons_4d,
      (select count(*) from pg_constraint c
        where c.conrelid = 'public.hosted_tournament_bracket_slots'::regclass and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%slot_type%'
          and pg_get_constraintdef(c.oid) like '%tbd%'
          and pg_get_constraintdef(c.oid) not like '%qualifier%')                                       as old_check_left,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname = 'hosted_tbslot_source_uniq')                                                    as idx_4d,
      (select count(*) from pg_indexes where schemaname = 'public'
        and indexname in ('hosted_tmatch_bracket_target_uniq', 'hosted_tbslot_team_round_uniq'))        as idx_keep,
      (select count(*) from pg_constraint
        where conname in ('hosted_tbslot_team_shape', 'hosted_tbslot_entrant_shape',
                          'hosted_tbslot_self_feed', 'hosted_tbslot_pos_uniq'))                         as cons_4a,
      (select count(*) from fn where proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier',
                                                 'hosted_tournament_qualifier_label',
                                                 'hosted_tournament_qualifier_downstream'))             as fns_4d,
      (select count(*) from fn where proname = 'assign_bracket_slot')                                   as assign_overloads,
      (select count(*) from fn where proname = 'assign_bracket_slot'
          and args = 'p_slug text, p_slot_id uuid, p_slot_type text, p_team_id uuid, p_expected_version integer')
                                                                                                        as assign_legacy,
      (select count(*) from fn where proname in ('resolve_bracket_qualifiers', 'unresolve_bracket_qualifier')
          and auth_exec)                                                                                as rpc_auth,
      (select count(*) from fn where proname in ('hosted_tournament_qualifier_label',
                                                 'hosted_tournament_qualifier_downstream')
          and auth_exec)                                                                                as helper_auth,
      (select count(*) from fn where anon_exec)                                                         as fn_anon,
      (select count(*) from fn f
        where f.proacl is null
           or exists (select 1 from aclexplode(f.proacl) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE'))                           as fn_public,
      (select count(*) from fn where prosecdef and proname <> 'hosted_tournament_qualifier_label')       as fn_secdef,
      (select coalesce(string_agg(proname || '=' || left(fdef, 8), ' · ' order by proname), '(none)')
         from ko)                                                                                       as ko_md5,
      (select count(*) from ko)                                                                         as ko_cnt,
      (select count(*) from ko where anon_exec)                                                         as ko_anon,
      (select count(*) from pg_trigger tr join pg_class c on c.oid = tr.tgrelid
        where not tr.tgisinternal
          and c.relname in ('hosted_tournament_matches', 'hosted_tournament_bracket_slots',
                            'hosted_tournament_groups'))                                                as trg_cnt,

      -- 데이터
      (select count(*) from public.hosted_tournament_bracket_slots where slot_type = 'qualifier')        as q_slots,
      (select count(*) from public.hosted_tournament_bracket_slots where source_kind is not null)        as q_source,
      (select count(*) from public.hosted_tournament_bracket_slots where resolved_at is not null)        as q_resolved,
      (select count(*) from public.hosted_tournament_bracket_slots)                                      as slots_all,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select slot_type || '=' || count(*) as s
            from public.hosted_tournament_bracket_slots group by slot_type) q)                           as slot_types,
      (select coalesce(string_agg(b.status || '(v' || b.version || ')', ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)                      as prod_bracket,
      (select count(*) from m where stage = 'knockout')                                                  as prod_knockout,
      (select count(*) from m)                                                                           as prod_matches,
      (select count(*) from m where stage = 'preliminary')                                               as prod_prelim,
      (select count(*) from m where stage = 'placement')                                                 as prod_place,
      (select count(*) from public.hosted_tournament_events
        where action in ('resolve_qualifier', 'resolve_qualifiers', 'unresolve_qualifier',
                         'knockout_match_removed'))                                                      as evt_4d,
      (select count(*) from public.hosted_tournaments where slug like 'zz-fixture%')                      as fixture_left,
      (select count(*) from public.hosted_tournament_registrations r join t on t.id = r.tournament_id)    as reg_total,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select r.registration_status || '=' || count(*) as s
            from public.hosted_tournament_registrations r join t on t.id = r.tournament_id
           group by r.registration_status) q)                                                            as reg_dist
),
rows_out as (
    select 1 as ord, 'A. schema' as section, 'qualifier 컬럼 4개(nullable)' as item, (select cols_4d::text from calc) as value
    union all select 2, 'A. schema', 'CHECK 5종(slot_type 포함)', (select cons_4d::text from calc)
    union all select 3, 'A. schema', '옛 3값 slot_type CHECK 잔존(0)', (select old_check_left::text from calc)
    union all select 4, 'A. schema', 'source unique 인덱스', (select idx_4d::text from calc)
    union all select 5, 'A. schema', '4A · 4C 인덱스 유지(2종)', (select idx_keep::text from calc)
    union all select 6, 'A. schema', '4A slots 제약 유지(4종)', (select cons_4a::text from calc)

    union all select 10, 'B. 함수 · 권한', '4D-0 함수 4개', (select fns_4d::text from calc)
    union all select 11, 'B. 함수 · 권한', 'assign_bracket_slot 오버로드 2개', (select assign_overloads::text from calc)
    union all select 12, 'B. 함수 · 권한', '  └ 구 프런트용 5인자 유지', (select assign_legacy::text from calc)
    union all select 13, 'B. 함수 · 권한', '운영 RPC authenticated 실행 2', (select rpc_auth::text from calc)
    union all select 14, 'B. 함수 · 권한', '내부 helper authenticated 실행(0)', (select helper_auth::text from calc)
    union all select 15, 'B. 함수 · 권한', 'anon 실행(0)', (select fn_anon::text from calc)
    union all select 16, 'B. 함수 · 권한', 'PUBLIC 실행(0)', (select fn_public::text from calc)
    union all select 17, 'B. 함수 · 권한', '자동 실행 트리거(0)', (select trg_cnt::text from calc)

    union all select 20, 'C. 4C 무변경', '4C 엔진 · guard 함수 8개', (select ko_cnt::text from calc)
    union all select 21, 'C. 4C 무변경', '정의 지문(precheck 37번과 같아야 함)', (select ko_md5 from calc)
    union all select 22, 'C. 4C 무변경', '4C anon 실행(0)', (select ko_anon::text from calc)

    union all select 30, 'D. 데이터', 'qualifier 자리(적용 직후 0)', (select q_slots::text from calc)
    union all select 31, 'D. 데이터', 'source 가 채워진 자리(0)', (select q_source::text from calc)
    union all select 32, 'D. 데이터', '반영된 자리(0)', (select q_resolved::text from calc)
    union all select 33, 'D. 데이터', '전체 slots 행 / 분포',
              (select slots_all::text || ' / ' || slot_types from calc)
    union all select 34, 'D. 데이터', 'bracket 상태', (select prod_bracket from calc)
    union all select 35, 'D. 데이터', '경기 총 수(예선/순위전/본선)',
              (select prod_matches::text || ' (' || prod_prelim::text || '/' || prod_place::text
                      || '/' || prod_knockout::text || ')' from calc)
    union all select 36, 'D. 데이터', '4D-0 운영 이벤트(적용 직후 0)', (select evt_4d::text from calc)
    union all select 37, 'D. 데이터', 'self-test 잔재 대회(0)', (select fixture_left::text from calc)
    union all select 38, 'D. 데이터', '접수 총 건수 / 분포',
              (select reg_total::text || ' · ' || reg_dist from calc)

    union all select 90, 'VERDICT', 'SCHEMA APPLIED',
              (select case when cols_4d = 4 and cons_4d = 5 and old_check_left = 0 and idx_4d = 1
                                and idx_keep = 2 and cons_4a = 4 and fns_4d = 4
                                and assign_overloads = 2 and assign_legacy = 1
                                and rpc_auth = 2 and helper_auth = 0 and fn_anon = 0 and fn_public = 0
                                and trg_cnt = 0
                           then 'YES — 컬럼 · 제약 · 인덱스 · 함수 · 권한 정상, 구 프런트 호환 유지'
                           else 'NO — 위 A · B 섹션 확인' end from calc)
    union all select 91, 'VERDICT', 'KNOCKOUT ENGINE UNCHANGED',
              (select case when ko_cnt = 8 and ko_anon = 0
                           then 'CHECK 21번 지문을 precheck 37번과 직접 대조하라(자동 판정 아님)'
                           else 'NO — 4C 함수 구성이 다르다' end from calc)
    union all select 92, 'VERDICT', 'NO DATA CREATED BY MIGRATION',
              (select case when q_slots = 0 and q_source = 0 and q_resolved = 0
                                and evt_4d = 0 and fixture_left = 0
                           then 'YES — 4D-0 은 데이터를 만들지 않았다(본선 경로는 경기이사가 입력한다)'
                           else 'CHECK — 위 D 섹션 확인' end from calc))
select section, item, value from rows_out order by ord;
