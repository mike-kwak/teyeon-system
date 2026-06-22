-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON 수동 회비·납부 관리 (Finance v2)
--
-- 목적: 카카오뱅크 모임통장은 별도 — TEYEON 앱에서는 회원별 회비·납부 기록 관리만.
-- 기존 finance_* 테이블 (finance_transactions / finance_receivables / finance_member_payments)
-- 과 충돌 방지를 위해 새 prefix 사용: finance_fee_rules / finance_dues_receivables /
-- finance_dues_payments. 기존 테이블은 손대지 않는다.
--
-- 권한 모델:
--   - CEO / ADMIN / FINANCE_MANAGER : 전체 CRUD
--   - 일반 회원                       : 본인 row 만 SELECT (members.auth_user_id 연결 기준)
--
-- ⚠️ 자동 실행 금지. SQL Editor 에서 1회 실행. idempotent — 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. 월별 회비 기준 ─────────────────────────────────────────────────────
create table if not exists public.finance_fee_rules (
  id              uuid        primary key default gen_random_uuid(),
  year            integer     not null check (year between 2020 and 2099),
  month           integer     not null check (month between 1 and 12),
  title           text,
  default_amount  integer     not null check (default_amount >= 0),
  due_date        date,
  is_active       boolean     not null default true,
  created_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 연·월 1:1 (활성 상태와 무관 — 같은 월 중복 방지).
create unique index if not exists finance_fee_rules_year_month_uniq
  on public.finance_fee_rules(year, month);

-- ── 2. 회원별 납부 대상 (receivable) ──────────────────────────────────────
-- 한 회원의 한 항목 (월회비/연회비/벌금 등) 에 대한 청구 row.
create table if not exists public.finance_dues_receivables (
  id                uuid        primary key default gen_random_uuid(),
  member_id         uuid        not null references public.members(id) on delete cascade,
  receivable_type   text        not null check (
    receivable_type in ('monthly_fee','annual_fee','guest_fee','penalty','event_fee','other')
  ),
  title             text,
  target_year       integer     check (target_year is null or target_year between 2020 and 2099),
  target_month      integer     check (target_month is null or target_month between 1 and 12),
  amount_due        integer     not null check (amount_due >= 0),
  due_date          date,
  status            text        not null default 'pending' check (
    status in ('pending','partial','paid','exempt','not_target','prepaid','needs_review')
  ),
  exemption_reason  text,
  memo              text,         -- 관리자 메모 — 일반 회원 응답에서 제외 (RLS 의존)
  created_by        uuid        references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 같은 회원·같은 월회비 중복 청구 방지 (월회비만 적용 — 벌금 / 행사비는 여러 건 가능).
create unique index if not exists finance_dues_receivables_month_uniq
  on public.finance_dues_receivables(member_id, target_year, target_month)
  where receivable_type = 'monthly_fee';

create index if not exists finance_dues_receivables_member_idx
  on public.finance_dues_receivables(member_id);
create index if not exists finance_dues_receivables_year_month_idx
  on public.finance_dues_receivables(target_year, target_month)
  where target_year is not null and target_month is not null;

-- ── 3. 실제 납부 기록 (payments) ──────────────────────────────────────────
create table if not exists public.finance_dues_payments (
  id              uuid        primary key default gen_random_uuid(),
  member_id       uuid        not null references public.members(id) on delete cascade,
  receivable_id   uuid        references public.finance_dues_receivables(id) on delete set null,
  payment_type    text        not null check (
    payment_type in ('monthly_fee','annual_fee','guest_fee','penalty','event_fee','other')
  ),
  amount          integer     not null check (amount > 0),
  paid_at         date        not null,
  memo            text,                       -- 관리자 메모
  created_by      uuid        references auth.users(id) on delete set null,
  updated_by      uuid        references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists finance_dues_payments_member_idx
  on public.finance_dues_payments(member_id);
create index if not exists finance_dues_payments_receivable_idx
  on public.finance_dues_payments(receivable_id)
  where receivable_id is not null;
create index if not exists finance_dues_payments_paid_at_idx
  on public.finance_dues_payments(paid_at desc);

-- 같은 회원/같은 항목/같은 날짜/같은 금액 중복 입력 경고 (DB 강제 X — UI 경고만).
-- DB 강제는 운영 회원·날짜·금액이 우연히 동일한 정상 케이스도 막을 수 있어 적용하지 않음.

-- ── 4. RLS ───────────────────────────────────────────────────────────────
alter table public.finance_fee_rules         enable row level security;
alter table public.finance_dues_receivables  enable row level security;
alter table public.finance_dues_payments     enable row level security;

-- 관리자 판정 함수 — profiles.role 가 CEO/ADMIN/FINANCE_MANAGER 인지.
-- SECURITY DEFINER + search_path 제한으로 권한 escalation 차단.
create or replace function public.is_finance_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid()
       and role in ('CEO', 'ADMIN', 'FINANCE_MANAGER')
  );
$$;
revoke execute on function public.is_finance_manager() from public;
grant  execute on function public.is_finance_manager() to anon, authenticated;

-- ── 4-1. finance_fee_rules ──
-- 모든 인증 사용자 SELECT (회원도 자신의 회비 기준 알아야 함).
-- 단, anon 차단.
drop policy if exists "fee_rules_select_auth"   on public.finance_fee_rules;
create policy "fee_rules_select_auth" on public.finance_fee_rules
  for select using (auth.uid() is not null);

drop policy if exists "fee_rules_insert_admin" on public.finance_fee_rules;
create policy "fee_rules_insert_admin" on public.finance_fee_rules
  for insert with check (public.is_finance_manager());

drop policy if exists "fee_rules_update_admin" on public.finance_fee_rules;
create policy "fee_rules_update_admin" on public.finance_fee_rules
  for update using (public.is_finance_manager())
            with check (public.is_finance_manager());

drop policy if exists "fee_rules_delete_admin" on public.finance_fee_rules;
create policy "fee_rules_delete_admin" on public.finance_fee_rules
  for delete using (public.is_finance_manager());

-- ── 4-2. finance_dues_receivables ──
-- 본인 row (auth_user_id 매칭) OR 관리자만 SELECT. 일반 회원은 다른 회원 row 0건.
drop policy if exists "dues_recv_select_self_or_admin" on public.finance_dues_receivables;
create policy "dues_recv_select_self_or_admin" on public.finance_dues_receivables
  for select using (
    public.is_finance_manager()
    or exists (
      select 1 from public.members m
       where m.id = finance_dues_receivables.member_id
         and m.auth_user_id = auth.uid()
    )
  );

drop policy if exists "dues_recv_write_admin" on public.finance_dues_receivables;
create policy "dues_recv_write_admin" on public.finance_dues_receivables
  for insert with check (public.is_finance_manager());
drop policy if exists "dues_recv_update_admin" on public.finance_dues_receivables;
create policy "dues_recv_update_admin" on public.finance_dues_receivables
  for update using (public.is_finance_manager())
            with check (public.is_finance_manager());
drop policy if exists "dues_recv_delete_admin" on public.finance_dues_receivables;
create policy "dues_recv_delete_admin" on public.finance_dues_receivables
  for delete using (public.is_finance_manager());

-- ── 4-3. finance_dues_payments ──
drop policy if exists "dues_pay_select_self_or_admin" on public.finance_dues_payments;
create policy "dues_pay_select_self_or_admin" on public.finance_dues_payments
  for select using (
    public.is_finance_manager()
    or exists (
      select 1 from public.members m
       where m.id = finance_dues_payments.member_id
         and m.auth_user_id = auth.uid()
    )
  );

drop policy if exists "dues_pay_write_admin" on public.finance_dues_payments;
create policy "dues_pay_write_admin" on public.finance_dues_payments
  for insert with check (public.is_finance_manager());
drop policy if exists "dues_pay_update_admin" on public.finance_dues_payments;
create policy "dues_pay_update_admin" on public.finance_dues_payments
  for update using (public.is_finance_manager())
            with check (public.is_finance_manager());
drop policy if exists "dues_pay_delete_admin" on public.finance_dues_payments;
create policy "dues_pay_delete_admin" on public.finance_dues_payments
  for delete using (public.is_finance_manager());

-- ⚠️ memo 컬럼은 RLS 가 row 자체를 차단하므로 회원은 다른 회원 row 의 메모를 볼 수 없다.
-- 일반 회원의 본인 row 에는 memo 가 노출될 수 있으므로, 관리자 전용 메모를 별도로
-- 두려면 별도 admin_memo 컬럼을 후속 라운드에서 도입 검토.

comment on table public.finance_fee_rules is
  '월별 회비 기준 — 운영진이 연·월별로 직접 입력. 코드 하드코딩 금지.';
comment on table public.finance_dues_receivables is
  '회원별 납부 대상 — 월회비 / 벌금 / 행사비 등. status 로 면제/비대상 표시.';
comment on table public.finance_dues_payments is
  '실제 납부 기록 — receivable 에 연결되거나 독립 항목. 금액 합계는 이 테이블 기준.';
