-- ────────────────────────────────────────────────────────────────────────────
-- [DRAFT · 승인 전 실행 금지] 2026-11-10 KDK 게스트 벌금 오매칭 청구 → 게스트 벌금 납부로 이관 (v2)
--
-- 배경:
--   공식 Archive 상 게스트(is_guest=true)였던 참가자가 앱의 이름 매칭으로 동명 회원에게 연결되어
--   그 회원 앞으로 KDK penalty 청구(3,000원) + 유효 납부(3,000원)가 생성됐다.
--   실제 돈은 게스트가 냈고, 그 회원은 해당 세션 참가자가 아니다.
--
-- 이 SQL 이 하는 일 — DO 블록 1개 = 1 트랜잭션. 어느 단계든 예외가 나면 전체가 롤백된다(부분 성공 없음).
--   1) 대상 검증 — 하나라도 어긋나면 예외로 중단(아무것도 바꾸지 않음)
--        · c_recv_id(전체 uuid) 일치 · penalty · 공식/비테스트 세션 · 날짜 2026-11-10 · amount_due 3,000
--        · 청구 회원 id 가 settlement player_id 에 없음(회원 본인 벌금 아님)
--        · 앱과 동일한 이름 정규화로 그 회원 닉네임이 유일(동명 회원 없음)
--        · 같은 이름의 게스트 벌금 항목 정확히 1개 · player_id 존재 · 그 id 가 회원 id 아님
--        · Archive penalty_amount = -3,000
--        · 유효(is_voided=false) 납부 정확히 1건 · 3,000원 · paid_at(date) = created_at 의 KST 날짜
--   2) 게스트 납부 기록(kdk_guest_penalty_payments)
--        · 행 없음   → status='paid' 신규. paid_at = 원래 회원 납부 기록의 created_at(실제 기록 시각, 임의 시각 아님)
--                      created_at/updated_at = now() (= 시스템 정정 시각 — 실제 납부 시각과 구분됨)
--        · cancelled → status='paid' 로 갱신(같은 기준). 이전 값은 audit 에 보존
--        · paid      → 금액이 3,000 이면 보존(변경 없음). 다르면 중단
--   3) 회원 납부 1건 soft-cancel(is_voided=true, voided_at=now(), void_reason) — DELETE 없음
--   4) 회원 청구 status='not_target', exemption_reason 기록 — DELETE 없음
--   5) finance_payment_audit 1행(action='KDK_GUEST_MISMATCH_TRANSFER_V1'). reason = JSON(이전·이후 상태, 실행자)
--
-- 동시성:
--   · pg_advisory_xact_lock — 이 스크립트/rollback 스크립트끼리만 직렬화(앱 쓰기는 막지 못함).
--   · 대상 청구·납부·게스트 행은 FOR UPDATE 행 잠금 → 앱의 동시 UPDATE 는 커밋까지 대기.
--   · 앱이 같은 청구에 새 납부를 INSERT 하면 FK 확인 잠금이 FOR UPDATE 와 충돌해 커밋까지 대기 후 들어온다
--     → 실행 직후 verify 의 other_valid_payments = 0 으로 반드시 확인.
--   · 게스트 RPC 가 같은 게스트 행을 동시에 만들면 UNIQUE 충돌 → 둘 중 하나가 실패(이 SQL 이면 전체 롤백).
-- 재실행: 같은 청구에 롤백되지 않은 audit 행이 있으면 변경 없이 NOTICE 후 종료(중복 납부·중복 감사 없음).
-- 실행자 식별: SQL Editor 는 auth.uid() 가 NULL → c_operator(필수)를 audit/void_reason 에 기록.
--
-- 선행: add_finance_payment_audit_table.sql 적용 → ..._precheck_READONLY.sql (본문 + S1~S6 스키마 확인)
-- 후속: ..._verify.sql        되돌리기: ..._rollback.sql
-- 범위 밖(건드리지 않음): 6/23 게스트 납부 누락 · 6/30 게스트 cancelled · 기존 not_target 12건 · 청구 미연결 납부 2건
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  c_recv_id_txt  constant text := '__RECV_ID__';    -- ← precheck 의 recv_id(전체 uuid)로 교체
  c_operator     constant text := '__OPERATOR__';   -- ← 실행 운영자 표기(1~40자, ';' 금지)로 교체
  c_session_date constant text := '2026-11-10';
  c_amount       constant int  := 3000;
  c_tag          constant text := 'KDK_GUEST_MISMATCH_TRANSFER_V1';

  v_recv_id      uuid;
  v_cnt          int;
  v_recv         public.finance_dues_receivables%rowtype;
  v_nick_key     text;
  v_sd           jsonb;
  v_entry        jsonb;
  v_pid          text;
  v_gname        text;
  v_pay          public.finance_dues_payments%rowtype;
  v_guest        public.kdk_guest_penalty_payments%rowtype;
  v_guest_found  boolean;
  v_guest_prev   text;
  v_guest_id     uuid;
  v_guest_paid_at timestamptz;
begin
  -- 0) 입력값 검증
  if c_recv_id_txt !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'SET_c_recv_id_FIRST (전체 uuid 필요)';
  end if;
  v_recv_id := c_recv_id_txt::uuid;
  -- 자리표시자 판별은 리터럴 비교가 아닌 패턴으로('모두 바꾸기' 로 이 줄까지 치환돼도 오판하지 않게)
  if c_operator ~ '^__.*__$' or btrim(c_operator) = '' or length(c_operator) > 40 or position(';' in c_operator) > 0 then
    raise exception 'SET_c_operator_FIRST (1~40자, 세미콜론 금지)';
  end if;

  -- 감사 테이블 존재 확인 — 운영에 없음(READ-ONLY 확인). 먼저 add_finance_payment_audit_table.sql 을 적용해야 한다.
  -- 없으면 여기서 중단(아무것도 바꾸지 않음).
  if to_regclass('public.finance_payment_audit') is null then
    raise exception 'AUDIT_TABLE_MISSING — public.finance_payment_audit 없음(precheck S1 확인). 실행 중단';
  end if;

  perform pg_advisory_xact_lock(hashtext(c_tag));

  -- 1) 대상 청구 잠금 + 기본 조건
  --    잠금 순서: 청구(receivable) FOR UPDATE → 납부(payment) FOR UPDATE.
  --    pay_kdk_member_penalty RPC 도 청구 FOR UPDATE 를 먼저 잡으므로 순서가 같아 교착 없이 직렬화된다.
  select rv.* into v_recv
    from public.finance_dues_receivables rv
   where rv.id = v_recv_id
   for update;
  if not found then raise exception 'TARGET_RECEIVABLE_NOT_FOUND'; end if;

  -- 이미 적용(그리고 그 뒤 rollback 되지 않음)이면 변경 없이 종료.
  if exists (select 1 from public.finance_payment_audit au
              where au.action = c_tag and au.old_receivable_id = v_recv.id
                and not exists (select 1 from public.finance_payment_audit r
                                 where r.action = c_tag || '_ROLLBACK' and r.payment_id = au.payment_id
                                   and r.changed_at > au.changed_at)) then
    raise notice 'ALREADY_APPLIED — 변경 없이 종료 (receivable %)', v_recv.id;
    return;
  end if;

  if v_recv.receivable_type <> 'penalty' then raise exception 'NOT_PENALTY'; end if;
  if v_recv.amount_due <> c_amount then raise exception 'AMOUNT_DUE_MISMATCH=%', v_recv.amount_due; end if;
  if v_recv.status in ('exempt','not_target') then raise exception 'RECEIVABLE_ALREADY_%', upper(v_recv.status); end if;

  select count(*) into v_cnt
    from public.teyeon_archive_v1 a
   where a.id = v_recv.related_kdk_session_id
     and a.is_official is true and a.is_test is not true
     and coalesce(nullif(a.raw_data->>'date',''), a.created_at::date::text) = c_session_date;
  if v_cnt <> 1 then raise exception 'SESSION_NOT_OFFICIAL_OR_DATE_MISMATCH'; end if;

  select a.raw_data->'settlement_data' into v_sd
    from public.teyeon_archive_v1 a where a.id = v_recv.related_kdk_session_id;
  if jsonb_typeof(v_sd) is distinct from 'array' then raise exception 'SETTLEMENT_NOT_ARRAY'; end if;

  if exists (select 1 from jsonb_array_elements(v_sd) e where e->>'player_id' = v_recv.member_id::text) then
    raise exception 'MEMBER_IS_SESSION_PARTICIPANT — 회원 본인 벌금일 수 있어 중단';
  end if;

  -- 앱 normalizeName 과 동일 정규화(회원 닉네임에도 동일 적용)
  select lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(m.nickname,''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g'))
    into v_nick_key
    from public.members m where m.id = v_recv.member_id;
  if coalesce(v_nick_key,'') = '' then raise exception 'MEMBER_NICKNAME_EMPTY'; end if;

  select count(*) into v_cnt from public.members m
   where lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(m.nickname,''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) = v_nick_key;
  if v_cnt <> 1 then raise exception 'MEMBER_NAME_NOT_UNIQUE=%', v_cnt; end if;

  -- 같은 이름의 게스트 벌금 항목 정확히 1개
  select count(*) into v_cnt
    from jsonb_array_elements(v_sd) e
   where coalesce((e->>'is_guest')::boolean,false)
     and coalesce((e->>'penalty_amount')::int,0) < 0
     and lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(e->>'player_name',''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) = v_nick_key;
  if v_cnt <> 1 then raise exception 'GUEST_ENTRY_COUNT=% (expected 1)', v_cnt; end if;

  select e into v_entry
    from jsonb_array_elements(v_sd) e
   where coalesce((e->>'is_guest')::boolean,false)
     and coalesce((e->>'penalty_amount')::int,0) < 0
     and lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           coalesce(e->>'player_name',''), '^manual-guest-','','i'), '\s*\(G\)\s*$','','i'), '\s+g$','','i'), '\s+','','g')) = v_nick_key;

  v_pid   := nullif(btrim(coalesce(v_entry->>'player_id','')), '');
  v_gname := nullif(btrim(coalesce(v_entry->>'player_name','')), '');
  if v_pid is null then raise exception 'GUEST_PLAYER_ID_MISSING'; end if;
  if exists (select 1 from public.members m where m.id::text = v_pid) then raise exception 'GUEST_PID_IS_MEMBER_ID'; end if;
  if abs((v_entry->>'penalty_amount')::int) <> c_amount then
    raise exception 'GUEST_ARCHIVE_AMOUNT=%', abs((v_entry->>'penalty_amount')::int);
  end if;

  -- 유효 납부 정확히 1건 · 3,000원 · 날짜 일관성 + 잠금
  select count(*) into v_cnt from public.finance_dues_payments p
   where p.receivable_id = v_recv.id and p.is_voided = false;
  if v_cnt <> 1 then raise exception 'VALID_PAYMENT_COUNT=% (expected 1)', v_cnt; end if;
  select p.* into v_pay from public.finance_dues_payments p
   where p.receivable_id = v_recv.id and p.is_voided = false
   for update;
  if v_pay.amount <> c_amount then raise exception 'PAYMENT_AMOUNT=%', v_pay.amount; end if;
  if v_pay.member_id <> v_recv.member_id then raise exception 'PAYMENT_MEMBER_MISMATCH'; end if;
  if v_pay.created_at is null or v_pay.paid_at <> (v_pay.created_at at time zone 'Asia/Seoul')::date then
    raise exception 'PAID_DATE_EDITED (paid_at=%, created_at=%) — 실제 납부 시각 수동 판단 필요', v_pay.paid_at, v_pay.created_at;
  end if;

  -- 2) 게스트 납부 기록
  select g.* into v_guest from public.kdk_guest_penalty_payments g
   where g.session_id = v_recv.related_kdk_session_id and g.participant_id = v_pid and g.charge_type = 'penalty'
   for update;
  v_guest_found := found;

  if not v_guest_found then
    v_guest_prev := 'none';
    v_guest_paid_at := v_pay.created_at;
    insert into public.kdk_guest_penalty_payments
      (session_id, participant_id, charge_type, participant_name_snapshot, amount,
       status, paid_at, paid_by, cancelled_at, cancelled_by, updated_at)
    values
      (v_recv.related_kdk_session_id, v_pid, 'penalty', v_gname, c_amount,
       'paid', v_guest_paid_at, null, null, null, now())
    returning id into v_guest_id;
  elsif v_guest.status = 'cancelled' then
    v_guest_prev := 'cancelled';
    v_guest_id   := v_guest.id;
    v_guest_paid_at := v_pay.created_at;
    update public.kdk_guest_penalty_payments
       set status = 'paid', amount = c_amount, participant_name_snapshot = v_gname,
           paid_at = v_guest_paid_at, paid_by = null, cancelled_at = null, cancelled_by = null, updated_at = now()
     where id = v_guest.id;
  elsif v_guest.status = 'paid' then
    if v_guest.amount <> c_amount then raise exception 'GUEST_ALREADY_PAID_AMOUNT=%', v_guest.amount; end if;
    v_guest_prev := 'paid';            -- 이미 게스트 납부 존재 → 보존(변경 없음). 회원 쪽 중복 기록만 취소.
    v_guest_id   := v_guest.id;
    v_guest_paid_at := v_guest.paid_at;
  else
    raise exception 'GUEST_ROW_UNKNOWN_STATUS=%', v_guest.status;
  end if;

  -- 3) 회원 납부 soft-cancel
  update public.finance_dues_payments
     set is_voided = true, voided_at = now(), voided_by = null,
         void_reason = c_tag || ' — 게스트 벌금으로 이관 (' || c_operator || ')',
         updated_at = now()
   where id = v_pay.id and is_voided = false;
  get diagnostics v_cnt = row_count;
  if v_cnt <> 1 then raise exception 'PAYMENT_VOID_FAILED'; end if;

  -- 4) 회원 청구 비대상 처리
  update public.finance_dues_receivables
     set status = 'not_target',
         exemption_reason = '게스트 오매칭 — 게스트 벌금으로 이관 (' || c_tag || ')',
         updated_at = now()
   where id = v_recv.id;

  -- 5) 감사 이력 — reason 은 JSON(손실 없는 이전 상태 보존 · rollback 이 그대로 읽음)
  insert into public.finance_payment_audit
    (payment_id, action, old_receivable_id, new_receivable_id,
     old_target_year, old_target_month, new_target_year, new_target_month, reason, changed_by)
  values
    (v_pay.id, c_tag, v_recv.id, v_recv.id,
     v_recv.target_year, v_recv.target_month, v_recv.target_year, v_recv.target_month,
     jsonb_build_object(
       'v', 2,
       'operator', c_operator,
       'session', v_recv.related_kdk_session_id,
       'participant', v_pid,
       'recv_prev', jsonb_build_object('status', v_recv.status, 'exemption_reason', v_recv.exemption_reason,
                                       'updated_at', v_recv.updated_at),
       'pay_prev',  jsonb_build_object('paid_at', v_pay.paid_at, 'created_at', v_pay.created_at,
                                       'created_by', v_pay.created_by, 'updated_at', v_pay.updated_at),
       'guest_prev', v_guest_prev,
       'guest_row', v_guest_id,
       'guest_prev_row', case when v_guest_found then jsonb_build_object(
                           'status', v_guest.status, 'amount', v_guest.amount, 'paid_at', v_guest.paid_at,
                           'paid_by', v_guest.paid_by, 'cancelled_at', v_guest.cancelled_at,
                           'cancelled_by', v_guest.cancelled_by, 'participant_name_snapshot', v_guest.participant_name_snapshot)
                         else null end,
       'guest_new_paid_at', v_guest_paid_at
     )::text,
     null);

  raise notice 'DONE recv=% payment=% guest_row=% guest_prev=%', v_recv.id, v_pay.id, v_guest_id, v_guest_prev;
end
$$;
