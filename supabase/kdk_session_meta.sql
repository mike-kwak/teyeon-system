-- =============================================================================
-- kdk_session_meta: KDK 세션별 메타데이터 (ticker_message 등)
-- 실행: Supabase Dashboard > SQL Editor
-- =============================================================================

create table if not exists public.kdk_session_meta (
  session_id     text        primary key,
  club_id        uuid,
  ticker_message text,
  updated_at     timestamptz not null default now()
);

-- RLS 활성화
alter table public.kdk_session_meta enable row level security;

-- 읽기: 누구나 (전광판 display 포함)
drop policy if exists "read_kdk_session_meta" on public.kdk_session_meta;
create policy "read_kdk_session_meta" on public.kdk_session_meta
  for select using (true);

-- 쓰기: 인증된 사용자 (운영자)
drop policy if exists "write_kdk_session_meta" on public.kdk_session_meta;
create policy "write_kdk_session_meta" on public.kdk_session_meta
  for all using (auth.role() = 'authenticated');

-- Realtime 활성화 (이미 있으면 무시됨)
alter publication supabase_realtime add table public.kdk_session_meta;
