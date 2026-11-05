-- #############################################################################
-- ##  ⛔ 운영(Production) · 테스트 Supabase 실행 절대 금지 — DO NOT RUN ON SUPABASE  ##
-- ##  이 파일은 일부러 '취약한 상태'(anon 전체 권한 · RLS 해제 등)를 만든다.            ##
-- ##  SQL Editor 가 문장을 나눠 실행하면 아래 가드(DO 블록)가 뒤 문장을 막지 못한다.    ##
-- ##  로컬 PostgreSQL 하네스(teyeon.local_only=yes)에서만 사용. 실행 순서 등록부 제외. ##
-- #############################################################################
-- =============================================================================
-- 로컬 전용 — 운영 감사 결과(S03·S04·S08·S09·S16·S19·S20)와 같은 "취약 상태"를 로컬 PostgreSQL 에 재현한다.
--   ⚠ Supabase(운영·테스트) 에서 실행 금지. 세션 설정 teyeon.local_only=yes 가 없으면 즉시 중단.
--   전제: spotlight_testenv/00 stub → 01 base → 기존 KDK RPC → 02 seed 이후 실행.
--   profiles 는 저장소 secure_members_profiles_access.sql 정책 + "본인 row UPDATE" 최악 가정 정책(S20 미확정 대비).
-- =============================================================================
do $$
begin
  if coalesce(current_setting('teyeon.local_only', true), '') <> 'yes' then
    raise exception 'local only: set teyeon.local_only = yes';
  end if;
end $$;

-- auth 보조(로컬 stub 에 없는 것만)
create table if not exists auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- profiles: 운영 형태
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists profile_visibility_level text default 'public';
drop policy if exists qa_profiles_read on public.profiles;
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon;
grant select, insert, update, delete on table public.profiles to authenticated;
create policy profiles_select_auth on public.profiles for select to authenticated using (true);
create policy profiles_insert_admin on public.profiles for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN')));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN')));
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('CEO','ADMIN')));
-- 최악 가정: 오래된 "본인 프로필 수정" 정책이 남아 있는 경우(permissive OR → 본인 role 수정 가능)
create policy profiles_update_own_legacy on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- RLS 꺼짐 + anon/authenticated 전체 권한(S03·S04·S16 재현)
alter table public.matches disable row level security;
alter table public.teyeon_archive_v1 disable row level security;
grant select, insert, update, delete, truncate on public.matches, public.teyeon_archive_v1 to anon, authenticated;

create table if not exists public.teyeon_special_sessions (session_id text primary key, club_id text, raw_data jsonb, created_at timestamptz default now());
create table if not exists public.kdk_sessions (id text primary key, raw_data jsonb);
create table if not exists public.app_logs (id bigserial primary key, user_id uuid, user_email text, path text, action text,
                                           metadata jsonb, created_at timestamptz default now());
grant select, insert, update, delete, truncate on public.teyeon_special_sessions, public.kdk_sessions, public.app_logs to anon, authenticated;
grant usage, select on sequence public.app_logs_id_seq to anon, authenticated;
grant all on public.teyeon_special_sessions, public.kdk_sessions, public.app_logs, public.teyeon_archive_v1 to service_role;
