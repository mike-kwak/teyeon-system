-- [RPC FINAL FIX] update_match_status: 최종 호환성 패치 (v3.1)
-- 모든 가능성을 고려하여 인자 순서와 데이터 타입을 최적화했습니다.

-- 1. 기존의 모든 복잡한 형태의 함수들을 제거하여 깨끗하게 정리
DROP FUNCTION IF EXISTS public.update_match_status(JSONB);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, TEXT, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, INTEGER, INTEGER, TEXT);

-- 2. 버전 A: INTEGER 기반 (표준 정수 처리)
CREATE OR REPLACE FUNCTION public.update_match_status(
    p_match_id TEXT,
    p_score1 INTEGER,
    p_score2 INTEGER,
    p_status TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.matches
    SET 
        status = p_status,
        score1 = p_score1,
        score2 = p_score2
    WHERE id = p_match_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 버전 B: NUMERIC 기반 (JS Number 호환성 강화)
-- 웹에서 숫자가 실수 형태로 넘어올 경우를 대비한 오버로딩 함수입니다.
CREATE OR REPLACE FUNCTION public.update_match_status(
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

-- 4. 권한 부여 
GRANT EXECUTE ON FUNCTION public.update_match_status(TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_match_status(TEXT, NUMERIC, NUMERIC, TEXT) TO anon, authenticated, service_role;
