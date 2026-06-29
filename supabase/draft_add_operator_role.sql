-- =============================================================================
-- TEYEON — profiles.role 에 'OPERATOR'(운영진 공통 보안 Role) 추가 (설계 초안)
--
-- 상태(STATUS):
--   * DRAFT ONLY — DO NOT APPLY. 승인 전 운영 DB 실행 금지.
--   * 운영 DB 미적용 — 이 스크립트는 운영 Supabase 에서 실행된 적 없음.
--   * 코드 선배포 이후 별도 승인 필요 — AuthContext.VALID_ROLES 에 'OPERATOR' 배포 후에만 적용.
--   * 비파괴 — 신규 Role 값 허용 + 지정 계정 데이터 보정만. 스키마/테이블 구조 변경 없음.
--   * 지정 계정만 OPERATOR 배정 — 이메일/UID 명시. 클럽 직책(members.role) 자동 매핑 금지.
--   * CEO·ADMIN 강등 금지 — STEP 3 WHERE 에 role not in ('CEO','ADMIN') 안전장치 포함.
--   * rollback 전 기존 Role 기록 필요 — STEP 1 에서 prior role 을 반드시 캡처(rollback 원복용).
--       운영진 보안 판정은 오직 profiles.role='OPERATOR' (인증과 연결된 앱 보안 Role).
--   * rollback: supabase/draft_add_operator_role_rollback.sql
--
-- 적용 순서(권장):
--   (0) 코드 배포 선행: AuthContext.VALID_ROLES 에 'OPERATOR' 포함(미포함 시 OPERATOR→GUEST 강등).
--   (1) STEP 1 진단 → CHECK 제약 유무 확인
--   (2) STEP 2 (제약이 있을 때만) 제약에 'OPERATOR' 추가
--   (3) STEP 3 지정 계정만 OPERATOR 배정(이메일/UID 명시. 클럽 직책 기준 자동 배정 금지)
--   (4) STEP 4 검증
-- =============================================================================

-- ── STEP 1. 진단 (SELECT 만, 안전) ────────────────────────────────────────────
--   결과에 role 관련 CHECK 제약(def 에 'CEO'/'ADMIN' 등 role IN (...))이 있으면 STEP 2 필요.
--   결과가 비어 있으면(= profiles.role 이 자유 text) STEP 2 건너뜀.
select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid = 'public.profiles'::regclass
   and contype = 'c';

-- 참고: 현재 OPERATOR 로 바꿀 대상 후보를 미리 확인(배정 전 prior role 기록 → rollback 대비).
--   아래 이메일 목록은 실제 운영진 계정으로 교체.
-- select id, email, role
--   from public.profiles
--  where email in ('operator1@example.com', 'operator2@example.com')
--  order by email;

-- ── STEP 2. (제약이 있을 때만) CHECK 제약에 'OPERATOR' 추가 ────────────────────
--   STEP 1 에서 나온 실제 제약 이름으로 교체. 제약이 없으면 이 블록 전체 건너뜀.
--   (FINANCE_MANAGER 호환을 위해 add_finance_v2_security_hardening.sql 와 동일한 집합 + OPERATOR.)
--
-- alter table public.profiles
--   drop constraint if exists profiles_role_check;
-- alter table public.profiles
--   add constraint profiles_role_check
--   check (role in ('CEO','ADMIN','OPERATOR','FINANCE_MANAGER','MEMBER','GUEST'));

-- ── STEP 3. 지정 계정만 OPERATOR 배정 (수동·명시적) ────────────────────────────
--   ⚠️ 클럽 직책(members.role)으로 자동 배정하지 말 것. 운영진 본인 계정 이메일/UID 를 명시.
--   ⚠️ 실행 전 STEP 1 의 prior role 을 반드시 기록(rollback 시 원복용).
--   ⚠️ CEO/ADMIN 계정을 OPERATOR 로 덮어쓰지 않도록 WHERE 에 role 안전장치 포함.
--
-- update public.profiles
--    set role = 'OPERATOR'
--  where email in ('operator1@example.com', 'operator2@example.com')
--    and role not in ('CEO','ADMIN');   -- 기존 관리자 강등 방지

-- ── STEP 4. 검증 ──────────────────────────────────────────────────────────────
-- select email, role from public.profiles where role = 'OPERATOR' order by email;
-- -- 기대: 지정한 운영진 계정만 OPERATOR. CEO/ADMIN/FINANCE_MANAGER 영향 없음.
-- =============================================================================
