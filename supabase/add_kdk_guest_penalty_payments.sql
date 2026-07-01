-- ────────────────────────────────────────────────────────────────────────────
-- KDK 게스트 벌금 납부 상태 저장소 (Guest penalty payment tracking)
--
-- 목적:
--   회원 벌금은 finance_dues_receivables(member_id NOT NULL) + finance_dues_payments 로
--   관리되지만, member_id 가 없는 "게스트 참가자"는 이 구조에 저장할 수 없다.
--   (게스트를 members 에 억지로 등록하거나 가짜 member_id 를 넣지 않는다.)
--   → 게스트 벌금 납부 완료/되돌리기 상태를 KDK 세션·게스트 참가자 단위로 저장하는 전용 테이블.
--
-- 식별 기준(이름 아님):
--   session_id      = KDK 세션 id (= teyeon_archive_v1.id)
--   participant_id  = 공식 Archive settlement_data[].player_id (게스트의 안정적 참가자 id)
--   charge_type     = 'penalty' (게스트비/상금과 혼동 금지 — 벌금만)
--   → UNIQUE(session_id, participant_id, charge_type) 로 세션·참가자·항목당 1행(멱등).
--   동명이인 게스트도 participant_id 로 구분되고, 같은 이름 다른 세션도 session_id 로 분리된다.
--
-- 금액 source of truth:
--   amount 은 공식 Archive settlement_data 의 penalty_amount(절대값) 스냅샷을 그대로 저장.
--   서비스(markGuestPenaltyPaid)가 저장 직전 teyeon_archive_v1 을 재조회해 이 금액/이름을 강제한다
--   (화면값 미신뢰). 이 테이블은 "납부 상태"만 관리하며 벌금 금액 자체를 새로 계산/변경하지 않는다.
--
-- ⚠️ 최신 상태 테이블(이벤트 로그 아님):
--   participant 당 1행만 유지하며 재납부 시 같은 행을 갱신한다.
--     납부 완료  → status='paid',      paid_at/paid_by 갱신,  cancelled_at/cancelled_by = NULL
--     미납 되돌림 → status='cancelled', cancelled_at/cancelled_by 기록 (paid_at/paid_by 는 참고용 유지)
--   즉 최종 상태와 감사 필드는 항상 정합(paid 면 cancelled_* = NULL). 다회 이력 전체 보존이 필요하면
--   별도 이벤트 로그 테이블이 필요하나, 이번 작업 범위에는 포함하지 않는다.
--
-- 권한:
--   조회(SELECT): public.is_finance_manager()(CEO/ADMIN/FINANCE_MANAGER) 만. 감사 필드 노출 최소화.
--   쓰기: 클라이언트 직접 INSERT/UPDATE/DELETE 금지(RLS 에 write 정책 없음).
--        납부/되돌리기는 SECURITY DEFINER RPC(mark_/revert_kdk_guest_penalty_paid)로만 수행하며,
--        RPC 가 공식 Archive 를 재조회해 amount/이름/status 를 확정한다(클라이언트 값 미신뢰).
--
-- ⚠️ 상태: DRAFT. 운영 Supabase 미적용. 승인 전 실행 금지. idempotent(재실행 안전).
-- 선행: add_manual_finance_management.sql (public.is_finance_manager() 정의) 적용 필요.
--
-- 적용 순서:
--   1) add_manual_finance_management.sql 적용 확인(is_finance_manager 존재).
--   2) 이 파일을 Supabase SQL Editor 에서 1회 실행.
--   3) 프런트 배포(게스트 납부 UI는 테이블이 없으면 자동 비활성 → 순서 무관, 양방향 안전).
--
-- Rollback:
--   drop function if exists public.mark_kdk_guest_penalty_paid(text, text);
--   drop function if exists public.revert_kdk_guest_penalty_paid(text, text);
--   drop table if exists public.kdk_guest_penalty_payments;
--   (기존 finance 테이블/데이터에는 영향 없음. 회원 벌금 흐름과 완전히 분리.)
--
-- Backfill:
--   기존 데이터 없음(신규 기능). 과거 세션은 필요 시 운영자가 화면에서 수동 처리.
--   자동 backfill/일괄 삽입 없음.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.kdk_guest_penalty_payments (
  id                         uuid        primary key default gen_random_uuid(),
  session_id                 text        not null check (btrim(session_id) <> ''),
  participant_id             text        not null check (btrim(participant_id) <> ''),
  charge_type                text        not null default 'penalty'
                                         check (charge_type in ('penalty')),
  participant_name_snapshot  text,
  amount                     integer     not null check (amount > 0),
  status                     text        not null default 'paid'
                                         check (status in ('paid', 'cancelled')),
  paid_at                    timestamptz,
  paid_by                    uuid        references auth.users(id) on delete set null,
  cancelled_at               timestamptz,
  cancelled_by               uuid        references auth.users(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (session_id, participant_id, charge_type)
);

create index if not exists kdk_guest_penalty_payments_session_idx
  on public.kdk_guest_penalty_payments(session_id);

comment on table public.kdk_guest_penalty_payments is
  'KDK 게스트(비회원) 벌금 납부 상태. session_id + participant_id(settlement player_id) + charge_type 단위. '
  '금액은 공식 Archive penalty_amount 스냅샷. 회원 벌금(finance_dues_*)과 분리.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.kdk_guest_penalty_payments enable row level security;

-- 조회: 운영진(is_finance_manager)만. 감사 필드(paid_by/cancelled_by 등)를 일반 회원에게 노출하지 않는다.
--   유일한 사용처는 운영자 전용 KDK 정산 화면이며, 공개 공지는 생성 시점 스냅샷을 별도 저장해 사용한다
--   (이 테이블을 직접 공개 조회하지 않음). 필요 시 별도 안전한 공개 경로만 추가한다.
drop policy if exists "kdk_guest_penalty_select_auth"  on public.kdk_guest_penalty_payments;
drop policy if exists "kdk_guest_penalty_select_admin" on public.kdk_guest_penalty_payments;
create policy "kdk_guest_penalty_select_admin" on public.kdk_guest_penalty_payments
  for select using (public.is_finance_manager());

-- 쓰기: 클라이언트 직접 INSERT/UPDATE/DELETE 정책을 두지 않는다(정책 없음 = RLS 가 모든 직접 쓰기 거부).
--   금액/이름/status 는 아래 SECURITY DEFINER RPC 만 확정·기록한다. (재실행 시 과거 write 정책이 있으면 제거)
drop policy if exists "kdk_guest_penalty_insert_admin" on public.kdk_guest_penalty_payments;
drop policy if exists "kdk_guest_penalty_update_admin" on public.kdk_guest_penalty_payments;
drop policy if exists "kdk_guest_penalty_delete_admin" on public.kdk_guest_penalty_payments;

-- ── 쓰기 전용 RPC (SECURITY DEFINER) ─────────────────────────────────────────
-- 클라이언트는 amount/이름/status 를 전달하지 않는다. RPC 가 공식 Archive 를 재조회해 확정한다.
--   검증 실패 시 'GUEST_PENALTY_NOT_VERIFIED' 예외 → 프런트가 사용자 안내로 변환.
--   auth.uid()/is_finance_manager() 를 함수 내부에서 재확인, search_path 고정.

create or replace function public.mark_kdk_guest_penalty_paid(
  p_session_id     text,
  p_participant_id text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row    public.teyeon_archive_v1%rowtype;
  v_entry  jsonb;
  v_pen    integer;
  v_amount integer;
  v_name   text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_finance_manager() then raise exception 'FORBIDDEN'; end if;
  if p_session_id is null or btrim(p_session_id) = ''
     or p_participant_id is null or btrim(p_participant_id) = '' then
    raise exception 'INVALID_INPUT';
  end if;

  -- 공식 Archive 재검증: 세션 존재 + is_official + not is_test.
  select * into v_row from public.teyeon_archive_v1 where id = p_session_id;
  if not found or v_row.is_official is distinct from true or v_row.is_test is true then
    raise exception 'GUEST_PENALTY_NOT_VERIFIED';
  end if;

  -- settlement_data 배열에서 player_id 정확 일치 행 조회.
  if jsonb_typeof(v_row.raw_data -> 'settlement_data') is distinct from 'array' then
    raise exception 'GUEST_PENALTY_NOT_VERIFIED';
  end if;
  select e into v_entry
    from jsonb_array_elements(v_row.raw_data -> 'settlement_data') e
   where e ->> 'player_id' = p_participant_id
   limit 1;
  if v_entry is null then raise exception 'GUEST_PENALTY_NOT_VERIFIED'; end if;

  -- 실제 벌금(penalty_amount < 0) 만. 금액/이름은 공식 스냅샷에서 확정.
  v_pen := coalesce((v_entry ->> 'penalty_amount')::int, 0);
  if not (v_pen < 0) then raise exception 'GUEST_PENALTY_NOT_VERIFIED'; end if;
  v_amount := abs(v_pen);
  v_name   := nullif(btrim(coalesce(v_entry ->> 'player_name', '')), '');

  -- 최신 상태 upsert (멱등). 이미 paid 여도 중복행 없이 갱신.
  insert into public.kdk_guest_penalty_payments
    (session_id, participant_id, charge_type, participant_name_snapshot, amount,
     status, paid_at, paid_by, cancelled_at, cancelled_by, updated_at)
  values
    (p_session_id, p_participant_id, 'penalty', v_name, v_amount,
     'paid', now(), auth.uid(), null, null, now())
  on conflict (session_id, participant_id, charge_type) do update
     set participant_name_snapshot = excluded.participant_name_snapshot,
         amount       = excluded.amount,
         status       = 'paid',
         paid_at      = now(),
         paid_by      = auth.uid(),
         cancelled_at = null,
         cancelled_by = null,
         updated_at   = now();
end;
$$;

create or replace function public.revert_kdk_guest_penalty_paid(
  p_session_id     text,
  p_participant_id text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_finance_manager() then raise exception 'FORBIDDEN'; end if;

  -- 존재하는 행만 soft-cancel(없으면 no-op). paid_at/paid_by 는 과거 납부 참고값으로 유지.
  update public.kdk_guest_penalty_payments
     set status       = 'cancelled',
         cancelled_at = now(),
         cancelled_by = auth.uid(),
         updated_at   = now()
   where session_id     = p_session_id
     and participant_id = p_participant_id
     and charge_type    = 'penalty';
end;
$$;

-- 실행 권한 — public 회수, authenticated 만(함수 내부에서 is_finance_manager 재확인).
revoke execute on function public.mark_kdk_guest_penalty_paid(text, text)   from public;
revoke execute on function public.revert_kdk_guest_penalty_paid(text, text) from public;
grant  execute on function public.mark_kdk_guest_penalty_paid(text, text)   to authenticated;
grant  execute on function public.revert_kdk_guest_penalty_paid(text, text) to authenticated;
