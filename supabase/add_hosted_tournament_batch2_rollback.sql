-- ============================================================================
--  2026 TEYEON OPEN — Tournament Batch 2A 롤백
--
--  대상: supabase/add_hosted_tournament_groups.sql
--
--  ⚠⚠ 이 스크립트는 조편성 데이터(조·배정)를 전부 삭제한다.
--    잠금 상태(preliminary_draw_*)도 함께 사라진다.
--
--  ⚠ 건드리지 않는 것 (아래 어떤 구문도 이들을 대상으로 하지 않는다)
--      hosted_tournament_teams         (Batch 1)
--      hosted_tournament_courts        (Batch 1)
--      hosted_tournament_events        (Batch 1 — 조편성 감사 기록도 그대로 남는다)
--      hosted_tournament_registrations (접수 원장)
--      hosted_tournament_registration_history
--      기존 RPC · RLS · submit lockdown
--      hosted_tournaments 의 기존 컬럼과 행 데이터
--
--    hosted_tournaments 에서 제거하는 것은 Batch 2A 가 추가한 4개 컬럼뿐이다.
--
--  ⚠ 삭제 순서: 함수 → 멤버십 → 조 → 컬럼.
--    멤버십이 조를 FK 로 참조하므로 역순을 지킨다(cascade 가 있지만 명시적으로 둔다).
-- ============================================================================

begin;

-- ── 1) RPC (14종) ───────────────────────────────────────────────────────────
drop function if exists public.get_admin_preliminary_draw(text);
drop function if exists public.unlock_preliminary_draw(text, text, integer);
drop function if exists public.lock_preliminary_draw(text, integer);
drop function if exists public.validate_preliminary_draw(text);
drop function if exists public.reorder_group_slots(text, integer, uuid[], integer);
drop function if exists public.swap_group_teams(text, uuid, uuid, integer);
drop function if exists public.move_group_team(text, uuid, integer, integer, integer);
drop function if exists public.unassign_group_team(text, uuid, integer);
drop function if exists public.assign_group_team(text, integer, uuid, integer, integer);
drop function if exists public.delete_tournament_group(text, integer, integer);
drop function if exists public.create_tournament_groups(text, integer, boolean, integer);
drop function if exists public.hosted_tournament_draw_validate(uuid);
drop function if exists public.hosted_tournament_draw_bump(uuid);
drop function if exists public.hosted_tournament_draw_begin(text, integer);

-- ── 2) 멤버십 ───────────────────────────────────────────────────────────────
drop policy if exists hosted_tgmember_select_manager on public.hosted_tournament_group_members;
drop table if exists public.hosted_tournament_group_members;   -- index/constraint 동반 삭제

-- ── 3) 조 ───────────────────────────────────────────────────────────────────
drop policy if exists hosted_tgroup_select_manager on public.hosted_tournament_groups;
drop table if exists public.hosted_tournament_groups;

-- ── 4) hosted_tournaments 추가 컬럼 4개만 제거 ──────────────────────────────
--   전부 Batch 2A 에서 추가한 것이다. 기존 컬럼·행에는 영향이 없다.
alter table public.hosted_tournaments drop column if exists preliminary_draw_locked_by;
alter table public.hosted_tournaments drop column if exists preliminary_draw_locked_at;
alter table public.hosted_tournaments drop column if exists preliminary_draw_version;
alter table public.hosted_tournaments drop column if exists preliminary_draw_status;

commit;


-- ============================================================================
--  롤백 후 확인 (읽기 전용)
--
--    -- 조편성 오브젝트가 사라졌는가 (3행 모두 NOT APPLIED 여야 한다)
--    select 'groups'  as obj, coalesce(to_regclass('public.hosted_tournament_groups')::text,
--                                     'NOT APPLIED') as state
--    union all
--    select 'members', coalesce(to_regclass('public.hosted_tournament_group_members')::text,
--                               'NOT APPLIED')
--    union all
--    select 'draw columns',
--           coalesce((select string_agg(column_name, ', ') from information_schema.columns
--                      where table_schema='public' and table_name='hosted_tournaments'
--                        and column_name like 'preliminary_draw_%'), 'NOT APPLIED');
--
--    -- Batch 1 · 접수는 그대로여야 한다 (3행 모두 존재)
--    select 'teams'  as obj, to_regclass('public.hosted_tournament_teams')::text  as state
--    union all select 'courts', to_regclass('public.hosted_tournament_courts')::text
--    union all select 'events', to_regclass('public.hosted_tournament_events')::text;
-- ============================================================================
