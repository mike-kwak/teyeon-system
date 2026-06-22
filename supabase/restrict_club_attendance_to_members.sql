-- ────────────────────────────────────────────────────────────────────────────
-- restrict_club_attendance_to_members.sql
--
-- 정모 참석 체크(INSERT/UPDATE)를 TEYEON 회원 계정으로만 제한.
-- 단일 진실: members.auth_user_id = auth.uid()  ← 매핑이 없으면 RLS 가 저장을 거절.
--
-- 변경 정책:
--   - SELECT / DELETE 정책은 그대로 유지 (조회 권한 축소 금지)
--   - INSERT / UPDATE 정책만 재정의 — DROP IF EXISTS → CREATE 로 idempotent
--   - 기존 add_club_schedule_attendance.sql 의 정책 이름을 그대로 재사용
--
-- 적용 후 기대 동작:
--   - profiles 만 있고 members 연결이 없는 계정: insert/update 모두 RLS 거절
--   - members.auth_user_id 가 다른 회원으로 잘못 연결돼 있어도 본인 row 만 저장 가능
--   - 기존 정상 attendance (member_id 가 실제 members.id 와 연결된 row) 는 그대로 보존
--
-- ⚠️ 실행 전 점검 권장:
--    1) 본 마이그레이션은 schema 변경 없음 (정책만 재정의). 롤백은 정책을 이전 정의로 되돌리면 됨.
--    2) 운영 환경에서 members.auth_user_id 가 비어 있는 회원이 다수라면 — 그 회원들은
--       이 마이그레이션 적용 직후 참석 체크가 불가해진다. 사전 보완 후 적용.
--    3) /club-schedule/[id] UI 는 강제로 안내 카드를 띄우므로 사용자 혼란은 없다.
-- ────────────────────────────────────────────────────────────────────────────

-- RLS 가 이미 켜져 있다는 전제 (add_club_schedule_attendance.sql 에서 enable 됨).
-- 만약 어떤 환경에서 꺼져 있다면 재실행 가능하도록 보장.
alter table public.club_schedule_attendances enable row level security;

-- ── INSERT ─────────────────────────────────────────────────────────────────
-- 기존: auth.uid() = user_id  → 비회원 / 게스트도 통과
-- 신규: 위 조건 + members.auth_user_id 매핑된 row 의 id 와 member_id 일치
drop policy if exists "club_schedule_attendances_insert" on public.club_schedule_attendances;

create policy "club_schedule_attendances_insert"
  on public.club_schedule_attendances
  for insert
  with check (
    auth.uid() = user_id
    and member_id is not null
    and exists (
      select 1
        from public.members m
       where m.auth_user_id = auth.uid()
         and m.id = club_schedule_attendances.member_id
    )
  );

-- ── UPDATE ─────────────────────────────────────────────────────────────────
-- 기존 row 의 user_id 가 본인이어야 함 + 변경 후에도 본인 + 본인의 members.id 만 사용 가능.
-- (다른 회원으로 위장하려는 UPDATE 차단)
drop policy if exists "club_schedule_attendances_update" on public.club_schedule_attendances;

create policy "club_schedule_attendances_update"
  on public.club_schedule_attendances
  for update
  using (
    auth.uid() = user_id
  )
  with check (
    auth.uid() = user_id
    and member_id is not null
    and exists (
      select 1
        from public.members m
       where m.auth_user_id = auth.uid()
         and m.id = club_schedule_attendances.member_id
    )
  );

-- ── SELECT / DELETE ────────────────────────────────────────────────────────
-- 기존 정책 (조회 공개 + 본인 삭제) 는 변경하지 않는다. 별도 안전 보강도 하지 않음.
-- (관리자 대리 삭제 권한이 기존에 별도 정책으로 운영되고 있었다면 그대로 유지.)

-- ── 운영 진단 헬퍼 (선택) ──────────────────────────────────────────────────
-- 적용 후 즉시 아래 SELECT 로 RLS 효과를 확인할 수 있다 (운영진 세션에서).
--
-- -- 본인의 attendance row 가 정책 통과로 저장 가능한지 미리 확인 (행 단위 시뮬레이션).
-- select
--   exists (
--     select 1 from public.members m where m.auth_user_id = auth.uid()
--   ) as has_member_link,
--   (
--     select m.id from public.members m where m.auth_user_id = auth.uid() limit 1
--   ) as my_member_id;
--
-- -- 운영진(서비스 키) 측에서 unresolved row 카운트:
-- select count(*) from public.club_schedule_attendances a
--  where a.member_id is null
--     or not exists (
--       select 1 from public.members m where m.id = a.member_id
--     );
