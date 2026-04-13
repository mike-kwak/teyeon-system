-- =========================================================================
-- [긴급 패치] 게스트 라이브 관전 및 화면 실시간 동기화 완전 활성화 SQL
-- =========================================================================

-- 1. [핵심] matches 테이블을 Realtime(실시간 동기화) 채널로 발송하도록 허용합니다.
-- supabase_realtime 퍼블리케이션이 없으면 만들고, 있으면 matches 테이블을 추가합니다.
BEGIN;
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND tablename = 'matches'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE matches;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 만약 publication 자체가 없다면 생성 후 추가합니다.
    CREATE PUBLICATION supabase_realtime FOR TABLE matches;
  END $$;
COMMIT;


-- 2. 게스트(로그인하지 않은 유저 포함)도 라이브 코트를 볼 수 있도록 읽기 권한(SELECT)을 완전 개방합니다.
-- (RLS 정책 중 'SELECT'를 모든 사람에게 허용)
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "게스트 포함 누구나 라이브 코트 시청 가능" ON public.matches;

CREATE POLICY "게스트 포함 누구나 라이브 코트 시청 가능" 
ON public.matches
FOR SELECT 
USING (true); -- 조건 없이 무조건 읽기 허용


-- 3. 혹시나 진행 중인 세션 데이터 묶음인 app_config 테이블 등이 막혀있을 수 있으므로 안전차원에서 개방
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "누구나 환경 설정 읽기 가능" ON public.app_config;
CREATE POLICY "누구나 환경 설정 읽기 가능" 
ON public.app_config
FOR SELECT
USING (true);

-- 완료 메시지
-- 오른쪽 아래 'Success' 메시지가 떴다면 브라우저를 모두 새로고침해 주세요!
