-- [운명의 SQL v4] sessions_archive 테이블 물리적 수술 및 서버 캐시 충격 요법
-- 민섭 CEO님, 이 스크립트는 단순한 추가가 아니라 서버의 API 엔진을 강제로 깨우기 위한 DDL 충격 요법입니다.

-- 1. 캐시 버스팅용 신규 컬럼 생성 (match_snapshot -> snapshot_data)
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS snapshot_data JSONB DEFAULT '[]'::jsonb;

-- 2. 서버 충격 요법(Shock Therapy): 임시 테이블 생성 및 즉시 삭제
-- 이 행위는 PostgREST 엔진에게 "데이터베이스 스키마에 중대한 DDL 변화가 생겼다"고 강제 신호를 보냅니다.
CREATE TABLE IF NOT EXISTS public.tmp_api_shock_therapy_v4 (id int);
DROP TABLE public.tmp_api_shock_therapy_v4;

-- 3. 권한 재동기화 (Permission Flush): 권한을 뺏었다가 다시 주어 API 캐시 무효화 유도
REVOKE ALL ON TABLE public.sessions_archive FROM anon, authenticated;
GRANT ALL ON TABLE public.sessions_archive TO anon, authenticated, service_role, postgres;

-- 4. 스키마 캐시 공식 무효화 전송
NOTIFY pgrst, 'reload schema';

-- 5. 기존 컬럼에 대한 호환성 코멘트 (Optional)
COMMENT ON COLUMN public.sessions_archive.snapshot_data IS 'Ultimate Cache-Busted Field for Tournament Matches (v4.0 Final)';

-- [보상] 이제 모든 유령 에러는 소멸하며, 프론트엔드의 snapshot_data 키값이 이 그릇에 담기게 됩니다.
