-- =============================================================================
-- P1-b 적용 전·후 상태 확인 — 읽기 전용 · SELECT 1개 · 아무것도 바꾸지 않음 (적용 전 precheck 겸 적용 후 verify)
--   S00 판정 NOT_APPLIED / APPLIED / ROLLED_BACK / PARTIAL
--   S 행  : P1-b trigger·함수·백업 · 4개 테이블의 authenticated / anon 권한
--   E 행  : 운영진 권한(profiles.role) 정합성 — DB 역할 기준(이메일 목록 사용 안 함 · 건수만 출력)
--           E01 탈회 직책인데 CEO/ADMIN 남음(BLOCK) · E02 CEO/ADMIN 인원(CEO 0 이면 BLOCK) · E03~E05 참고
--   F 행  : Archive·레거시 테이블에 쓰는 SECURITY DEFINER 함수(anon/authenticated 실행 가능 여부)
--   C 행  : 기준값(공식·전체 건수 · raw_data 전체 해시) — 적용 전후·QA 전후 같아야 함
--   Z 행  : P0-A · P0-B · P0-C · P1 유지
-- =============================================================================
with
tbl(o, t) as (values (1, 'teyeon_archive_v1'), (2, 'matches_archive'), (3, 'sessions_archive'), (4, 'kdk_sessions')),
pv as (
  select tbl.o, tbl.t, to_regclass('public.' || tbl.t) as rel from tbl
),
g as (
  select pv.*,
    (select string_agg(r || '=' || coalesce(nullif(concat_ws('',
        case when has_table_privilege(r, pv.rel, 'SELECT') then 'S' end, case when has_table_privilege(r, pv.rel, 'INSERT') then 'I' end,
        case when has_table_privilege(r, pv.rel, 'UPDATE') then 'U' end, case when has_table_privilege(r, pv.rel, 'DELETE') then 'D' end,
        case when has_table_privilege(r, pv.rel, 'TRUNCATE') then 'Tr' end, case when has_table_privilege(r, pv.rel, 'REFERENCES') then 'R' end,
        case when has_table_privilege(r, pv.rel, 'TRIGGER') then 'Tg' end), ''), '-'), ' ' order by r)
       from unnest(array['anon', 'authenticated']) r) as grants,
    case when pv.rel is null then null else has_table_privilege('authenticated', pv.rel, 'SELECT') end as auth_s,
    case when pv.rel is null then null else has_table_privilege('anon', pv.rel, 'SELECT') end as anon_s,
    case when pv.rel is null then null else (has_table_privilege('authenticated', pv.rel, 'TRUNCATE') or has_table_privilege('authenticated', pv.rel, 'REFERENCES')
                                             or has_table_privilege('authenticated', pv.rel, 'TRIGGER')) end as auth_trt,
    case when pv.rel is null then null else (has_table_privilege('authenticated', pv.rel, 'INSERT') or has_table_privilege('authenticated', pv.rel, 'UPDATE')
                                             or has_table_privilege('authenticated', pv.rel, 'DELETE')) end as auth_iud,
    case when pv.rel is null then null else (has_table_privilege('anon', pv.rel, 'INSERT') or has_table_privilege('anon', pv.rel, 'UPDATE')
                                             or has_table_privilege('anon', pv.rel, 'DELETE') or has_table_privilege('anon', pv.rel, 'TRUNCATE')) end as anon_w
  from pv
),
st as (
  select
    (select count(*) from pg_trigger where tgrelid = to_regclass('public.teyeon_archive_v1') and tgname in ('p1b_archive_guard_trg', 'p1b_archive_block_truncate_trg') and tgenabled <> 'D')::int as trg,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('p1b_archive_guard', 'p1b_archive_block_truncate'))::int as fns,
    to_regclass('security_backup.p1b_state') is not null as bk_exists,
    case when to_regclass('security_backup.p1b_state') is null then 0
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from security_backup.p1b_state', false, true, '')))[1]::text::int end as bk_rows,
    case when to_regclass('security_backup.p1b_state') is null then 0
         else (xpath('/row/n/text()', query_to_xml('select count(*) as n from security_backup.p1b_state where restored_at is null', false, true, '')))[1]::text::int end as bk_open,
    (select bool_or(auth_trt) from g where t = 'teyeon_archive_v1') as arch_trt,
    (select bool_or(auth_iud) from g where t <> 'teyeon_archive_v1') as legacy_iud
),
-- E 행: 운영진 판정은 앱 권한(profiles.role CEO·ADMIN)만 — 화면(app/archive)도 같은 기준(이메일 목록 판정 제거).
--   members.role(클럽 직책)은 'CEO, 재무' 처럼 쉼표 다중값일 수 있다. 결과는 건수만(이름·이메일·UUID 출력 없음).
er as (
  select
    (select count(*) from public.profiles where upper(btrim(role::text)) = 'CEO')::int   as ceo_n,
    (select count(*) from public.profiles where upper(btrim(role::text)) = 'ADMIN')::int as admin_n,
    to_regclass('public.members') is not null as members_exists,
    case when to_regclass('public.members') is null then null else
      (xpath('/row/n/text()', query_to_xml($q$
         select count(distinct p.id) as n from public.profiles p join public.members m on m.auth_user_id = p.id
          where upper(btrim(p.role::text)) in ('CEO', 'ADMIN')
            and '탈회' = any(regexp_split_to_array(btrim(coalesce(m.role::text, '')), '\s*,\s*'))$q$, false, true, '')))[1]::text::int end as withdrawn_admin_n,
    case when to_regclass('public.members') is null then null else
      (xpath('/row/n/text()', query_to_xml($q$
         select count(*) as n from public.profiles p
          where upper(btrim(p.role::text)) in ('CEO', 'ADMIN')
            and not exists (select 1 from public.members m where m.auth_user_id = p.id)$q$, false, true, '')))[1]::text::int end as admin_unlinked_n,
    case when to_regclass('public.members') is null then null else
      (xpath('/row/n/text()', query_to_xml($q$
         select count(distinct m.id) as n from public.members m left join public.profiles p on p.id = m.auth_user_id
          where regexp_split_to_array(btrim(coalesce(m.role::text, '')), '\s*,\s*') && array['회장','부회장','총무','재무','경기','섭외','CEO']
            and not '탈회' = any(regexp_split_to_array(btrim(coalesce(m.role::text, '')), '\s*,\s*'))
            and coalesce(upper(btrim(p.role::text)), '') not in ('CEO', 'ADMIN')$q$, false, true, '')))[1]::text::int end as staff_title_not_admin_n,
    (select count(*) from public.profiles
      where coalesce(upper(btrim(role::text)), '') not in ('CEO','ADMIN','OPERATOR','FINANCE_MANAGER','MEMBER','GUEST'))::int as unknown_role_n
),
r as (
  select 0 as o, 'S00 P1-b 적용 상태' as item,
         case
           when s.trg = 2 and s.fns = 2 and not s.arch_trt and not coalesce(s.legacy_iud, false) and s.bk_open > 0 then 'APPLIED'
           when s.trg = 0 and s.fns = 0 and s.bk_open = 0 and s.bk_rows = 0 then 'NOT_APPLIED'
           when s.trg = 0 and s.fns = 0 and s.bk_open = 0 and s.bk_rows > 0 then 'ROLLED_BACK'
           else 'PARTIAL'
         end as verdict,
         format('trigger %s/2 · 함수 %s/2 · 백업 %s행(열린 회차 %s행) · archive authenticated TRUNCATE·REFERENCES·TRIGGER=%s · 레거시 authenticated 쓰기=%s',
                s.trg, s.fns, s.bk_rows, s.bk_open, s.arch_trt, coalesce(s.legacy_iud::text, '-')) as detail
    from st s
  union all
  select 10 + g.o, 'S ' || g.t,
         case when g.rel is null then 'INFO'
              when not g.auth_s or not g.anon_s then 'CHECK'          -- 공개 SELECT 유지 필수
              when g.anon_w then 'CHECK'                              -- P0-A: anon 쓰기 없어야 함
              else 'INFO' end,
         case when g.rel is null then '(없음)' else g.grants || ' · rls=' || (select relrowsecurity from pg_class where oid = g.rel) end
    from g
  union all
  select 20, 'E01 탈회 직책인데 앱 권한 CEO/ADMIN 이 남은 계정',
         case when e.withdrawn_admin_n is null then 'INFO' when e.withdrawn_admin_n = 0 then 'OK' else 'BLOCK' end,
         case when e.withdrawn_admin_n is null then 'members 테이블 없음'
              else e.withdrawn_admin_n || '명 — 0 이어야 함(있으면 P1-b 후에도 그 계정이 Archive 를 쓸 수 있음 · 역할은 운영진이 결정)' end
    from er e
  union all
  select 21, 'E02 Archive 쓰기 가능 계정(앱 권한 CEO · ADMIN)',
         case when e.ceo_n >= 1 then 'OK' else 'BLOCK' end,
         'CEO ' || e.ceo_n || '명 · ADMIN ' || e.admin_n || '명 — P1-b 후 Archive 공식 확정·해제·삭제·정정은 이 계정들만'
    from er e
  union all
  select 22, 'E03 CEO/ADMIN 중 회원(members) 연결 없는 계정', 'INFO',
         coalesce(e.admin_unlinked_n::text || '명 — 운영에 문제는 없음(앱 권한은 profiles 기준) · 정리 대상 여부만 확인', 'members 테이블 없음')
    from er e
  union all
  select 23, 'E04 운영 직책(회장·부회장·총무·재무·경기·섭외)인데 앱 권한 CEO/ADMIN 아님', 'INFO',
         coalesce(e.staff_title_not_admin_n::text || '명 — P1-b 후 Archive 쓰기 불가(직책만으로는 권한 없음 · 의도된 정책이면 정상)', 'members 테이블 없음')
    from er e
  union all
  select 24, 'E05 앱 권한 값이 정의 밖(CEO·ADMIN·OPERATOR·FINANCE_MANAGER·MEMBER·GUEST 외)',
         case when e.unknown_role_n = 0 then 'OK' else 'CHECK' end, e.unknown_role_n || '명(앱에서는 GUEST 로 취급)'
    from er e
  union all
  select 30, 'F ' || p.oid::regprocedure::text,
         case when has_function_privilege('anon', p.oid, 'execute') then 'RISK' else 'INFO' end,
         concat_ws(' · ', 'anon=' || has_function_privilege('anon', p.oid, 'execute'),
                   'auth=' || has_function_privilege('authenticated', p.oid, 'execute'),
                   'admin_check=' || (p.prosrc ~* '(is_full_admin|''CEO''|''ADMIN'')'),
                   'P1-b 후 archive 쓰기는 trigger 가 JWT 로 재검사')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(teyeon_archive_v1|matches_archive|sessions_archive|kdk_sessions)\M'
  union all
  select 40, 'C 기준값(teyeon_archive_v1)', 'INFO',
         (xpath('/row/s/text()', query_to_xml($q$select 'total=' || count(*) || ' official=' || count(*) filter (where coalesce(is_official, false))
                                                    || ' raw_md5=' || coalesce(md5(string_agg(id || ':' || md5(raw_data::text), '|' order by id)), '-')
                                                    || ' row_md5=' || coalesce(md5(string_agg(md5(t::text), '|' order by id)), '-') as s
                                               from public.teyeon_archive_v1 t$q$, false, true, '')))[1]::text
  union all
  select 41, 'C QA 잔여물(QA-P1B-* Archive 행 · 정정 이력)',
         case when (xpath('/row/n/text()', query_to_xml($q$select count(*) as n from public.teyeon_archive_v1 where id like 'QA-P1B-%'$q$, false, true, '')))[1]::text::int = 0
                   and (to_regclass('public.kdk_archive_corrections') is null
                        or (xpath('/row/n/text()', query_to_xml($q$select count(*) as n from public.kdk_archive_corrections where archive_id like 'QA-P1B-%'$q$, false, true, '')))[1]::text::int = 0)
              then 'OK' else 'CHECK' end,
         'QA 실행 전·후 모두 0 이어야 함'
  union all
  select 50, 'Z P0-A: RLS 꺼짐 + anon 쓰기 남은 테이블',
         case when exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
              and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE')
                   or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs'))) then 'CHECK' else 'OK' end, '(none) 이어야 함'
  union all
  select 51, 'Z P0-B: KDK RPC 3개 anon 실행',
         case when (select bool_or(to_regprocedure(s) is not null and has_function_privilege('anon', to_regprocedure(s), 'execute'))
                      from unnest(array['public.delete_kdk_live_session(text,text)','public.start_kdk_match(text,text)','public.start_kdk_match_timer(text,text)']) s)
              then 'CHECK' else 'OK' end, ''
  union all
  select 52, 'Z P0-C: profiles guard trigger',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D')
              then 'OK' else 'CHECK' end, ''
  union all
  select 53, 'Z P1: matches trigger 3개',
         case when (select count(*) from pg_trigger where tgrelid = to_regclass('public.matches') and tgname like 'kdk_p1_%' and tgenabled <> 'D') = 3
              then 'OK' else 'CHECK' end, ''
)
select item, verdict, detail from r order by o, item;
