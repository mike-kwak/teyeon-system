-- ────────────────────────────────────────────────────────────────────────────
-- Finance v2 — 1차 후속 보안/운영 강화
--
-- 적용 범위:
--   1) admin_memo 분리 — 운영진 메모를 일반 회원 응답에서 차단.
--      → memo 는 회원 공개용으로 유지, admin_memo 컬럼 신규.
--      → 직접 테이블 SELECT 는 운영진만. 회원은 get_my_finance_year(p_year) RPC 만 사용.
--   2) 납부 기록 soft-cancel (is_voided 등) — hard delete 대신 취소 상태 보존.
--      → 합계 계산은 is_voided=false 만 사용.
--   3) finance_member_leaves — 회원 휴회 관리. 월회비 일괄 생성 제외 기준.
--   4) is_finance_manager() — 이미 존재 시 재정의 (idempotent).
--   5) profiles.role 호환 진단 + 안전 보정 — FINANCE_MANAGER 저장 가능 보장.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행. 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. admin_memo 컬럼 ───────────────────────────────────────────────────
alter table public.finance_dues_receivables
  add column if not exists admin_memo text;
alter table public.finance_dues_payments
  add column if not exists admin_memo text;

comment on column public.finance_dues_receivables.admin_memo is
  '운영진 전용 메모. 일반 회원 응답에서 절대 제외 (RLS + RPC 양쪽 차단).';
comment on column public.finance_dues_payments.admin_memo is
  '운영진 전용 메모. 일반 회원 응답에서 절대 제외 (RLS + RPC 양쪽 차단).';

-- ── 2. 납부 기록 soft-cancel ──────────────────────────────────────────────
alter table public.finance_dues_payments
  add column if not exists is_voided   boolean not null default false,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

create index if not exists finance_dues_payments_active_idx
  on public.finance_dues_payments(member_id)
  where is_voided = false;

comment on column public.finance_dues_payments.is_voided is
  '취소된 납부 기록. true 면 합계 계산에서 제외. hard delete 대신 사용 권장.';

-- ── 3. 회원 휴회 ──────────────────────────────────────────────────────────
-- 한 회원의 휴회 구간은 여러 건 가능 (연도별). end_date nullable = 무기한.
-- 월회비 일괄 생성은 휴회 활성 회원을 제외하기 위해 application-layer 에서 검사.
create table if not exists public.finance_member_leaves (
  id           uuid        primary key default gen_random_uuid(),
  member_id    uuid        not null references public.members(id) on delete cascade,
  start_date   date        not null,
  end_date     date,
  reason       text,
  created_by   uuid        references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists finance_member_leaves_member_idx
  on public.finance_member_leaves(member_id);
create index if not exists finance_member_leaves_range_idx
  on public.finance_member_leaves(start_date, end_date);

alter table public.finance_member_leaves enable row level security;

drop policy if exists "leaves_select_self_or_admin" on public.finance_member_leaves;
create policy "leaves_select_self_or_admin" on public.finance_member_leaves
  for select using (
    public.is_finance_manager()
    or exists (
      select 1 from public.members m
       where m.id = finance_member_leaves.member_id
         and m.auth_user_id = auth.uid()
    )
  );

drop policy if exists "leaves_insert_admin" on public.finance_member_leaves;
create policy "leaves_insert_admin" on public.finance_member_leaves
  for insert with check (public.is_finance_manager());
drop policy if exists "leaves_update_admin" on public.finance_member_leaves;
create policy "leaves_update_admin" on public.finance_member_leaves
  for update using (public.is_finance_manager())
            with check (public.is_finance_manager());
drop policy if exists "leaves_delete_admin" on public.finance_member_leaves;
create policy "leaves_delete_admin" on public.finance_member_leaves
  for delete using (public.is_finance_manager());

comment on table public.finance_member_leaves is
  '회원 휴회 구간. 월회비 일괄 생성 시 활성 휴회 회원 제외 + 납부 현황에 휴회 표시.';

-- ── 4. RLS 강화 — 회원의 직접 SELECT 차단 ────────────────────────────────
-- 회원은 이 두 테이블을 직접 SELECT 할 수 없다.
-- 본인 데이터는 아래 get_my_finance_year RPC 로만 접근 (admin_memo 미포함).
-- 직접 SELECT 가능자는 운영진만.
drop policy if exists "dues_recv_select_self_or_admin" on public.finance_dues_receivables;
drop policy if exists "dues_recv_select_admin"         on public.finance_dues_receivables;
create policy "dues_recv_select_admin" on public.finance_dues_receivables
  for select using (public.is_finance_manager());

drop policy if exists "dues_pay_select_self_or_admin" on public.finance_dues_payments;
drop policy if exists "dues_pay_select_admin"         on public.finance_dues_payments;
create policy "dues_pay_select_admin" on public.finance_dues_payments
  for select using (public.is_finance_manager());

-- ── 5. is_finance_manager() — 재정의 (idempotent) ───────────────────────
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

-- ── 6. 회원 전용 RPC: 본인 1년치 납부 현황 ───────────────────────────────
-- 응답에 admin_memo / created_by / updated_by 등 운영 컬럼은 절대 포함하지 않는다.
-- is_voided=true 인 payment 는 응답에서 제외.
create or replace function public.get_my_finance_year(p_year integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_member_id uuid;
  v_receivables jsonb;
  v_payments jsonb;
  v_leaves jsonb;
begin
  -- 호출자의 members.id 매핑. 없으면 빈 응답.
  select m.id into v_member_id
    from public.members m
   where m.auth_user_id = auth.uid()
   limit 1;
  if v_member_id is null then
    return jsonb_build_object(
      'memberFound', false,
      'receivables', '[]'::jsonb,
      'payments',    '[]'::jsonb,
      'leaves',      '[]'::jsonb
    );
  end if;

  -- 회원 공개 필드만 직렬화. admin_memo / created_by / updated_by 미포함.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',              r.id,
    'member_id',       r.member_id,
    'receivable_type', r.receivable_type,
    'title',           r.title,
    'target_year',     r.target_year,
    'target_month',    r.target_month,
    'amount_due',      r.amount_due,
    'due_date',        to_char(r.due_date, 'YYYY-MM-DD'),
    'status',          r.status,
    'exemption_reason', r.exemption_reason,
    'memo',            r.memo,
    'created_at',      to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at',      to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) order by r.target_year asc nulls last, r.target_month asc nulls last), '[]'::jsonb)
    into v_receivables
    from public.finance_dues_receivables r
   where r.member_id = v_member_id
     and (r.target_year is null or r.target_year = p_year);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',            p.id,
    'member_id',     p.member_id,
    'receivable_id', p.receivable_id,
    'payment_type',  p.payment_type,
    'amount',        p.amount,
    'paid_at',       to_char(p.paid_at, 'YYYY-MM-DD'),
    'memo',          p.memo,
    'created_at',    to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at',    to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) order by p.paid_at desc), '[]'::jsonb)
    into v_payments
    from public.finance_dues_payments p
   where p.member_id = v_member_id
     and p.is_voided = false
     and p.paid_at between (p_year::text || '-01-01')::date
                       and (p_year::text || '-12-31')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',         l.id,
    'start_date', to_char(l.start_date, 'YYYY-MM-DD'),
    'end_date',   to_char(l.end_date, 'YYYY-MM-DD'),
    'reason',     l.reason
  ) order by l.start_date desc), '[]'::jsonb)
    into v_leaves
    from public.finance_member_leaves l
   where l.member_id = v_member_id;

  return jsonb_build_object(
    'memberFound', true,
    'receivables', v_receivables,
    'payments',    v_payments,
    'leaves',      v_leaves
  );
end;
$$;
revoke execute on function public.get_my_finance_year(integer) from public;
grant  execute on function public.get_my_finance_year(integer) to anon, authenticated;

-- ── 7. profiles.role — FINANCE_MANAGER 저장 호환성 진단 + 보정 ──────────
-- 7-A) 진단 (실행 안전 — SELECT 만). 결과로 CHECK constraint 가 있으면 7-B 검토.
--
--   select conname, pg_get_constraintdef(oid) as def
--     from pg_constraint
--    where conrelid = 'public.profiles'::regclass
--      and contype = 'c';
--
-- 7-B) FINANCE_MANAGER 저장이 막혀 있다면 (예: 기존 CHECK 가 'CEO/ADMIN/MEMBER/GUEST' 한정),
--     아래 블록을 주석 해제하고 실제 constraint 이름으로 교체 후 실행.
--     constraint 가 없으면 (profiles.role 이 그냥 text) 이 블록 무시 — INSERT/UPDATE 정상.
--
-- alter table public.profiles
--   drop constraint if exists profiles_role_check;
-- alter table public.profiles
--   add constraint profiles_role_check
--   check (role in ('CEO','ADMIN','FINANCE_MANAGER','MEMBER','GUEST'));
--
-- (어플리케이션은 AuthContext.normalizeRole 에서 'GUEST' 로 fallback 하므로
--  잘못된 값이 들어가도 화면 안전. 단, FINANCE_MANAGER 권한 부여를 위해선 정상 저장 필요.)
