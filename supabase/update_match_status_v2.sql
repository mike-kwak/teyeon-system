-- [RPC ULTIMATE FIX] update_match_status: JSONB 유니버설 버전 (v3.0)
-- 이 버전은 인자 개수나 순서에 상관없이 클라이언트의 요청 객체를 통째로 받아 처리합니다.

-- 1. 기존의 모든 중복 함수들 강제 삭제 (매개변수 조합별로 모두 삭제)
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, TEXT, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, INTEGER, INTEGER, TEXT);

-- 2. 단일 JSONB 인자를 받는 유니버설 함수 생성 
-- 인자 이름을 'p_params'가 아닌 무명 혹은 일반적인 이름으로 설정하여 PostgREST 매칭 최적화
CREATE OR REPLACE FUNCTION public.update_match_status(payload JSONB)
RETURNS VOID AS $$
BEGIN
    UPDATE public.matches
    SET 
        status = (payload->>'p_status')::TEXT,
        score1 = (payload->>'p_score1')::INTEGER,
        score2 = (payload->>'p_score2')::INTEGER
    WHERE id = (payload->>'p_match_id')::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 권한 부여
GRANT EXECUTE ON FUNCTION public.update_match_status(JSONB) TO anon, authenticated, service_role;
