-- ────────────────────────────────────────────────────────────────────────────
-- KDK 세션 ↔ Club Schedule 연결
--
-- KDK 세션은 두 테이블에 존재:
--   - `matches`            : 진행 중 / 대기 / 완료 row 들 (session_id text 그룹키)
--   - `teyeon_archive_v1`  : 확정 / 미확정 스냅샷 (id = session_id)
--   - `kdk_session_meta`   : 세션별 메타데이터 (session_id PK, ticker_message 등)
--
-- 연결 단일 진실 소스:
--   `kdk_session_meta.club_schedule_id` (uuid, nullable, FK)
--   → 정모 - KDK 세션 1:1 (운영진이 KDK 생성 시 선택). 정모 삭제 시 SET NULL.
--   → 이름/날짜 자동 매칭 금지 — 운영진이 명시적으로 지정한 경우만 연결.
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행해야 한다. idempotent — 재실행 안전.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.kdk_session_meta
  add column if not exists club_schedule_id uuid
  references public.club_schedules(id) on delete set null;

-- 정모 1건 ↔ KDK 세션 1건 보장 (1:1). null 은 unique 검사에서 제외 (partial index).
-- ⚠️ 적용 전 supabase/inspect_kdk_session_meta_duplicates.sql 로 중복 데이터 점검 필수.
--   중복이 남아 있으면 이 인덱스 생성이 실패할 수 있다.
create unique index if not exists kdk_session_meta_club_schedule_unique_idx
  on public.kdk_session_meta(club_schedule_id)
  where club_schedule_id is not null;

comment on column public.kdk_session_meta.club_schedule_id is
  'KDK 세션이 운영진에 의해 명시적으로 연결된 Club Schedule (정모) id. ' ||
  'null 이면 미연결. 자동 매칭 금지 — 운영진이 KDK 생성 화면에서 선택한 경우만. ' ||
  '정모 ↔ 세션 1:1 (unique partial index 적용).';
