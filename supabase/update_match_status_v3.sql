-- [RPC FORCE RECOVERY] update_match_status_v3 (v3.5)
-- 모든 인자를 TEXT 타입으로 통일하여 PostgREST의 인자 매칭 오류를 원천 차단합니다.

-- 1. 기존 함수 삭제 (이전 시그니처들)
DROP FUNCTION IF EXISTS public.update_match_status_v3(TEXT, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.update_match_status_v3(TEXT, INTEGER, INTEGER, TEXT);

-- 2. 함수 생성 (모든 인자를 TEXT로 받아 관대하게 처리)
CREATE OR REPLACE FUNCTION public.update_match_status_v3(
    p_match_id TEXT,
    p_score1 TEXT,
    p_score2 TEXT,
    p_status TEXT
)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER -- 어떠한 역할에서도 권한 문제 없이 실행 보장
AS $$
BEGIN
    UPDATE public.matches
    SET 
        status = p_status,
        score1 = COALESCE(NULLIF(p_score1, ''), '0')::INTEGER,
        score2 = COALESCE(NULLIF(p_score2, ''), '0')::INTEGER
    WHERE id = p_match_id;
END;
$$;

-- 3. 권한 강제 개방
GRANT EXECUTE ON FUNCTION public.update_match_status_v3(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
