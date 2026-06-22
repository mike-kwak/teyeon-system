-- ────────────────────────────────────────────────────────────────────────────
-- 진단: kdk_session_meta.club_schedule_id 중복 연결 점검
--
-- ⚠️ 자동 실행 금지. add_kdk_session_club_schedule_link.sql 의 unique partial index
--    를 적용하기 전에 먼저 실행해 중복 데이터를 확인하라.
--
-- 중복이 있으면 인덱스 생성이 실패한다 (`could not create unique index ... duplicate key`).
-- 임의로 한 쪽을 삭제하지 말고, 운영진이 어떤 KDK 세션을 정모 연결로 유지할지
-- 결정한 뒤 다른 세션의 club_schedule_id 를 NULL 로 직접 UPDATE 한다.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 블록 1: 정모 id 별 연결된 KDK 세션 수 + session_id 목록 ───────────────
select
  m.club_schedule_id,
  count(*)                    as linked_sessions,
  array_agg(m.session_id
            order by m.updated_at desc nulls last) as session_ids,
  max(m.updated_at)           as last_updated_at
from public.kdk_session_meta m
where m.club_schedule_id is not null
group by m.club_schedule_id
having count(*) > 1
order by last_updated_at desc;

-- ── 블록 2: 영향 받는 정모 + KDK 세션 디테일 (운영진 검토용) ──────────────
-- 위 블록 1 결과로 club_schedule_id 가 있으면 그 id 들로 검색.
-- (예: ARRAY['UUID1','UUID2']::uuid[] 로 교체)
-- select
--   m.club_schedule_id,
--   cs.title          as schedule_title,
--   cs.schedule_date  as schedule_date,
--   m.session_id,
--   m.updated_at      as meta_updated_at,
--   (select count(*) from public.matches mt where mt.session_id = m.session_id) as match_count,
--   (select bool_or(a.is_official) from public.teyeon_archive_v1 a where a.id = m.session_id) as has_official_archive
-- from public.kdk_session_meta m
-- join public.club_schedules cs on cs.id = m.club_schedule_id
-- where m.club_schedule_id = any(ARRAY['<우선 검토 대상 schedule UUID>']::uuid[])
-- order by m.club_schedule_id, m.updated_at desc;

-- ── 블록 3: 보정 UPDATE — 운영진이 유지할 session_id 외 나머지 NULL ──────
-- ⚠️ 블록 2 결과 검토 후에만 주석 해제 + 정확한 값으로 교체.
-- update public.kdk_session_meta
--    set club_schedule_id = null,
--        updated_at = now()
--  where club_schedule_id = '<대상 schedule UUID>'
--    and session_id <> '<유지할 session_id>';
--
-- 위 update 가 모두 끝나면 add_kdk_session_club_schedule_link.sql 를 적용해
-- unique partial index 를 생성한다 (이후 1:1 보장).
