-- [긴급 스키마 동기화] sessions_archive 테이블 컬럼 강제 생성
-- 민섭 CEO님, 아래 명령어를 Supabase SQL Editor에서 실행하여 그릇(Column)을 먼저 마련해 주세요.

-- 1. match_snapshot (JSONB): 전 경기 결과 기록용
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS match_snapshot JSONB DEFAULT '[]'::jsonb;

-- 2. player_metadata (JSONB): 참가자 설정(레이트, 등급 등) 기록용
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS player_metadata JSONB DEFAULT '{}'::jsonb;

-- 3. 통계용 컬럼 (존재 여부 불확실시를 대비해 추가)
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS total_matches INTEGER DEFAULT 0;

ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS total_rounds INTEGER DEFAULT 0;

-- 4. matches 테이블 보정 (매치 실종 방지용 그룹 정보)
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS group_name TEXT;

-- [참고] 이제 Ranking 탭에서 '공식 종료' 시 데이터 유실 없이 저장됩니다.
COMMENT ON COLUMN public.sessions_archive.match_snapshot IS 'Historical snapshot of matches (v7.0 Absolute)';
