-- ────────────────────────────────────────────────────────────────────────────
-- club_guest_pass_defaults — 클럽 공통 Guest Pass 기본값 (싱글톤)
--
-- 운영 흐름:
--   1) 운영진이 한 번 입력 (계좌·게스트비·준비사항·규칙·클럽 소개 등)
--   2) 매 정모마다 자동 적용 — 필요하면 정모별로 override
--
-- 현재 TEYEON 단일 클럽 가정 — club_key UNIQUE = 'TEYEON' 으로 한 행만 유지.
-- 멀티 클럽 도입 시 club_key 컬럼을 club_id 로 교체하는 추가 migration 필요.
--
-- 공개 페이지(/guest/pass/[token])는 익명 SELECT 가 필요 → SELECT 정책은 모두 허용.
-- INSERT/UPDATE/DELETE 는 CEO/ADMIN 만 가능.
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행해야 한다. 파일은 idempotent.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.club_guest_pass_defaults (
  id                          uuid        primary key default gen_random_uuid(),
  club_key                    text        not null default 'TEYEON' unique,

  -- 게스트비 / 계좌
  default_fee_amount          integer,
  bank_name                   text,
  bank_account_number         text,
  -- 공개용 예금주 (마스킹된 표시명, 예: '곽민*'). Guest Pass / 카카오 안내문에서만 사용.
  -- ⚠️ 실제 예금주 실명을 저장하는 컬럼은 두지 않는다 — 공개 응답 노출 위험 차단.
  --     (이전 버전에 bank_account_holder 컬럼이 있었다면 supabase/secure_public_guest_pass.sql
  --      가 ALTER ... DROP COLUMN IF EXISTS 로 정리.)
  bank_account_holder_display text,
  payment_note                text,

  -- 준비사항
  preparation_items           text[]      not null default '{}',
  arrival_guide_minutes       integer     not null default 15,
  late_or_absent_notice       text,

  -- TEYEON GUEST NOTE (규칙)
  kdk_start_notice            text,
  penalty_notice              text,
  guest_prize_exclusion       text,

  -- 클럽 소개
  club_intro_name             text        not null default 'TEYEON',
  club_intro_paragraphs       text[]      not null default '{}',

  -- 문의 안내
  contact_notice              text,

  -- KDK 경기 안내 영역 — 1차 MVP에는 운영진이 직접 문구 편집.
  -- 정모별 override 도 가능 (club_schedule_guest_passes.match_status_*_override).
  match_status_headline       text        not null default '당일 대진표 공유 예정',
  match_status_body           text        not null default '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.',

  updated_by                  uuid        references auth.users(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- 이미 적용된 DB 호환 — 신규 컬럼 idempotent 추가.
alter table public.club_guest_pass_defaults
  add column if not exists bank_account_holder_display text;
alter table public.club_guest_pass_defaults
  add column if not exists match_status_headline       text;
alter table public.club_guest_pass_defaults
  add column if not exists match_status_body           text;

-- 신규 컬럼 기본값 시드 — 기존 row 가 NULL 인 경우만 채움.
update public.club_guest_pass_defaults
   set match_status_headline = '당일 대진표 공유 예정'
 where match_status_headline is null;
update public.club_guest_pass_defaults
   set match_status_body = '대진표는 당일 경기이사가 편성한 뒤 앱에 등록되며, 준비가 완료되면 이 페이지에서 확인할 수 있습니다.'
 where match_status_body is null;

-- TEYEON 싱글톤 행 시드 (없을 때만). 운영진이 이후 편집해서 채움.
insert into public.club_guest_pass_defaults (club_key)
  values ('TEYEON')
  on conflict (club_key) do nothing;

alter table public.club_guest_pass_defaults enable row level security;

-- 공개 페이지에서 익명으로도 읽을 수 있어야 함 → SELECT 모두 허용.
drop policy if exists "guest_pass_defaults_select" on public.club_guest_pass_defaults;
create policy "guest_pass_defaults_select" on public.club_guest_pass_defaults
  for select using (true);

-- INSERT/UPDATE/DELETE 는 CEO/ADMIN 만.
drop policy if exists "guest_pass_defaults_insert" on public.club_guest_pass_defaults;
create policy "guest_pass_defaults_insert" on public.club_guest_pass_defaults
  for insert with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

drop policy if exists "guest_pass_defaults_update" on public.club_guest_pass_defaults;
create policy "guest_pass_defaults_update" on public.club_guest_pass_defaults
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

drop policy if exists "guest_pass_defaults_delete" on public.club_guest_pass_defaults;
create policy "guest_pass_defaults_delete" on public.club_guest_pass_defaults
  for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('CEO', 'ADMIN')
    )
  );

comment on table public.club_guest_pass_defaults is
  'Guest Pass 공통 기본값 (싱글톤 — club_key=TEYEON 1행). 정모별 override는 club_schedule_guest_passes 에서 처리.';
