-- =============================================================================
-- ROLLBACK — add_member_achievement_fields.sql 되돌리기.
--   CHECK/인덱스/컬럼만 제거한다. 2) 단계의 데이터 정규화(year 백필, result/division
--   통일)는 되돌리지 않는다(원래 자유 텍스트 복원 불가 — 비파괴 원칙상 값은 유지).
--   ⚠️ organization/year 컬럼을 제거하면 해당 값이 삭제된다. 필요 시 백업 후 실행.
-- =============================================================================

DROP INDEX IF EXISTS public.member_achievements_member_year_idx;

ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_org_chk;
ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_division_chk;
ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_result_chk;
ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_year_chk;

ALTER TABLE public.member_achievements DROP COLUMN IF EXISTS organization;
ALTER TABLE public.member_achievements DROP COLUMN IF EXISTS year;

NOTIFY pgrst, 'reload schema';
