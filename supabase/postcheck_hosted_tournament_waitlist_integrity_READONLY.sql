-- =============================================================================
-- POSTCHECK (READ-ONLY) — add_hosted_tournament_waitlist_integrity.sql 적용 후 운영 데이터 확인
--
--   ⚠ 이 파일은 SELECT 하나다.
--      INSERT / UPDATE / DELETE / MERGE / TRUNCATE / DDL / DO 블록 / advisory lock 없음.
--      함수 호출 없음(RPC 를 부르지 않는다). 이름 · 전화 · 입금자 · 메모를 읽지 않는다 — 건수와 상태만.
--   대상: 2026-teyeon-open
--   출력: section · item · value. 마지막 3행이 판정이다.
--
--   기준선(migration 직전 precheck 결과)
--     총 42행 / 정상 37(applied 5 · confirmed 32) / 대기 0 / 취소 5 / 거절 0 / 최대 순번 42
--     입금 paid 32 · pending 8 · refunded 2 / 팀 0 / 조 · 경기 사용 0 / 순번 역전 0
--     ⚠ 그 뒤 실제 참가자의 신규 신청(순번 43~)은 정상이다. 그래서 아래는
--        '기존 구간(sequence_no <= 42)' 과 '신규 구간(sequence_no >= 43)' 을 나눠서 센다.
--        기존 구간이 기준선과 한 글자도 다르지 않아야 migration 이 데이터를 건드리지 않은 것이다.
-- =============================================================================

with t as (
    select id from public.hosted_tournaments where slug = '2026-teyeon-open'
),
r as (
    select x.sequence_no, x.registration_no, x.registration_status, x.payment_status,
           x.submitted_at, x.waitlisted_at, x.updated_at
      from public.hosted_tournament_registrations x join t on t.id = x.tournament_id
),
old as (select * from r where sequence_no <= 42),
new as (select * from r where sequence_no >= 43),
tm as (
    select x.id, x.team_no, x.status, x.withdrawn_reason, x.registration_id, x.source
      from public.hosted_tournament_teams x join t on t.id = x.tournament_id
),
gm as (select distinct m.team_id from public.hosted_tournament_group_members m join t on t.id = m.tournament_id),
mt as (
    select team1_id as team_id from public.hosted_tournament_matches m join t on t.id = m.tournament_id
    union
    select team2_id from public.hosted_tournament_matches m join t on t.id = m.tournament_id
),
used as (
    select team_id from gm where team_id is not null
    union
    select team_id from mt where team_id is not null
),
teamlink as (
    select tm.id, tm.status, tm.withdrawn_reason,
           reg.registration_status,
           (tm.id in (select team_id from used)) as in_use
      from tm
      left join (select x.id, x.registration_status
                   from public.hosted_tournament_registrations x join t on t.id = x.tournament_id) reg
             on reg.id = tm.registration_id
),
hist as (
    select h.action, h.created_at
      from public.hosted_tournament_registration_history h
      join public.hosted_tournament_registrations x on x.id = h.registration_id
      join t on t.id = x.tournament_id
),
calc as (
    select
      -- A. 스키마
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_registrations'
          and column_name = 'waitlisted_at' and data_type = 'timestamp with time zone'
          and is_nullable = 'YES')                                                   as col_waitlisted_at,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'hosted_tournament_teams'
          and column_name = 'withdrawn_reason' and data_type = 'text'
          and is_nullable = 'YES')                                                   as col_withdrawn_reason,
      (select count(*) from pg_constraint
        where conname = 'hosted_tteam_withdrawn_reason_check'
          and conrelid = 'public.hosted_tournament_teams'::regclass)                  as chk_reason,
      (select count(*) from pg_indexes
        where schemaname = 'public' and indexname = 'hosted_treg_waitlist_order_idx') as idx_waitlist,
      -- B. 접수
      (select count(*) from r)                                                        as total_all,
      (select count(*) from old)                                                      as total_old,
      (select count(*) from new)                                                      as total_new,
      (select count(*) filter (where registration_status in ('applied', 'confirmed')) from r) as normal_all,
      (select count(*) filter (where registration_status = 'applied') from r)         as applied_all,
      (select count(*) filter (where registration_status = 'confirmed') from r)       as confirmed_all,
      (select count(*) filter (where registration_status = 'waitlisted') from r)      as wait_all,
      (select count(*) filter (where registration_status = 'cancelled') from r)       as cancelled_all,
      (select count(*) filter (where registration_status = 'rejected') from r)        as rejected_all,
      (select coalesce(max(sequence_no), 0) from r)                                   as max_seq,
      (select count(*) - count(distinct registration_no) from r)                      as dup_regno,
      (select count(*) - count(distinct sequence_no) from r)                          as dup_seq,
      -- 기존 구간(<=42) 상태 지문 — 기준선과 문자열로 비교한다
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select registration_status || '/' || payment_status || '=' || count(*) as s
            from old group by registration_status, payment_status) q)                 as old_fingerprint,
      (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
          select registration_status || '/' || payment_status || '=' || count(*) as s
            from new group by registration_status, payment_status) q)                 as new_fingerprint,
      -- C. 팀
      (select count(*) from tm)                                                       as team_total,
      (select count(*) filter (where status = 'active') from tm)                      as team_active,
      (select count(*) filter (where status = 'withdrawn') from tm)                   as team_withdrawn,
      (select count(*) filter (where registration_id is not null) from tm)            as team_linked,
      (select count(*) from teamlink
        where status = 'active' and registration_status in ('cancelled', 'rejected')) as team_cancel_active,
      (select count(*) from teamlink
        where status = 'withdrawn' and registration_status = 'confirmed')             as team_confirm_withdrawn,
      (select count(*) from teamlink where in_use)                                    as team_in_use,
      -- D. 대기 정합성
      (select count(*) from r where registration_status = 'waitlisted' and waitlisted_at is null)      as wait_missing_at,
      (select count(*) from r where registration_status <> 'waitlisted' and waitlisted_at is not null) as wait_stale_at,
      (select count(*) from r a
        where a.registration_status = 'waitlisted'
          and exists (select 1 from r b
                       where b.registration_status = 'waitlisted'
                         and coalesce(b.waitlisted_at, b.submitted_at) > coalesce(a.waitlisted_at, a.submitted_at)
                         and b.sequence_no < a.sequence_no))                          as wait_inverted,
      -- E. 운영 데이터 안전
      (select count(*) filter (where status = 'active' and withdrawn_reason is not null) from tm)      as team_bad_reason,
      (select count(*) from hist where action in ('registration_status', 'payment_status')
         and created_at >= date '2026-09-22')                                         as hist_recent_changes,
      (select coalesce(max(updated_at)::text, '(none)') from old)                     as old_max_updated
),
rows_out as (
    -- A. 스키마
    select 1 as ord, 'A. schema' as section, 'registrations.waitlisted_at (timestamptz · nullable)' as item,
           (select case when col_waitlisted_at = 1 then 'OK' else 'MISSING' end from calc) as value
    union all select 2, 'A. schema', 'teams.withdrawn_reason (text · nullable)',
              (select case when col_withdrawn_reason = 1 then 'OK' else 'MISSING' end from calc)
    union all select 3, 'A. schema', 'CHECK hosted_tteam_withdrawn_reason_check',
              (select case when chk_reason = 1 then 'OK' else 'MISSING' end from calc)
    union all select 4, 'A. schema', 'partial index hosted_treg_waitlist_order_idx',
              (select case when idx_waitlist = 1 then 'OK' else 'MISSING' end from calc)
    -- B. 접수
    union all select 10, 'B. registration', '전체 행 수', (select total_all::text from calc)
    union all select 11, 'B. registration', '  └ 기존 구간(순번 ≤ 42)', (select total_old::text from calc)
    union all select 12, 'B. registration', '  └ 신규 구간(순번 ≥ 43 · migration 이후 실제 신청)', (select total_new::text from calc)
    union all select 13, 'B. registration', '정상 참가(applied + confirmed)', (select normal_all::text from calc)
    union all select 14, 'B. registration', 'applied', (select applied_all::text from calc)
    union all select 15, 'B. registration', 'confirmed', (select confirmed_all::text from calc)
    union all select 16, 'B. registration', 'waitlisted', (select wait_all::text from calc)
    union all select 17, 'B. registration', 'cancelled', (select cancelled_all::text from calc)
    union all select 18, 'B. registration', 'rejected', (select rejected_all::text from calc)
    union all select 19, 'B. registration', 'max sequence_no', (select max_seq::text from calc)
    union all select 20, 'B. registration', 'registration_no 중복', (select dup_regno::text from calc)
    union all select 21, 'B. registration', 'sequence_no 중복', (select dup_seq::text from calc)
    union all
    select 30 + row_number() over (order by payment_status), 'B. payment (전체)', payment_status, count(*)::text
      from r group by payment_status
    -- C. 팀
    union all select 40, 'C. team', '전체', (select team_total::text from calc)
    union all select 41, 'C. team', 'active', (select team_active::text from calc)
    union all select 42, 'C. team', 'withdrawn', (select team_withdrawn::text from calc)
    union all select 43, 'C. team', 'registration 연결', (select team_linked::text from calc)
    union all select 44, 'C. team', 'cancelled/rejected 접수인데 active', (select team_cancel_active::text from calc)
    union all select 45, 'C. team', 'confirmed 접수인데 withdrawn', (select team_confirm_withdrawn::text from calc)
    union all select 46, 'C. team', '조 또는 경기에 사용된 team', (select team_in_use::text from calc)
    -- D. 대기 정합성
    union all select 50, 'D. waitlist', 'waitlisted 인데 waitlisted_at NULL', (select wait_missing_at::text from calc)
    union all select 51, 'D. waitlist', 'waitlisted 아닌데 waitlisted_at 남음', (select wait_stale_at::text from calc)
    union all select 52, 'D. waitlist', '대기 순번 역전(진입 시각 vs 접수 순번)', (select wait_inverted::text from calc)
    -- E. 운영 데이터 안전
    union all select 60, 'E. safety', '기존 구간 상태 지문(기준선과 같아야 함)', (select old_fingerprint from calc)
    union all select 61, 'E. safety', '기준선(migration 직전 precheck)',
              'applied/pending=5 · cancelled/pending=3 · cancelled/refunded=2 · confirmed/paid=32'
    union all select 62, 'E. safety', '신규 구간 상태 지문(실제 신규 신청)', (select new_fingerprint from calc)
    union all select 63, 'E. safety', 'active 인데 기권 사유가 남은 team', (select team_bad_reason::text from calc)
    union all select 64, 'E. safety', '2026-09-22 이후 운영진 상태/입금 변경 이력 건수', (select hist_recent_changes::text from calc)
    union all select 65, 'E. safety', '기존 구간 최종 updated_at', (select old_max_updated from calc)
    -- 판정
    union all select 90, 'VERDICT', 'SCHEMA APPLIED',
              (select case when col_waitlisted_at = 1 and col_withdrawn_reason = 1
                            and chk_reason = 1 and idx_waitlist = 1
                           then 'YES — 컬럼 2 · CHECK · 인덱스 모두 존재' else 'NO — 위 A 항목 확인' end from calc)
    union all select 91, 'VERDICT', 'PRODUCTION DATA UNCHANGED',
              (select case when total_old = 42
                            and old_fingerprint = 'applied/pending=5 · cancelled/pending=3 · cancelled/refunded=2 · confirmed/paid=32'
                            and dup_regno = 0 and dup_seq = 0
                           then 'YES — 기존 42행의 상태 · 입금 · 번호가 기준선과 동일'
                           else 'CHECK — 기존 구간이 기준선과 다르다. 60/61 행 비교 필요' end from calc)
    union all select 92, 'VERDICT', 'INTEGRITY CLEAN',
              (select case when wait_missing_at = 0 and wait_stale_at = 0 and wait_inverted = 0
                            and team_cancel_active = 0 and team_confirm_withdrawn = 0 and team_bad_reason = 0
                           then 'YES — 대기 · 팀 정합성 위반 0건'
                           else 'CHECK — 50~52 · 44~45 · 63 행 확인' end from calc)
)
select section, item, value from rows_out order by ord;
