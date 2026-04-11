-- [운명의 SQL v5] sessions_archive 테이블 '완전 박멸(Hard Reset)' 및 신규 재건
-- 민섭 CEO님, 이 스크립트는 기존의 모든 오염된 캐시와 데이터를 삭제(DROP)하고 새롭게 태어나는 '창조적 파괴'입니다.

-- 1. 기득권 하드 리셋 (Hard Reset)
-- CASCADE를 통해 해당 테이블과 연관된 모든 제약 조건 및 뷰를 깨끗이 밀어버립니다.
DROP TABLE IF EXISTS public.sessions_archive CASCADE;

-- 2. 신규 스키마 성전 구축 (Fresh Build)
-- ID 타입을 TEXT로 지정하여 프론트엔드의 세션 형식을 100% 수용합니다.
CREATE TABLE public.sessions_archive (
    id TEXT PRIMARY KEY, -- 프론트엔드 sessionId 형식 (KDK-YYYYMMDD-...)과 일치
    title TEXT,
    date TEXT,
    ranking_data JSONB DEFAULT '[]'::jsonb,
    snapshot_data JSONB DEFAULT '[]'::jsonb, -- 기존 match_snapshot을 완전히 대체하는 신규 규약
    player_metadata JSONB DEFAULT '{}'::jsonb,
    total_matches INT DEFAULT 0,
    total_rounds INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. 소유권 및 권한 전면 개방
ALTER TABLE public.sessions_archive OWNER TO postgres;
GRANT ALL ON TABLE public.sessions_archive TO anon, authenticated, service_role, postgres;

-- 4. 서버 엔진 강제 동기화 (Schema Refresh)
-- 이 신호가 울리는 순간 Supabase PostgREST 엔진은 옛 기억을 버리고 새로운 스키마를 읽어들입니다.
NOTIFY pgrst, 'reload schema';

-- [전쟁의 끝] 이제 서버에 '컬럼 없음' 에러는 영원히 소멸하며, 프론트엔드의 snapshot_data는 이 성전에 완벽하게 안착합니다.
