-- =============================================================================
-- TEYEON Ranking Manager — additive 권한 화이트리스트 (profiles.role 비덮어쓰기)
--
-- 목적: 랭킹 산식(가중치/최소조건) 관리 권한을 profiles.role 을 바꾸지 않고 부여한다.
--   · 판정식: profiles.role = 'CEO'  OR  ranking_managers.user_id = auth.uid()
--   · ADMIN 은 자동 포함하지 않는다(요구사항). 추가 대상은 ranking_managers 에 명시 등록.
--   · admin_users(add_admin_users.sql) 선례와 동일한 additive 패턴.
--
-- ⚠️ 초안. 사용자 승인 후 Supabase SQL Editor 에서 1회 실행. 선행 테이블: profiles(존재).
--   이 파일만으로는 아무 계정도 매니저가 되지 않는다(김민준 등록은 별도 승인·별도 실행).
--   미적용 상태에서도 앱은 정상 동작한다(can_manage_ranking() 없으면 코드가 false 로 폴백).
-- rollback: supabase/add_ranking_managers_rollback.sql
-- =============================================================================

create table if not exists public.ranking_managers (
    user_id     uuid        primary key references auth.users(id) on delete cascade,
    note        text,
    granted_by  uuid        references auth.users(id) on delete set null,
    granted_at  timestamptz not null default now()
);
comment on table public.ranking_managers is
    '랭킹 산식 관리 권한 화이트리스트(additive). profiles.role 과 분리 — 기존 역할을 덮어쓰지 않는다.';

alter table public.ranking_managers enable row level security;

-- 본인 행 조회 허용(AuthContext/layout 이 본인 매니저 여부 판정에 사용). 그 외 조회/쓰기 차단.
drop policy if exists ranking_managers_select_self on public.ranking_managers;
create policy ranking_managers_select_self on public.ranking_managers
    for select to authenticated
    using (user_id = auth.uid());

-- 전체 조회/등록/삭제는 CEO 만(관리 목적).
drop policy if exists ranking_managers_select_ceo on public.ranking_managers;
create policy ranking_managers_select_ceo on public.ranking_managers
    for select to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO'));

drop policy if exists ranking_managers_write_ceo on public.ranking_managers;
create policy ranking_managers_write_ceo on public.ranking_managers
    for all to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO'))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO'));

-- 랭킹 관리 권한 단일 판정 helper(서버 middleware / RLS / RPC 공용).
--   CEO OR ranking_managers 등재자. ADMIN 자동 포함 없음.
--   안전: 고정 search_path · schema-qualified · 파라미터 없음 · 동적 SQL 없음 · anon revoke.
create or replace function public.can_manage_ranking()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO')
        or exists (select 1 from public.ranking_managers r where r.user_id = auth.uid());
$$;
revoke execute on function public.can_manage_ranking() from public;
revoke execute on function public.can_manage_ranking() from anon;
grant  execute on function public.can_manage_ranking() to authenticated;

-- ── 김민준 등록(승인 후 별도 실행 — 이 파일 적용만으로는 실행하지 않음) ──────────
--   ⚠️ 대상 UID 를 확인 후 주석 해제. profiles.role 은 절대 건드리지 않는다.
-- insert into public.ranking_managers (user_id, note)
--   select m.auth_user_id, '김민준 — 경기이사 랭킹 관리'
--     from public.members m
--    where m.nickname = '김민준' and m.auth_user_id is not null
--   on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
