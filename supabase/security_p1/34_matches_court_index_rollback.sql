-- =============================================================================
-- KDK 34 rollback — 34 가 만든 matches_playing_court_uniq 만 삭제   [승인 후에만 실행]
--   · 이 이름의 index 만 지운다(다른 이름의 기존 index 는 건드리지 않음). 데이터 무변경. 재실행 안전.
--   · 삭제 후에는 start_kdk_match 의 세션 잠금만 코트 중복을 막는다(직접 UPDATE 경로는 보호 없음).
-- =============================================================================
do $kdk34_rb$
begin
  perform set_config('lock_timeout', '3s', true);
  drop index if exists public.matches_playing_court_uniq;
end
$kdk34_rb$;

select 'KDK34 rollback' as step,
       to_regclass('public.matches_playing_court_uniq') is null as index_removed;   -- true
