-- =============================================================================
-- DELTA (READ-ONLY) — 기존 구간(sequence_no <= 42) 상태 변화의 원인 규명
--
--   질문: postcheck 에서 기존 구간 지문이 applied/pending 5 → 4, confirmed/paid 32 → 33 으로
--         한 건 이동했다. 이 변화가 migration 때문인가, 운영진의 정상 처리인가?
--
--   판단 원리
--     · 상태·입금 변경은 set_tournament_registration_status RPC 한 경로로만 일어나고,
--       그 RPC 는 변경마다 hosted_tournament_registration_history 에 행을 남긴다.
--     · migration 은 기존 행을 UPDATE 하지 않으므로 **이력을 만들지 않는다**.
--     → 그러므로 "현재 상태가 마지막 이력과 일치하는가"가 결정적 증거다.
--       이력 없이 바뀐 행이 있으면 migration(또는 외부 직접 수정) 의심, 0이면 전부 운영진 처리로 설명된다.
--
--   ⚠ SELECT 하나다. INSERT/UPDATE/DELETE/DDL/DO/RPC 호출/advisory lock 없음.
--   ⚠ 개인정보 미출력 — 이름 · 전화 · 입금자 · 메모 · 클럽을 읽지 않는다.
--      접수번호도 출력하지 않고 sequence_no 로만 지목한다. actor_user_id 도 출력하지 않는다.
--      (actor_type 은 'public' / 'admin' / 'system' 구분값이라 개인정보가 아니다)
--   대상: 2026-teyeon-open · sequence_no <= 42
-- =============================================================================

with t as (
    select id from public.hosted_tournaments where slug = '2026-teyeon-open'
),
r as (
    select x.id, x.sequence_no, x.registration_status, x.payment_status,
           x.submitted_at, x.updated_at
      from public.hosted_tournament_registrations x join t on t.id = x.tournament_id
     where x.sequence_no <= 42
),
h as (
    select h.registration_id, h.action, h.from_value, h.to_value, h.actor_type, h.created_at,
           r.sequence_no
      from public.hosted_tournament_registration_history h
      join r on r.id = h.registration_id
),
last_reg as (   -- 접수 상태에 대한 마지막 이력 (최초 submit 포함)
    --   시각이 같으면 submit 보다 상태 변경을 뒤로 본다(같은 순간이면 변경이 나중이다).
    select distinct on (registration_id) registration_id, sequence_no, to_value, actor_type, created_at
      from h where action in ('registration_status', 'submit')
     order by registration_id, created_at desc, (case when action = 'submit' then 1 else 0 end)
),
last_pay as (   -- 입금 상태에 대한 마지막 이력
    select distinct on (registration_id) registration_id, sequence_no, to_value, actor_type, created_at
      from h where action = 'payment_status'
     order by registration_id, created_at desc
),
mismatch_reg as (
    select r.sequence_no, r.registration_status as now_value,
           coalesce(lr.to_value, '(이력 없음)') as last_history_value, lr.created_at
      from r left join last_reg lr on lr.registration_id = r.id
     where r.registration_status is distinct from lr.to_value
),
mismatch_pay as (
    select r.sequence_no, r.payment_status as now_value,
           coalesce(lp.to_value, '(이력 없음)') as last_history_value, lp.created_at
      from r left join last_pay lp on lp.registration_id = r.id
     -- 입금은 'pending' 이 최초값이라 이력이 없는 것이 정상이다. 그 경우는 불일치가 아니다.
     where (lp.to_value is null and r.payment_status <> 'pending')
        or (lp.to_value is not null and r.payment_status is distinct from lp.to_value)
),
changed as (   -- 최근(2026-09-20 이후) 상태·입금이 바뀐 기존 구간 행
    select distinct sequence_no from h
     where action in ('registration_status', 'payment_status') and created_at >= date '2026-09-20'
),
rows_out as (
    -- ── 1. 요약 ────────────────────────────────────────────────────────────
    select 1 as ord, '1. 요약' as section, '기존 구간(≤42) 행 수' as item, (select count(*)::text from r) as value
    union all select 2, '1. 요약', '현재 상태 지문',
              (select coalesce(string_agg(s, ' · ' order by s), '(none)') from (
                  select registration_status || '/' || payment_status || '=' || count(*) as s
                    from r group by registration_status, payment_status) q)
    union all select 3, '1. 요약', 'migration 직전 기준선',
              'applied/pending=5 · cancelled/pending=3 · cancelled/refunded=2 · confirmed/paid=32'
    union all select 4, '1. 요약', '이력 전체 건수(기존 구간)', (select count(*)::text from h)
    union all select 5, '1. 요약', '현재 DB 시각(KST)',
              to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')

    -- ── 2. 결정적 증거: 이력 없이 바뀐 행 ──────────────────────────────────
    union all select 10, '2. 이력 정합성', '현재 접수상태 ≠ 마지막 이력 (이력 없는 변경)',
              (select count(*)::text from mismatch_reg)
    union all select 11, '2. 이력 정합성', '현재 입금상태 ≠ 마지막 이력 (이력 없는 변경)',
              (select count(*)::text from mismatch_pay)
    union all
    select 12, '2. 이력 정합성', '  └ 접수상태 불일치 seq ' || sequence_no,
           'now=' || now_value || ' / last_history=' || last_history_value
      from mismatch_reg
    union all
    select 13, '2. 이력 정합성', '  └ 입금상태 불일치 seq ' || sequence_no,
           'now=' || now_value || ' / last_history=' || last_history_value
      from mismatch_pay

    -- ── 3. 최근 변경된 행의 현재 상태 ──────────────────────────────────────
    union all
    select 20 + row_number() over (order by r.sequence_no), '3. 최근 변경 행(≥09-20)',
           'seq ' || r.sequence_no,
           r.registration_status || '/' || r.payment_status
           || ' · submitted ' || to_char(r.submitted_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI')
           || ' · updated ' || to_char(r.updated_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS')
      from r join changed c on c.sequence_no = r.sequence_no

    -- ── 4. 변경 이력 원문(기존 구간 · 2026-09-20 이후) ─────────────────────
    union all
    select 100 + row_number() over (order by created_at, sequence_no), '4. 이력 상세',
           to_char(created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') || ' · seq ' || sequence_no,
           action || ' : ' || coalesce(from_value, '-') || ' → ' || coalesce(to_value, '-')
           || ' · actor=' || actor_type
      from h
     where action in ('registration_status', 'payment_status') and created_at >= date '2026-09-20'

    -- ── 5. 이력 작성자 분포 (system 이 있으면 자동 변경 의심) ───────────────
    union all
    select 300 + row_number() over (order by actor_type, action), '5. actor 분포(≥09-20)',
           actor_type || ' · ' || action, count(*)::text
      from h
     where action in ('registration_status', 'payment_status') and created_at >= date '2026-09-20'
     group by actor_type, action

    -- ── 6. 판정 ────────────────────────────────────────────────────────────
    union all select 900, 'VERDICT', 'UNEXPLAINED CHANGES (이력 없는 변경)',
              (select case when (select count(*) from mismatch_reg) + (select count(*) from mismatch_pay) = 0
                           then 'NONE — 현재 상태가 모두 이력으로 설명된다'
                           else 'FOUND — 위 12/13 행 확인 필요' end)
    union all select 901, 'VERDICT', 'MIGRATION-INDUCED CHANGE',
              (select case when (select count(*) from mismatch_reg) + (select count(*) from mismatch_pay) = 0
                            and not exists (select 1 from h where actor_type = 'system'
                                             and action in ('registration_status', 'payment_status'))
                           then 'NO — 모든 변경이 admin 이력으로 남아 있고 system 자동 변경이 없다'
                           else 'CHECK — 아래 상세 확인' end)
)
select section, item, value from rows_out order by ord;
