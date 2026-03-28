-- KDK Tournament & Archive Tables
-- v1.1.0-beta.4

CREATE TABLE IF NOT EXISTS public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id TEXT,
    session_id TEXT,
    session_title TEXT,
    round INTEGER,
    court INTEGER,
    player_ids TEXT[], 
    player_names TEXT[],
    score1 INTEGER DEFAULT 0,
    score2 INTEGER DEFAULT 0,
    status TEXT DEFAULT 'waiting',
    mode TEXT DEFAULT 'KDK',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matches_archive (
    id TEXT PRIMARY KEY, -- deterministic ID (arch-session-round-court)
    session_id TEXT,
    session_title TEXT,
    match_date DATE,
    player_names TEXT[],
    score1 INTEGER,
    score2 INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Bypassing RLS for friction-free simulation
ALTER TABLE public.matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches_archive DISABLE ROW LEVEL SECURITY;
