-- ────────────────────────────────────────────────────────────────────────────
-- club_schedule_comments 1단계 대댓글 지원
--
-- 정모 댓글에 답글 기능 추가. 무한 중첩 금지 — 1단계만 허용.
-- 답글의 parent_comment_id 는 항상 "원댓글"의 id 여야 한다 (서비스 레이어에서 정규화).
-- 원댓글 삭제 시 cascade 로 답글도 함께 제거.
--
-- 기존 RLS 정책 그대로 적용된다 (select/insert/update/delete 모두 같은 테이블).
-- 답글의 schedule_id 는 원댓글과 동일해야 하지만 DB 레벨 강제 대신 서비스에서 검증.
--
-- ⚠️ 이 migration 은 운영 Supabase 에 직접 실행해야 한다.
-- 파일 자체는 idempotent 로 재실행 안전.
-- 기존 댓글 row 는 parent_comment_id = null 로 자동 유지.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.club_schedule_comments
  add column if not exists parent_comment_id uuid
  references public.club_schedule_comments(id) on delete cascade;

-- 답글 조회/카운트 최적화 — 원댓글 id 기준 lookup.
create index if not exists club_schedule_comments_parent_idx
  on public.club_schedule_comments(parent_comment_id);

-- 일정 상세 화면에서 schedule_id + 시간 정렬 batch 조회 최적화.
create index if not exists club_schedule_comments_schedule_created_idx
  on public.club_schedule_comments(schedule_id, created_at);

comment on column public.club_schedule_comments.parent_comment_id is
  '1단계 대댓글의 원댓글 id. null 이면 원댓글. 2단계 이상 중첩은 서비스에서 정규화로 차단.';
