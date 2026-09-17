-- ============================================================================
--  2026 TEYEON OPEN — Batch 2B-2 (일괄 조편성 + 조 번호 보정) 검증
--
--  사용법: Supabase SQL Editor 에 전체를 붙여넣고 1회 실행.
--          seq / check_name / result(PASS·FAIL) 한 개의 표가 나온다.
--
--  ⚠ 100% 읽기 전용. INSERT/UPDATE/DELETE/DDL 없음, 함수 호출 없음(카탈로그 조회만).
--
--  선행: Batch 1 4종 + Batch 2A + add_hosted_tournament_group_bulk_assignment.sql
-- ============================================================================

with
fn as (
    select
        to_regprocedure('public.hosted_tournament_draw_normalize_order(uuid)')                as f_norm,
        to_regprocedure('public.replace_preliminary_group_assignments(text,jsonb,integer)')   as f_bulk,
        to_regprocedure('public.create_tournament_groups(text,integer,boolean,integer)')      as f_create
),
new_fn as (select unnest(array[f_norm, f_bulk, f_create]) as oid from fn),
pub_exec as (
    select count(*) as n
      from pg_proc p join new_fn a on a.oid = p.oid,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     where x.grantee = 0 and x.privilege_type = 'EXECUTE'
),
hardening as (
    select count(*) as total,
           count(*) filter (where p.prosecdef) as secdef,
           count(*) filter (where exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                           where c like 'search\_path=%')) as pinned
      from pg_proc p join new_fn a on a.oid = p.oid
),
prod as (select id, preliminary_draw_status from public.hosted_tournaments
          where slug = '2026-teyeon-open'),
checks as (

-- ── 1. 함수 존재 / 보안 ─────────────────────────────────────────────────────
select  1, '[fn] normalize helper 존재',        (select f_norm   is not null from fn)
union all select  2, '[fn] bulk replace RPC 존재',      (select f_bulk   is not null from fn)
union all select  3, '[fn] create_tournament_groups 존재(교체 후)',
                                                        (select f_create is not null from fn)
union all select  4, '[fn] 3종 모두 security definer',  (select total = 3 and secdef = 3 from hardening)
union all select  5, '[fn] 3종 모두 search_path 고정',  (select total = 3 and pinned = 3 from hardening)
union all select  6, '[fn] PUBLIC EXECUTE 잔존 0건',    (select n = 0 from pub_exec)
union all select  7, '[fn] anon 은 3종 전부 실행 불가',
        (select bool_and(not has_function_privilege('anon', a.oid, 'EXECUTE'))
           from new_fn a where a.oid is not null)
union all select  8, '[fn] normalize helper 는 authenticated 도 실행 불가(내부 전용)',
        (select not has_function_privilege('authenticated', f_norm, 'EXECUTE') from fn)
union all select  9, '[fn] bulk RPC 는 authenticated 실행 가능(내부 재검증)',
        (select has_function_privilege('authenticated', f_bulk, 'EXECUTE') from fn)
union all select 10, '[fn] ★ 재생성한 create_tournament_groups 의 lockdown 재적용 확인',
        -- Supabase 기본 권한 부활 함정. anon 차단 + authenticated 만 허용이어야 한다.
        (select not has_function_privilege('anon', f_create, 'EXECUTE')
            and has_function_privilege('authenticated', f_create, 'EXECUTE') from fn)

-- ── 2. 조 번호 보정 ─────────────────────────────────────────────────────────
union all select 20, '[group_no] 가장 작은 빈 번호를 쓰도록 교체됨',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_create
            and p.prosrc ilike '%generate_series%'
            and p.prosrc ilike '%not exists%'
            and p.prosrc ilike '%limit p_preliminary_count%')
union all select 21, '[group_no] 기존 max+1 방식 잔존하지 않음',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_create and p.prosrc not ilike '%v_max_no + i%')
union all select 22, '[group_no] 저장된 조 번호를 renumber 하지 않음',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_create
            and p.prosrc not ilike '%set group_no%'
            and p.prosrc not ilike '%group_no =%row_number%')
union all select 23, '[order] create 가 display_order 정규화를 호출',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_create and p.prosrc ilike '%hosted_tournament_draw_normalize_order%')
union all select 24, '[order] 정규화가 placement 를 맨 뒤로 보냄',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_norm
            and p.prosrc ilike '%max(group_no), 0) + 1%'
            and p.prosrc ilike '%placement%')

-- ── 3. bulk RPC 계약 ────────────────────────────────────────────────────────
union all select 30, '[bulk] expected_version 필수',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%version_required%')
union all select 31, '[bulk] draw_begin 경유(권한·advisory lock·locked·version)',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%hosted_tournament_draw_begin%')
union all select 32, '[bulk] 중복 팀 차단',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%duplicate_team%')
union all select 33, '[bulk] 조 인원(3/2) 차단',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%group_size_mismatch%')
union all select 34, '[bulk] 기권 팀 차단',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%team_withdrawn%')
union all select 35, '[bulk] 다른 대회 팀 차단',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%team_not_in_tournament%')
union all select 36, '[bulk] 누락 active 팀 차단(부분 저장 금지)',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%missing_active_teams%')
union all select 37, '[bulk] placement 2개 이상 차단',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%multiple_placement%')
union all select 38, '[bulk] team id 형식 검증(uuid 캐스트 예외 방지)',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%invalid_team_id%')
union all select 39, '[bulk] 조 번호를 payload 값 그대로 사용(시스템이 정하지 않음)',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%(e ->> ''groupNo'')::integer%')
union all select 40, '[bulk] 반영 전 기존 배정 전체 삭제(전체 교체)',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%delete from public.hosted_tournament_group_members%')
union all select 41, '[bulk] 반영 후 display_order 정규화',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%hosted_tournament_draw_normalize_order%')
union all select 42, '[bulk] 감사 이벤트 기록',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc ilike '%bulk_replace_group_assignments%')

-- ── 4. 개인정보 경계 ────────────────────────────────────────────────────────
union all select 50, '[PII] bulk RPC 가 registrations 를 참조하지 않음',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc not ilike '%hosted_tournament_registrations%')
union all select 51, '[PII] bulk RPC 가 선수명/클럽명을 다루지 않음',
        (select count(*) = 1 from pg_proc p, fn where p.oid = fn.f_bulk
          and p.prosrc not ilike '%player1_name%'
          and p.prosrc not ilike '%player2_name%'
          and p.prosrc not ilike '%club_name%')
union all select 52, '[PII] events 스키마 변경 없음(group/membership 이미 허용)',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_events'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%membership%')

-- ── 5. Batch 2A / Batch 1 회귀 없음 ─────────────────────────────────────────
union all select 60, '[regression] Batch 2A 테이블 2종 존재',
        (to_regclass('public.hosted_tournament_groups') is not null
     and to_regclass('public.hosted_tournament_group_members') is not null)
union all select 61, '[regression] Batch 2A RPC 주요 5종 존재',
        (to_regprocedure('public.assign_group_team(text,integer,uuid,integer,integer)') is not null
     and to_regprocedure('public.move_group_team(text,uuid,integer,integer,integer)') is not null
     and to_regprocedure('public.swap_group_teams(text,uuid,uuid,integer)') is not null
     and to_regprocedure('public.lock_preliminary_draw(text,integer)') is not null
     and to_regprocedure('public.unlock_preliminary_draw(text,text,integer)') is not null)
union all select 62, '[regression] 멤버십 제약 2종 유지',
        (select count(*) = 2 from pg_constraint
          where conname in ('hosted_tgmember_team_unique','hosted_tgmember_slot_unique'))
union all select 63, '[regression] Batch 1 테이블 3종 존재',
        (to_regclass('public.hosted_tournament_teams') is not null
     and to_regclass('public.hosted_tournament_courts') is not null
     and to_regclass('public.hosted_tournament_events') is not null)
union all select 64, '[regression] submit RPC lockdown 유지',
        (select count(*) >= 1
                and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
                and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'submit_tournament_registration')

-- ── 6. Production 보호 ──────────────────────────────────────────────────────
union all select 70, '[prod] 2026-teyeon-open 조 0개',
        (select count(*) = 0 from public.hosted_tournament_groups g, prod
          where g.tournament_id = prod.id)
union all select 71, '[prod] 2026-teyeon-open 배정 0건',
        (select count(*) = 0 from public.hosted_tournament_group_members m, prod
          where m.tournament_id = prod.id)
union all select 72, '[prod] 2026-teyeon-open 조편성 draft 유지',
        (select preliminary_draw_status = 'draft' from prod)
union all select 73, '[prod] 대회 status registration_open 유지',
        (select status = 'registration_open' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 74, '[prod] 승격된 접수 0건',
        (select count(*) = 0 from public.hosted_tournament_teams
          where registration_id is not null)

)
select seq, check_name, case when ok then 'PASS' else 'FAIL' end as result
  from checks as c(seq, check_name, ok)
union all
select 999, 'SUMMARY  PASS=' || (select count(*) filter (where ok) from checks as c2(seq, check_name, ok))
         || ' / FAIL=' || (select count(*) filter (where not ok or ok is null) from checks as c3(seq, check_name, ok))
         || ' / TOTAL=' || (select count(*) from checks as c4(seq, check_name, ok)),
       case when (select count(*) filter (where not ok or ok is null) from checks as c5(seq, check_name, ok)) = 0
            then 'ALL PASS' else 'CHECK FAILED' end
 order by 1;
