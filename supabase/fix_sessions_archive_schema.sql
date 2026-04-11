-- [SCHEMA FIX] sessions_archive 테이블 컬럼 강제 생성 및 일치화
-- 민섭 CEO님, 아래 스크립트를 Supabase SQL Editor에서 실행하시면 아카이브 저장 에러가 해결됩니다.

-- 1. match_snapshot (JSONB): 전체 경기 기록 저장용
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS match_snapshot JSONB DEFAULT '[]'::jsonb;

-- 2. player_metadata (JSONB): 참가자 설정 및 개인 지표 저장용
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS player_metadata JSONB DEFAULT '{}'::jsonb;

-- 3. total_matches (INT): 총 경기 수
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS total_matches INT DEFAULT 0;

-- 4. total_rounds (INT): 총 라운드 수
ALTER TABLE public.sessions_archive 
ADD COLUMN IF NOT EXISTS total_rounds INT DEFAULT 0;

-- [참고] 컬럼 추가 후 RPC 함수(finalize_tournament)가 이 컬럼들을 정상적으로 참조하게 됩니다.
COMMENT ON COLUMN public.sessions_archive.match_snapshot IS 'Full matches snapshot for the session';
COMMENT ON COLUMN public.sessions_archive.player_metadata IS 'Attendee configurations and metadata';
