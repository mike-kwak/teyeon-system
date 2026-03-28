-- TEYEON Notice & Comment System Migration
-- Run this in Supabase SQL Editor

-- 1. Notices Table
CREATE TABLE IF NOT EXISTS public.notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    is_pinned BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    author_id TEXT NOT NULL,
    author_nickname TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Notice Comments Table
CREATE TABLE IF NOT EXISTS public.notice_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notice_id UUID REFERENCES notices(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    author_nickname TEXT,
    author_avatar TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Notice Likes (Tennis Ball 🎾)
CREATE TABLE IF NOT EXISTS public.notice_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notice_id UUID REFERENCES notices(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    UNIQUE(notice_id, user_id)
);

-- 4. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notices;
ALTER PUBLICATION supabase_realtime ADD TABLE notice_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE notice_likes;

-- 5. RLS Policies (Basic)
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notice_likes ENABLE ROW LEVEL SECURITY;

-- Allow everyone to read
CREATE POLICY "Public Read Notices" ON public.notices FOR SELECT USING (true);
CREATE POLICY "Public Read Comments" ON public.notice_comments FOR SELECT USING (true);
CREATE POLICY "Public Read Likes" ON public.notice_likes FOR SELECT USING (true);

-- Authenticated Users can comment/like
CREATE POLICY "Auth Insert Comments" ON public.notice_comments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth Insert Likes" ON public.notice_likes FOR INSERT WITH CHECK (auth.role() = 'authenticated');
