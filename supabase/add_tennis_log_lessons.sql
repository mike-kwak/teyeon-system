-- ============================================================================
-- add_tennis_log_lessons.sql
--
-- TENNIS LOG — 레슨일지 개인 기록(프라이빗). 외부 대회 기록과 동일한 소유권/자격 모델.
--   · 본인만 SELECT/INSERT/UPDATE/DELETE.
--   · CEO/운영진도 타인의 레슨 기록을 열람/수정/삭제할 수 없다(개인 데이터).
--   · anon(비로그인) 접근 불가. owner_user_id 위조 INSERT 차단.
--   · 접근 자격은 기존 public.can_access_tennis_log() 를 **재사용**한다(신규 함수 생성 안 함).
--     허용 역할(9): 정회원·준회원·회장·부회장·총무·재무·경기·섭외·CEO
--     차단: ADMIN 단독·게스트·GUEST·빈 값·알 수 없는 역할·members 미연결.
--
-- 상태: 검토용(DRAFT). 운영 Supabase 미적용. 승인 전 실행 금지.
-- 성격: idempotent(재실행 안전).
-- 선행 조건: supabase/add_tennis_log_tournaments.sql 의 STEP 3
--            public.can_access_tennis_log() 함수가 먼저 정의되어 있어야 한다.
--
-- 적용 순서: STEP 1 테이블+인덱스 → STEP 2 updated_at 트리거 → STEP 3 RLS+정책.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── STEP 1. 테이블 ──────────────────────────────────────────────────────────
create table if not exists public.tennis_log_lessons (
  id                uuid primary key default gen_random_uuid(),
  owner_user_id     uuid not null references auth.users(id) on delete cascade,
  lesson_date       date not null,
  coach_name        text,
  lesson_topic      text not null,
  learned_points    text not null,
  correction_points text,
  practice_tasks    text,
  next_goal         text,
  free_memo         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 인덱스 — 본인 기록 목록/요약 조회 최적화.
create index if not exists tennis_log_lessons_owner_idx
  on public.tennis_log_lessons (owner_user_id);
create index if not exists tennis_log_lessons_owner_date_idx
  on public.tennis_log_lessons (owner_user_id, lesson_date desc);
create index if not exists tennis_log_lessons_owner_created_idx
  on public.tennis_log_lessons (owner_user_id, created_at desc);
-- 현재 연습 목표(가장 최근의 비어있지 않은 next_goal) 조회 최적화 — 부분 인덱스.
create index if not exists tennis_log_lessons_owner_goal_idx
  on public.tennis_log_lessons (owner_user_id, lesson_date desc, created_at desc)
  where next_goal is not null and btrim(next_goal) <> '';

-- ── STEP 2. updated_at 트리거 ───────────────────────────────────────────────
-- 대회 기록과 공유하는 트리거 함수. 재실행 안전(동일 본문 create or replace).
create or replace function public.tennis_log_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tennis_log_lessons_updated_at on public.tennis_log_lessons;
create trigger trg_tennis_log_lessons_updated_at
  before update on public.tennis_log_lessons
  for each row execute function public.tennis_log_set_updated_at();

-- ── STEP 3. RLS + 본인 전용 정책 ────────────────────────────────────────────
-- 접근 자격은 기존 public.can_access_tennis_log() 재사용(여기서 정의하지 않음).
alter table public.tennis_log_lessons enable row level security;

-- 방어적: anon 역할의 테이블 권한 회수(정책상으로도 차단되지만 이중 보호).
revoke all on table public.tennis_log_lessons from anon;

-- SELECT — 본인 기록만 + 회원 자격.
drop policy if exists "tennis_log_lessons_select_own" on public.tennis_log_lessons;
create policy "tennis_log_lessons_select_own"
  on public.tennis_log_lessons
  for select
  to authenticated
  using ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- INSERT — owner 위조 차단(owner_user_id 는 반드시 본인) + 회원 자격.
drop policy if exists "tennis_log_lessons_insert_own" on public.tennis_log_lessons;
create policy "tennis_log_lessons_insert_own"
  on public.tennis_log_lessons
  for insert
  to authenticated
  with check ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- UPDATE — 본인 기록만, 변경 후에도 소유자 유지 + 회원 자격.
drop policy if exists "tennis_log_lessons_update_own" on public.tennis_log_lessons;
create policy "tennis_log_lessons_update_own"
  on public.tennis_log_lessons
  for update
  to authenticated
  using ( owner_user_id = auth.uid() and public.can_access_tennis_log() )
  with check ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- DELETE — 본인 기록만 + 회원 자격.
drop policy if exists "tennis_log_lessons_delete_own" on public.tennis_log_lessons;
create policy "tennis_log_lessons_delete_own"
  on public.tennis_log_lessons
  for delete
  to authenticated
  using ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- ── STEP 4. (선택) 자체 검증 — 운영 적용 후 세션에서 확인 ────────────────────
-- 1) 자격 함수: select public.can_access_tennis_log();  -- 허용 역할 true, 게스트/ADMIN단독/미연결 false
-- 2) 타인 owner_user_id 로 INSERT 시 WITH CHECK 위반(실패) 기대.
-- 3) 다른 사용자의 레슨 id 직접 SELECT → 0행 기대.
-- ============================================================================
