-- ============================================================================
--  2026 TEYEON OPEN — Tournament Batch 2A 통합 검증 (읽기 전용)
--
--  사용법: Supabase SQL Editor 에 이 파일 '전체'를 붙여넣고 한 번 실행한다.
--          seq / check_name / result(PASS·FAIL) 한 개의 표가 나온다.
--
--  ⚠ 100% 읽기 전용이다. INSERT/UPDATE/DELETE/DDL 없음, RPC 호출 없음.
--    (Batch 1 verify 와 달리 함수를 하나도 호출하지 않는다 — 전부 카탈로그 조회다)
--
--  선행 조건: Batch 1 (events → teams → courts → fixture) + add_hosted_tournament_groups.sql
-- ============================================================================

with
fn as (
    select
        to_regprocedure('public.hosted_tournament_draw_begin(text,integer)')                as f_begin,
        to_regprocedure('public.hosted_tournament_draw_bump(uuid)')                         as f_bump,
        to_regprocedure('public.hosted_tournament_draw_validate(uuid)')                     as f_validate,
        to_regprocedure('public.create_tournament_groups(text,integer,boolean,integer)')    as f_create,
        to_regprocedure('public.delete_tournament_group(text,integer,integer)')             as f_delgroup,
        to_regprocedure('public.assign_group_team(text,integer,uuid,integer,integer)')      as f_assign,
        to_regprocedure('public.unassign_group_team(text,uuid,integer)')                    as f_unassign,
        to_regprocedure('public.move_group_team(text,uuid,integer,integer,integer)')        as f_move,
        to_regprocedure('public.swap_group_teams(text,uuid,uuid,integer)')                  as f_swap,
        to_regprocedure('public.reorder_group_slots(text,integer,uuid[],integer)')          as f_reorder,
        to_regprocedure('public.validate_preliminary_draw(text)')                           as f_val,
        to_regprocedure('public.lock_preliminary_draw(text,integer)')                       as f_lock,
        to_regprocedure('public.unlock_preliminary_draw(text,text,integer)')                as f_unlock,
        to_regprocedure('public.get_admin_preliminary_draw(text)')                          as f_get
),
all_fn as (
    select unnest(array[f_begin, f_bump, f_validate, f_create, f_delgroup, f_assign,
                        f_unassign, f_move, f_swap, f_reorder, f_val, f_lock, f_unlock, f_get]) as oid
      from fn
),
-- PUBLIC(role oid 0) 에 EXECUTE 가 남아 있는 함수 수.
--   has_function_privilege('public', ...) 는 'public' 이 role 명이 아니라 오류가 난다 → aclexplode 사용.
pub_exec as (
    select count(*) as n
      from pg_proc p
      join all_fn a on a.oid = p.oid,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     where x.grantee = 0 and x.privilege_type = 'EXECUTE'
),
hardening as (
    select count(*) as total,
           count(*) filter (where p.prosecdef) as secdef,
           count(*) filter (where exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                           where c like 'search\_path=%')) as pinned
      from pg_proc p join all_fn a on a.oid = p.oid
),
prod as (select id, preliminary_draw_status from public.hosted_tournaments
          where slug = '2026-teyeon-open'),
checks as (

-- ── 1. 테이블 / RLS ─────────────────────────────────────────────────────────
select  1, '[table] hosted_tournament_groups 존재',
        to_regclass('public.hosted_tournament_groups') is not null
union all select  2, '[table] hosted_tournament_group_members 존재',
        to_regclass('public.hosted_tournament_group_members') is not null
union all select  3, '[RLS] 두 테이블 RLS 활성',
        (select count(*) = 2 from pg_class
          where relname in ('hosted_tournament_groups','hosted_tournament_group_members')
            and relnamespace = 'public'::regnamespace and relrowsecurity)
union all select  4, '[RLS] SELECT 정책 2개(운영진 전용)',
        (select count(*) = 2 from pg_policies
          where schemaname='public'
            and tablename in ('hosted_tournament_groups','hosted_tournament_group_members')
            and cmd = 'SELECT')
union all select  5, '[RLS] INSERT/UPDATE/DELETE 정책 0개(직접 쓰기 경로 없음)',
        (select count(*) = 0 from pg_policies
          where schemaname='public'
            and tablename in ('hosted_tournament_groups','hosted_tournament_group_members')
            and cmd <> 'SELECT')

-- ── 2. 테이블 권한 ──────────────────────────────────────────────────────────
union all select 10, '[grant] anon 은 groups SELECT 불가',
        not has_table_privilege('anon', 'public.hosted_tournament_groups', 'SELECT')
union all select 11, '[grant] anon 은 group_members SELECT 불가',
        not has_table_privilege('anon', 'public.hosted_tournament_group_members', 'SELECT')
union all select 12, '[grant] anon 은 groups 쓰기 불가',
        not (has_table_privilege('anon','public.hosted_tournament_groups','INSERT')
          or has_table_privilege('anon','public.hosted_tournament_groups','UPDATE')
          or has_table_privilege('anon','public.hosted_tournament_groups','DELETE'))
union all select 13, '[grant] anon 은 group_members 쓰기 불가',
        not (has_table_privilege('anon','public.hosted_tournament_group_members','INSERT')
          or has_table_privilege('anon','public.hosted_tournament_group_members','UPDATE')
          or has_table_privilege('anon','public.hosted_tournament_group_members','DELETE'))
union all select 14, '[grant] authenticated 는 groups SELECT 가능(RLS 2차 제한)',
        has_table_privilege('authenticated', 'public.hosted_tournament_groups', 'SELECT')
union all select 15, '[grant] authenticated 는 groups 쓰기 불가',
        not (has_table_privilege('authenticated','public.hosted_tournament_groups','INSERT')
          or has_table_privilege('authenticated','public.hosted_tournament_groups','UPDATE')
          or has_table_privilege('authenticated','public.hosted_tournament_groups','DELETE'))
union all select 16, '[grant] authenticated 는 group_members 쓰기 불가',
        not (has_table_privilege('authenticated','public.hosted_tournament_group_members','INSERT')
          or has_table_privilege('authenticated','public.hosted_tournament_group_members','UPDATE')
          or has_table_privilege('authenticated','public.hosted_tournament_group_members','DELETE'))

-- ── 3. groups 제약 ──────────────────────────────────────────────────────────
union all select 20, '[uniq] groups (tournament_id, group_no)',
        (select count(*) = 1 from pg_constraint where conname = 'hosted_tgroup_no_unique')
union all select 21, '[uniq] groups (tournament_id, id) — 복합 FK 대상',
        (select count(*) = 1 from pg_constraint where conname = 'hosted_tgroup_tid_id_unique')
union all select 22, '[uniq] groups display_order 지연 검사(재정렬 가능)',
        (select count(*) = 1 from pg_constraint
          where conname = 'hosted_tgroup_order_unique' and condeferrable and condeferred)
union all select 23, '[check] preliminary=3 / placement=2 강제',
        (select count(*) = 1 from pg_constraint
          where conname = 'hosted_tgroup_size_by_type' and contype = 'c')
union all select 24, '[uniq] placement 조는 대회당 1개(partial unique index)',
        -- ⚠ 술어 문자열을 그대로 비교하지 않는다. Postgres 가 괄호를 붙이는 방식이
        --   컬럼 타입에 따라 달라져 오탐이 난다. 구성 요소로만 확인한다.
        (select count(*) = 1 from pg_indexes
          where schemaname = 'public' and indexname = 'hosted_tgroup_placement_uniq'
            and indexdef ilike '%unique%'
            and indexdef ilike '%where%'
            and indexdef ilike '%placement%')
union all select 26, '[order] placement display_order 를 magic number 로 저장하지 않음',
        -- 9999 같은 고정값이 아니라 그때그때 max(display_order)+1 을 계산해야 한다.
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_create
            and p.prosrc not like '%9999%'
            and p.prosrc ilike '%max(display_order)%')
union all select 25, '[check] group_type 은 preliminary/placement 만',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_groups'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%placement%')

-- ── 4. group_members 제약 ───────────────────────────────────────────────────
union all select 30, '[uniq] ★ 한 팀은 대회 내 1개 조 (tournament_id, team_id)',
        (select count(*) = 1 from pg_constraint where conname = 'hosted_tgmember_team_unique')
union all select 31, '[uniq] 같은 조 slot 중복 금지 + 지연 검사(교환 가능)',
        (select count(*) = 1 from pg_constraint
          where conname = 'hosted_tgmember_slot_unique' and condeferrable and condeferred)
union all select 32, '[fk] 복합 FK → groups(tournament_id, id)',
        (select count(*) = 1 from pg_constraint
          where conname = 'hosted_tgmember_group_fk' and contype = 'f'
            and array_length(conkey, 1) = 2)
union all select 33, '[fk] 복합 FK → teams(tournament_id, id)',
        (select count(*) = 1 from pg_constraint
          where conname = 'hosted_tgmember_team_fk' and contype = 'f'
            and array_length(conkey, 1) = 2)
union all select 34, '[fk] 두 복합 FK 모두 on delete cascade',
        (select count(*) = 2 from pg_constraint
          where conname in ('hosted_tgmember_group_fk','hosted_tgmember_team_fk')
            and confdeltype = 'c')

-- ── 5. hosted_tournaments 잠금 컬럼 ─────────────────────────────────────────
union all select 40, '[column] preliminary_draw 컬럼 4개 존재',
        (select count(*) = 4 from information_schema.columns
          where table_schema='public' and table_name='hosted_tournaments'
            and column_name in ('preliminary_draw_status','preliminary_draw_version',
                                'preliminary_draw_locked_at','preliminary_draw_locked_by'))
union all select 41, '[column] draw_status 기본값 draft + NOT NULL',
        (select is_nullable = 'NO' and column_default like '%draft%'
           from information_schema.columns
          where table_schema='public' and table_name='hosted_tournaments'
            and column_name = 'preliminary_draw_status')
union all select 42, '[check] draw_status 는 draft/locked 만',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournaments'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%preliminary_draw_status%')
union all select 43, '[column] 기존 대회 행이 전부 draft 로 초기화됨',
        (select count(*) = 0 from public.hosted_tournaments
          where preliminary_draw_status is distinct from 'draft'
             or preliminary_draw_version is null)

-- ── 6. 함수 존재 / 보안 ─────────────────────────────────────────────────────
union all select 50, '[fn] 14개 함수 모두 존재',
        (select count(*) = 14 from all_fn where oid is not null)
union all select 51, '[fn] 전 함수 security definer',
        (select total = 14 and secdef = 14 from hardening)
union all select 52, '[fn] 전 함수 search_path 고정',
        (select total = 14 and pinned = 14 from hardening)
union all select 53, '[fn] PUBLIC EXECUTE 잔존 0건',
        (select n = 0 from pub_exec)
union all select 54, '[fn] anon 은 14개 전부 실행 불가',
        (select bool_and(not has_function_privilege('anon', a.oid, 'EXECUTE'))
           from all_fn a where a.oid is not null)
union all select 55, '[fn] 내부 helper 3종은 authenticated 도 실행 불가',
        (select not has_function_privilege('authenticated', f_begin, 'EXECUTE')
            and not has_function_privilege('authenticated', f_bump, 'EXECUTE')
            and not has_function_privilege('authenticated', f_validate, 'EXECUTE') from fn)
union all select 56, '[fn] 공개 RPC 11종은 authenticated 실행 가능(내부 재검증)',
        (select has_function_privilege('authenticated', f_create,   'EXECUTE')
            and has_function_privilege('authenticated', f_delgroup, 'EXECUTE')
            and has_function_privilege('authenticated', f_assign,   'EXECUTE')
            and has_function_privilege('authenticated', f_unassign, 'EXECUTE')
            and has_function_privilege('authenticated', f_move,     'EXECUTE')
            and has_function_privilege('authenticated', f_swap,     'EXECUTE')
            and has_function_privilege('authenticated', f_reorder,  'EXECUTE')
            and has_function_privilege('authenticated', f_val,      'EXECUTE')
            and has_function_privilege('authenticated', f_lock,     'EXECUTE')
            and has_function_privilege('authenticated', f_unlock,   'EXECUTE')
            and has_function_privilege('authenticated', f_get,      'EXECUTE') from fn)
union all select 57, '[fn] 전 write RPC 가 can_manage_tournaments 경유',
        (select count(*) = 11 from pg_proc p, fn
          where p.oid in (fn.f_create, fn.f_delgroup, fn.f_assign, fn.f_unassign, fn.f_move,
                          fn.f_swap, fn.f_reorder, fn.f_val, fn.f_lock, fn.f_unlock, fn.f_get)
            and (p.prosrc ilike '%can_manage_tournaments%'
              or p.prosrc ilike '%hosted_tournament_draw_begin%'))
union all select 58, '[fn] 전 write RPC 가 advisory lock 경유',
        (select count(*) = 9 from pg_proc p, fn
          where p.oid in (fn.f_create, fn.f_delgroup, fn.f_assign, fn.f_unassign, fn.f_move,
                          fn.f_swap, fn.f_reorder, fn.f_lock, fn.f_unlock)
            and (p.prosrc ilike '%pg_advisory_xact_lock%'
              or p.prosrc ilike '%hosted_tournament_draw_begin%'))
union all select 59, '[fn] lock 은 내부에서 검증을 재실행',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_lock and p.prosrc ilike '%hosted_tournament_draw_validate%')
union all select 60, '[fn] unlock 은 reason 필수',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_unlock and p.prosrc ilike '%reason_required%')
union all select 61, '[fn] lock 은 expected_version 필수',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_lock and p.prosrc ilike '%version_required%')
union all select 62, '[fn] assign 이 withdrawn 팀을 차단',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_assign and p.prosrc ilike '%team_withdrawn%')
union all select 63, '[fn] assign 이 정원 초과를 차단',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_assign and p.prosrc ilike '%group_full%')
union all select 64, '[fn] 조 생성이 팀 수로부터 개수를 계산하지 않음(자동 편성 금지)',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_create
            and p.prosrc not ilike '%hosted_tournament_teams%')

-- ── 7. 개인정보 방화벽 ──────────────────────────────────────────────────────
union all select 70, '[PII] groups 컬럼이 설계된 9개와 정확히 일치',
        (select count(*) = 9
                and count(*) filter (where column_name::text <> all(array[
                        'created_at','display_order','expected_size','group_no','group_type',
                        'id','label','tournament_id','updated_at'])) = 0
           from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_groups')
union all select 71, '[PII] group_members 컬럼이 설계된 7개와 정확히 일치',
        (select count(*) = 7
                and count(*) filter (where column_name::text <> all(array[
                        'created_at','group_id','id','slot_no','team_id',
                        'tournament_id','updated_at'])) = 0
           from information_schema.columns
          where table_schema='public' and table_name='hosted_tournament_group_members')
union all select 72, '[PII] 조회 RPC 가 registrations 를 join 하지 않음',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_get and p.prosrc not ilike '%hosted_tournament_registrations%')
union all select 73, '[PII] 검증 helper 도 registrations 를 보지 않음',
        (select count(*) = 1 from pg_proc p, fn
          where p.oid = fn.f_validate and p.prosrc not ilike '%hosted_tournament_registrations%')

-- ── 8. Batch 1 / 접수 회귀 없음 ─────────────────────────────────────────────
union all select 80, '[regression] Batch 1 테이블 3종 그대로 존재',
        (to_regclass('public.hosted_tournament_teams') is not null
     and to_regclass('public.hosted_tournament_courts') is not null
     and to_regclass('public.hosted_tournament_events') is not null)
union all select 81, '[regression] 접수 테이블 2종 그대로 존재',
        (to_regclass('public.hosted_tournament_registrations') is not null
     and to_regclass('public.hosted_tournament_registration_history') is not null)
union all select 82, '[regression] 기존 접수 RPC 6종 존재',
        (to_regprocedure('public.get_public_tournament(text)') is not null
     and to_regprocedure('public.get_public_tournament_teams(text)') is not null
     and to_regprocedure('public.get_admin_tournament_registrations(text)') is not null
     and to_regprocedure('public.get_tournament_registration_history(uuid)') is not null
     and to_regprocedure('public.set_tournament_registration_status(uuid,text,text,text)') is not null
     and to_regprocedure('public.get_admin_hosted_tournaments()') is not null)
union all select 83, '[regression] Batch 1 RPC 4종 존재',
        (to_regprocedure('public.promote_confirmed_registrations(text)') is not null
     and to_regprocedure('public.get_admin_tournament_teams(text)') is not null
     and to_regprocedure('public.upsert_tournament_court(text,integer,text,integer,text,boolean)') is not null
     and to_regprocedure('public.seed_fixture_tournament(text,text,integer,boolean,integer)') is not null)
union all select 84, '[regression] submit RPC lockdown 유지(anon/authenticated)',
        (select count(*) >= 1
                and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
                and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'submit_tournament_registration')
union all select 85, '[regression] events entity_type 에 group/membership 허용(스키마 변경 없음)',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_events'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%membership%')

-- ── 9. Production 보호 ──────────────────────────────────────────────────────
union all select 90, '[prod] 2026-teyeon-open 조 0개',
        (select count(*) = 0 from public.hosted_tournament_groups g, prod
          where g.tournament_id = prod.id)
union all select 91, '[prod] 2026-teyeon-open 배정 0건',
        (select count(*) = 0 from public.hosted_tournament_group_members m, prod
          where m.tournament_id = prod.id)
union all select 92, '[prod] 2026-teyeon-open 조편성 draft 유지',
        (select preliminary_draw_status = 'draft' from prod)
union all select 93, '[prod] 접수 데이터 존속',
        (select count(*) > 0 from public.hosted_tournament_registrations r, prod
          where r.tournament_id = prod.id)
union all select 94, '[prod] 대회 status registration_open 유지',
        (select status = 'registration_open' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 95, '[prod] 승격된 접수 0건(teams 에 registration_id 참조 없음)',
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
