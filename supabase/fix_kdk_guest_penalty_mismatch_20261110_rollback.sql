-- ────────────────────────────────────────────────────────────────────────────
-- [DRAFT · 승인 전 실행 금지] fix_kdk_guest_penalty_mismatch_20261110.sql(v2) 되돌리기
--
-- audit(action='KDK_GUEST_MISMATCH_TRANSFER_V1', reason=JSON) 에 보존된 이전 상태로 복원한다. DO 블록 = 1 트랜잭션.
--   · 회원 납부 : is_voided=false 복원 — 현재 우리 void_reason 으로 취소된 상태일 때만
--   · 회원 청구 : 이전 status / exemption_reason 복원 — 현재 not_target + 우리 사유일 때만
--   · 게스트 납부:
--       guest_prev=none      → DELETE 하지 않고 soft-cancel(status='cancelled', cancelled_at=now()).
--                              앱 화면/집계는 cancelled 를 '행 없음'과 동일하게 미납으로 취급(paid 만 납부로 인정)하므로
--                              결과 상태가 동일하고, 이관·롤백 흔적이 행에 남는다.
--       guest_prev=cancelled → 이전 status/amount/paid_*/cancelled_*/이름 스냅샷 그대로 복원
--       guest_prev=paid      → 이관 때 변경하지 않았으므로 그대로
--     모든 경우, 현재 행이 "이관 직후 상태"(paid · paid_by NULL · paid_at=이관 값)일 때만 변경
--   · audit 에 '_ROLLBACK' 행 추가(원 이력은 보존 — 삭제/수정 없음)
-- 이관 이후 다른 운영자가 어느 하나라도 바꿨으면 예외로 전체 중단(아무것도 복원하지 않음) → 수동 확인.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  c_tag      constant text := 'KDK_GUEST_MISMATCH_TRANSFER_V1';
  c_operator constant text := '__OPERATOR__';   -- ← 실행 운영자 표기(1~40자, ';' 금지)로 교체
  v_au       public.finance_payment_audit%rowtype;
  v_j        jsonb;
  v_prev     jsonb;
  v_cnt      int;
  n          int;
begin
  -- 자리표시자 판별은 리터럴 비교가 아닌 패턴으로('모두 바꾸기' 로 이 줄까지 치환돼도 오판하지 않게)
  if c_operator ~ '^__.*__$' or btrim(c_operator) = '' or length(c_operator) > 40 or position(';' in c_operator) > 0 then
    raise exception 'SET_c_operator_FIRST (1~40자, 세미콜론 금지)';
  end if;
  if to_regclass('public.finance_payment_audit') is null then
    raise exception 'AUDIT_TABLE_MISSING — public.finance_payment_audit 없음. 실행 중단';
  end if;
  perform pg_advisory_xact_lock(hashtext(c_tag));

  select count(*) into v_cnt from public.finance_payment_audit au
   where au.action = c_tag
     and not exists (select 1 from public.finance_payment_audit r
                      where r.action = c_tag || '_ROLLBACK' and r.payment_id = au.payment_id and r.changed_at > au.changed_at);
  if v_cnt = 0 then raise notice 'NOTHING_TO_ROLLBACK'; return; end if;
  if v_cnt <> 1 then raise exception 'AUDIT_ROWS=% (expected 1)', v_cnt; end if;

  select au.* into v_au from public.finance_payment_audit au
   where au.action = c_tag
     and not exists (select 1 from public.finance_payment_audit r
                      where r.action = c_tag || '_ROLLBACK' and r.payment_id = au.payment_id and r.changed_at > au.changed_at);

  v_j := v_au.reason::jsonb;
  if (v_j->>'v') is distinct from '2' then raise exception 'AUDIT_FORMAT_UNSUPPORTED'; end if;

  -- 회원 납부 복원
  update public.finance_dues_payments
     set is_voided = false, voided_at = null, voided_by = null, void_reason = null, updated_at = now()
   where id = v_au.payment_id and is_voided = true and void_reason like c_tag || '%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PAYMENT_STATE_CHANGED — 수동 확인 필요'; end if;

  -- 회원 청구 복원
  update public.finance_dues_receivables
     set status = v_j->'recv_prev'->>'status',
         exemption_reason = v_j->'recv_prev'->>'exemption_reason',
         updated_at = now()
   where id = v_au.old_receivable_id and status = 'not_target' and exemption_reason like '%' || c_tag || '%';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'RECEIVABLE_STATE_CHANGED — 수동 확인 필요'; end if;

  -- 게스트 납부 복원
  if v_j->>'guest_prev' in ('none','cancelled') then
    perform 1 from public.kdk_guest_penalty_payments g
     where g.id = (v_j->>'guest_row')::uuid
       and g.status = 'paid' and g.paid_by is null
       and g.paid_at = (v_j->>'guest_new_paid_at')::timestamptz
     for update;
    if not found then raise exception 'GUEST_ROW_STATE_CHANGED — 수동 확인 필요'; end if;

    if v_j->>'guest_prev' = 'none' then
      update public.kdk_guest_penalty_payments
         set status = 'cancelled', cancelled_at = now(), cancelled_by = null, updated_at = now()
       where id = (v_j->>'guest_row')::uuid;
    else
      v_prev := v_j->'guest_prev_row';
      update public.kdk_guest_penalty_payments
         set status       = v_prev->>'status',
             amount       = (v_prev->>'amount')::int,
             paid_at      = (v_prev->>'paid_at')::timestamptz,
             paid_by      = (v_prev->>'paid_by')::uuid,
             cancelled_at = (v_prev->>'cancelled_at')::timestamptz,
             cancelled_by = (v_prev->>'cancelled_by')::uuid,
             participant_name_snapshot = v_prev->>'participant_name_snapshot',
             updated_at   = now()
       where id = (v_j->>'guest_row')::uuid;
    end if;
  end if;  -- 'paid' 는 원래 건드리지 않았음

  insert into public.finance_payment_audit
    (payment_id, action, old_receivable_id, new_receivable_id, reason, changed_by)
  values
    (v_au.payment_id, c_tag || '_ROLLBACK', v_au.old_receivable_id, v_au.old_receivable_id,
     jsonb_build_object('v', 2, 'rollback_of', v_au.id, 'operator', c_operator,
                        'guest_action', case v_j->>'guest_prev' when 'none' then 'soft_cancel'
                                                                 when 'cancelled' then 'restore_prev'
                                                                 else 'unchanged' end)::text,
     null);

  raise notice 'ROLLED_BACK audit=%', v_au.id;
end
$$;
