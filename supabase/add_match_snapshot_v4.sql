-- [SCHEMA UPDATE] Add match_snapshot to sessions_archive for Deep Recap
-- This column will store the full array of matches from the live session.

ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS match_snapshot JSONB;

-- Comment for documentation
COMMENT ON COLUMN public.sessions_archive.match_snapshot IS 'JSON array of matches from the live tournament for re-rendering Atmosphere Replay.';
