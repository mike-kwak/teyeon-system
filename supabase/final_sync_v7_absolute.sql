-- [RPC ABSOLUTE] final_sync_v7_absolute (v7.0)
-- 12번의 실패를 끝내기 위해 기존의 모든 관련 함수들을 박멸하고 재시공합니다.

-- 1. 기존 유령 함수들 완전 박멸 (오염된 스키마 정적 삭제)
DROP FUNCTION IF EXISTS public.update_match_status_v1(uuid, text, int);
DROP FUNCTION IF EXISTS public.update_match_status_v2(text, text, int);
DROP FUNCTION IF EXISTS public.update_match_status_v3(text, text, int);
DROP FUNCTION IF EXISTS public.final_match_sync_v4(text, text, text, text);
DROP FUNCTION IF EXISTS public.final_sync_v5_stable(text, text, text, text);
DROP FUNCTION IF EXISTS public.final_sync_v6_json(jsonb);
DROP FUNCTION IF EXISTS public.final_sync_v6_json(jsonb, text);

-- 2. 절대적 동기화 함수 생성 (단일 JSONB 인자)
CREATE OR REPLACE FUNCTION public.final_sync_v7_absolute(
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
    -- JSON 파싱 (래핑 없는 순수 객체 매핑)
    v_match_id := p_data->>'match_id';
    v_score1 := COALESCE((p_data->>'score1')::INTEGER, 0);
    v_score2 := COALESCE((p_data->>'score2')::INTEGER, 0);
    v_status := p_data->>'status';

    -- 테이블 업데이트
    UPDATE public.matches
    SET 
        status = v_status,
        score1 = v_score1,
        score2 = v_score2,
        updated_at = NOW()
    WHERE id = v_match_id;
END;
$$;

-- 3. 권한 및 소유권 절대적 동기화
ALTER FUNCTION public.final_sync_v7_absolute(JSONB) OWNER TO postgres;
GRANT ALL ON FUNCTION public.final_sync_v7_absolute(JSONB) TO anon;
GRANT ALL ON FUNCTION public.final_sync_v7_absolute(JSONB) TO authenticated;
GRANT ALL ON FUNCTION public.final_sync_v7_absolute(JSONB) TO service_role;
