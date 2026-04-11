-- [RPC ROOT INSPECTION] update_match_status_v3 (v3.4)
-- SECURITY DEFINER와 권한 강제 개방을 통해 인프라 수준의 가시성 이슈를 해결합니다.

-- 1. 기존 권한 및 함수 초기화 (강제 초기화)
DROP FUNCTION IF EXISTS public.update_match_status_v3(TEXT, NUMERIC, NUMERIC, TEXT);

-- 2. 함수 생성 (SECURITY DEFINER 명시)
-- 이를 통해 anon(비로그인) 사용자도 권한 이슈 없이 함수 내부 로직을 실행할 수 있습니다.
CREATE OR REPLACE FUNCTION public.update_match_status_v3(
    p_match_id TEXT,
    p_score1 NUMERIC,
    p_score2 NUMERIC,
    p_status TEXT
)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER -- 함수 생성자(postgres)의 권한으로 실행 (권한 문제 해결 핵심)
AS $$
BEGIN
    UPDATE public.matches
    SET 
        status = p_status,
        score1 = p_score1::INTEGER,
        score2 = p_score2::INTEGER
    WHERE id = p_match_id;
END;
$$;

-- 3. 권한 강제 개방 (각 역할별로 명시적 부여)
GRANT EXECUTE ON FUNCTION public.update_match_status_v3(TEXT, NUMERIC, NUMERIC, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.update_match_status_v3(TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_match_status_v3(TEXT, NUMERIC, NUMERIC, TEXT) TO service_role;
