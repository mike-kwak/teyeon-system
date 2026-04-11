-- [RPC ULTIMATE STABLE] final_sync_v5_stable (v5.0)
-- 404 에러와 타입 오류를 원천 차단하기 위해 모든 인자를 TEXT로 받고 파라미터 구조를 단일화했습니다.

-- 1. 함수 생성 (SECURITY DEFINER로 권한 장전)
CREATE OR REPLACE FUNCTION public.final_sync_v5_stable(
    p_match_id TEXT,
    p_score1 TEXT,
    p_score2 TEXT,
    p_status TEXT
)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.matches
    SET 
        status = p_status,
        -- TEXT로 받아온 점수를 INTEGER로 안전하게 형변환 (빈 문자열은 0으로 처리)
        score1 = COALESCE(NULLIF(p_score1, ''), '0')::INTEGER,
        score2 = COALESCE(NULLIF(p_score2, ''), '0')::INTEGER,
        updated_at = NOW()
    WHERE id = p_match_id;
END;
$$;

-- 2. 권한 강제 개방
GRANT EXECUTE ON FUNCTION public.final_sync_v5_stable(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.final_sync_v5_stable(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.final_sync_v5_stable(TEXT, TEXT, TEXT, TEXT) TO service_role;
