-- [UPGRADE] Archive 'Deep Recap' System (v1.1.0-beta.4)
-- This migration adds the Session Metadata Archive for the 3-tab Detail View.

-- 1. Create sessions_archive table for rank and tournament metadata
CREATE TABLE IF NOT EXISTS public.sessions_archive (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    date DATE NOT NULL,
    ranking_data JSONB, -- SNAPSHOT of final ranking (wins, losses, diff, avatar_url)
    player_metadata JSONB, -- SNAPSHOT of nicknames and configs
    total_matches INTEGER DEFAULT 0,
    total_rounds INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Permissions & Security
GRANT ALL ON TABLE public.sessions_archive TO anon, authenticated, service_role;
ALTER TABLE public.sessions_archive DISABLE ROW LEVEL SECURITY;

-- 3. Ensure matches_archive has court/round columns for re-rendering grid
ALTER TABLE public.matches_archive ADD COLUMN IF NOT EXISTS round INTEGER;
ALTER TABLE public.matches_archive ADD COLUMN IF NOT EXISTS court INTEGER;
ALTER TABLE public.matches_archive ADD COLUMN IF NOT EXISTS player_ids TEXT[];

-- 4. Initial Seed (Demo Session Metadata for 3-tab view)
INSERT INTO public.sessions_archive (id, title, date, ranking_data, player_metadata, total_matches, total_rounds)
VALUES 
('S1', '테연 v2 오픈 기념 정기전', '2026-03-01', '[{"id":"p1","name":"손흥민","wins":3,"losses":0,"diff":18},{"id":"p2","name":"김민재","wins":2,"losses":1,"diff":5}]'::jsonb, '{}'::jsonb, 2, 1),
('DEMO-1', '테연 v2 오픈 기념 정기전', '2026-03-01', '[]'::jsonb, '{}'::jsonb, 3, 1),
('DEMO-2', '3월 둘째주 목요 야간 테니스', '2026-03-12', '[]'::jsonb, '{}'::jsonb, 3, 1),
('DEMO-3', '테연 vs 고대 클럽 교류전', '2026-03-15', '[]'::jsonb, '{}'::jsonb, 3, 1),
('DEMO-4', 'CEO배 스페셜 하이레벨 토너먼트', '2026-03-22', '[]'::jsonb, '{}'::jsonb, 3, 1),
('DEMO-5', '3월 피날레 정기 대진표', '2026-03-28', '[]'::jsonb, '{}'::jsonb, 3, 1)
ON CONFLICT (id) DO NOTHING;
