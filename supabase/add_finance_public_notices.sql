-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON 재무 — 회원 공지용 미납 현황 공개 링크 (스냅샷 기반)
--
-- 목적:
--   관리자가 특정 기준일(reference_date)의 미납·일부납부 현황을 스냅샷으로 고정해
--   랜덤 토큰 공개 링크로 회원 단체방에 공유한다. 생성 이후 납부 데이터가 바뀌어도
--   공개 링크의 기준일과 내용은 변하지 않는다(실시간 조회 링크가 아님).
--
-- 보안:
--   - 직접 SELECT/INSERT/UPDATE 는 운영자(CEO/ADMIN/FINANCE_MANAGER)만 — is_finance_manager().
--   - anon 직접 접근 불가. 공개 조회는 get_public_finance_notice(token) RPC 만 사용하며,
--     스냅샷 공개 필드만 반환(created_by / deactivated_by / member_id / 내부 컬럼 미반환).
--   - 토큰은 추측 어려운 랜덤 문자열(클라이언트 crypto 생성). is_active=false 면 공개 차단.
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행. 재실행 안전(idempotent).
--    선행: add_finance_v2_security_hardening.sql (is_finance_manager() 정의) 필요.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. 테이블 ───────────────────────────────────────────────────────────────
create table if not exists public.finance_public_notices (
  id                  uuid        primary key default gen_random_uuid(),
  token               text        not null unique,
  title               text        not null,
  target_year         integer     not null,
  target_month        integer     not null,
  -- 집계 기준일. 단순 생성일이 아니라 미납 현황이 집계된 기준일(공개 화면/안내문에 표시).
  reference_date      date        not null,
  -- 이름 표시 방식: 'full'(전체) | 'masked'(일부 가림). 스냅샷에는 이미 적용된 표시명 저장.
  name_display_mode   text        not null default 'full',
  public_note         text,
  total_target_count  integer     not null default 0,
  paid_count          integer     not null default 0,
  partial_count       integer     not null default 0,
  unpaid_count        integer     not null default 0,
  total_unpaid_amount bigint      not null default 0,
  -- 공개에 필요한 최소 정보만. members[] = { displayName, itemTitle, amountDue, amountPaid, remainingAmount, status }
  snapshot_data       jsonb       not null default '{}'::jsonb,
  is_active           boolean     not null default true,
  created_by          uuid        references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  deactivated_at      timestamptz,
  deactivated_by      uuid        references auth.users(id) on delete set null
);

create index if not exists finance_public_notices_token_idx
  on public.finance_public_notices(token);
create index if not exists finance_public_notices_created_idx
  on public.finance_public_notices(created_at desc);

comment on table public.finance_public_notices is
  'TEYEON 재무 회원 공지용 미납 현황 공개 링크. 생성 시점 스냅샷을 고정 저장(불변). 공개 조회는 get_public_finance_notice RPC 만 사용.';

-- ── 2. RLS — 운영자만 직접 접근 ─────────────────────────────────────────────
alter table public.finance_public_notices enable row level security;

drop policy if exists "fin_notice_select_admin" on public.finance_public_notices;
create policy "fin_notice_select_admin" on public.finance_public_notices
  for select using (public.is_finance_manager());

drop policy if exists "fin_notice_insert_admin" on public.finance_public_notices;
create policy "fin_notice_insert_admin" on public.finance_public_notices
  for insert with check (public.is_finance_manager());

drop policy if exists "fin_notice_update_admin" on public.finance_public_notices;
create policy "fin_notice_update_admin" on public.finance_public_notices
  for update using (public.is_finance_manager())
            with check (public.is_finance_manager());

-- DELETE — 운영자(CEO/ADMIN/FINANCE_MANAGER)만. 불필요한(주로 비활성) 공지 정리용.
--   삭제 후 기존 공개 URL 은 get_public_finance_notice 에서 null → "공개되지 않은 공지" 표시.
drop policy if exists "fin_notice_delete_admin" on public.finance_public_notices;
create policy "fin_notice_delete_admin" on public.finance_public_notices
  for delete to authenticated
  using (public.is_finance_manager());

-- ── 3. 공개 전용 RPC ────────────────────────────────────────────────────────
-- token 으로 활성 공지 1건의 공개 가능 필드만 반환. 비활성/없음 → null.
-- created_by / deactivated_by / id / token / member_id 등 내부 정보는 반환하지 않는다.
create or replace function public.get_public_finance_notice(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.finance_public_notices%rowtype;
begin
  if p_token is null or length(btrim(p_token)) = 0 then
    return null;
  end if;

  select * into v
    from public.finance_public_notices
   where token = p_token
     and is_active = true
   limit 1;

  if v.id is null then
    return null;
  end if;

  -- 공개 데이터는 스냅샷(고정)에서만. 집계/대상명단/제외명단 모두 snapshot_data 에 들어 있으며
  -- 실명·항목·금액·상태·사유·집계만 포함(member_id/연락처/메모/생성자 없음).
  return jsonb_build_object(
    'title',         v.title,
    'targetYear',    v.target_year,
    'targetMonth',   v.target_month,
    'referenceDate', to_char(v.reference_date, 'YYYY-MM-DD'),
    'publicNote',    v.public_note,
    'stats',    coalesce(v.snapshot_data -> 'stats', '{}'::jsonb),
    'members',  coalesce(v.snapshot_data -> 'members', '[]'::jsonb),
    'excluded', coalesce(v.snapshot_data -> 'excluded', '[]'::jsonb)
  );
end;
$$;

-- 실행 권한: 기본 public 회수 후 anon/authenticated 에만 부여(공개 페이지가 anon 호출).
revoke execute on function public.get_public_finance_notice(text) from public;
grant  execute on function public.get_public_finance_notice(text) to anon, authenticated;

comment on function public.get_public_finance_notice(text) is
  'TEYEON 재무 공개 공지 RPC. is_active=true 토큰만 조회. 스냅샷 공개 필드만 반환하며 생성자/내부 컬럼은 반환하지 않는다.';
