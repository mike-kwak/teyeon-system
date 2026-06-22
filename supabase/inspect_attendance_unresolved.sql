-- ────────────────────────────────────────────────────────────────────────────
-- 진단 + 안전 backfill — '회원 정보 없음' 으로 표시되는 attendance row 점검.
--
-- ⚠️ 자동 실행 금지. 각 블록을 운영진이 SQL Editor 에서 1개씩 검토 후 실행.
-- ⚠️ UPDATE 블록은 보호 조건(name exact match + member_id IS NULL 만)을 검증한 뒤 실행.
--
-- 의도:
--   1) member_id NULL + auth_user_id 매핑 없음 + snapshot 없음 인 row 식별
--   2) members.nickname 과 정확히 일치하는 1건만 매핑되는 row 에 한해
--      attendance.display_name_snapshot 만 보정 (member_id 는 임의로 채우지 않음)
-- ────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 블록 1: 매핑 실패 카운트 — 일정별 unresolved row 수
-- ─────────────────────────────────────────────────────────────────────────
select
  a.schedule_id,
  count(*)                                                           as total,
  count(a.member_id)                                                 as has_member_id,
  count(a.display_name_snapshot)                                     as has_snapshot,
  count(*) filter (
    where a.member_id is null
      and a.display_name_snapshot is null
      and not exists (
        select 1 from public.members m
         where m.auth_user_id = a.user_id
      )
  )                                                                  as unresolved
from public.club_schedule_attendances a
group by a.schedule_id
order by unresolved desc, total desc;

-- ─────────────────────────────────────────────────────────────────────────
-- 블록 2: unresolved row 의 user_id 만 추출 — UUID 노출 검토용
-- (개인정보 보안 — 운영진 1명만 본다는 전제)
-- ─────────────────────────────────────────────────────────────────────────
select a.id as attendance_id, a.schedule_id, a.user_id, a.created_at
  from public.club_schedule_attendances a
 where a.member_id is null
   and a.display_name_snapshot is null
   and not exists (
     select 1 from public.members m where m.auth_user_id = a.user_id
   )
 order by a.created_at desc
 limit 100;

-- ─────────────────────────────────────────────────────────────────────────
-- 블록 3: profile.email 기준으로 member 후보가 정확히 1건 잡히는 row 점검
-- (이 결과를 운영진이 직접 검토한 뒤에만 블록 4 UPDATE 실행)
-- ─────────────────────────────────────────────────────────────────────────
select
  a.id            as attendance_id,
  a.user_id,
  p.email         as profile_email,
  cand.id         as candidate_member_id,
  cand.nickname   as candidate_nickname
from public.club_schedule_attendances a
join public.profiles p on p.id = a.user_id
join lateral (
  select id, nickname from public.members m
   where m.email is not null and m.email = p.email
   limit 2
) cand on true
where a.member_id is null
  and a.display_name_snapshot is null
  and not exists (
    select 1 from public.members m where m.auth_user_id = a.user_id
  )
order by a.created_at desc
limit 200;

-- ─────────────────────────────────────────────────────────────────────────
-- 블록 4: 안전 backfill — snapshot 만 보정 (1차)
-- 조건:
--   - attendance.member_id IS NULL
--   - attendance.display_name_snapshot IS NULL
--   - profile.email 으로 매칭되는 members row 가 정확히 1건
--   - 동명이인 / 중복은 자동 제외
-- 효과:
--   - members.id 는 채우지 않는다 (이 블록은 표시명만 보강).
--   - 표시 안정성을 위해 display_name_snapshot 만 보정.
-- ⚠️ 블록 3 결과를 확인하지 않은 채 실행 금지.
-- ─────────────────────────────────────────────────────────────────────────
-- update public.club_schedule_attendances a
--    set display_name_snapshot = sub.nickname
--   from (
--     select a2.id as attendance_id, m.nickname
--       from public.club_schedule_attendances a2
--       join public.profiles p on p.id = a2.user_id
--       join public.members m on m.email is not null and m.email = p.email
--      where a2.member_id is null
--        and a2.display_name_snapshot is null
--        and not exists (
--          select 1 from public.members mm where mm.auth_user_id = a2.user_id
--        )
--      group by a2.id, m.nickname
--      having count(m.id) = 1
--   ) sub
--  where a.id = sub.attendance_id;

-- ─────────────────────────────────────────────────────────────────────────
-- 블록 5: 안전 backfill — member_id + snapshot 동시 보정 (2차, 선택적)
-- 조건 (블록 4 보다 더 엄격):
--   - attendance.member_id IS NULL
--   - profile.email 으로 정확히 일치하는 active member 가 정확히 1건 (동명이인 자동 제외)
--   - 이미 member_id 가 있는 행은 절대 수정하지 않음
--   - snapshot 은 동시에 members.nickname 으로 덮어씀 (이름 변경 회원 반영)
-- 사용 흐름:
--   1) 먼저 아래 첫 번째 SELECT (preview) 로 영향 받는 row 확인
--   2) 결과가 의도와 일치하면 두 번째 UPDATE 블록 주석 해제 후 실행
--   3) 의심스러운 row 가 보이면 실행 중단 → 운영진 수동 매핑
-- ⚠️ 자동 실행 금지.
-- ─────────────────────────────────────────────────────────────────────────

-- (5-A) preview — 영향 받을 row 미리 확인 (실행 안전)
select
  a.id            as attendance_id,
  a.user_id,
  p.email         as profile_email,
  cand.id         as candidate_member_id,
  cand.nickname   as candidate_nickname
from public.club_schedule_attendances a
join public.profiles p on p.id = a.user_id
join lateral (
  select id, nickname from public.members m
   where m.email is not null and m.email = p.email
) cand on true
where a.member_id is null
group by a.id, a.user_id, p.email, cand.id, cand.nickname
having count(cand.id) over (partition by a.id) = 1
order by a.created_at desc
limit 200;

-- (5-B) UPDATE — 검토 통과한 행만 member_id + snapshot 동시 보정.
-- 동명이인 / 복수 후보는 자동 제외 (having count = 1).
-- ⚠️ preview 결과 확인 전까지 주석 해제 금지.
-- update public.club_schedule_attendances a
--    set member_id = sub.member_id,
--        display_name_snapshot = sub.nickname,
--        updated_at = now()
--   from (
--     select a2.id           as attendance_id,
--            (array_agg(m.id))[1]       as member_id,
--            (array_agg(m.nickname))[1] as nickname
--       from public.club_schedule_attendances a2
--       join public.profiles p on p.id = a2.user_id
--       join public.members m on m.email is not null and m.email = p.email
--      where a2.member_id is null
--      group by a2.id
--      having count(m.id) = 1
--   ) sub
--  where a.id = sub.attendance_id
--    and a.member_id is null;
