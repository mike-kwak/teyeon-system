-- ────────────────────────────────────────────────────────────────────────────
-- 코트 중복 최종 방어 — matches partial unique index
--
-- 목적:
--   같은 club_id + session_id + court 에 status='playing' 경기가 두 개 존재하지
--   못하게 DB 차원에서 강제한다. start_kdk_match RPC 의 advisory lock 이 1차 직렬화,
--   이 index 가 최종 방어선(우회 update / 동시성 경쟁까지 차단). 위반 시 23505 →
--   RPC 가 court_conflict 로 변환해 안전 반환한다.
--
-- 적용 범위:
--   - status='playing' AND court IS NOT NULL 인 행만 대상(partial).
--   - waiting / complete 행, court IS NULL 행(예: SPECIAL 매치는 court=null)은 영향 없음.
--   - 조별 코트 설정(group_courts) 유무와 무관하게 최종 코트 유일성만 보장.
--
-- ⚠️ 운영 DB 에 직접 실행. 아래 1 → 2 → 3 순서를 반드시 지킨다.
--    기존 중복 데이터는 절대 임의 삭제/완료/수정하지 말 것(운영자가 앱에서 정리).
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1) 중복 검사 (먼저 실행) ───────────────────────────────────────────────
--    결과가 0행이면 2)로 진행. 1행 이상이면 index 를 만들지 말고 중복부터 정리한다.
--    (어떤 session / court / match_id 가 겹쳤는지 확인용.)
select
  club_id,
  session_id,
  court,
  count(*) as duplicate_count,
  array_agg(id order by created_at) as match_ids
from public.matches
where status = 'playing'
  and court is not null
group by club_id, session_id, court
having count(*) > 1
order by club_id, session_id, court;

-- ── 2) 게이트 ──────────────────────────────────────────────────────────────
--    위 1) 결과가 0행임을 눈으로 확인했을 때만 아래 3) 을 실행한다.
--    (중복이 남아 있으면 unique index 생성이 23505 로 실패한다 — 강제하지 말 것.)

-- ── 3) partial unique index 생성 ──────────────────────────────────────────
create unique index if not exists matches_playing_court_uniq
  on public.matches (club_id, session_id, court)
  where status = 'playing'
    and court is not null;

-- ── 확인 ───────────────────────────────────────────────────────────────────
-- select indexname, indexdef
--   from pg_indexes
--  where schemaname = 'public'
--    and tablename = 'matches'
--    and indexname = 'matches_playing_court_uniq';
