-- KDK 게스트 출생연도 — 영구 프로필 + 세션 snapshot (공식 동률 '연소자 우위' 계산 전용)
--   ⚠️ 사용자 승인 후 실행. 실행 전까지 앱은 이 테이블들 없이도 기존과 동일하게 동작한다
--   (조회 실패 시 빈 결과 → 게스트는 '미제공 후순위' 경로).
--
--   구조 원칙:
--   · kdk_guest_profiles      = 영구 프로필. 운영자 이름 매칭 화면에서만 조회·수정(재참여 자동 불러오기).
--   · kdk_session_attendee_meta = 세션 확정 시점의 birthYear snapshot. 모바일 /kdk 와
--     공식 라이브 순위 RPC(get_kdk_live_official_ranking)가 이것만 읽어 같은 순위를 계산하고,
--     이후 프로필 수정이 진행 중/과거 세션에 소급되지 않는다.
--     전광판이 영구 프로필을 직접 조회하는 구조 금지.
--   · club scope: profiles 에는 club_id 가 없고, auth 사용자 ↔ 클럽 연결은
--     members.auth_user_id → members.club_id 가 유일한 경로(운영진 6계정 전원 연결 확인, 2026-07-08).
--     RLS 가 역할(CEO/ADMIN/OPERATOR) AND 소속 클럽 일치를 직접 강제한다 —
--     쿼리의 club_id 조건은 성능/명시성일 뿐 보안 경계가 아니다.
--     CEO 전역(모든 클럽) 예외는 설계된 바 없어 두지 않는다(현재 단일 클럽 — 동작 동일, 확장 시 안전).
--   · 개인정보: birth_year 는 순위 결정 목적 한정, 공개 화면/공개 RPC 비노출, anon·일반 회원 차단.

-- ── club-scope 보안 helper ────────────────────────────────────────────────────
--   현재 사용자가 회원으로 연결된 club_id 목록. SECURITY DEFINER 로 선언해
--   향후 members RLS 를 잠가도 정책 평가가 깨지지 않는다(미래-안전).
--   안전 조건: 고정 search_path · schema-qualified 테이블 · 파라미터 없음 · 동적 SQL 없음
--   · PUBLIC/anon EXECUTE revoke(authenticated 만). recursion 없음(members 만 참조).
CREATE OR REPLACE FUNCTION public.current_user_club_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT m.club_id), '{}'::uuid[])
  FROM public.members m
  WHERE m.auth_user_id = auth.uid()
    AND m.club_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.current_user_club_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_club_ids() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_club_ids() TO authenticated;

-- ── 공통 club-scope 조건(각 정책에 적용) ──────────────────────────────────────
--   role 검사 AND row.club_id = ANY(current_user_club_ids())
--   UPDATE 는 USING(기존 row)과 WITH CHECK(변경 후 row) 양쪽에 적용
--   → 다른 클럽 row 조회/수정 불가 + club_id 를 타 클럽으로 바꾸는 것도 불가.
--   CEO 도 club scope 적용(전역 예외 없음 — 설계 미존재, 현재 단일 클럽).

-- ═══════════════════════════ 1) 영구 게스트 프로필 ═══════════════════════════
CREATE TABLE IF NOT EXISTS public.kdk_guest_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id uuid NOT NULL,
    guest_key text NOT NULL,            -- 기존 stable id: manual-guest-<정규화이름> (재작성 없음)
    display_name text NOT NULL,
    normalized_name text NOT NULL,      -- 기존 normalizeManualName 규칙(공백 제거·소문자)
    birth_year integer,                 -- 4자리 출생연도. 미상 null. 나이 숫자 저장 금지.
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),  -- service 가 명시 갱신(trigger 배제)
    created_by uuid DEFAULT auth.uid(),
    updated_by uuid,
    CONSTRAINT kdk_guest_profiles_club_guest_key_unique UNIQUE (club_id, guest_key),
    -- DB CHECK 는 극단값 방지선(1900~2100). '현재 연도 이하' 상한은 service/normalizeBirthYear 가
    -- 담당(연도가 바뀌어도 스키마 수정 불필요). 쓰기 자체가 RLS 로 클럽 운영진에 한정되므로
    -- 운영진이 API 를 직접 호출해 2090 을 넣는 내부자 케이스만 남고, 그 값도 normalizeBirthYear 가
    -- 읽기 시 null 처리해 순위에 영향을 주지 못한다(이중 방어) → MVP 는 A안(CHECK 유지) 채택.
    CONSTRAINT kdk_guest_profiles_birth_year_range CHECK (birth_year IS NULL OR (birth_year >= 1900 AND birth_year <= 2100))
);
COMMENT ON TABLE public.kdk_guest_profiles IS 'KDK 게스트 출생연도(영구) — 이름 매칭 화면 전용, 공개 비노출';
CREATE INDEX IF NOT EXISTS kdk_guest_profiles_club_id_idx ON public.kdk_guest_profiles (club_id);
CREATE INDEX IF NOT EXISTS kdk_guest_profiles_normalized_name_idx ON public.kdk_guest_profiles (club_id, normalized_name);

ALTER TABLE public.kdk_guest_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kdk_guest_profiles_select ON public.kdk_guest_profiles;
CREATE POLICY kdk_guest_profiles_select ON public.kdk_guest_profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS kdk_guest_profiles_insert ON public.kdk_guest_profiles;
CREATE POLICY kdk_guest_profiles_insert ON public.kdk_guest_profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS kdk_guest_profiles_update ON public.kdk_guest_profiles;
CREATE POLICY kdk_guest_profiles_update ON public.kdk_guest_profiles
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS kdk_guest_profiles_delete ON public.kdk_guest_profiles;
CREATE POLICY kdk_guest_profiles_delete ON public.kdk_guest_profiles
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN'))
        AND club_id = ANY(public.current_user_club_ids())
    );

-- ═══════════════════ 2) 세션 참가자 birthYear snapshot ═══════════════════════
--   세션 생성(이름 매칭 확정) 시점의 게스트 출생연도를 박제 — 모바일/공식 순위 RPC/다른 운영자
--   기기가 이것만 읽어 동일 순위를 계산한다. kdk_session_meta 는 anon 공개 조회가 열려 있어
--   개인정보(birth_year)를 실을 수 없으므로 별도 운영진 전용 테이블로 분리한다.
CREATE TABLE IF NOT EXISTS public.kdk_session_attendee_meta (
    session_id text PRIMARY KEY,
    club_id uuid NOT NULL,
    -- { "<playerId>": { "birthYear": 1995 } } — 제공된 게스트만. 회원은 members."나이" 로 해석.
    attendee_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid DEFAULT auth.uid()
);
COMMENT ON TABLE public.kdk_session_attendee_meta IS 'KDK 세션별 게스트 birthYear snapshot — 운영진 전용, 프로필 수정 소급 방지';
CREATE INDEX IF NOT EXISTS kdk_session_attendee_meta_club_idx ON public.kdk_session_attendee_meta (club_id);

ALTER TABLE public.kdk_session_attendee_meta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kdk_session_attendee_meta_select ON public.kdk_session_attendee_meta;
CREATE POLICY kdk_session_attendee_meta_select ON public.kdk_session_attendee_meta
    FOR SELECT TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS kdk_session_attendee_meta_insert ON public.kdk_session_attendee_meta;
CREATE POLICY kdk_session_attendee_meta_insert ON public.kdk_session_attendee_meta
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS kdk_session_attendee_meta_update ON public.kdk_session_attendee_meta;
CREATE POLICY kdk_session_attendee_meta_update ON public.kdk_session_attendee_meta
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN','OPERATOR'))
        AND club_id = ANY(public.current_user_club_ids())
    );

DROP POLICY IF EXISTS kdk_session_attendee_meta_delete ON public.kdk_session_attendee_meta;
CREATE POLICY kdk_session_attendee_meta_delete ON public.kdk_session_attendee_meta
    FOR DELETE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('CEO','ADMIN'))
        AND club_id = ANY(public.current_user_club_ids())
    );

-- 공개 RPC(get_public_kdk_session / get_public_guest_pass*)는 두 테이블을 참조하지 않음 — 영향 없음.
-- 공식 라이브 순위 RPC 는 add_kdk_live_official_ranking.sql 에서 별도 생성(이 파일 이후 실행).
NOTIFY pgrst, 'reload schema';
