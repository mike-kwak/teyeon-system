-- TEYEON Member Schema Enhancement (v1.1.0-beta.13)
-- Adds fields for advanced KDK Matchmaking: AGE, MBTI

-- 1. Add missing columns to members
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS mbti TEXT;
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS achievements TEXT;

-- 2. Verify and Cleanup (Optional)
COMMENT ON COLUMN public.members.age IS '나이 (KDK 연령별 대진용)';
COMMENT ON COLUMN public.members.mbti IS 'MBTI (KDK 이벤트 대진용)';
COMMENT ON COLUMN public.members.achievements IS '입상 경력 및 수상 내역 (KDK 입상자 밸런스용)';
