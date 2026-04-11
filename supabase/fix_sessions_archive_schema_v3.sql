-- [운명의 SQL] sessions_archive 테이블 물리적 수술 및 스키마 캐시 갱신
-- 민섭 CEO님, 아래 명령어를 Supabase SQL Editor에서 실행하여 서버의 '그릇'을 최종 확정해 주세요.

-- 1. 필수 분석용 컬럼 생성 (이미 존재하는 경우 무시)
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS match_snapshot JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS player_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS total_matches INTEGER DEFAULT 0;

ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS total_rounds INTEGER DEFAULT 0;

-- 2. API 접근 권한 및 스키마 캐시 강제 갱신 
-- (PostgREST 엔진에게 '스키마가 바뀌었으니 다시 읽어라'고 명령합니다.)
NOTIFY pgrst, 'reload schema';

-- [확인] 이제 Ranking 탭에서 '공식 종료' 시 match_snapshot 에러 없이 완벽하게 박제됩니다.
COMMENT ON COLUMN public.sessions_archive.match_snapshot IS 'Final archive of all session matches (v7.0 Stable)';
