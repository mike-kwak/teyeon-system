-- ────────────────────────────────────────────────────────────────────────────
-- club_schedule_guest_passes — 정모별 Guest Pass 활성/override
--
-- 운영 흐름:
--   1) club_schedules 정모 등록 (기존 흐름)
--   2) 운영진이 정모 상세 화면에서 [Guest Pass 설정] → 활성화 토글
--      → 이 테이블에 row INSERT + public_token 발급
--   3) 게스트비/계좌 공개 여부/추가 공지를 정모별 override (선택)
--
-- 토큰 정책:
--   - 활성화 시 nanoid(10) 발급 — URL-safe, 영문 대소문자 + 숫자
--   - 재발급 = 새 토큰으로 교체 (기존 링크 즉시 무효화). 별도 명시 버튼으로만 가능.
--   - 비활성화 시 토큰은 보존 (재활성화 시 같은 링크 유지 — 운영 편의).
--     단 재발급을 누르면 새 토큰으로 강제 교체.
--
-- 공개 페이지(/guest/pass/[token]) 접근:
--   - 익명 SELECT 허용. 단 RLS 가 is_active=true 인 row 만 노출.
--   - is_active=false 또는 token 미스매치 → '현재 사용할 수 없는 게스트 안내 링크입니다'
--     안내를 화면에서 처리 (404 대신 친절한 메시지).
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행해야 한다. 파일은 idempotent.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.club_schedule_guest_passes (
  id                              uuid        primary key default gen_random_uuid(),
  schedule_id                     uuid        not null unique references public.club_schedules(id) on delete cascade,

  -- 공개 활성 / 비활성 + 공개 링크 식별자 (보안 토큰 아님 — URL obscurity)
  is_active                       boolean     not null default false,
  public_token                    text        unique,

  -- 정모별 override (null/기본이면 defaults 사용)
  fee_amount_override             integer,
  show_bank_account               boolean     not null default true,
  extra_notice                    text,

  -- KDK 경기 안내 정모별 override — null 이면 defaults.match_status_* 사용.
  match_status_headline_override  text,
  match_status_body_override      text,

  -- 참여 확정 상태 — 카드 상단 dot 색에 영향 (confirmed / pending / cancelled)
  participation_status            text        not null default 'confirmed'
                                  check (participation_status in ('pending', 'confirmed', 'cancelled')),

  created_by                      uuid        references auth.users(id) on delete set null,
  updated_by                      uuid        references auth.users(id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

-- 이미 적용된 DB 호환 — 신규 override 컬럼 idempotent 추가.
alter table public.club_schedule_guest_passes
  add column if not exists match_status_headline_override text;
alter table public.club_schedule_guest_passes
  add column if not exists match_status_body_override     text;

-- 활성 row 빠른 조회 (캘린더 → Guest Pass 활성 일정 강조 등 후속 기능에서 사용 가능).
create index if not exists club_schedule_guest_passes_active_idx
  on public.club_schedule_guest_passes (is_active)
  where is_active = true;

-- 토큰 lookup 인덱스 — UNIQUE 라 자동 생성되지만 명시.
-- (UNIQUE 제약이 이미 인덱스를 만들기 때문에 추가 생성 생략)

alter table public.club_schedule_guest_passes enable row level security;

-- SELECT: 활성화된 row 는 익명/모두 가능. 비활성 row 는 CEO/ADMIN 만.
drop policy if exists "guest_pass_active_select" on public.club_schedule_guest_passes;
create policy "guest_pass_active_select" on public.club_schedule_guest_passes
  for select using (is_active = true);

drop policy if exists "guest_pass_admin_select" on public.club_schedule_guest_passes;
create policy "guest_pass_admin_select" on public.club_schedule_guest_passes
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

-- INSERT/UPDATE/DELETE 는 CEO/ADMIN 만.
drop policy if exists "guest_pass_insert" on public.club_schedule_guest_passes;
create policy "guest_pass_insert" on public.club_schedule_guest_passes
  for insert with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

drop policy if exists "guest_pass_update" on public.club_schedule_guest_passes;
create policy "guest_pass_update" on public.club_schedule_guest_passes
  for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  ) with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

drop policy if exists "guest_pass_delete" on public.club_schedule_guest_passes;
create policy "guest_pass_delete" on public.club_schedule_guest_passes
  for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

comment on table public.club_schedule_guest_passes is
  '정모별 Guest Pass 활성 + override. 공개 페이지는 is_active=true 일 때만 익명 조회 가능.';
comment on column public.club_schedule_guest_passes.public_token is
  '공개 URL /guest/pass/[token]. 재발급 시 즉시 무효화 (별도 명시 버튼).';
