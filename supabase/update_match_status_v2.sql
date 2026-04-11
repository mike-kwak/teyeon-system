-- [RPC HOTFIX] update_match_status: 인자 순서 정렬 버전 (v2.1)
-- PostgREST의 알파벳 순서 매칭 이슈를 해결하기 위해 인자 순서를 조정했습니다.

-- 1. 기존 오버로딩 함수들 모두 삭제 (충돌 방지)
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, TEXT, INTEGER, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.update_match_status(TEXT, INTEGER, INTEGER, TEXT);

-- 2. 신규 함수 생성 (인자 순서를 알파벳 순으로 배치: match_id -> score1 -> score2 -> status)
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

-- 3. 권한 부여
GRANT EXECUTE ON FUNCTION public.update_match_status(TEXT, INTEGER, INTEGER, TEXT) TO anon, authenticated, service_role;
