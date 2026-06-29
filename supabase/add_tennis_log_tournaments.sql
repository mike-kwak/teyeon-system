-- ============================================================================
-- add_tennis_log_tournaments.sql
--
-- TENNIS LOG — 외부 대회 개인 기록(프라이빗). 본인만 SELECT/INSERT/UPDATE/DELETE.
--   · CEO/ADMIN/운영진도 타인의 TENNIS LOG 를 열람/수정/삭제할 수 없다(개인 데이터).
--   · anon(비로그인) 접근 불가.
--   · TENNIS LOG 자체가 정회원/운영진 직책 전용 → RLS 에서도 회원 자격을 함께 검증.
--
-- 상태: 검토용(DRAFT). 운영 Supabase 에서 아직 실행되지 않음. 승인 전 실행 금지.
-- 성격: idempotent(재실행 안전) — CREATE ... IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS.
--
-- 적용 순서(권장):
--   STEP 1  테이블 + 제약 + 인덱스
--   STEP 2  updated_at 트리거
--   STEP 3  접근 자격 helper  public.can_access_tennis_log()  (SECURITY DEFINER)
--   STEP 4  RLS 활성화 + 본인 전용 정책
--   STEP 5  (선택) 자체 검증 쿼리 — 주석 처리되어 있음
--
-- 회원 자격 판정(앱 lib/tennisLogAccess.ts 와 동일 기준 · 화이트리스트):
--   허용(정확히 이 7개 members.role 만): 정회원 · 회장 · 부회장 · 총무 · 재무 · 경기 · 섭외
--   그 외 전부 잠금: 준회원 · 게스트 · 빈 값 · 알 수 없는 신규 역할 · members 미연결.
--   (차단 목록 방식이 아니라 허용 목록만 명시하는 whitelist.)
--   로그인 사용자 ↔ members 연결 우선순위:
--     1순위  members.auth_user_id = auth.uid()
--     2순위  현재 사용자에게 연결된 행이 하나도 없을 때만(NOT EXISTS auth_user_id 연결 행)
--            미연결 회원의 이메일로 fallback.
--            → 연결 행이 하나라도 있으면 이메일 fallback 전면 비활성화(연결 행 역할만으로 판정).
--     이메일 비교: 대소문자와 앞뒤 공백 정규화(lower(btrim())) 후 전체 이메일 exact 비교.
--            → 대소문자/공백 차이는 정규화되어 동일 이메일로 취급되고, 부분일치는 불허.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── STEP 1. 테이블 ──────────────────────────────────────────────────────────
create table if not exists public.tennis_log_tournaments (
  id                  uuid primary key default gen_random_uuid(),
  owner_user_id       uuid not null references auth.users(id) on delete cascade,
  tournament_date     date not null,
  tournament_name     text not null,
  region              text,
  venue               text,
  event_type                    text not null,
  participation_category        text,
  participation_category_custom text,
  partner_name                  text,
  final_result                  text not null,
  result_detail                 text,
  condition_rating              smallint,
  one_line_review     text not null,
  good_points         text,
  improvements        text,
  next_goal           text,
  partner_memo        text,
  match_results       jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 제약 — 기존(제약 없이 만들어진) 테이블에도 재실행으로 보강되도록 DO 가드.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tennis_log_tournaments'::regclass
       and conname = 'tennis_log_tournaments_condition_rating_chk'
  ) then
    alter table public.tennis_log_tournaments
      add constraint tennis_log_tournaments_condition_rating_chk
      check (condition_rating is null or condition_rating between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tennis_log_tournaments'::regclass
       and conname = 'tennis_log_tournaments_match_results_is_array_chk'
  ) then
    alter table public.tennis_log_tournaments
      add constraint tennis_log_tournaments_match_results_is_array_chk
      check (jsonb_typeof(match_results) = 'array');
  end if;
end $$;

-- 인덱스 — 본인 기록 목록/요약 조회 최적화.
create index if not exists tennis_log_tournaments_owner_idx
  on public.tennis_log_tournaments (owner_user_id);
create index if not exists tennis_log_tournaments_owner_date_idx
  on public.tennis_log_tournaments (owner_user_id, tournament_date desc);
create index if not exists tennis_log_tournaments_owner_created_idx
  on public.tennis_log_tournaments (owner_user_id, created_at desc);

-- ── STEP 2. updated_at 트리거 ───────────────────────────────────────────────
create or replace function public.tennis_log_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tennis_log_tournaments_updated_at on public.tennis_log_tournaments;
create trigger trg_tennis_log_tournaments_updated_at
  before update on public.tennis_log_tournaments
  for each row execute function public.tennis_log_set_updated_at();

-- ── STEP 3. 접근 자격 helper ────────────────────────────────────────────────
-- members 의 RLS 와 무관하게 "현재 로그인 사용자가 TENNIS LOG 자격이 있는지"만 boolean 으로 반환.
-- 회원 정보 자체는 노출하지 않는다. SECURITY DEFINER + 고정 search_path + authenticated 전용.
create or replace function public.can_access_tennis_log()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.members m
     where (
             -- 1순위: auth_user_id 직접 연결.
             m.auth_user_id = auth.uid()
             -- 2순위: 현재 사용자에게 연결된 행이 "하나도 없을 때만" 로그인 이메일로 fallback.
             --   · 글로벌 우선순위 guard(not exists …): 연결 행이 하나라도 있으면 이메일 fallback 전면 비활성화
             --     → 연결 행의 역할만으로 판정(게스트로 연결되면 동일 이메일 미연결 정회원 행이 있어도 false).
             --   · 이메일 비교: lower(btrim()) 정규화 후 전체 이메일 exact 비교
             --     (대소문자·앞뒤 공백은 정규화 후 동일 이메일로 취급, 부분일치 금지).
             or (
               m.auth_user_id is null
               and not exists (
                 select 1
                   from public.members linked
                  where linked.auth_user_id = auth.uid()
               )
               and m.email is not null
               and lower(btrim(m.email)) = (
                 select lower(btrim(u.email))
                   from auth.users u
                  where u.id = auth.uid()
               )
             )
           )
       -- 화이트리스트: 아래 7개 역할만 허용. 그 외(준회원·게스트·빈 값·알 수 없는 역할)는 제외.
       and btrim(coalesce(m.role, '')) in ('정회원', '회장', '부회장', '총무', '재무', '경기', '섭외')
  );
$$;

revoke all on function public.can_access_tennis_log() from public;
revoke all on function public.can_access_tennis_log() from anon;
grant execute on function public.can_access_tennis_log() to authenticated;

-- ── STEP 4. RLS + 본인 전용 정책 ────────────────────────────────────────────
alter table public.tennis_log_tournaments enable row level security;

-- 방어적: anon 역할의 테이블 권한 회수(정책상으로도 차단되지만 이중 보호).
revoke all on table public.tennis_log_tournaments from anon;

-- SELECT — 본인 기록만 + 회원 자격.
drop policy if exists "tennis_log_tournaments_select_own" on public.tennis_log_tournaments;
create policy "tennis_log_tournaments_select_own"
  on public.tennis_log_tournaments
  for select
  to authenticated
  using ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- INSERT — owner 위조 차단(owner_user_id 는 반드시 본인) + 회원 자격.
drop policy if exists "tennis_log_tournaments_insert_own" on public.tennis_log_tournaments;
create policy "tennis_log_tournaments_insert_own"
  on public.tennis_log_tournaments
  for insert
  to authenticated
  with check ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- UPDATE — 본인 기록만, 변경 후에도 소유자 유지 + 회원 자격.
drop policy if exists "tennis_log_tournaments_update_own" on public.tennis_log_tournaments;
create policy "tennis_log_tournaments_update_own"
  on public.tennis_log_tournaments
  for update
  to authenticated
  using ( owner_user_id = auth.uid() and public.can_access_tennis_log() )
  with check ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- DELETE — 본인 기록만 + 회원 자격.
drop policy if exists "tennis_log_tournaments_delete_own" on public.tennis_log_tournaments;
create policy "tennis_log_tournaments_delete_own"
  on public.tennis_log_tournaments
  for delete
  to authenticated
  using ( owner_user_id = auth.uid() and public.can_access_tennis_log() );

-- ── STEP 5. (선택) 자체 검증 — 운영 적용 후 세션에서 확인 ────────────────────
-- 1) 회원 자격 함수가 본인에 대해 true 인지:
--    select public.can_access_tennis_log();           -- 정회원/운영진: true, 준회원/게스트: false
-- 2) 타인 owner_user_id 로 INSERT 시 RLS 거절(with check 위반) 되는지:
--    insert into public.tennis_log_tournaments (owner_user_id, tournament_date, tournament_name,
--      event_type, final_result, one_line_review)
--    values ('00000000-0000-0000-0000-000000000000', current_date, 'x', '단식', '예탈', 'x');  -- 실패 기대
-- 3) 다른 사용자의 기록 id 를 직접 SELECT 해도 0 행:
--    select count(*) from public.tennis_log_tournaments where owner_user_id <> auth.uid();  -- 0 기대
-- 4) [회귀] 이메일 fallback 우회 차단 — 연결 행이 게스트이고, 같은 이메일의 미연결 행이 정회원인 경우:
--      · members: (auth_user_id = 본인 uid, role='게스트', email=a@x.com)
--                 (auth_user_id IS NULL,      role='정회원', email=a@x.com)
--      · 본인 세션에서: select public.can_access_tennis_log();   -- 기대: false
--      (연결 행이 존재하므로 이메일 fallback 비활성 → 게스트 역할로 판정 → 차단)
-- ============================================================================
