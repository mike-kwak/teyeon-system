-- ────────────────────────────────────────────────────────────────────────────
-- TEYEON Finance ↔ KDK 공식 기록 벌금 연동 (1차)
--
-- 목적: 공식·비테스트 KDK 세션의 settlement_data 스냅샷에 박제된 벌금을
--       운영진 확인(반자동) 후 finance_dues_receivables 에 receivable_type='penalty'
--       로 등록할 때, "어느 KDK 세션에서 온 벌금인지" 를 기록하고 중복 등록을 막는다.
--
-- 설계 결정:
--   1) finance_dues_receivables 에 KDK 연결 컬럼이 없으므로 최소 확장 — related_kdk_session_id
--      한 컬럼만 추가한다. 범용 source_type/source_id 구조는 도입하지 않는다(현재 출처는 KDK 뿐).
--   2) 값은 teyeon_archive_v1.id (KDK 공식 기록 세션 id). 과거 로컬/비정형 id 가능성을 감안해
--      FK 를 걸지 않고 text 로 둔다(기존 finance_receivables.kdk_archive_id 관례와 동일).
--   3) target_month 은 NULL 로 저장한다(application). 월별 회비 대시보드/공개 공지는
--      target_month 키로 월회비만 집계하므로, NULL 인 벌금은 월회비 KPI 에 절대 섞이지 않는다.
--      target_year 는 KDK 진행 연도로 저장해 회원 연도별 조회/본인 RPC 에서 정상 노출된다.
--
-- 중복 방지: (related_kdk_session_id, member_id) 한 쌍당 penalty 1건. partial unique index
--   로 DB 차원 방어. application 단에서도 사전 조회로 중복 INSERT 를 막는다(2중 방어).
--
-- ⚠️ 자동 실행 금지. Supabase SQL Editor 에서 1회 실행. idempotent — 재실행 안전.
-- ⚠️ 이 마이그레이션을 적용하기 전에는 KDK 벌금 등록 기능이 동작하지 않는다(컬럼 부재).
-- ────────────────────────────────────────────────────────────────────────────

alter table public.finance_dues_receivables
  add column if not exists related_kdk_session_id text;

comment on column public.finance_dues_receivables.related_kdk_session_id is
  'KDK 공식 기록 세션 id (teyeon_archive_v1.id). 이 청구가 어느 KDK 벌금에서 자동 생성됐는지 출처. 수동 등록 벌금은 NULL.';

-- 같은 KDK 세션 · 같은 회원 · penalty 중복 등록 방지.
-- 다른 KDK 세션의 벌금 / 다른 수동 벌금(related_kdk_session_id IS NULL)은 영향 없음.
create unique index if not exists finance_dues_receivables_kdk_penalty_uniq
  on public.finance_dues_receivables(related_kdk_session_id, member_id)
  where receivable_type = 'penalty' and related_kdk_session_id is not null;

-- 세션별 등록 현황 조회용(미리보기에서 "등록 완료" 판정).
create index if not exists finance_dues_receivables_kdk_session_idx
  on public.finance_dues_receivables(related_kdk_session_id)
  where related_kdk_session_id is not null;
