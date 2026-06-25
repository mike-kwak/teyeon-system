-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance — KDK 세션별 벌금 정산 공지 + 1등 상금 지급 관리
--
-- 두 가지 추가:
--   1) finance_kdk_prize_payouts      : KDK 1등 상금 지급 관리(클럽 → 회원 지급).
--      ⚠️ 회원이 납부하는 receivable/payment 와 분리. 월회비/벌금 미납 집계에 절대 포함 안 됨.
--      ⚠️ 상금 수령자는 "실제 1위"가 아니라 "게스트를 제외한 최고순위 TEYEON 회원"이다.
--         실제 1위(overallWinner)는 Archive 스냅샷에서 조회하고, 이 테이블에는
--         실제 지급 대상(prize_recipient_member_id)과 그의 전체순위만 저장한다.
--   2) finance_kdk_settlement_notices : KDK 세션 벌금·상금 현황 공개 공지(스냅샷 불변).
--      기존 월회비 공개공지(finance_public_notices)와 별도 테이블 — 월회비 공지/스냅샷 무영향.
--
-- 보안: 직접 접근은 운영자(is_finance_manager)만. 공개 조회는 get_public_kdk_notice(token) RPC 만.
--   공개 RPC 는 스냅샷 공개 필드만 반환(member_id / paid_by / created_by / 내부 메모 미반환).
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행. idempotent(재실행 안전).
--    선행: add_finance_v2_security_hardening.sql(is_finance_manager() 정의) 필요.
--    적용 후: notify pgrst, 'reload schema';
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. KDK 1등 상금 지급 ────────────────────────────────────────────────────
create table if not exists public.finance_kdk_prize_payouts (
  id                        uuid        primary key default gen_random_uuid(),
  related_kdk_session_id    text        not null,                 -- teyeon_archive_v1.id
  archive_id                text,                                 -- 동일 값(명시 보관)
  -- 실제 지급 대상(게스트 제외 최고순위 회원). 의미가 분명하도록 winner_member_id 대신 사용.
  prize_recipient_member_id uuid        references public.members(id) on delete set null,
  recipient_name            text        not null,                 -- 지급 대상 표시명(스냅샷)
  recipient_overall_rank    integer,                              -- 지급 대상의 전체순위(예: 3)
  prize_type                text        not null default 'kdk_first_place'
                                         check (prize_type in ('kdk_first_place')),
  amount                    integer     not null default 0 check (amount >= 0),
  status                    text        not null default 'unpaid'
                                         check (status in ('unpaid','paid')),
  paid_at                   timestamptz,
  paid_by                   uuid        references auth.users(id) on delete set null,
  memo                      text,                                 -- 운영진 전용 메모(공개 안 함)
  created_by                uuid        references auth.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- 같은 KDK 세션 · 같은 지급 대상 · 1등 상금 1건만(중복 지급 행 방지).
create unique index if not exists finance_kdk_prize_payouts_uniq
  on public.finance_kdk_prize_payouts(related_kdk_session_id, prize_recipient_member_id)
  where prize_type = 'kdk_first_place' and prize_recipient_member_id is not null;

create index if not exists finance_kdk_prize_payouts_session_idx
  on public.finance_kdk_prize_payouts(related_kdk_session_id);

comment on table public.finance_kdk_prize_payouts is
  'KDK 1등 상금 지급(클럽→회원). 수령자=게스트 제외 최고순위 회원. receivable/payment 와 분리 — 회원 미납 집계 포함 금지.';

alter table public.finance_kdk_prize_payouts enable row level security;

drop policy if exists "kdk_prize_select_admin" on public.finance_kdk_prize_payouts;
create policy "kdk_prize_select_admin" on public.finance_kdk_prize_payouts
  for select using (public.is_finance_manager());
drop policy if exists "kdk_prize_insert_admin" on public.finance_kdk_prize_payouts;
create policy "kdk_prize_insert_admin" on public.finance_kdk_prize_payouts
  for insert with check (public.is_finance_manager());
drop policy if exists "kdk_prize_update_admin" on public.finance_kdk_prize_payouts;
create policy "kdk_prize_update_admin" on public.finance_kdk_prize_payouts
  for update using (public.is_finance_manager()) with check (public.is_finance_manager());
drop policy if exists "kdk_prize_delete_admin" on public.finance_kdk_prize_payouts;
create policy "kdk_prize_delete_admin" on public.finance_kdk_prize_payouts
  for delete using (public.is_finance_manager());

-- ── 2. KDK 벌금·상금 현황 공개 공지(스냅샷 불변) ────────────────────────────
create table if not exists public.finance_kdk_settlement_notices (
  id                      uuid        primary key default gen_random_uuid(),
  token                   text        not null unique,
  related_kdk_session_id  text        not null,                 -- teyeon_archive_v1.id
  archive_id              text,
  kdk_date                text,                                 -- 'YYYY-MM-DD'(스냅샷)
  session_title           text,
  title                   text        not null,
  reference_at            timestamptz not null,                 -- 기준일시
  due_at                  timestamptz,                          -- 납부 마감일시(nullable)
  public_note             text,
  ranking_url             text,                                 -- 전체 순위 링크(포함 옵션 off 면 null)
  target_count            integer     not null default 0,
  paid_count              integer     not null default 0,
  unpaid_count            integer     not null default 0,
  total_penalty           bigint      not null default 0,
  total_paid              bigint      not null default 0,
  total_unpaid            bigint      not null default 0,
  -- 공개 최소 정보만:
  --   members[] = { name, amount, status('paid'|'partial'|'pending'), paidAt('YYYY-MM-DD'|null) }
  --   prize     = { overallWinnerName, overallWinnerIsGuest, recipientName, recipientOverallRank,
  --                 amount, status('paid'|'unpaid'), paidAt(ISO|null) } | null
  snapshot_data           jsonb       not null default '{}'::jsonb,
  is_active               boolean     not null default true,
  created_by              uuid        references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  deactivated_at          timestamptz,
  deactivated_by          uuid        references auth.users(id) on delete set null
);

create index if not exists finance_kdk_notices_token_idx
  on public.finance_kdk_settlement_notices(token);
create index if not exists finance_kdk_notices_session_idx
  on public.finance_kdk_settlement_notices(related_kdk_session_id, created_at desc);

comment on table public.finance_kdk_settlement_notices is
  'KDK 세션 벌금·상금 현황 공개 공지. 생성 시점 스냅샷 고정(불변). 공개는 get_public_kdk_notice RPC 만. 월회비 공지와 분리.';

alter table public.finance_kdk_settlement_notices enable row level security;

drop policy if exists "kdk_notice_select_admin" on public.finance_kdk_settlement_notices;
create policy "kdk_notice_select_admin" on public.finance_kdk_settlement_notices
  for select using (public.is_finance_manager());
drop policy if exists "kdk_notice_insert_admin" on public.finance_kdk_settlement_notices;
create policy "kdk_notice_insert_admin" on public.finance_kdk_settlement_notices
  for insert with check (public.is_finance_manager());
drop policy if exists "kdk_notice_update_admin" on public.finance_kdk_settlement_notices;
create policy "kdk_notice_update_admin" on public.finance_kdk_settlement_notices
  for update using (public.is_finance_manager()) with check (public.is_finance_manager());
drop policy if exists "kdk_notice_delete_admin" on public.finance_kdk_settlement_notices;
create policy "kdk_notice_delete_admin" on public.finance_kdk_settlement_notices
  for delete to authenticated using (public.is_finance_manager());

-- ── 3. 공개 전용 RPC ────────────────────────────────────────────────────────
-- token 으로 활성 공지 1건의 공개 가능 필드만 반환. 비활성/없음 → null.
create or replace function public.get_public_kdk_notice(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.finance_kdk_settlement_notices%rowtype;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return null;
  end if;

  select * into v
    from public.finance_kdk_settlement_notices
   where token = p_token
     and is_active = true
   limit 1;

  if v.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'title',         v.title,
    'kdkDate',       v.kdk_date,
    'sessionTitle',  v.session_title,
    'referenceAt',   to_char(v.reference_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'dueAt',         case when v.due_at is null then null
                          else to_char(v.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'publicNote',    v.public_note,
    'rankingUrl',    v.ranking_url,
    'stats', jsonb_build_object(
      'targetCount',  v.target_count,
      'paidCount',    v.paid_count,
      'unpaidCount',  v.unpaid_count,
      'totalPenalty', v.total_penalty,
      'totalPaid',    v.total_paid,
      'totalUnpaid',  v.total_unpaid
    ),
    'members', coalesce(v.snapshot_data -> 'members', '[]'::jsonb),
    'prize',   coalesce(v.snapshot_data -> 'prize', 'null'::jsonb),
    -- 입금 계좌 스냅샷(공개 안전 필드). 구버전 공지엔 없을 수 있어 null 허용.
    'paymentAccount', coalesce(v.snapshot_data -> 'paymentAccount', 'null'::jsonb)
  );
end;
$$;

revoke execute on function public.get_public_kdk_notice(text) from public;
grant  execute on function public.get_public_kdk_notice(text) to anon, authenticated;

comment on function public.get_public_kdk_notice(text) is
  'KDK 벌금·상금 공개 공지 RPC. is_active=true 토큰만. 스냅샷 공개 필드만 반환(member_id/paid_by/created_by/내부 메모 미반환).';
