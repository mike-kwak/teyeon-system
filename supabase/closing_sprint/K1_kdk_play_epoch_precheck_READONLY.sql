-- [CLOSING SPRINT K1] 적용 전 점검 — 조회 전용 단일 SELECT(쓰기 · 잠금 · set_config 없음). 결과 1개 표, 건수 · 판정만(개인정보 없음).
--   판정 기준
--     P01 matches 존재                                  → OK 여야 함
--     P02 play_epoch 열                                 → ABSENT(첫 적용) 또는 OK_INT_NOTNULL(재실행). 그 외 STOP
--     P03 kdk_play_epoch_trg 뒤에 실행되는 BEFORE trigger → 0 이어야 함(있으면 STOP)
--     P04 P1 score guard trigger 활성                    → OK(K1 은 guard 없이도 동작하지만 운영 기준 확인)
--     P05 진행 중(playing) 경기 수                       → 0 권장. 1 이상이면 정모 중 — 적용을 경기 없는 시간으로 미룬다
--     P06 matches 행 수(참고: 상수 DEFAULT 라 행 수와 무관하게 즉시 적용)
--     P07 matches 에 걸린 다른 세션의 잠금 수            → 0 권장(있으면 lock_timeout 3s 로 실패 · 무변경)
select 'P01' as k, 'matches 존재' as item, case when to_regclass('public.matches') is not null then 'OK' else 'STOP' end as result
union all
select 'P02', 'play_epoch 열',
  coalesce((select case when data_type = 'integer' and is_nullable = 'NO' then 'OK_INT_NOTNULL(재실행)' else 'STOP(' || data_type || ',' || is_nullable || ')' end
              from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'play_epoch'), 'ABSENT(첫 적용)')
union all
select 'P03', 'K1 뒤 BEFORE trigger',
  coalesce((select 'STOP(' || string_agg(tgname, ',') || ')' from pg_trigger
             where tgrelid = 'public.matches'::regclass and not tgisinternal and (tgtype & 2) = 2 and tgname > 'kdk_play_epoch_trg'), 'OK(0)')
union all
select 'P04', 'P1 score guard trigger',
  case when exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'kdk_p1_score_guard_trg' and tgenabled <> 'D') then 'OK' else 'INFO(없음)' end
union all
select 'P05', '진행 중 경기 수', (select count(*)::text from public.matches where status = 'playing')
union all
select 'P06', 'matches 행 수', (select count(*)::text from public.matches)
union all
select 'P07', '다른 세션의 matches 잠금 수',
  (select count(*)::text from pg_locks l where l.relation = 'public.matches'::regclass and l.pid <> pg_backend_pid());
