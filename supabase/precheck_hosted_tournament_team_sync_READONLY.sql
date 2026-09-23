-- =============================================================================
-- PRECHECK (READ-ONLY) — 접수 ↔ operational team 정합성 · 대기 순서 마이그레이션 사전 확인
--
--   ⚠ 이 파일은 SELECT 하나다.
--      INSERT / UPDATE / DELETE / MERGE / TRUNCATE / DDL / DO 블록 없음.
--      함수 호출 없음(SECURITY DEFINER RPC 를 부르지 않는다). 개인정보 컬럼을 읽지 않는다.
--   대상: 2026-teyeon-open
--   출력: section · item · value 3열. 마지막 두 행이 판정이다.
--         DATA CORRECTION REQUIRED / SAFE TO APPLY MIGRATION
--
--   확인 대상 (결정된 정책 기준)
--     · team 전체 / active / withdrawn / registration 연결 수
--     · 취소·거절 접수인데 team 이 active        → 자동 withdrawn 대상(경기 미사용 건에 한함)
--     · confirmed 접수인데 team 이 withdrawn      → 자동 복구 대상 후보(사유 구분 전이라 수동 확인)
--     · group membership · match 에 이미 사용된 team → 자동 변경 금지 대상
--     · 취소 접수 + 조/경기 사용 team              → Admin 경고 대상(운영진 판단)
--     · 현재 waitlisted 수 · 과거 대기 진입/이탈 이력 · 대기 순번 역전 여부
-- =============================================================================

with t as (
    select id from public.hosted_tournaments where slug = '2026-teyeon-open'
),
tm as (
    select x.id, x.team_no, x.status, x.registration_id, x.source
      from public.hosted_tournament_teams x join t on t.id = x.tournament_id
),
rg as (
    select x.id, x.registration_status, x.sequence_no, x.submitted_at
      from public.hosted_tournament_registrations x join t on t.id = x.tournament_id
),
gm as (   -- 조편성에 배정된 team
    select distinct m.team_id from public.hosted_tournament_group_members m join t on t.id = m.tournament_id
),
mt as (   -- 경기에 등장하는 team (취소 경기 포함 — 데이터가 남아 있으면 '사용됨'으로 본다)
    select team1_id as team_id from public.hosted_tournament_matches m join t on t.id = m.tournament_id
    union
    select team2_id from public.hosted_tournament_matches m join t on t.id = m.tournament_id
),
used as (
    select team_id from gm where team_id is not null
    union
    select team_id from mt where team_id is not null
),
link as (  -- team ↔ registration 조인 + 사용 여부
    select tm.id, tm.team_no, tm.status, tm.registration_id, tm.source,
           rg.registration_status,
           (tm.id in (select team_id from used))                     as in_use,
           (tm.id in (select team_id from gm where team_id is not null)) as in_group,
           (tm.id in (select team_id from mt where team_id is not null)) as in_match
      from tm left join rg on rg.id = tm.registration_id
),
wl as (    -- 현재 대기팀
    select * from rg where registration_status = 'waitlisted'
),
hist as (
    select h.action, h.from_value, h.to_value
      from public.hosted_tournament_registration_history h join rg on rg.id = h.registration_id
),
calc as (
    select
      (select count(*) from tm)                                                          as team_total,
      (select count(*) from tm where status = 'active')                                  as team_active,
      (select count(*) from tm where status = 'withdrawn')                               as team_withdrawn,
      (select count(*) from tm where registration_id is not null)                        as team_linked,
      (select count(*) from tm where registration_id is null)                            as team_unlinked,
      (select count(*) from link where status = 'active'
         and registration_status in ('cancelled', 'rejected'))                           as cancelled_active,
      (select count(*) from link where status = 'active'
         and registration_status in ('cancelled', 'rejected') and not in_use)            as cancelled_active_free,
      (select count(*) from link where status = 'active'
         and registration_status in ('cancelled', 'rejected') and in_use)                as cancelled_active_inuse,
      (select count(*) from link where status = 'withdrawn'
         and registration_status = 'confirmed')                                          as confirmed_withdrawn,
      (select count(*) from link where in_group)                                         as team_in_group,
      (select count(*) from link where in_match)                                         as team_in_match,
      (select count(*) from link where in_use)                                           as team_in_use,
      (select count(*) from link where registration_id is not null and registration_status is null) as team_orphan_link,
      (select count(*) from wl)                                                          as wait_now,
      (select count(*) from hist where to_value = 'waitlisted')                          as hist_into_wait,
      (select count(*) from hist where from_value = 'waitlisted')                        as hist_out_wait,
      (select count(*) from hist where action = 'registration_status'
         and from_value in ('cancelled', 'rejected')
         and to_value in ('applied', 'waitlisted', 'confirmed'))                         as hist_restored,
      (select count(*) from wl a
        where exists (select 1 from wl b
                       where b.sequence_no > a.sequence_no and b.submitted_at < a.submitted_at)) as wait_inverted
),
rows_out as (
    select 1 as ord, 'teams' as section, 'hosted_tournament_teams 전체' as item, (select team_total::text from calc) as value
    union all select 2, 'teams', 'active', (select team_active::text from calc)
    union all select 3, 'teams', 'withdrawn', (select team_withdrawn::text from calc)
    union all select 4, 'teams', 'registration 연결 team', (select team_linked::text from calc)
    union all select 5, 'teams', 'registration 미연결 team(fixture/manual)', (select team_unlinked::text from calc)
    union all select 6, 'teams', '연결된 registration 이 사라진 team(고아)', (select team_orphan_link::text from calc)

    union all select 10, 'TODO1', 'cancelled/rejected 접수 · team active (전체)', (select cancelled_active::text from calc)
    union all select 11, 'TODO1', '  └ 조/경기 미사용 → 자동 withdrawn 대상', (select cancelled_active_free::text from calc)
    union all select 12, 'TODO1', '  └ 조/경기 사용 중 → 자동 변경 금지 · Admin 경고 대상', (select cancelled_active_inuse::text from calc)
    union all select 13, 'TODO1', 'confirmed 접수 · team withdrawn (복구 후보)', (select confirmed_withdrawn::text from calc)

    union all select 20, 'usage', 'group membership 에 사용된 team', (select team_in_group::text from calc)
    union all select 21, 'usage', 'match 에 사용된 team', (select team_in_match::text from calc)
    union all select 22, 'usage', '조 또는 경기에 사용된 team(합집합)', (select team_in_use::text from calc)

    union all select 30, 'TODO2', '현재 waitlisted 수', (select wait_now::text from calc)
    union all select 31, 'TODO2', '이력: waitlisted 로 진입', (select hist_into_wait::text from calc)
    union all select 32, 'TODO2', '이력: waitlisted 에서 이탈(승격 · 취소 등)', (select hist_out_wait::text from calc)
    union all select 33, 'TODO2', '이력: cancelled/rejected → 활성 복구', (select hist_restored::text from calc)
    union all select 34, 'TODO2', '현재 대기 순번 역전(접수 순번 vs 신청 시각)', (select wait_inverted::text from calc)

    union all select 90, 'VERDICT', 'DATA CORRECTION REQUIRED',
              case when (select cancelled_active + confirmed_withdrawn + wait_inverted from calc) = 0
                   then 'NO — 기존 행 보정 없이 적용 가능'
                   else 'YES — 아래 건수 확인 후 보정 범위 결정: '
                        || 'cancelled·active ' || (select cancelled_active::text from calc)
                        || ' / confirmed·withdrawn ' || (select confirmed_withdrawn::text from calc)
                        || ' / 대기 역전 ' || (select wait_inverted::text from calc) end
    union all select 91, 'VERDICT', 'SAFE TO APPLY MIGRATION',
              case when (select cancelled_active_inuse from calc) = 0
                   then 'YES — 조/경기에 물린 충돌 건 없음(컬럼 추가는 nullable 이라 기존 행 무변경)'
                   else 'CHECK — 조/경기 사용 중인 취소 건 '
                        || (select cancelled_active_inuse::text from calc) || '건: 자동 변경 대상 아님 · 운영진 판단 필요' end
)
select section, item, value from rows_out order by ord;
