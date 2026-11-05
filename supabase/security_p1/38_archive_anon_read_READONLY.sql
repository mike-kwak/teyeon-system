-- =============================================================================
-- ISS-005 · 38 상태 확인 — 읽기 전용(SELECT 1문장 · 이메일/UUID/raw_data 값 출력 없음, 건수만)
--   A01~A03 3개 표 anon · authenticated 조회 권한   A04 공개 RPC(SECURITY DEFINER · anon 실행)
--   A05 anon 실행 INVOKER 함수가 대상 표를 읽는지(있으면 38 STOP)   A06 노출 범위 건수(공식/미확정/정산/참가자 설정/확정자 이메일)
--   A07 anon 조회 가능한 뷰가 대상 표를 읽는지(있으면 별도 검토 — 뷰는 소유자 권한으로 읽으므로 38 로 막히지 않음)
-- =============================================================================
with
t(o, name) as (values (1, 'teyeon_archive_v1'), (2, 'matches_archive'), (3, 'sessions_archive')),
pub(name) as (values ('get_public_kdk_sessions(integer)'), ('get_public_kdk_session(text)'), ('get_public_schedule_kdk_state(uuid)'),
                     ('get_public_guest_pass_kdk_state(text)'), ('get_public_special_sessions(integer)'))
select t.o as o, 'A0' || t.o || ' ' || t.name as item,
       case when to_regclass('public.' || t.name) is null then 'INFO'
            when has_any_column_privilege('anon', ('public.' || t.name)::regclass, 'SELECT') then 'OPEN'
            else 'CLOSED' end as verdict,
       case when to_regclass('public.' || t.name) is null then '표 없음'
            else 'anon 조회=' || has_any_column_privilege('anon', ('public.' || t.name)::regclass, 'SELECT')
              || ' · 로그인 조회=' || has_table_privilege('authenticated', ('public.' || t.name)::regclass, 'SELECT')
              || ' · 행 ' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.name), false, true, '')))[1]::text end as detail
  from t
union all
select 4, 'A04 공개 RPC(SECURITY DEFINER · anon 실행)',
       case when bool_and(p.oid is not null and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) then 'OK' else 'CHECK' end,
       string_agg(pub.name || '=' || coalesce(case when p.prosecdef then 'DEFINER' else 'INVOKER' end, '없음'), ' · ')
  from pub left join pg_proc p on p.oid = to_regprocedure('public.' || pub.name)
union all
select 5, 'A05 anon 실행 INVOKER 함수가 대상 표를 읽음',
       case when count(*) = 0 then 'OK' else 'BLOCK' end,
       coalesce(string_agg(p.oid::regprocedure::text, ', '), '없음')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
   and p.prosrc ~* '\m(teyeon_archive_v1|matches_archive|sessions_archive)\M'
union all
select 7, 'A07 anon 이 조회 가능한 뷰 중 대상 표를 읽는 것(38 이 막지 못하는 별도 경로)',
       case when count(*) = 0 then 'OK' else 'CHECK' end,
       coalesce(string_agg(v.schemaname || '.' || v.viewname, ', '), '없음')
  from pg_views v
 where v.schemaname = 'public' and has_table_privilege('anon', (quote_ident(v.schemaname) || '.' || quote_ident(v.viewname))::regclass, 'SELECT')
   and v.definition ~* '\m(teyeon_archive_v1|matches_archive|sessions_archive)\M'
union all
select 6, 'A06 Archive 노출 범위(건수)', 'INFO',
       '전체 ' || count(*) || ' · 공식 ' || count(*) filter (where is_official) || ' · 미확정 ' || count(*) filter (where not coalesce(is_official, false))
       || ' · 정산 포함 ' || count(*) filter (where raw_data -> 'settlement_data' is not null)
       || ' · 참가자 설정 포함 ' || count(*) filter (where jsonb_typeof(raw_data -> 'player_metadata') = 'object' and raw_data -> 'player_metadata' <> '{}'::jsonb)
       || ' · 출생연도 포함 ' || count(*) filter (where raw_data::text like '%"birthYear"%')
       || ' · 확정자 이메일 형식 ' || count(*) filter (where confirmed_by like '%@%')
  from public.teyeon_archive_v1
order by 1;
