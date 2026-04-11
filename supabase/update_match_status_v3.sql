-- [RPC EMERGENCY BYPASS] update_match_status_v3 (v3.2)
-- 기존 이름의 캐시 충돌을 피하기 위해 이름을 새롭게 변경했습니다.

CREATE OR REPLACE FUNCTION public.update_match_status_v3(
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

-- 권한 부여
GRANT EXECUTE ON FUNCTION public.update_match_status_v3(TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated, service_role;
