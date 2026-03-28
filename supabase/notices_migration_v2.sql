-- TEYEON Notice & Comment System Migration (v2 - Ultra Stable)
-- Run this in Supabase SQL Editor

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Drop existing if it was corrupted (Only if you want to reset)
-- DROP TABLE IF EXISTS public.notice_likes;
-- DROP TABLE IF EXISTS public.notice_comments;
-- DROP TABLE IF EXISTS public.notices;

-- 3. Notices Table (Using v4 UUID)
CREATE TABLE IF NOT EXISTS public.notices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    is_pinned BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    author_id TEXT NOT NULL,
    author_nickname TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Notice Comments Table
CREATE TABLE IF NOT EXISTS public.notice_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notice_id UUID REFERENCES public.notices(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_nickname TEXT,
    author_avatar TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Notice Likes (Tennis Ball 🎾)
CREATE TABLE IF NOT EXISTS public.notice_likes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notice_id UUID REFERENCES public.notices(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    UNIQUE(notice_id, user_id)
);

-- 6. Grant Access (Bypass RLS issues for now to verify)
ALTER TABLE public.notices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_likes DISABLE ROW LEVEL SECURITY;

-- 7. Realtime Setup
-- Remove from publication first to avoid dupes
-- DROP PUBLICATION IF EXISTS supabase_realtime; -- Usually not recommended to drop global pub
-- ALTER PUBLICATION supabase_realtime ADD TABLE notices, notice_comments, notice_likes;
