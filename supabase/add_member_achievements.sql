-- 회원 프로필 확장 + 대회 입상 기록 테이블
--   (관리자 설정 > 멤버 관리 — 프로필 편집 · 입상 기록 관리 기능)
--   ⚠️ 사용자 승인 후 실행. 실행 전까지 앱은 이 테이블 없이도 동작한다
--   (조회는 빈 목록, 관리자 입상 기록 저장 시 안내 메시지).

-- 1) 한 줄 소개 — /members 카드와 PlayerCardModal 은 이미 member.bio 를 읽도록
--    구현되어 있으나 컬럼이 없어 항상 비어 있었다. 컬럼만 추가하면 즉시 표시된다.
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS bio TEXT;
COMMENT ON COLUMN public.members.bio IS '한 줄 소개 (멤버 카드/플레이어 카드 노출, 관리자 입력)';

-- 2) 대회 입상 기록 — 운영진이 확인 후 등록하는 TEYEON 공식 외부 대회 성과.
--    TENNIS LOG(개인 회고/레슨일지)와 완전히 별개이며 자동 연동하지 않는다.
--    members.achievements(TEXT) 는 목록 카드용 요약 문구로 유지(레거시 호환).
CREATE TABLE IF NOT EXISTS public.member_achievements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    tournament_name text NOT NULL,
    tournament_date date,                       -- 미상 허용
    result text NOT NULL,                       -- 우승/준우승/공동 3위/4강/8강/16강/본선 진출/직접 입력
    division text,                              -- 참가 부서 (예: 신인부, 개나리부)
    partner_name text,
    description text,
    is_featured boolean NOT NULL DEFAULT false, -- 목록 카드 대표 기록
    is_public boolean NOT NULL DEFAULT true,    -- 프로필 공개 여부
    display_order integer,                      -- 수동 정렬(낮을수록 위)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id)
);
COMMENT ON TABLE public.member_achievements IS '운영진 등록 회원 공식 대회 입상 기록 (TENNIS LOG 개인 기록과 무관)';
CREATE INDEX IF NOT EXISTS member_achievements_member_id_idx
    ON public.member_achievements (member_id);
CREATE INDEX IF NOT EXISTS member_achievements_tournament_date_idx
    ON public.member_achievements (tournament_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS member_achievements_is_featured_idx
    ON public.member_achievements (is_featured);
CREATE INDEX IF NOT EXISTS member_achievements_display_order_idx
    ON public.member_achievements (display_order);

-- 3) RLS — 읽기: 로그인 사용자는 공개 기록만, CEO/ADMIN 은 전체.
--          쓰기(INSERT/UPDATE/DELETE): CEO/ADMIN 만.
--    일반 회원은 타인 기록을 수정할 수 없다(§10). profiles.role 이 앱 권한의 원천.
ALTER TABLE public.member_achievements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_achievements_select ON public.member_achievements;
CREATE POLICY member_achievements_select ON public.member_achievements
    FOR SELECT TO authenticated
    USING (
        is_public = true
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('CEO', 'ADMIN')
        )
    );

DROP POLICY IF EXISTS member_achievements_insert ON public.member_achievements;
CREATE POLICY member_achievements_insert ON public.member_achievements
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('CEO', 'ADMIN')
        )
    );

DROP POLICY IF EXISTS member_achievements_update ON public.member_achievements;
CREATE POLICY member_achievements_update ON public.member_achievements
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('CEO', 'ADMIN')
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('CEO', 'ADMIN')
        )
    );

DROP POLICY IF EXISTS member_achievements_delete ON public.member_achievements;
CREATE POLICY member_achievements_delete ON public.member_achievements
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.role IN ('CEO', 'ADMIN')
        )
    );

-- 4) PostgREST 스키마 캐시 갱신 — 적용 즉시 앱에서 새 컬럼/테이블 인식
NOTIFY pgrst, 'reload schema';
