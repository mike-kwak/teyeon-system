-- [RPC CACHE SURGERY] update_match_status_v3 (v3.3)
-- 데이터베이스 API 엔진의 스키마 캐시를 강제로 초기화하기 위한 특별 처리가 포함되었습니다.

-- 1. [핵심] 스키마 캐시 강제 새로고침 유도 (DDL 자극)
-- 테이블에 임시 컬럼을 추가했다가 삭제하여 엔진이 스키마를 다시 읽게 만듭니다.
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS _cache_reload_v33 TIMESTAMP DEFAULT now();
ALTER TABLE public.matches DROP COLUMN IF EXISTS _cache_reload_v33;

-- 2. 신규 함수 생성 (타입 호환성이 가장 높은 NUMERIC 적용)
CREATE OR REPLACE FUNCTION public.update_match_status_v3(
    p_match_id TEXT,
    p_score1 NUMERIC,
    p_score2 NUMERIC,
    p_status TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.matches
    SET 
        status = p_status,
        score1 = p_score1::INTEGER,
        score2 = p_score2::INTEGER
    WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 권한 부여
GRANT EXECUTE ON FUNCTION public.update_match_status_v3(TEXT, NUMERIC, NUMERIC, TEXT) TO anon, authenticated, service_role;
