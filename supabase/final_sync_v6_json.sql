-- [RPC INFRA_FORCE] final_sync_v6_json (v6.5)
-- 스키마 캐시 지연을 강제로 깨트리기 위해 p_dummy 파라미터를 추가했습니다.

-- 1. 함수 생성 (p_dummy 추가로 스키마 강제 갱신 유도)
CREATE OR REPLACE FUNCTION public.final_sync_v6_json(
    p_data JSONB,
    p_dummy TEXT DEFAULT ''
)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_match_id TEXT;
    v_score1 INTEGER;
    v_score2 INTEGER;
    v_status TEXT;
BEGIN
    -- JSON 파싱 (SDK를 우회해도 값은 안전하게 추출됨)
    v_match_id := p_data->>'match_id';
    v_score1 := COALESCE((p_data->>'score1')::INTEGER, 0);
    v_score2 := COALESCE((p_data->>'score2')::INTEGER, 0);
    v_status := p_data->>'status';

    -- 실제 테이블 업데이트 (물리적 반영 확인)
    UPDATE public.matches
    SET 
        status = v_status,
        score1 = v_score1,
        score2 = v_score2,
        updated_at = NOW()
    WHERE id = v_match_id;
END;
$$;

-- 2. 권한 및 소유권 강제 주입 (권한 문제 0% 시도)
ALTER FUNCTION public.final_sync_v6_json(JSONB, TEXT) OWNER TO postgres;
GRANT ALL ON FUNCTION public.final_sync_v6_json(JSONB, TEXT) TO anon;
GRANT ALL ON FUNCTION public.final_sync_v6_json(JSONB, TEXT) TO authenticated;
GRANT ALL ON FUNCTION public.final_sync_v6_json(JSONB, TEXT) TO service_role;
