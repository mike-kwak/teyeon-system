-- [FIX] finalize_tournament RPC: 중복 함수 오류 해결 버전

-- 1. 기존에 존재할 수 있는 동일한 시그니처의 함수 삭제
-- (PostgreSQL의 함수 오버로딩으로 인한 'not unique' 에러 방지)
DROP FUNCTION IF EXISTS public.finalize_tournament(TEXT, TEXT, DATE, JSONB, JSONB, INTEGER, INTEGER, JSONB);

-- 2. 아카이브 저장 함수 생성
CREATE OR REPLACE FUNCTION public.finalize_tournament(
    p_session_id TEXT,
    p_title TEXT,
    p_date DATE,
    p_ranking_data JSONB,
    p_player_metadata JSONB,
    p_total_matches INTEGER,
    p_total_rounds INTEGER,
    p_match_snapshot JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.sessions_archive (
        id, 
        title, 
        date, 
        ranking_data, 
        player_metadata, 
        total_matches, 
        total_rounds,
        match_snapshot
    )
    VALUES (
        p_session_id,
        p_title,
        p_date,
        p_ranking_data,
        p_player_metadata,
        p_total_matches,
        p_total_rounds,
        p_match_snapshot
    )
    ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        date = EXCLUDED.date,
        ranking_data = EXCLUDED.ranking_data,
        player_metadata = EXCLUDED.player_metadata,
        total_matches = EXCLUDED.total_matches,
        total_rounds = EXCLUDED.total_rounds,
        match_snapshot = EXCLUDED.match_snapshot;
END;
$$;

-- 3. 권한 부여 (매개변수 형식을 명시하여 'not unique' 오류 해결)
GRANT EXECUTE ON FUNCTION public.finalize_tournament(TEXT, TEXT, DATE, JSONB, JSONB, INTEGER, INTEGER, JSONB) TO anon, authenticated, service_role;
