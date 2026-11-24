-- ════════════════════════════════════════════════════════════════════════════
-- [CLOSING SPRINT F3 · READ-ONLY] X05(세션 정산에 없는 벌금 청구) · X06(청구 미연결 회원 벌금 납부) 원인 추적
--   SELECT 1문장. INSERT/UPDATE/DELETE/DDL/SET 없음. 결과 1개 표(k · target · item · value).
--   대상은 F3_penalty_reconciliation_summary_READONLY.sql 과 같은 규칙으로 고른다:
--     X05 = penalty 청구 중 공식 · 스냅샷 있는 세션에 연결됐지만 정산 행 어디에도 연결되지 않은 것(reason not_in_settlement)
--     X06 = payment_type='penalty' · receivable_id 없음 · 취소(is_voided) 아님
--   개인정보 최소화: 이름 · 이메일 미출력. id 는 앞 8자. 메모 · 사유는 앞 40자만(원인 추적용).
--   선택 테이블(finance_payment_audit · kdk_archive_corrections)은 이 파일에서 직접 읽지 않는다(없으면 오류가 나므로).
--   Q06 에 '있음'이 나오면 F3_x05_x06_audit_READONLY.sql 을 이어서 실행한다.
-- ════════════════════════════════════════════════════════════════════════════
with
sess as (
  select a.id::text as sid,
         coalesce(substring(a.raw_data ->> 'date' from '^\d{4}-\d{2}-\d{2}'),
                  case when a.created_at is not null then to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD') end) as sdate,
         a.raw_data -> 'settlement_data' as settle, jsonb_typeof(a.raw_data -> 'settlement_data') = 'array' as has_snap
    from public.teyeon_archive_v1 a
   where a.is_official = true and coalesce(a.is_test, false) = false and lower(coalesce(a.archive_type::text, 'kdk')) = 'kdk'
),
mem as (select m.id::text as mid,
               lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(m.nickname::text, ''),
                 '^manual-guest-', '', 'i'), '\s*\(G\)\s*$', '', 'i'), '\s+g$', '', 'i'), '\s+', '', 'g')) as nkey
          from public.members m),
mem_name as (select nkey, min(mid) as mid, count(*) as n from mem where nkey <> '' group by nkey),
ent as (
  select s.sid, e.v,
         nullif(e.v ->> 'player_id', '') as pid,
         (jsonb_typeof(e.v -> 'is_guest') = 'boolean' and (e.v ->> 'is_guest')::boolean) as is_guest,
         case when coalesce(e.v ->> 'penalty_amount', '') ~ '^\s*-?\d+(\.\d+)?\s*$' then (e.v ->> 'penalty_amount')::numeric else 0 end as pen,
         lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(btrim(coalesce(e.v ->> 'player_name', '')),
           '^manual-guest-', '', 'i'), '\s*\(G\)\s*$', '', 'i'), '\s+g$', '', 'i'), '\s+', '', 'g')) as nkey
    from sess s cross join lateral jsonb_array_elements(s.settle) e(v) where s.has_snap
),
ent_m as (
  select e.*, coalesce((select m.mid from mem m where m.mid = e.pid),
                       case when not e.is_guest then (select mn.mid from mem_name mn where mn.n = 1 and mn.nkey = e.nkey) end) as mid
    from ent e where e.pen < 0
),
recv as (
  select r.id, r.member_id::text as mid, r.related_kdk_session_id::text as sid, greatest(r.amount_due, 0) as due, r.status::text as st, to_jsonb(r) as j,
         coalesce((select sum(p.amount) from public.finance_dues_payments p where p.receivable_id = r.id and p.is_voided is not true), 0) as vpaid,
         coalesce((select sum(p.amount) from public.finance_dues_payments p where p.receivable_id = r.id and p.is_voided is true), 0) as voided_amt,
         (select count(*) from public.finance_dues_payments p where p.receivable_id = r.id) as pay_n
    from public.finance_dues_receivables r where r.receivable_type = 'penalty'
),
recv_d as (
  select r.*, case when r.st = 'exempt' then 'exempt' when r.st = 'not_target' then 'not_target'
                   when r.vpaid <= 0 then 'pending' when r.vpaid < r.due then 'partial' else 'paid' end as dst
    from recv r
),
used as (  -- 정산 행이 실제로 쓰는 청구(같은 세션 · 같은 회원 중 id 가 가장 큰 1건 — 앱과 동일)
  select distinct (select d.id from recv_d d where d.sid = e.sid and d.mid = e.mid order by d.id desc limit 1) as rid
    from ent_m e where e.mid is not null
),
x05 as (
  select row_number() over (order by s.sdate, r.id) as n, r.*, s.sdate
    from recv_d r join sess s on s.sid = r.sid and s.has_snap
   where r.id not in (select rid from used where rid is not null)
     and not exists (select 1 from recv o where o.sid = r.sid and o.mid = r.mid and o.id <> r.id and o.id in (select rid from used where rid is not null))
),
x06 as (
  select row_number() over (order by p.paid_at, p.id) as n, p.id, p.member_id::text as mid, p.amount, p.paid_at, to_jsonb(p) as j
    from public.finance_dues_payments p
   where p.payment_type = 'penalty' and p.receivable_id is null and p.is_voided is not true
),
has_audit as (select to_regclass('public.finance_payment_audit') is not null as ok),
has_corr as (select to_regclass('public.kdk_archive_corrections') is not null as ok),
out as (
  -- ── X05 ──────────────────────────────────────────────────────────────────
  select 1 as o, x.n as tn, 'Q01' as k, 'X05#' || x.n as target, '청구 id · 회원 id(앞 8자) · 세션 id · 세션 날짜' as item,
         left(x.id::text, 8) || ' · ' || left(x.mid, 8) || ' · ' || x.sid || ' · ' || coalesce(x.sdate, '날짜 없음') as value
    from x05 x
  union all select 1, x.n, 'Q02', 'X05#' || x.n, '청구액 · 저장 status · 화면 판정 · 유효 납부 · 취소 납부 · 납부 기록 수',
         x.due || ' · ' || x.st || ' · ' || x.dst || ' · ' || x.vpaid || ' · ' || x.voided_amt || ' · ' || x.pay_n from x05 x
  union all select 1, x.n, 'Q03', 'X05#' || x.n, '생성 · 수정 시각(UTC) · 제목 · 면제/비대상 사유(앞 40자)',
         coalesce(x.j ->> 'created_at', '-') || ' · ' || coalesce(x.j ->> 'updated_at', '-') || ' · ' || coalesce(left(x.j ->> 'title', 40), '-')
         || ' · ' || coalesce(left(x.j ->> 'exemption_reason', 40), '-') from x05 x
  union all select 1, x.n, 'Q04', 'X05#' || x.n, '정산 스냅샷: 이 회원 id 항목 수 · 그 벌금액 / 같은 이름 항목(회원 · 게스트) 수 / 동명 회원 수',
         (select count(*) from ent e where e.sid = x.sid and e.pid = x.mid)::text || ' · '
         || coalesce((select string_agg(e.pen::text, ',') from ent e where e.sid = x.sid and e.pid = x.mid), '-') || ' / '
         || (select count(*) from ent e join mem m on m.mid = x.mid where e.sid = x.sid and e.nkey = m.nkey and e.nkey <> '' and not e.is_guest)::text || ' · '
         || (select count(*) from ent e join mem m on m.mid = x.mid where e.sid = x.sid and e.nkey = m.nkey and e.nkey <> '' and e.is_guest)::text || ' / '
         || (select count(*) from mem m2 join mem m on m.mid = x.mid where m2.nkey = m.nkey and m.nkey <> '')::text from x05 x
  union all select 1, x.n, 'Q05', 'X05#' || x.n, '같은 이름 게스트 항목의 게스트 납부(paid) 수 · 금액',
         (select count(*) from ent e join mem m on m.mid = x.mid
            join public.kdk_guest_penalty_payments g on g.session_id = e.sid and g.participant_id = e.pid and g.status = 'paid'
           where e.sid = x.sid and e.is_guest and e.nkey = m.nkey and e.nkey <> '')::text || ' · '
         || coalesce((select sum(g.amount) from ent e join mem m on m.mid = x.mid
            join public.kdk_guest_penalty_payments g on g.session_id = e.sid and g.participant_id = e.pid and g.status = 'paid'
           where e.sid = x.sid and e.is_guest and e.nkey = m.nkey and e.nkey <> '')::text, '0') from x05 x
  union all select 1, x.n, 'Q06', 'X05#' || x.n, '선택 테이블 존재: finance_payment_audit · kdk_archive_corrections (있으면 F3_x05_x06_audit_READONLY.sql 로 감사 기록 확인)',
         case when (select ok from has_audit) then '있음' else '없음' end || ' · ' || case when (select ok from has_corr) then '있음' else '없음' end from x05 x
  union all select 1, x.n, 'Q08', 'X05#' || x.n, '화면 영향(회원 상세 · 본인 회비 화면 · 누적 벌금 예외 목록)',
         case when x.dst in ('exempt', 'not_target') then '비대상/면제로 표시 — 미납 · 합계 영향 없음(누적 현황은 예외 목록에만)'
              when x.dst = 'paid' then '완납으로 표시 — 미납 영향 없음(누적 현황 합계에는 미포함 · 예외 목록에만)'
              else '미납(' || x.dst || ') ' || (x.due - x.vpaid) || '원으로 회원 상세 · 본인 화면에 표시됨 — 확인 필요' end from x05 x
  union all select 1, x.n, 'Q09', 'X05#' || x.n, '추정(단정 아님)',
         case when x.sdate = '2026-11-10' and x.st = 'not_target' and x.voided_amt > 0
                then '2026-11-10 게스트 오매칭 정정(fix_kdk_guest_penalty_mismatch_20261110) 결과와 일치 — 의도된 비대상 · 정정 불필요 후보'
              when x.st in ('exempt', 'not_target') then '운영진이 제외 처리한 청구 — 사유(Q03) 확인'
              when (select count(*) from ent e where e.sid = x.sid and e.pid = x.mid) > 0 then '정산 항목은 있으나 벌금 0원(정산 정정 후 청구만 남음) 후보'
              else '정산에 없는 회원에게 청구(이름 오매칭 · 수동 등록) 후보 — Q04 · Q05 확인' end from x05 x
  -- ── X06 ──────────────────────────────────────────────────────────────────
  union all select 2, x.n, 'P01', 'X06#' || x.n, '납부 id · 회원 id(앞 8자) · 금액 · 납부일 · 생성 · 수정 시각(UTC)',
         left(x.id::text, 8) || ' · ' || left(x.mid, 8) || ' · ' || x.amount || ' · ' || coalesce(x.paid_at::text, '-') || ' · '
         || coalesce(x.j ->> 'created_at', '-') || ' · ' || coalesce(x.j ->> 'updated_at', '-') from x06 x
  union all select 2, x.n, 'P02', 'X06#' || x.n, '기록 경로 단서: 입력자 기록 여부 · 메모(앞 40자)',
         case when coalesce(x.j ->> 'created_by', '') <> '' then '입력자 있음(앱 화면)' else '입력자 없음(SQL · 이관 등)' end || ' · '
         || coalesce(left(x.j ->> 'memo', 40), '-') from x06 x
  union all select 2, x.n, 'P03', 'X06#' || x.n, '이 회원의 벌금 청구: 전체 수 · 미납(pending/partial) 수 · 같은 금액 청구 수 · 같은 금액 중 이미 완납 수',
         (select count(*) from recv_d d where d.mid = x.mid)::text || ' · '
         || (select count(*) from recv_d d where d.mid = x.mid and d.dst in ('pending', 'partial'))::text || ' · '
         || (select count(*) from recv_d d where d.mid = x.mid and d.due = x.amount)::text || ' · '
         || (select count(*) from recv_d d where d.mid = x.mid and d.due = x.amount and d.dst = 'paid')::text from x06 x
  union all select 2, x.n, 'P04', 'X06#' || x.n, '납부일과 같은 날짜의 공식 KDK 세션: 이 회원 벌금 청구 · 그 청구의 유효 납부',
         coalesce((select string_agg(d.sid || ':' || d.due || '/' || d.vpaid || '(' || d.dst || ')', ', ')
                     from recv_d d join sess s on s.sid = d.sid where d.mid = x.mid and s.sdate = x.paid_at::text), '없음') from x06 x
  union all select 2, x.n, 'P06', 'X06#' || x.n, 'X05 청구와 같은 회원인가',
         case when exists (select 1 from x05 y where y.mid = x.mid) then '예 — X05#' || (select string_agg(y.n::text, ',') from x05 y where y.mid = x.mid) else '아니오' end from x06 x
  union all select 2, x.n, 'P07', 'X06#' || x.n, '회원 벌금 잔액 대조: 청구 대상 합(면제 · 비대상 제외) · 연결 유효 납부 합 · 미연결 납부 합',
         coalesce((select sum(d.due) from recv_d d where d.mid = x.mid and d.dst not in ('exempt', 'not_target')), 0) || ' · '
         || coalesce((select sum(d.vpaid) from recv_d d where d.mid = x.mid and d.dst not in ('exempt', 'not_target')), 0) || ' · '
         || coalesce((select sum(p.amount) from public.finance_dues_payments p where p.member_id::text = x.mid and p.payment_type = 'penalty'
                       and p.receivable_id is null and p.is_voided is not true), 0) from x06 x
  union all select 2, x.n, 'P08', 'X06#' || x.n, '화면 영향',
         '회원 상세 · 본인 화면의 "납부 기록" 목록에만 표시. 청구 합계 · 미납 · 누적 벌금 합계 · 공유 이미지에는 미포함(누적 현황 예외 "청구 미연결 납부"에 표시)' from x06 x
  union all select 2, x.n, 'P09', 'X06#' || x.n, '추정(단정 아님)',
         case when (select count(*) from recv_d d where d.mid = x.mid and d.dst in ('pending', 'partial') and d.due - d.vpaid = x.amount) > 0
                then '미납 청구와 금액 일치 — 연결 누락(재연결 후보)'
              when (select count(*) from recv_d d where d.mid = x.mid and d.due = x.amount and d.dst = 'paid') > 0
                then '같은 금액 청구가 이미 완납 — 중복 납부 또는 다른 목적 납부 후보'
              else '/finance/record 수동 입력(벌금 종류 · 청구 연결 없이 저장되는 경로) 또는 청구 삭제(FK on delete set null) 후보 — P02 · P04 확인' end from x06 x
  union all
  select 3, 0, 'Z01', '요약', 'X05 대상 수 · X06 대상 수(요약 SQL 의 X05 not_in_settlement · X06 과 같아야 함)',
         (select count(*) from x05)::text || ' · ' || (select count(*) from x06)::text
)
select k, target, item, value from out order by o, tn, k;
