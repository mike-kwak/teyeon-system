-- =============================================================================
-- POSTCHECK (READ-ONLY) — add_hosted_tournament_public_knockout.sql 적용 후 (Batch 4D-2)
--
--   ⚠ SELECT 하나다. INSERT / UPDATE / DELETE / DDL / DO 블록 / 사용자 RPC 호출 없음.
--   확인: ① 함수 · 권한이 올라갔는가 ② 공개 경계가 유지되는가
--         ③ 기존 함수 지문이 precheck 값과 같은가 ④ 데이터를 만들지 않았는가
-- =============================================================================

with
t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
fn as (
    select p.proname, p.oid, p.prosecdef, array_to_string(p.proconfig, ',') as cfg,
           has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('publish_bracket', 'unpublish_bracket',
                         'get_public_knockout_bracket', 'hosted_tournament_public_slot_key')
),
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
      (select count(*) from fn)                                                                   as fns_4d2,
      (select count(*) from fn where prosecdef and proname <> 'hosted_tournament_public_slot_key') as secdef,
      (select count(*) from fn where cfg = 'search_path=public, pg_temp')                          as pathfix,
      (select count(*) from fn where anon_exec)                                                    as anon_exec,
      (select coalesce(string_agg(proname, ',' order by proname), '(none)')
         from fn where anon_exec)                                                                  as anon_fn_name,
      (select count(*) from fn where proname in ('publish_bracket', 'unpublish_bracket')
          and auth_exec)                                                                           as auth_exec,
      (select count(*) from fn where proname = 'hosted_tournament_public_slot_key'
          and (anon_exec or auth_exec))                                                            as helper_exposed,
      (select count(*) from fn f
        where exists (select 1 from pg_proc p where p.oid = f.oid and p.proacl is null)
           or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                       where p.oid = f.oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'))     as public_exec,
      (select count(*) from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon'
          and (table_name like 'hosted_tournament_bracket%'
            or table_name = 'hosted_tournament_matches'))                                          as anon_tables,
      (select count(*) from keep)                                                                  as fns_keep,
      (select coalesce(string_agg(proname || '=' || left(fdef, 8), ' · ' order by proname), '(none)')
         from keep)                                                                                as keep_md5,
      (select count(*) from keep where anon_exec and proname <> 'get_public_preliminary_draw')      as keep_anon,
      (select count(*) from public.hosted_tournament_brackets where published_at is not null)       as published_all,
      (select coalesce(string_agg(b.status || '(v' || b.version || ')'
              || case when b.published_at is null then ' · 비공개' else ' · 공개중' end, ' · '), '(none)')
         from public.hosted_tournament_brackets b join t on t.id = b.tournament_id)                as prod_bracket,
      (select count(*) from public.hosted_tournament_events
        where action in ('publish_bracket', 'unpublish_bracket'))                                  as evt_pub,
      (select count(*) from public.hosted_tournaments where slug like 'zz-fixture%')               as fixture_left,
      (select count(*) from public.hosted_tournament_matches m join t on t.id = m.tournament_id
        where m.stage = 'knockout')                                                                as prod_knockout
),
rows_out as (
    select 1 as ord, 'A. schema' as section, '4D-2 함수 4개' as item, (select fns_4d2::text from calc) as value
    union all select 2, 'A. schema', 'SECURITY DEFINER 3', (select secdef::text from calc)
    union all select 3, 'A. schema', 'search_path 고정 3', (select pathfix::text from calc)

    union all select 10, 'B. 권한', 'anon 실행 가능 함수 수(1)', (select anon_exec::text from calc)
    union all select 11, 'B. 권한', '  └ 이름', (select anon_fn_name from calc)
    union all select 12, 'B. 권한', 'publish · unpublish authenticated 실행(2)', (select auth_exec::text from calc)
    union all select 13, 'B. 권한', '내부 키 helper 노출(0)', (select helper_exposed::text from calc)
    union all select 14, 'B. 권한', 'PUBLIC 실행 가능(0)', (select public_exec::text from calc)
    union all select 15, 'B. 권한', 'anon 의 bracket · matches 테이블 권한(0)', (select anon_tables::text from calc)

    union all select 20, 'C. 무변경', '유지 함수 10개', (select fns_keep::text from calc)
    union all select 21, 'C. 무변경', '지문(precheck 24번과 같아야 함)', (select keep_md5 from calc)
    union all select 22, 'C. 무변경', '운영 함수 anon 노출(0)', (select keep_anon::text from calc)

    union all select 30, 'D. 데이터', '공개 중인 본선(적용 직후 변화 없음)', (select published_all::text from calc)
    union all select 31, 'D. 데이터', '2026-teyeon-open bracket', (select prod_bracket from calc)
    union all select 32, 'D. 데이터', '본선 경기 수', (select prod_knockout::text from calc)
    union all select 33, 'D. 데이터', '공개 관련 이벤트(적용 직후 0)', (select evt_pub::text from calc)
    union all select 34, 'D. 데이터', 'self-test 잔재 대회(0)', (select fixture_left::text from calc)

    union all select 90, 'VERDICT', 'SCHEMA APPLIED',
              (select case when fns_4d2 = 4 and secdef = 3 and pathfix = 3
                                and anon_exec = 1 and anon_fn_name = 'get_public_knockout_bracket'
                                and auth_exec = 2 and helper_exposed = 0 and public_exec = 0
                                and anon_tables = 0
                           then 'YES — 함수 · 권한 정상, 공개 조회만 anon 허용'
                           else 'NO — 위 A · B 섹션 확인' end from calc)
    union all select 91, 'VERDICT', 'EXISTING FUNCTIONS UNCHANGED',
              (select case when fns_keep = 10 and keep_anon = 0
                           then 'CHECK 21번 지문을 precheck 24번과 직접 대조하라(자동 판정 아님)'
                           else 'NO — 유지 대상 함수 구성이 다르다' end from calc)
    union all select 92, 'VERDICT', 'NO DATA CREATED BY MIGRATION',
              (select case when evt_pub = 0 and fixture_left = 0
                           then 'YES — 공개 상태 · 이벤트를 만들지 않았다(공개는 운영자가 누른다)'
                           else 'CHECK — 위 D 섹션 확인' end from calc))
select section, item, value from rows_out order by ord;
