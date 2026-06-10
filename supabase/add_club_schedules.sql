-- club_schedules 테이블 생성
-- 정모, KDK, 번개 등 TEYEON 클럽 자체 일정 관리
-- tournament_events와 완전 분리 — 기존 테이블 수정 없음

create table if not exists public.club_schedules (
  id            uuid        primary key default gen_random_uuid(),
  title         text        not null,
  -- schedule_type: KDK는 정모로 통합. KDK 운영 세션은 추후 정모 일정에 FK로 연결 예정.
  schedule_type text        not null
    check (schedule_type in ('정모', '번개', '단체전 연습', '회식', '기타')),
  schedule_date date        not null,
  start_time    time,
  end_time      time,
  location      text,
  court_count   int         default 1,
  guest_enabled boolean     not null default false,
  guest_limit   int,       -- null = 인원 제한 없음 / 숫자 = 지정 인원 (guest_enabled=true 일 때만 유효)
  fee_amount    int,
  show_on_main  boolean     not null default false,
  memo          text,
  created_by    uuid        references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists club_schedules_date_idx on public.club_schedules (schedule_date);

-- RLS
alter table public.club_schedules enable row level security;

-- 읽기: 인증된 사용자 전체
create policy "club_schedules_select" on public.club_schedules
  for select using (auth.uid() is not null);

-- 쓰기: CEO / ADMIN 만
-- TODO: CALENDAR_MANAGER 역할 도입 시 아래 정책의 role 목록에 추가
create policy "club_schedules_insert" on public.club_schedules
  for insert with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

create policy "club_schedules_update" on public.club_schedules
  for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

create policy "club_schedules_delete" on public.club_schedules
  for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );
