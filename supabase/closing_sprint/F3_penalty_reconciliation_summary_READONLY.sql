-- ════════════════════════════════════════════════════════════════════════════
-- [CLOSING SPRINT F3 · READ-ONLY] KDK 벌금 정합성 요약(건수 · 금액만) — Finance 누적 벌금 현황과 같은 판정 규칙
--   SELECT 1문장. INSERT/UPDATE/DELETE/DDL/SET 없음. 이름 · 이메일 · ID 출력 없음(건수 · 금액만).
--   Supabase SQL Editor 에서 실행(소유자 권한 — 앱 RLS 와 무관하게 전체 집계).
--
--   판정 규칙 = 앱과 동일(lib/finance/kdkPenaltyHistoryService · kdkPenaltyHistoryModel · kdkSettlementService.buildKdkPenaltyRows):
--     세션  : teyeon_archive_v1 공식(is_official) · 비테스트 · archive_type='kdk'. 날짜 = raw_data.date 앞 10자, 없으면 created_at(UTC) 날짜.
--     대상  : raw_data.settlement_data 배열의 penalty_amount < 0 항목. 금액 = |trunc(penalty_amount)|.
--     회원 연결: (1) player_id = members.id (2) 게스트(is_guest=true) 가 아니면 정규화 이름이 유일하게 일치하는 회원.
--     회원 행: 같은 세션 · 같은 회원의 penalty 청구(여럿이면 id 가 가장 큰 1건) → 취소 제외 납부 합계로 상태 계산
--              exempt/not_target(저장값) > 납부 0 = pending > 일부 = partial > 완납 = paid. 청구 없음 = unregistered.
--              (저장된 status 는 exempt/not_target 외에는 화면 판정에 쓰이지 않는다 — X02 는 정보용)
--     게스트 행: 회원 미연결 · is_guest · player_id 있음 → kdk_guest_penalty_payments(paid) 있으면 paid, 없으면 pending.
--     그 외  : needs_link(회원 연결 필요 — 화면 '확인 필요').
--   구간: A = 세션일 2026-11-18 이하(사용자 확인: 회원 · 게스트 실제 수납 완료) / B = 2026-11-19 이후(납부 완료로 간주하지 않음) / C = 날짜 없음.
--
--   읽는 법(판정 기준)
--     A 구간: unpaid · review 건수가 0 이면 "기록 = 실제(전부 수납)". 0 이 아니면 그 건수가 "실제 수납됐지만 기록 누락" 후보
--             (단, unregistered 는 청구 자체가 없는 회원 벌금 — 등록 누락인지 의도적 미청구인지 운영진 확인 필요).
--     B 구간: 미납은 실제 미납일 수 있다(이 SQL 로 판단하지 않음). 금액 · 건수만 기록.
--     X 행  : 0 이면 OK. 0 이 아니면 F3_penalty_status_consistency_READONLY.sql(행 단위 · id 앞 8자)로 상세 확인.
-- ════════════════════════════════════════════════════════════════════════════
with
sess as (
  select a.id::text as sid,
         coalesce(substring(a.raw_data ->> 'date' from '^\d{4}-\d{2}-\d{2}'),
                  case when a.created_at is not null then to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD') end) as sdate,
         a.raw_data -> 'settlement_data' as settle
    from public.teyeon_archive_v1 a
   where a.is_official = true and coalesce(a.is_test, false) = false
     and lower(coalesce(a.archive_type::text, 'kdk')) = 'kdk'
),
sp as (
  select s.*, case when s.sdate is null then 'C 날짜 없음' when s.sdate <= '2026-11-18' then 'A ~11-18' else 'B 11-19~' end as per,
         jsonb_typeof(s.settle) = 'array' as has_snap
    from sess s
),
mem as (select m.id::text as mid,
               lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(m.nickname::text, ''),
                 '^manual-guest-', '', 'i'), '\s*\(G\)\s*$', '', 'i'), '\s+g$', '', 'i'), '\s+', '', 'g')) as nkey
          from public.members m),
mem_name as (select nkey, min(mid) as mid, count(*) as n from mem where nkey <> '' group by nkey),
ent0 as (
  select p.sid, p.per, e.ord,
         nullif(e.v ->> 'player_id', '') as pid,
         btrim(coalesce(e.v ->> 'player_name', '')) as pname,
         (jsonb_typeof(e.v -> 'is_guest') = 'boolean' and (e.v ->> 'is_guest')::boolean) as is_guest,
         case when coalesce(e.v ->> 'penalty_amount', '') ~ '^\s*-?\d+(\.\d+)?\s*$' then (e.v ->> 'penalty_amount')::numeric else 0 end as pen
    from sp p cross join lateral jsonb_array_elements(p.settle) with ordinality as e(v, ord)
   where p.has_snap
),
ent as (
  select e.*, abs(trunc(e.pen)) as amount,
         coalesce((select m.mid from mem m where m.mid = e.pid),
                  case when not e.is_guest then (select mn.mid from mem_name mn where mn.n = 1 and mn.nkey =
                    lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(e.pname,
                      '^manual-guest-', '', 'i'), '\s*\(G\)\s*$', '', 'i'), '\s+g$', '', 'i'), '\s+', '', 'g'))) end) as mid
    from ent0 e
   where e.pen < 0
),
recv as (
  select r.id, r.member_id::text as mid, r.related_kdk_session_id::text as sid, r.amount_due, greatest(r.amount_due, 0) as due, r.status::text as st,
         coalesce((select sum(p.amount) from public.finance_dues_payments p
                    where p.receivable_id = r.id and p.is_voided is not true), 0) as vpaid
    from public.finance_dues_receivables r
   where r.receivable_type = 'penalty'
),
recv_d as (
  select r.*, case when r.st = 'exempt' then 'exempt' when r.st = 'not_target' then 'not_target'
                   when r.vpaid <= 0 then 'pending' when r.vpaid < r.due then 'partial' else 'paid' end as dst
    from recv r
),
gpay as (
  select g.session_id::text as sid, g.participant_id::text as pid, g.amount, g.status::text as st
    from public.kdk_guest_penalty_payments g where coalesce(g.charge_type, 'penalty') = 'penalty'
),
rowx as (
  select e.sid, e.per, e.ord, e.pid, e.mid, e.is_guest, e.amount as entry_amount, rc.id as rid, rc.due, rc.vpaid, rc.dst, rc.st,
         case when e.mid is null and e.is_guest then 'guest' else 'member' end as side,  -- 앱: memberId ? member : isGuest ? guest : member
         case when e.mid is null then
                case when e.is_guest and e.pid is not null then
                       case when exists (select 1 from gpay g where g.sid = e.sid and g.pid = e.pid and g.st = 'paid') then 'paid' else 'pending' end
                     else 'needs_link' end
              when rc.id is null then 'unregistered'
              else rc.dst end as status,
         case when e.mid is not null and rc.id is not null then rc.due else e.amount end as amount
    from ent e
    left join lateral (select d.* from recv_d d where d.sid = e.sid and d.mid = e.mid order by d.id desc limit 1) rc on e.mid is not null
),
rowb as (
  select r.*,
         case r.status when 'paid' then 'paid' when 'pending' then 'unpaid' when 'partial' then 'unpaid'
                       when 'exempt' then 'excluded' when 'not_target' then 'excluded' else 'review' end as bucket,
         case when r.status in ('paid', 'pending', 'partial') then
                case when r.side = 'guest' then case when r.status = 'paid' then r.amount else 0 end else r.vpaid end
              when r.status in ('exempt', 'not_target') then r.vpaid else 0 end as paid_amt
    from rowx r
),
used as (select distinct rid from rowb where rid is not null),
orphan as (
  select r.*, case when r.sid is null or btrim(r.sid) = '' then 'no_session_link'
                   when not exists (select 1 from sp where sp.sid = r.sid) then 'session_not_official'
                   when not (select has_snap from sp where sp.sid = r.sid) then 'no_snapshot'
                   when exists (select 1 from recv o where o.sid = r.sid and o.mid = r.mid and o.id <> r.id and o.id in (select rid from used)) then 'duplicate'
                   else 'not_in_settlement' end as reason
    from recv_d r where r.id not in (select rid from used)
),
pers(per) as (values ('A ~11-18'), ('B 11-19~'), ('C 날짜 없음')),
out as (
  -- S: 세션
  select 1 as o, 'S01' as k, p.per, '공식 KDK 세션 수 · 정산 스냅샷 없음' as item,
         (select count(*) from sp where sp.per = p.per)::text || ' · 스냅샷없음 ' || (select count(*) from sp where sp.per = p.per and not sp.has_snap)::text as cnt,
         null::numeric as amount, 'INFO' as flag
    from pers p
  union all
  -- R: 화면과 같은 버킷 집계(구간 · 회원/게스트별)
  select 2, 'R' || b.ord, p.per, b.side || ' · ' || b.label,
         count(r.sid)::text,
         case b.metric when 'remaining' then coalesce(sum(greatest(0, r.amount - r.paid_amt)), 0) when 'paid' then coalesce(sum(r.paid_amt), 0) else coalesce(sum(r.amount), 0) end,
         case when p.per = 'A ~11-18' and b.check_a and count(r.sid) > 0 then 'CHECK' when p.per = 'A ~11-18' and b.check_a then 'OK' else 'INFO' end
    from pers p
    cross join (values
      (1, 'member', '완납(paid) 건수 · 청구액', array['paid'], 'amount', false),
      (2, 'member', '미납(pending/partial) 건수 · 남은 금액', array['pending', 'partial'], 'remaining', true),
      (3, 'member', '면제 · 비대상(exempt/not_target) 건수 · 금액', array['exempt', 'not_target'], 'amount', false),
      (4, 'member', '청구 미등록(unregistered) 건수 · 정산 금액', array['unregistered'], 'amount', true),
      (5, 'member', '회원 연결 필요(needs_link) 건수 · 금액', array['needs_link'], 'amount', true),
      (6, 'guest',  '완납(paid) 건수 · 금액', array['paid'], 'amount', false),
      (7, 'guest',  '미납(pending) 건수 · 금액', array['pending'], 'amount', true),
      (8, 'guest',  '연결 불가(needs_link: participant_id 없음) 건수 · 금액', array['needs_link'], 'amount', true)
    ) as b(ord, side, label, sts, metric, check_a)
    left join rowb r on r.per = p.per and r.side = b.side and r.status = any (b.sts)
   group by p.per, b.ord, b.side, b.label, b.metric, b.check_a
  union all
  select 3, 'R9', p.per, '합계 · 청구 대상(완납+미납) 금액 / 미납 잔액',
         coalesce(sum(r.amount) filter (where r.bucket in ('paid', 'unpaid')), 0)::text,
         coalesce(sum(greatest(0, r.amount - r.paid_amt)) filter (where r.bucket = 'unpaid'), 0), 'INFO'
    from pers p left join rowb r on r.per = p.per group by p.per
  union all
  -- X: 정합성 점검(전체)
  select 4, 'X01', '전체', '회원 청구 금액 ≠ 정산 스냅샷 금액(건수 · 차액 합)',
         count(*)::text, coalesce(sum(r.due - r.entry_amount), 0), case when count(*) > 0 then 'CHECK' else 'OK' end
    from rowb r where r.side = 'member' and r.rid is not null and r.due <> r.entry_amount
  union all
  select 4, 'X02', '전체', '[정보] 저장 status 가 납부 기록과 다름(저장 미납·납부 완료 / 저장 완납·납부 부족) — 화면은 납부 기록 기준',
         (count(*) filter (where st in ('pending', 'partial') and dst = 'paid'))::text || ' / ' || (count(*) filter (where st = 'paid' and dst <> 'paid'))::text,
         null, 'INFO'
    from recv_d
  union all
  select 4, 'X03', '전체', '같은 회원 · 같은 세션 벌금 청구 2건 이상(그룹 수 · 초과 청구액)',
         count(*)::text, coalesce(sum(extra), 0), case when count(*) > 0 then 'CHECK' else 'OK' end
    from (select sid, mid, sum(due) - max(due) as extra from recv where sid is not null group by sid, mid having count(*) > 1) d
  union all
  select 4, 'X04', '전체', '초과 납부 청구(유효 납부 > 청구액)(건수 · 초과액)',
         count(*)::text, coalesce(sum(vpaid - due), 0), case when count(*) > 0 then 'CHECK' else 'OK' end
    from recv where vpaid > due
  union all
  select 4, 'X05', '전체', '세션 행에 연결되지 않은 벌금 청구: ' || x.reason || '(건수 · 청구액)',
         count(o.*)::text, coalesce(sum(o.due), 0), case when count(o.*) > 0 then 'CHECK' else 'OK' end
    from (values ('no_session_link'), ('session_not_official'), ('no_snapshot'), ('duplicate'), ('not_in_settlement')) x(reason)
    left join orphan o on o.reason = x.reason group by x.reason
  union all
  select 4, 'X06', '전체', '청구에 연결되지 않은 회원 벌금 납부(payment_type=penalty · receivable 없음 · 취소 제외)(건수 · 금액)',
         count(*)::text, coalesce(sum(p.amount), 0), case when count(*) > 0 then 'CHECK' else 'OK' end
    from public.finance_dues_payments p where p.payment_type = 'penalty' and p.receivable_id is null and p.is_voided is not true
  union all
  select 4, 'X07', '전체', '세션 게스트 행과 맞지 않는 게스트 납부(paid)(건수 · 금액)',
         count(*)::text, coalesce(sum(g.amount), 0), case when count(*) > 0 then 'CHECK' else 'OK' end
    from gpay g where g.st = 'paid' and not exists (select 1 from rowb r where r.side = 'guest' and r.sid = g.sid and r.pid = g.pid)
  union all
  select 4, 'X08', '전체', '게스트 납부액 ≠ 정산 벌금액(건수 · 차액 합)',
         count(*)::text, coalesce(sum(g.amount - r.amount), 0), case when count(*) > 0 then 'CHECK' else 'OK' end
    from rowb r join gpay g on g.sid = r.sid and g.pid = r.pid and g.st = 'paid' where r.side = 'guest' and g.amount <> r.amount
  union all
  select 4, 'X09', '전체', '한 세션에서 같은 회원이 정산 항목 2개 이상에 연결(같은 청구를 공유 — 이중 집계 위험)(건수)',
         count(*)::text, null, case when count(*) > 0 then 'CHECK' else 'OK' end
    from (select sid, mid from rowb where mid is not null group by sid, mid having count(*) > 1) d
  union all
  select 4, 'X10', '전체', '[정보] 취소된 게스트 납부 기록 수', count(*)::text, coalesce(sum(amount), 0), 'INFO' from gpay where st <> 'paid'
  union all
  -- V: 구간 판정
  select 5, 'V01', 'A ~11-18', '11-18 이전 벌금: 기록상 전부 수납(회원 미납 · 미등록 · 연결 필요 · 게스트 미납 0)',
         (count(*) filter (where bucket in ('unpaid', 'review')))::text, coalesce(sum(greatest(0, amount - paid_amt)) filter (where bucket in ('unpaid', 'review')), 0),
         case when count(*) filter (where bucket in ('unpaid', 'review')) = 0 then 'OK' else 'CHECK' end
    from rowb where per = 'A ~11-18'
)
select k, per as period, item, cnt, amount, flag from out order by o, k, per;
