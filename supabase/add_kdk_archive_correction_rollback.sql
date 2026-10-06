-- ────────────────────────────────────────────────────────────────────────────
-- Rollback — KDK 공식 기록 정정 (add_kdk_archive_correction.sql)
--
-- ⚠️ 데이터 손실 경고:
--    kdk_archive_corrections 를 DROP 하면 **정정 이력과 before_raw_data(pre-image)가
--    전부 사라진다.** 이미 정정을 수행한 환경에서는 반드시 먼저 백업한다:
--      create table _bak_kdk_archive_corrections as table public.kdk_archive_corrections;
--
-- ⚠️ 이 rollback 은 이미 정정된 Archive 의 raw_data 를 **되돌리지 않는다.**
--    raw_data 복구가 필요하면 kdk_archive_corrections.before_raw_data 를 보고
--    운영자가 별도로 판단해 처리한다(자동 복구 없음 — 의도된 설계).
--
-- 제거 후 앱 동작: 정정 RPC 부재를 감지해 정정 버튼이 '준비 중'으로 비활성된다.
--    기존 Archive 조회 · 공식 확정/해제 · Finance 연동에는 영향이 없다.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists public.correct_kdk_archive_match_score(
  text, text, integer, integer, text, text, jsonb, jsonb);

drop function if exists public.get_kdk_archive_correction_context(text);

-- 이력 테이블 제거는 기본적으로 주석 처리해 둔다 — 실수로 감사 로그를 날리지 않도록.
-- 정말 제거해야 할 때만 아래 두 줄의 주석을 푼다(위 백업 안내 확인 후).
-- drop index if exists public.kdk_archive_corrections_match_idx;
-- drop index if exists public.kdk_archive_corrections_archive_idx;
-- drop table if exists public.kdk_archive_corrections;

-- notify pgrst, 'reload schema';
