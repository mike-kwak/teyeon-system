-- =============================================================================
-- KDK 30·31 상태 확인 — 읽기 전용(쓰기 없음 · 이메일/UUID 출력 없음). 적용 전·후·rollback 후 언제든 실행 가능.
--   S00 : NOT_APPLIED | APPLIED_30 | APPLIED_30_31 | PARTIAL
--   F   : 대상 함수 상태(원본 md5 일치 / [KDKM] 확장 / 기타=CHECK)
--   G   : 실행 권한(anon 은 모두 false 여야 함)
--   M   : KDK 관리자 등록 수 · 등록자 앱 권한 분포(GUEST·탈회 등록자는 권한 없음 = CHECK)
--   Z   : 기존 보호(P1 trigger · P1-b trigger · 코트 unique index) 유지
-- =============================================================================
with
fn(o, sig, orig) as (values
  (1, 'public.start_kdk_match(text,text)',       array['81257f29c2abed42a8e28bc9e8376626', '8b6c074d6e336c45f5e24bba2e1fd460']),
  (2, 'public.start_kdk_match_timer(text,text)', array['a5b9875242bb9c28f33f9b1ad910ccc7']),
  (3, 'public.kdk_p1_score_guard()',             array['82f7e3a705449d4b522e9a7945083bf6']),
  (4, 'public.kdk_p1_can_generate()',            array['74e6681b3a3c5a0963aacb52be5a3a35']),
  (5, 'public.p1b_archive_guard()',              array['34a96f1a7c750f5b91402a5576f359cc'])),
fs as (
  select fn.o, fn.sig, p.oid,
         case when p.oid is null then 'MISSING'
              when p.prosrc like '%[KDKM]%' then 'KDKM'
              when md5(replace(p.prosrc, E'\r', '')) = any(fn.orig) then 'ORIGINAL'
              else 'OTHER' end as st
    from fn left join pg_proc p on p.oid = to_regprocedure(fn.sig)
),
h as (
  select to_regprocedure('public.can_manage_kdk()') is not null as has_mgr,
         to_regprocedure('public.kdk_can_operate_court()') is not null as has_court,
         to_regprocedure('public.save_kdk_official_archive(text,text,jsonb)') is not null as has_save,
         to_regclass('public.kdk_managers') is not null as has_tbl,
         (select count(*) from fs where o <= 4 and st = 'KDKM') as n30,
         (select count(*) from fs where o = 5 and st = 'KDKM') as n31
),
mg as (
  select case when to_regclass('public.kdk_managers') is null then null else
           (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_managers', false, true, '')))[1]::text end as n,
         case when to_regclass('public.kdk_managers') is null then null else
           (xpath('/row/s/text()', query_to_xml($q$select coalesce(string_agg(r || '=' || c, ' · ' order by r), '-') as s from (
              select coalesce(upper(btrim(p.role::text)), '(프로필 없음)') as r, count(*) as c
                from public.kdk_managers k left join public.profiles p on p.id::text = k.user_id::text group by 1) t$q$, false, true, '')))[1]::text end as roles,
         case when to_regclass('public.kdk_managers') is null then null else
           (xpath('/row/n/text()', query_to_xml($q$select count(*) as n from public.kdk_managers k
               left join public.profiles p on p.id::text = k.user_id::text
              where coalesce(upper(btrim(p.role::text)), '') not in ('CEO','ADMIN','MEMBER','OPERATOR','FINANCE_MANAGER')
                 or exists (select 1 from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) x(v)
                             where m.auth_user_id::text = k.user_id::text and btrim(x.v) = '탈회')$q$, false, true, '')))[1]::text end as inactive
)
select 0 as o, 'S00 적용 상태' as item,
       case when not has_mgr and not has_save and n30 = 0 and n31 = 0 then 'NOT_APPLIED'
            when has_mgr and has_court and n30 = 4 and not has_save and n31 = 0 then 'APPLIED_30'
            when has_mgr and has_court and n30 = 4 and has_save and n31 = 1 then 'APPLIED_30_31'
            else 'PARTIAL' end as verdict,
       concat_ws(' · ', 'helper=' || (has_mgr and has_court), 'table=' || has_tbl, '30 확장 ' || n30 || '/4', 'save_rpc=' || has_save, '31 확장 ' || n31 || '/1') as detail
  from h
union all
select 10 + o, 'F ' || sig, case when st in ('ORIGINAL', 'KDKM') then 'OK' else 'CHECK' end,
       st || case when st = 'OTHER' then ' — 검토된 원본도 확장본도 아님(30·31 적용 시 STOP)' else '' end
  from fs
union all
select 20, 'G anon 실행 권한(KDK RPC · helper)',
       case when coalesce(bool_or(has_function_privilege('anon', to_regprocedure(s), 'execute')), false) then 'RISK' else 'OK' end,
       coalesce(string_agg(split_part(split_part(s, '.', 2), '(', 1) || '=' || has_function_privilege('anon', to_regprocedure(s), 'execute'), ' · '), '(대상 없음)')
  from unnest(array['public.start_kdk_match(text,text)', 'public.start_kdk_match_timer(text,text)', 'public.delete_kdk_live_session(text,text)',
                    'public.can_manage_kdk()', 'public.kdk_can_operate_court()', 'public.save_kdk_official_archive(text,text,jsonb)']) s
 where to_regprocedure(s) is not null
union all
select 21, 'G 직접 쓰기 권한(관리자 표 · 감사 기록)',
       case when (to_regclass('public.kdk_managers') is not null and (has_table_privilege('authenticated', 'public.kdk_managers', 'INSERT')
                    or has_table_privilege('authenticated', 'public.kdk_managers', 'UPDATE') or has_table_privilege('authenticated', 'public.kdk_managers', 'DELETE')
                    or has_table_privilege('anon', 'public.kdk_managers', 'SELECT')))
              or (to_regclass('public.kdk_official_saves') is not null and (has_table_privilege('authenticated', 'public.kdk_official_saves', 'INSERT')
                    or has_table_privilege('authenticated', 'public.kdk_official_saves', 'UPDATE') or has_table_privilege('authenticated', 'public.kdk_official_saves', 'DELETE')))
            then 'RISK' else 'OK' end,
       '회원은 kdk_managers · kdk_official_saves 에 쓸 수 없어야 함(등록은 SQL Editor 전용)'
union all
select 30, 'M KDK 관리자 등록', case when mg.n is null then 'INFO' when coalesce(mg.inactive, '0') = '0' then 'OK' else 'CHECK' end,
       case when mg.n is null then '표 없음(미적용)'
            else mg.n || '명 · 앱 권한 ' || mg.roles || ' · 권한 없음(GUEST·탈회 등) ' || coalesce(mg.inactive, '0') || '명' end
  from mg
union all
select 31, 'M KDK 관리자 공식 저장 기록', 'INFO',
       case when to_regclass('public.kdk_official_saves') is null then '표 없음(31 미적용)'
            else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_official_saves', false, true, '')))[1]::text || '건 · 관리자 경로 '
              || (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.kdk_official_saves where via_manager', false, true, '')))[1]::text || '건' end
union all
select 40, 'Z P1 trigger 3개',
       case when (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and tgenabled <> 'D'
                   and tgname in ('kdk_p1_score_guard_trg', 'kdk_p1_block_truncate_trg', 'kdk_p1_score_ledger_trg')) = 3 then 'OK' else 'CHECK' end,
       '3 이어야 함'
union all
select 41, 'Z P1-b trigger 2개',
       case when (select count(*) from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname like 'p1b_%' and tgenabled <> 'D') = 2 then 'OK' else 'INFO' end,
       (select count(*) from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname like 'p1b_%' and tgenabled <> 'D')::text || '개(31 은 2 일 때만 적용 가능)'
union all
select 42, 'Z 코트 중복 방지 index(matches_playing_court_uniq)',
       case when to_regclass('public.matches_playing_court_uniq') is not null then 'OK' else 'CHECK' end,
       case when to_regclass('public.matches_playing_court_uniq') is not null then '있음' else '없음 — 동시 투입 시 같은 코트 2경기 가능성(세션 잠금만 남음)' end
union all
select 43, 'M kdk_session_meta 쓰기 정책(게스트비 · 조별 코트 · 전광판 문구 · 정모 연결)',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'kdk_session_meta' and cmd <> 'SELECT')
              then 'CHECK'
            when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'kdk_session_meta' and cmd <> 'SELECT'
                              and not (coalesce(qual, '') like '%can_manage_kdk()%' or coalesce(with_check, '') like '%can_manage_kdk()%'))
              then 'OK' else 'RISK' end,
       coalesce((select string_agg(policyname || '(' || cmd || ')', ' · ' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'kdk_session_meta' and cmd <> 'SELECT'), '(없음)')
       || ' — OK = KDK 관리자·CEO·ADMIN 만 쓰기 · RISK = 로그인 누구나 쓰기 가능한 정책이 남음(30 미적용)'
order by 1;
