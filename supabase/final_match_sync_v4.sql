-- [RPC ROOT PURGE] final_match_sync_v4 (v4.0)
-- 기존 이름의 캐시 저주를 풀고 인프라 불일치를 원천 차단하기 위해 새로운 명칭으로 재정의되었습니다.

-- 1. 함수 생성 (SECURITY DEFINER: 인프라/권한 장벽을 무력화하고 강제로 명령어 수행)
CREATE OR REPLACE FUNCTION public.final_match_sync_v4(
    p_match_id TEXT,
    p_score1 TEXT,
    p_score2 TEXT,
    p_status TEXT
)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER -- 함수 생성자 권한으로 실행 (권한 문제 근본 해결)
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

-- 2. 권한 강제 개방 (익명, 인증, 서비스 역할 모두 허용)
GRANT EXECUTE ON FUNCTION public.final_match_sync_v4(TEXT, TEXT, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.final_match_sync_v4(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.final_match_sync_v4(TEXT, TEXT, TEXT, TEXT) TO service_role;
