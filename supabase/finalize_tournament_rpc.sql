-- [RPC] finalize_tournament: 대회 종료 시 데이터를 아카이브 테이블로 저장하는 함수
-- 이 함수는 세션 요약 정보(`sessions_archive`)를 생성하거나 업데이트합니다.

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

-- 권한 부여
GRANT EXECUTE ON FUNCTION public.finalize_tournament TO anon, authenticated, service_role;
