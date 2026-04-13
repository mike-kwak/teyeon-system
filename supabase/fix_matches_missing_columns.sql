-- ==============================================================================
-- [긴급 패치] DB 컬럼 누락으로 인한 조용한 '대진표 증발 버그' 해결 스크립트
-- ==============================================================================

-- 대진 생성(generateKDK) 시 프론트엔드가 DB에 다음 컬럼들을 넣으려 시도하지만, 
-- 만약 단 하나라도 테이블에 없으면 DB 구조 에러가 내부적으로 발생하여 저장을 거부합니다.
-- 이 스크립트는 누락된 열이 있다면 즉시 만들어줍니다.

BEGIN;

DO $$ 
BEGIN
    -- 1. session_id (필수)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'session_id') THEN
        ALTER TABLE public.matches ADD COLUMN session_id TEXT;
    END IF;

    -- 2. session_title (대회명)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'session_title') THEN
        ALTER TABLE public.matches ADD COLUMN session_title TEXT;
    END IF;

    -- 3. mode (MBTI, 랜덤, YB/OB 모드 구분 등)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'mode') THEN
        ALTER TABLE public.matches ADD COLUMN mode TEXT;
    END IF;

    -- 4. group_name (A조, B조)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'group_name') THEN
        ALTER TABLE public.matches ADD COLUMN group_name TEXT;
    END IF;

    -- 5. player_names (이름 배열 보관 캐시)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'matches' AND column_name = 'player_names') THEN
        ALTER TABLE public.matches ADD COLUMN player_names TEXT[];
    END IF;

    -- 6. player_ids 타입 체크 (ARRAY로 들어오는지 텍스트로 들어오는지)
    -- 만약 JSON이나 다른 형태로 꼬여있으면 문제가 될 수 있지만, 현재 시스템은 TEXT[] 사용.
END $$;
COMMIT;

-- 완료 메시지
-- 오른쪽 아래 'Success' 메시지가 떴다면 이제 다시 [대진 생성]을 눌러보세요!
