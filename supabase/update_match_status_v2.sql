-- [RPC FIX] update_match_status: 4개 인자 오버로딩 버전
-- 클라이언트에서 명명된 인자(Named Arguments)로 4개의 값만 보낼 때 대응하기 위한 함수입니다.

CREATE OR REPLACE FUNCTION public.update_match_status(
    p_match_id TEXT,
    p_status TEXT,
    p_score1 INTEGER,
    p_score2 INTEGER
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

-- 권한 부여 (시그니처를 명시하여 정확한 함수에 부여)
GRANT EXECUTE ON FUNCTION public.update_match_status(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated, service_role;
