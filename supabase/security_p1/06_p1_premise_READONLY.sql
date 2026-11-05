-- =============================================================================
-- P1(KDK 점수 권한) 전제 점검 — 읽기 전용 · SELECT 1개 · 결과 약 14행
--   운영 matches 구조·trigger·RPC 가 20_p1_kdk_score_guard.sql 의 전제와 맞는지 확인한다.
--   verdict: OK(전제 일치) / CHECK(사람이 판단) / STOP(P1 적용 금지 — 초안 수정 필요)
--   행 내용(이름·점수·id)은 출력하지 않는다.
-- =============================================================================
with
mt as (select to_regclass('public.matches') as oid),
cols as (
  select a.attname::text as col, format_type(a.atttypid, a.atttypmod) as typ, a.attgenerated <> '' as generated,
         pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = (select oid from mt) and a.attnum > 0 and not a.attisdropped
),
trg as (
  select t.tgname::text as name, p.proname::text as fn, p.prosrc as src, t.tgenabled::text as en,
         (t.tgtype & 2) <> 0 as before, (t.tgtype & 4) <> 0 as ins, (t.tgtype & 8) <> 0 as del,
         (t.tgtype & 16) <> 0 as upd, (t.tgtype & 1) <> 0 as row_level
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = (select oid from mt) and not t.tgisinternal
),
fn as (   -- matches 를 쓰는 public 함수(DEFINER 면 P1 guard 를 우회)
  select p.oid::regprocedure::text as sig, p.prosecdef as definer, p.prosrc as src,
         has_function_privilege('anon', p.oid, 'execute') as anon_x,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_x
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind in ('f','p')
     and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?matches\M'
),
known(sig) as (values ('start_kdk_match(text,text)'), ('start_kdk_match_timer(text,text)'), ('delete_kdk_live_session(text,text)'),
                      ('sync_tournament_matches(jsonb)'), ('update_match_status(text,text,integer,integer,integer)')),
r as (
  select 1 as o, 'Q01 matches 컬럼(guard 비교 제외: status·score1·score2·updated_at)' as chk, 'INFO' as verdict,
         (select string_agg(col || ':' || typ || case when generated then '[generated]' else '' end, ', ') from cols) as detail
  union all
  select 2, 'Q02 필수 컬럼 id·session_id·status·score1·score2·player_ids',
         case when (select count(*) from cols where col in ('id','session_id','status','score1','score2','player_ids')) = 6 then 'OK' else 'STOP' end,
         (select string_agg(col || ':' || typ, ', ') from cols where col in ('id','session_id','status','score1','score2','player_ids'))
  union all
  select 3, 'Q03 status 값 분포(guard 는 waiting·playing·complete 전제)',
         case when exists (select 1 from public.matches where status::text not in ('waiting','playing','complete')) then 'CHECK' else 'OK' end,
         coalesce((select string_agg(s || '=' || n, ', ' order by s) from (select coalesce(status::text, '(null)') s, count(*) n from public.matches group by 1) x), '(비어 있음)')
  union all
  select 4, 'Q04 BEFORE UPDATE 행 trigger(점수 입력 시 다른 컬럼을 바꾸면 회원 입력이 막힘)',
         case when exists (select 1 from trg where before and upd and row_level and name not like 'kdk_p1_%') then 'CHECK' else 'OK' end,
         coalesce((select string_agg(name || '→' || fn || '[' || en || ']', ', ') from trg where before and upd and row_level and name not like 'kdk_p1_%'), '(none)')
  union all
  select 5, 'Q05 matches 전체 사용자 trigger', 'INFO',
         coalesce((select string_agg(name || '(' || case when before then 'B' else 'A' end
                                     || case when ins then 'I' else '' end || case when upd then 'U' else '' end
                                     || case when del then 'D' else '' end || ')[' || en || ']', ', ' order by name) from trg), '(none)')
  union all
  select 6, 'Q06 P1 객체 사전 존재(없어야 정상 · 있으면 재적용)',
         case when exists (select 1 from trg where name like 'kdk_p1_%') or to_regclass('public.kdk_match_results') is not null then 'CHECK' else 'OK' end,
         coalesce((select string_agg(name, ', ') from trg where name like 'kdk_p1_%'), '-') || ' / kdk_match_results=' || coalesce(to_regclass('public.kdk_match_results')::text, '없음')
  union all
  select 7, 'Q07 matches 를 쓰는 DEFINER 함수 중 P1 검토 목록 밖(우회 경로 후보)',
         case when exists (select 1 from fn where definer and (auth_x or anon_x) and sig not in (select sig from known)
                             and sig not like 'kdk_%spotlight%' and sig not like 'kdk_match_lifecycle%' and sig not like 'kdk_p1_%') then 'STOP' else 'OK' end,
         coalesce((select string_agg(sig || case when anon_x then '[anon]' when auth_x then '[auth]' else '' end, ', ')
                     from fn where definer and (auth_x or anon_x) and sig not in (select sig from known)
                       and sig not like 'kdk_%spotlight%' and sig not like 'kdk_match_lifecycle%' and sig not like 'kdk_p1_%'), '(none)')
  union all
  select 8, 'Q08 기존 KDK RPC 운영자 검사 흔적(start·timer·delete)',
         case when (select count(*) from fn where sig in ('start_kdk_match(text,text)','start_kdk_match_timer(text,text)','delete_kdk_live_session(text,text)')
                      and src ~* 'auth\.uid\(\)' and src ~* '(CEO|ADMIN)') = 3 then 'OK' else 'CHECK' end,
         coalesce((select string_agg(sig || ' anon=' || anon_x, ', ') from fn where sig in ('start_kdk_match(text,text)','start_kdk_match_timer(text,text)','delete_kdk_live_session(text,text)')), '(없음)')
  union all
  select 9, 'Q09 sync_tournament_matches 본문 = 저장소 원본 또는 P1 적용본',
         case when to_regprocedure('public.sync_tournament_matches(jsonb)') is null then 'SKIP'
              when (select md5(replace(prosrc, E'\r', '')) = 'a27d801795e07e61e4c71c26d3ffa8ef' or prosrc like '%[P1] Special 행만 허용%'
                      from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')) then 'OK' else 'STOP' end,
         coalesce((select left(md5(replace(prosrc, E'\r', '')), 12) from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')),
                  '없음 → P1 은 이 함수를 건드리지 않음(새로 만들지 않음)')
  union all
  select 10, 'Q10 update_match_status 존재 · 실행 권한(anon/auth)', 'INFO',
         coalesce((select 'anon=' || anon_x || ' auth=' || auth_x from fn where sig = 'update_match_status(text,text,integer,integer,integer)'), '(없음)')
  union all
  select 11, 'Q11 Special 행 session_id 가 모두 SP- (P1 sync 범위 고정 전제)',
         case when exists (select 1 from public.matches where mode::text = 'SPECIAL' and coalesce(session_id::text, '') not like 'SP-%') then 'STOP' else 'OK' end,
         (select count(*) filter (where session_id::text like 'SP-%') || ' SP-행 / mode=SPECIAL 인데 SP- 아님 '
                 || count(*) filter (where mode::text = 'SPECIAL' and coalesce(session_id::text, '') not like 'SP-%') from public.matches)
  union all
  select 12, 'Q12 app_config.permissions 구조 · ADMIN/MEMBER/GUEST 의 kdk 값',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_config' and column_name = 'permissions') then 'STOP'
              else 'INFO' end,
         coalesce((select 'permissions=' || coalesce(jsonb_typeof(permissions::jsonb), 'null')
                          || ' | ADMIN.kdk=' || coalesce(permissions::jsonb -> 'ADMIN' ->> 'kdk', case when permissions::jsonb -> 'ADMIN' is null then '(설정 없음→WRITE)' else '(없음→HIDE)' end)
                          || ' | MEMBER.kdk=' || coalesce(permissions::jsonb -> 'MEMBER' ->> 'kdk', '-')
                          || ' | GUEST.kdk=' || coalesce(permissions::jsonb -> 'GUEST' ->> 'kdk', '-')
                     from public.app_config where id::text = 'primary'), '(primary 행 없음)')
  union all
  select 13, 'Q13 profiles.role 값(대문자 정규화 후 · 개수)', 'INFO',
         coalesce((select string_agg(k || '=' || n, ', ' order by k) from (select upper(btrim(coalesce(role::text, ''))) k, count(*) n from public.profiles group by 1) x), '-')
  union all
  select 14, 'Q14 matches 권한 TRUNCATE/TRIGGER(authenticated · anon)', 'INFO',
         'authenticated Tr=' || has_table_privilege('authenticated', 'public.matches', 'TRUNCATE') || ' Tg=' || has_table_privilege('authenticated', 'public.matches', 'TRIGGER')
         || ' / anon Tr=' || has_table_privilege('anon', 'public.matches', 'TRUNCATE')
)
select chk as "check", verdict, detail from r order by o;
