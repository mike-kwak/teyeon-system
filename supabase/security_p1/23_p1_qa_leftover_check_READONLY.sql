-- =============================================================================
-- P1 QA 잔여물 확인 — 읽기 전용 · SELECT 1개. 22_p1_qa_rollback_only.sql 실행 전·후 같은 값이어야 한다.
--   QA 테스트 경기 0 · QA 원장/이력 0 · 원장/이력 전체 행 수 = QA 실행 메시지의 "실행 전" 값
-- =============================================================================
select
  (select count(*) from public.matches where club_id::text = 'QA-P1-ROLLBACK-CLUB' or session_id::text like 'QA-P1-ROLLBACK-%') as qa_matches_left,      -- 0
  (select count(*) from public.kdk_match_results r
     where not exists (select 1 from public.matches m where m.id::text = r.match_id) and r.session_id like 'QA-P1-ROLLBACK-%') as qa_ledger_left,  -- 0
  (select count(*) from public.kdk_match_score_history h where h.session_id like 'QA-P1-ROLLBACK-%') as qa_history_left,                          -- 0
  (select count(*) from public.kdk_match_results) as ledger_total,      -- QA 메시지의 "실행 전 원장" 과 같아야 함(그 사이 실제 경기 입력이 없을 때)
  (select count(*) from public.kdk_match_score_history) as history_total;
