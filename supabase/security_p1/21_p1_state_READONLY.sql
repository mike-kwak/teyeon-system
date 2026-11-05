-- =============================================================================
-- P1 실행 실패(42P01 _p1_first_install) 후 운영 상태 확인 — 읽기 전용 · SELECT 1개 · 아무것도 바꾸지 않음
--   R00 판정: NOT_APPLIED(P1 미적용 · 빈 p1_state 만 남음 포함) / PARTIAL(일부 객체 생성) / APPLIED(전부 적용)
--   R01~R08 P1 객체 하나씩 · Z01~Z04 P0-A · P0-B · P0-C 유지 여부
--   없는 테이블은 query_to_xml 로 실행 시점에만 조회 → 테이블이 없어도 오류 없이 동작.
-- =============================================================================
with
st as (
  select
    to_regclass('security_backup.p1_state') is not null as p1_state_exists,
    case when to_regclass('security_backup.p1_state') is null then null
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from security_backup.p1_state', false, true, '')))[1]::text::int end as p1_state_rows,
    case when to_regclass('security_backup.p1_state') is null then null
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from security_backup.p1_state where restored_at is null', false, true, '')))[1]::text::int end as p1_state_open,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('kdk_p1_actor_role','kdk_p1_can_manage_results','kdk_p1_can_generate',
                                                   'kdk_p1_result_recorded','kdk_p1_score_guard','kdk_p1_block_truncate','kdk_p1_score_ledger'))::int as p1_funcs,
    to_regclass('public.kdk_match_results') is not null as ledger_exists,
    to_regclass('public.kdk_match_score_history') is not null as history_exists,
    case when to_regclass('public.kdk_match_results') is null then null
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_match_results', false, true, '')))[1]::text::int end as ledger_rows,
    (select count(*) from pg_trigger where tgrelid = to_regclass('public.matches') and tgname like 'kdk_p1_%')::int as p1_triggers,
    has_table_privilege('authenticated', 'public.matches', 'TRUNCATE') as auth_truncate,
    has_table_privilege('authenticated', 'public.matches', 'REFERENCES') as auth_references,
    has_table_privilege('authenticated', 'public.matches', 'TRIGGER') as auth_trigger,
    to_regprocedure('public.sync_tournament_matches(jsonb)') is not null as sync_exists,
    coalesce((select prosrc like '%[P1] Special 행만 허용%' from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')), false) as sync_p1,
    to_regprocedure('public.update_match_status(text,text,integer,integer,integer)') is not null as ums_exists
),
r as (
  select 0 as o, 'R00 P1 적용 상태 판정' as item,
         v.verdict,
         case v.verdict
           when 'NOT_APPLIED' then case when s.p1_state_exists
             then '실패한 실행이 남긴 것은 빈 security_backup.p1_state 뿐(무해 · 수정된 P1 재실행 시 그대로 사용)'
             else 'P1 흔적 없음' end
           when 'ROLLED_BACK' then '이전 P1 적용분이 rollback 됨(원장·이력 테이블은 설계상 보존) — P1 미적용과 같은 동작'
           when 'APPLIED' then 'P1 전부 적용(trigger 3 · 함수 7 · 원장 · authenticated TRUNCATE 등 회수 · 백업 회차 있음)'
           else '일부 객체만 생성됨 — 아래 R 행 그대로 보고(재실행·rollback 금지)'
         end as detail
    from st s
    cross join lateral (select case
           -- 공통: P1 함수·trigger 없음 · Special 본문 원본 · authenticated 권한 원래대로 · 열린 백업 회차 없음
           when s.p1_funcs = 0 and s.p1_triggers = 0 and not s.sync_p1
                and s.auth_truncate and s.auth_references and s.auth_trigger and coalesce(s.p1_state_open, 0) = 0
             then case when not s.ledger_exists and not s.history_exists and coalesce(s.p1_state_rows, 0) = 0 then 'NOT_APPLIED'
                       when coalesce(s.p1_state_rows, 0) > 0 then 'ROLLED_BACK'
                       else 'PARTIAL' end
           when s.p1_funcs = 7 and s.ledger_exists and s.history_exists and s.p1_triggers = 3 and not s.auth_truncate
                and coalesce(s.p1_state_open, 0) > 0
             then 'APPLIED'
           else 'PARTIAL'
         end as verdict) v
  union all select 1, 'R01 security_backup.p1_state', case when s.p1_state_exists then 'INFO' else 'OK' end,
         case when s.p1_state_exists then '있음 · 전체 ' || s.p1_state_rows || '행 · 미복원 ' || s.p1_state_open || '행' else '없음' end from st s
  union all select 2, 'R02 P1 함수(kdk_p1_* 7개)', case when s.p1_funcs = 0 then 'OK' else 'CHECK' end, s.p1_funcs || '개' from st s
  union all select 3, 'R03 원장 kdk_match_results(rollback 후에도 보존)', 'INFO',
         case when s.ledger_exists then '있음 · ' || s.ledger_rows || '행' else '없음' end from st s
  union all select 4, 'R04 이력 kdk_match_score_history(rollback 후에도 보존)', 'INFO',
         case when s.history_exists then '있음' else '없음' end from st s
  union all select 5, 'R05 matches 의 P1 trigger', case when s.p1_triggers = 0 then 'OK' else 'CHECK' end, s.p1_triggers || '개' from st s
  union all select 6, 'R06 authenticated 의 matches TRUNCATE·REFERENCES·TRIGGER(P1 미적용이면 true)',
         case when s.auth_truncate and s.auth_references and s.auth_trigger then 'OK' else 'CHECK' end,
         'TRUNCATE=' || s.auth_truncate || ' REFERENCES=' || s.auth_references || ' TRIGGER=' || s.auth_trigger from st s
  union all select 7, 'R07 sync_tournament_matches', 'INFO',
         case when not s.sync_exists then '없음(P1 은 건너뜀)' when s.sync_p1 then '있음 · P1 본문(CHECK)' else '있음 · 원본' end from st s
  union all select 8, 'R08 update_match_status', 'INFO',
         case when not s.ums_exists then '없음' else '있음 · authenticated 실행=' ||
              has_function_privilege('authenticated', 'public.update_match_status(text,text,integer,integer,integer)', 'execute') end from st s
  union all
  select 20, 'Z01 P0-A: RLS 꺼짐 + anon 쓰기 남은 테이블',
         case when exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
              and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE')
                   or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs'))) then 'CHECK' else 'OK' end,
         '(none) 이어야 함'
  union all
  select 21, 'Z02 P0-B: KDK RPC 3개 anon 실행',
         case when (select bool_or(to_regprocedure(s) is not null and has_function_privilege('anon', to_regprocedure(s), 'execute'))
                      from unnest(array['public.delete_kdk_live_session(text,text)','public.start_kdk_match(text,text)','public.start_kdk_match_timer(text,text)']) s)
              then 'CHECK' else 'OK' end,
         (select string_agg(split_part(s, '(', 1) || '=' || coalesce(has_function_privilege('anon', to_regprocedure(s), 'execute')::text, '없음'), ' · ')
            from unnest(array['public.delete_kdk_live_session(text,text)','public.start_kdk_match(text,text)','public.start_kdk_match_timer(text,text)']) s)
  union all
  select 22, 'Z03 P0-B 백업 회차(security_backup.function_acl_p0b)',
         case when to_regclass('security_backup.function_acl_p0b') is null then 'INFO' else 'OK' end,
         case when to_regclass('security_backup.function_acl_p0b') is null then '없음(P0-B 미적용?)'
              else '미복원 ' || (xpath('/row/n/text()', query_to_xml('select count(*) as n from security_backup.function_acl_p0b where restored_at is null', false, true, '')))[1]::text || '행' end
  union all
  select 23, 'Z04 P0-C profiles guard trigger',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D')
              then 'OK' else 'CHECK' end, ''
)
select item, verdict, detail from r order by o;
