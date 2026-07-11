-- =============================================================================
-- member_achievements 구조 표준화 — 대회 체계(organization) + 연도(year) 컬럼 추가.
--   표시 형식: "{organization} {tournament_name} {division} {result}"
--             예) "KATO 천안시장배 신인부 우승"
--   기존 테이블(supabase/add_member_achievements.sql)에 컬럼만 추가하는 최소 변경.
--   RLS/권한 변경 없음. partner_name/description/tournament_date/is_featured/display_order 는
--   삭제하지 않고(비파괴) 신규 입력·표시에서만 제외한다.
--
--   ⚠️ 사용자 승인 후 Supabase SQL Editor 에서 1회 실행. 앱은 이 컬럼 없이도 동작한다
--      (조회 실패 → 빈 목록, 관리자 저장 시 안내 메시지).
--   rollback: supabase/add_member_achievement_fields_rollback.sql
--   verify  : supabase/add_member_achievement_fields_verify.sql
-- =============================================================================

-- 1) 신규 컬럼(멱등)
ALTER TABLE public.member_achievements ADD COLUMN IF NOT EXISTS organization text;
ALTER TABLE public.member_achievements ADD COLUMN IF NOT EXISTS year integer;
COMMENT ON COLUMN public.member_achievements.organization IS '대회 체계: KATO/KATA/KTA';
COMMENT ON COLUMN public.member_achievements.year IS '입상 연도(YYYY)';

-- 2) 레거시 데이터 보정(현재 0행 — 있을 경우에만 안전 변환, 행 삭제 없음)
--    2-a) year 백필: tournament_date 가 있으면 그 연도로 채운다.
UPDATE public.member_achievements
   SET year = EXTRACT(YEAR FROM tournament_date)::int
 WHERE year IS NULL AND tournament_date IS NOT NULL;

--    2-b) 성적 통일: 우승/준우승 외(4강·8강·16강·공동 3위·본선 진출·기타)는 '입상' 으로.
--         (result 는 NOT NULL 이므로 IS NULL 케이스 없음)
UPDATE public.member_achievements
   SET result = '입상'
 WHERE result NOT IN ('우승', '준우승', '입상');

--    2-c) 부서 통일: 신인부/오픈부 외 레거시 값은 오픈부로 정규화(예: 개나리부 등).
--         부서 미상(null)은 그대로 둔다.
UPDATE public.member_achievements
   SET division = '오픈부'
 WHERE division IS NOT NULL AND division NOT IN ('신인부', '오픈부');

-- 3) 값 무결성 CHECK(향후 잘못된 저장 차단). NULL 은 허용(레거시 행 보호).
ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_org_chk;
ALTER TABLE public.member_achievements ADD CONSTRAINT member_achievements_org_chk
  CHECK (organization IS NULL OR organization IN ('KATO', 'KATA', 'KTA'));

ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_division_chk;
ALTER TABLE public.member_achievements ADD CONSTRAINT member_achievements_division_chk
  CHECK (division IS NULL OR division IN ('신인부', '오픈부'));

ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_result_chk;
ALTER TABLE public.member_achievements ADD CONSTRAINT member_achievements_result_chk
  CHECK (result IN ('우승', '준우승', '입상'));

ALTER TABLE public.member_achievements DROP CONSTRAINT IF EXISTS member_achievements_year_chk;
ALTER TABLE public.member_achievements ADD CONSTRAINT member_achievements_year_chk
  CHECK (year IS NULL OR (year BETWEEN 1990 AND 2100));

-- 4) 연도 정렬 인덱스(멤버별 최신 연도 우선)
CREATE INDEX IF NOT EXISTS member_achievements_member_year_idx
  ON public.member_achievements (member_id, year DESC NULLS LAST);

-- 5) PostgREST 스키마 캐시 갱신 — 적용 즉시 앱에서 새 컬럼 인식
NOTIFY pgrst, 'reload schema';
