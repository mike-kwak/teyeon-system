-- ────────────────────────────────────────────────────────────────────────────
-- club_schedule_attendances + club_schedule_comments
--
-- 정모 참석 체크 MVP. club_schedules 테이블 자체는 갈아엎지 않는다.
--   - club_schedule_attendances: 개인별 참석 시작/조퇴 시간 + 불참 선택
--   - club_schedule_comments: 특이사항 / 파트너 요청 댓글 스레드
--
-- 식별자 결정: PRIMARY identification is auth.users.id (UNIQUE 보장 가능).
--             member_id는 nullable로 함께 저장해 이름 표시·집계에 활용.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 참석 체크 ───────────────────────────────────────────────────────────────

create table if not exists public.club_schedule_attendances (
  id                 uuid        primary key default gen_random_uuid(),
  schedule_id        uuid        not null references public.club_schedules(id) on delete cascade,
  user_id            uuid        not null references auth.users(id) on delete cascade,
  member_id          uuid        null references public.members(id) on delete set null,
  attendance_status  text        not null check (attendance_status in ('attending', 'not_attending')),
  -- arrival_time / leave_time: 사용자가 시안의 시간대 칩에서 선택한 값. 자유 입력 아님.
  -- end_time이 정모마다 다르므로 enum 강제는 클라이언트 검증으로 처리.
  arrival_time       time        null,
  leave_time         text        null,   -- 'end' (끝까지) | 'HH:MM' (예: '21:00')
  note               text        null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists club_schedule_attendances_uniq
  on public.club_schedule_attendances (schedule_id, user_id);

create index if not exists club_schedule_attendances_schedule_idx
  on public.club_schedule_attendances (schedule_id);

create index if not exists club_schedule_attendances_user_idx
  on public.club_schedule_attendances (user_id);

-- 불참이면 arrival_time / leave_time은 NULL이어야 한다 (data integrity).
alter table public.club_schedule_attendances
  add constraint club_schedule_attendances_status_consistency
  check (
    (attendance_status = 'attending')
    or (attendance_status = 'not_attending' and arrival_time is null and leave_time is null)
  );

alter table public.club_schedule_attendances enable row level security;

-- 읽기: 인증된 사용자 전체 — 명단/현황 표시용
create policy "club_schedule_attendances_select" on public.club_schedule_attendances
  for select using (auth.uid() is not null);

-- 쓰기: 본인만. CEO/ADMIN도 대리 입력은 일단 막아둠 (필요 시 별도 정책 추가).
create policy "club_schedule_attendances_insert" on public.club_schedule_attendances
  for insert with check (auth.uid() = user_id);

create policy "club_schedule_attendances_update" on public.club_schedule_attendances
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "club_schedule_attendances_delete" on public.club_schedule_attendances
  for delete using (auth.uid() = user_id);


-- ── 특이사항 / 파트너 요청 댓글 ─────────────────────────────────────────────

create table if not exists public.club_schedule_comments (
  id           uuid        primary key default gen_random_uuid(),
  schedule_id  uuid        not null references public.club_schedules(id) on delete cascade,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  member_id    uuid        null references public.members(id) on delete set null,
  -- 카테고리: '파트너 요청' / '늦음' / '조퇴' / '기타' 등을 클라이언트에서 표시할 수 있게 태그만 저장.
  category     text        null,
  body         text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists club_schedule_comments_schedule_idx
  on public.club_schedule_comments (schedule_id, created_at desc);

alter table public.club_schedule_comments enable row level security;

create policy "club_schedule_comments_select" on public.club_schedule_comments
  for select using (auth.uid() is not null);

create policy "club_schedule_comments_insert" on public.club_schedule_comments
  for insert with check (auth.uid() = user_id);

create policy "club_schedule_comments_update" on public.club_schedule_comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 댓글 삭제: 본인 OR 운영진(CEO/ADMIN).
create policy "club_schedule_comments_delete" on public.club_schedule_comments
  for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );
