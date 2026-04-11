-- [RPC JSON_ULTIMATE] final_sync_v6_json (v6.0)
-- 인자 개수 및 타입 매칭 오류를 원천 차단하기 위해 단일 JSONB 파라미터를 사용합니다.

-- 1. 함수 생성 (SECURITY DEFINER로 모든 데이터베이스 장벽을 넘음)
CREATE OR REPLACE FUNCTION public.final_sync_v6_json(
    p_data JSONB
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
    -- JSON 파싱 및 안전한 형변환
    v_match_id := p_data->>'match_id';
    v_score1 := COALESCE((p_data->>'score1')::INTEGER, 0);
    v_score2 := COALESCE((p_data->>'score2')::INTEGER, 0);
    v_status := p_data->>'status';

    -- 실제 테이블 업데이트 (어떠한 시그니처 오류도 허용하지 않음)
    UPDATE public.matches
    SET 
        status = v_status,
        score1 = v_score1,
        score2 = v_score2,
        updated_at = NOW()
    WHERE id = v_match_id;
END;
$$;

-- 2. 권한 강제 개방 (익명, 인증, 서비스 역할 모두 허용)
GRANT EXECUTE ON FUNCTION public.final_sync_v6_json(JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.final_sync_v6_json(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.final_sync_v6_json(JSONB) TO service_role;
