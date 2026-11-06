-- =============================================================================
-- MATCH SPOTLIGHT 테스트 환경 — 1단계: 운영과 같은 모양의 최소 테이블 (데이터 없음)
--
-- ⚠️ **테스트 전용 Supabase 프로젝트(또는 로컬 PostgreSQL)에서만** 실행한다. 운영 프로젝트 실행 금지.
--    운영 DB 를 복제하지 않는다 — 구조만 저장소 SQL 기준으로 재현하고, 데이터는 02_testenv_seed.sql 의 가상 값만 쓴다.
--
-- 재현 대상(MATCH SPOTLIGHT · 기존 KDK RPC 가 실제로 참조하는 것만):
--   profiles(id, role) · teyeon_archive_v1(id, raw_data) · matches(운영 컬럼 전체 · TEXT id)
--   matches 의 started_at 은 add_kdk_match_timer.sql, 코트 unique index 는 add_matches_playing_court_unique_index.sql 이 추가.
--
-- 안전 장치: 이미 matches 에 행이 있으면 중단(운영·기존 프로젝트 오실행 방지).
-- =============================================================================
do $$
declare
  v_has boolean := false;
begin
  if to_regclass('public.matches') is not null then
    execute 'select exists (select 1 from public.matches limit 1)' into v_has;   -- 테이블이 없을 때 해석 오류 방지(동적 SQL)
  end if;
  if v_has then
    raise exception 'public.matches 에 이미 데이터가 있음 — 테스트 전용 빈 프로젝트에서만 실행하세요.';
  end if;
end $$;

create table if not exists public.profiles (
    id   uuid primary key,          -- Supabase 테스트 프로젝트에서 로그인 QA 를 하려면 auth.users 의 id 와 같게 넣는다
    role text
);
alter table public.profiles enable row level security;
drop policy if exists qa_profiles_read on public.profiles;
create policy qa_profiles_read on public.profiles for select using (true);
grant select on public.profiles to anon, authenticated;

create table if not exists public.teyeon_archive_v1 (
    id       text primary key,
    raw_data jsonb
);
alter table public.teyeon_archive_v1 enable row level security;
drop policy if exists qa_archive_read on public.teyeon_archive_v1;
create policy qa_archive_read on public.teyeon_archive_v1 for select using (true);
grant select on public.teyeon_archive_v1 to anon, authenticated;

create table if not exists public.matches (
    id            text primary key,
    club_id       text,
    session_id    text,
    session_title text,
    round         integer,
    court         integer,
    player_ids    text[],
    player_names  text[],
    score1        integer default 0,
    score2        integer default 0,
    status        text default 'waiting',
    mode          text default 'KDK',
    group_name    text,
    created_at    timestamptz default now()
);
-- 운영 앱 동작 모사: 누구나 LIVE 코트 조회, 로그인 사용자는 직접 쓰기(앱이 upsert/update/delete 를 직접 호출).
--   ※ 운영 RLS 정책과 다를 수 있다 — 필요하면 운영에서 읽기 전용으로 pg_policies 를 확인해 맞춘다(README 참고).
alter table public.matches enable row level security;
drop policy if exists qa_matches_read on public.matches;
create policy qa_matches_read on public.matches for select using (true);
drop policy if exists qa_matches_write on public.matches;
create policy qa_matches_write on public.matches for all to authenticated using (true) with check (true);
grant select on public.matches to anon;
grant select, insert, update, delete on public.matches to authenticated;
grant all on public.matches to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'matches') then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;
