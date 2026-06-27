-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Admin Console — admin_users 접근 제어 테이블 (장기 기준)
--
-- 목적: `/admin/**` Admin Console 접근 권한을 profiles.role(앱 역할)과 분리된
--       전용 화이트리스트(admin_users)로 관리하기 위한 장기 구조.
--       - Admin Console 접근권한 ≠ 기능별 운영권한.
--       - FINANCE_MANAGER 등 기능 담당자가 Admin Console 전체 접근을 자동으로 얻지 않게 한다.
--       - 이메일 하드코딩이 아니라 DB 행으로 명시 관리.
--
-- ⚠️ 이 파일은 "초안"입니다. 아직 운영 DB 에 적용하지 않았습니다.
--    1차 구현의 서버 guard 는 임시로 profiles.role IN ('CEO','ADMIN') 을 사용합니다.
--    이 마이그레이션을 적용한 뒤 middleware guard 를 is_admin_console_user() 기준으로
--    교체하는 것이 후속 권장 단계입니다(아래 "적용 영향" 참고).
--
-- 적용 방법(승인 후): Supabase SQL Editor 에서 1회 실행 → notify pgrst, 'reload schema';
-- 선행: profiles 테이블 존재(현재 존재).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.admin_users (
    user_id     uuid        primary key references auth.users(id) on delete cascade,
    -- 'CEO' | 'ADMIN' — Admin Console 내부 등급(접근은 동일, 표시/감사용).
    admin_role  text        not null default 'ADMIN' check (admin_role in ('CEO', 'ADMIN')),
    note        text,
    created_by  uuid        references auth.users(id) on delete set null,
    created_at  timestamptz not null default now()
);

comment on table public.admin_users is
    'Admin Console(/admin) 접근 화이트리스트. profiles.role(앱 역할)과 분리. 기능 담당자 자동 부여 금지.';

alter table public.admin_users enable row level security;

-- 본인 행 조회 허용(서버 guard 가 본인 admin 여부 판정에 사용). 그 외 조회/쓰기는 차단.
drop policy if exists "admin_users_select_self" on public.admin_users;
create policy "admin_users_select_self" on public.admin_users
    for select using (user_id = auth.uid());

-- 전체 목록 조회/수정은 CEO 만(관리 화면용). 안전을 위해 명시.
drop policy if exists "admin_users_select_ceo" on public.admin_users;
create policy "admin_users_select_ceo" on public.admin_users
    for select using (exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO'
    ));
drop policy if exists "admin_users_write_ceo" on public.admin_users;
create policy "admin_users_write_ceo" on public.admin_users
    for all using (exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO'
    )) with check (exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO'
    ));

-- 현재 호출자가 Admin Console 접근 대상인지(서버/RPC 공용 판정).
create or replace function public.is_admin_console_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (select 1 from public.admin_users a where a.user_id = auth.uid());
$$;
revoke execute on function public.is_admin_console_user() from public;
grant  execute on function public.is_admin_console_user() to authenticated;

-- ── 초기 데이터(적용 시 CEO/ADMIN 시드) — 운영자가 검토 후 주석 해제 ──────────
-- 기존 profiles 의 CEO/ADMIN 을 admin_users 로 1회 시드(이메일 하드코딩 대신 역할 기반 시드).
-- 적용 전 반드시 대상 계정을 확인하세요.
--
-- insert into public.admin_users (user_id, admin_role)
--   select p.id, case when p.role = 'CEO' then 'CEO' else 'ADMIN' end
--     from public.profiles p
--    where p.role in ('CEO', 'ADMIN')
--   on conflict (user_id) do nothing;
