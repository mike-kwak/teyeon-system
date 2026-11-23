-- [CLOSING SPRINT K1] 적용 후 확인 — 조회 전용 단일 SELECT(쓰기 없음). 결과 1개 표, 건수 · 판정만.
--   V01~V07 은 모두 OK 여야 한다. V08 은 참고(적용 직후 기존 행은 전부 0 — 정상).
select 'V01' as k, 'play_epoch integer NOT NULL DEFAULT 0' as item,
  case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'play_epoch'
                     and data_type = 'integer' and is_nullable = 'NO' and column_default = '0') then 'OK' else 'FAIL' end as result
union all
select 'V02', 'NULL 행 0', case when (select count(*) from public.matches where play_epoch is null) = 0 then 'OK' else 'FAIL' end
union all
select 'V03', 'kdk_play_epoch_trg 활성 · BEFORE INSERT/UPDATE · ROW',
  case when exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'kdk_play_epoch_trg' and tgenabled <> 'D'
                     and (tgtype & 1) = 1 and (tgtype & 2) = 2 and (tgtype & 4) = 4 and (tgtype & 16) = 16) then 'OK' else 'FAIL' end
union all
select 'V04', 'K1 뒤 BEFORE trigger 0',
  case when not exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and not tgisinternal and (tgtype & 2) = 2 and tgname > 'kdk_play_epoch_trg') then 'OK' else 'FAIL' end
union all
select 'V05', 'kdk_play_epoch_guard() SECURITY INVOKER · search_path 고정',
  case when exists (select 1 from pg_proc where oid = to_regprocedure('public.kdk_play_epoch_guard()') and not prosecdef
                     and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') then 'OK' else 'FAIL' end
union all
select 'V06', 'anon/authenticated 가 trigger 함수 직접 실행 불가',
  case when not has_function_privilege('anon', 'public.kdk_play_epoch_guard()', 'execute')
        and not has_function_privilege('authenticated', 'public.kdk_play_epoch_guard()', 'execute') then 'OK' else 'FAIL' end
union all
select 'V07', '기존 trigger 유지(P1 guard · ledger · SPOTLIGHT 3종)',
  case when (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and tgenabled <> 'D' and tgname in
             ('kdk_p1_score_guard_trg', 'kdk_p1_score_ledger_trg', 'kdk_match_lifecycle_insert_trg', 'kdk_match_lifecycle_status_trg', 'kdk_match_lifecycle_recert_trg')) = 5
       then 'OK' else 'CHECK(' || (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and tgenabled <> 'D' and tgname in
             ('kdk_p1_score_guard_trg', 'kdk_p1_score_ledger_trg', 'kdk_match_lifecycle_insert_trg', 'kdk_match_lifecycle_status_trg', 'kdk_match_lifecycle_recert_trg'))::text || '/5)' end
union all
select 'V08', '참고: play_epoch 분포(0 / 1 / 2+)',
  (select count(*) filter (where play_epoch = 0) || ' / ' || count(*) filter (where play_epoch = 1) || ' / ' || count(*) filter (where play_epoch >= 2) from public.matches);
