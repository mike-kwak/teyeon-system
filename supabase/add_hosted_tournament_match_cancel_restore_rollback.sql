-- ============================================================================
--  2026 TEYEON OPEN — 취소 경기 복구 (Batch 3C-2) 롤백
--
--  대상: supabase/add_hosted_tournament_match_cancel_restore.sql
--
--  이 follow-up 은 함수 1개만 추가했으므로 롤백도 그 함수 1개 제거로 끝난다.
--
--  ⚠ 건드리지 않는 것
--      hosted_tournament_matches 테이블과 그 안의 경기 결과   (Batch 3A)
--      hosted_tournament_group_tie_resolutions / 순위 RPC     (Batch 3B)
--      hosted_tournament_groups / _group_members              (Batch 2)
--      hosted_tournament_teams / _courts / _events            (Batch 1)
--      hosted_tournament_registrations / _history             (접수 원장)
--      기존 lifecycle RPC · RLS · GRANT
--
--  ⚠ 이미 복구된 경기(CANCELLED → WAITING) 를 되돌리지 않는다.
--    이 스크립트는 '앞으로 복구할 수 없게' 만들 뿐, 지난 복구 이력은 그대로다.
--    events 에 남은 match_cancel_restored 기록도 보존된다.
-- ============================================================================

begin;

drop function if exists public.restore_cancelled_match(uuid, text, integer);

commit;
