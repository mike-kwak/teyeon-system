-- =============================================================================
-- P0 / P1 적용 판단 요약 — 읽기 전용 · SELECT 1개 · 결과 12행
--   05_security_detail_READONLY.sql 의 핵심만. 단계별로 "적용 가능(OK) / 사람 판단(CHECK) / 적용 금지(STOP)".
--   행 내용(이름·이메일·점수)은 출력하지 않는다(개수·이름표만).
-- =============================================================================
with
p0a_reviewed(t) as (values ('matches'), ('teyeon_archive_v1'), ('teyeon_special_sessions'), ('kdk_sessions'), ('app_logs'),
  ('kdk_session_meta'), ('lucky_vicky_rounds'), ('lucky_vicky_teams'), ('notices'), ('notice_comments'), ('notice_likes'),
  ('tournament_events'), ('tournament_pairs'), ('tournament_partner_requests'), ('ranking_config'), ('ranking_snapshots'),
  ('member_achievements'), ('app_config')),
weak as (   -- RLS 꺼짐 + anon 쓰기
  select c.relname::text as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
     and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
          or has_table_privilege('anon', c.oid, 'TRUNCATE')
          or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs')         -- app_logs INSERT 는 P0-A 가 의도적으로 유지
          or (c.relname = 'app_logs' and has_table_privilege('anon', c.oid, 'SELECT')))
),
adf as (    -- anon 실행 가능 DEFINER 함수(쓰기 포함)
  select p.oid::regprocedure::text as sig,
         p.prosrc ~* '\m(insert|update|delete|truncate)\M' as writes,
         p.prosrc ~* 'auth\.uid\(\)' as uid_chk
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind in ('f','p') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
),
pol as (select * from pg_policies where schemaname = 'public' and tablename = 'profiles'),
r as (
  -- ── P0-C ──
  select 1 as o, 'P0-C ① profiles UPDATE 정책 중 role 검사 없는 본인수정 정책' as chk,
         case when exists (select 1 from pol where cmd in ('UPDATE','ALL') and coalesce(qual, '') ~* 'auth\.uid\(\)' and coalesce(qual, '') !~* '(CEO|ADMIN)') then 'CHECK' else 'OK' end as verdict,
         coalesce((select string_agg(policyname::text || '[' || cmd || ']'
                                     || case when coalesce(qual, '') ~* 'auth\.uid\(\)' and coalesce(qual, '') !~* '(CEO|ADMIN)' then '★role검사없음' else '' end, ', ')
                     from pol where cmd in ('UPDATE','ALL')), '(none)') as detail
  union all
  select 2, 'P0-C ② authenticated 의 profiles.role 컬럼 UPDATE 권한',
         case when has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') then 'CHECK' else 'OK' end,
         has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')::text
  union all
  select 3, 'P0-C ③ sync_my_profile 본문 = 저장소 원본(다르면 P0-C STOP)',
         case when (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')) = 'ee64b99b69f2ca8d535530786654c1f4' then 'OK'
              when (select prosrc like '%[P0-C]%' from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')) then 'OK'
              else 'STOP' end,
         coalesce((select left(md5(replace(prosrc, E'\r', '')), 12) from pg_proc where oid = to_regprocedure('public.sync_my_profile(text,text)')), '없음')
  union all
  select 4, 'P0-C ④ 탈취 경로 대상: 미연결 CEO·ADMIN profile / email 다른 CEO·ADMIN / 미확인 email 계정',
         case when (select count(*) from public.profiles p where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
                      and not exists (select 1 from auth.users u where u.id = p.id)) > 0 then 'CHECK' else 'OK' end,
         (select count(*) from public.profiles p where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
            and not exists (select 1 from auth.users u where u.id = p.id))::text
         || ' / ' || (select count(*) from public.profiles p join auth.users u on u.id = p.id
                       where upper(btrim(coalesce(p.role::text, ''))) in ('CEO','ADMIN')
                         and lower(btrim(coalesce(p.email::text, ''))) is distinct from lower(btrim(coalesce(u.email::text, ''))))::text
         || ' / ' || (select count(*) from auth.users where email_confirmed_at is null)::text
  union all
  select 5, 'P0-C ⑤ guard trigger 설치 상태', 'INFO',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg') then '설치됨' else '미설치' end
  -- ── P0-A ──
  union all
  select 6, 'P0-A ① RLS 꺼짐 + anon 쓰기 테이블(검토 목록 밖이면 STOP)',
         case when exists (select 1 from weak where t not in (select t from p0a_reviewed)) then 'STOP' when exists (select 1 from weak) then 'OK' else 'INFO' end,
         coalesce((select string_agg(t || case when t not in (select t from p0a_reviewed) then '★미검토' else '' end, ', ' order by t) from weak), '(none — 적용 불필요/이미 적용)')
  union all
  select 7, 'P0-A ② app_logs anon 조회(이메일 열람) 가능',
         case when to_regclass('public.app_logs') is not null and has_table_privilege('anon', 'public.app_logs', 'SELECT') then 'CHECK' else 'OK' end,
         case when to_regclass('public.app_logs') is null then '(app_logs 없음)' else has_table_privilege('anon', 'public.app_logs', 'SELECT')::text end
  -- ── P0-B ──
  union all
  select 8, 'P0-B ① anon 실행 가능 DEFINER 쓰기 함수(권한 검사 흔적 없음)',
         case when exists (select 1 from adf where writes and not uid_chk) then 'CHECK' else 'OK' end,
         coalesce((select string_agg(sig, ', ' order by sig) from adf where writes and not uid_chk), '(none)')
  union all
  select 9, 'P0-B ② 대상 3개 anon 실행 여부(sync · update_match_status · date_match_status)', 'INFO',
         coalesce((select string_agg(split_part(s, '(', 1) || '=' || has_function_privilege('anon', s, 'execute'), ', ')
                     from unnest(array['public.sync_tournament_matches(jsonb)', 'public.update_match_status(text,text,integer,integer,integer)',
                                       'public.date_match_status(text)']) s where to_regprocedure(s) is not null), '(없음)')
  -- ── P1 ──
  union all
  select 10, 'P1 ① sync_tournament_matches 본문 = 원본/P1본 (없으면 SKIP)',
         case when to_regprocedure('public.sync_tournament_matches(jsonb)') is null then 'SKIP'
              when (select md5(replace(prosrc, E'\r', '')) = 'a27d801795e07e61e4c71c26d3ffa8ef' or prosrc like '%[P1] Special 행만 허용%'
                      from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')) then 'OK' else 'STOP' end,
         coalesce((select left(md5(replace(prosrc, E'\r', '')), 12) from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')),
                  '없음 → P1 은 이 함수를 건드리지 않음')
  union all
  select 11, 'P1 ② app_config ADMIN.kdk (대진 생성 = CEO, 또는 ADMIN 이면서 이 값이 WRITE/설정 없음)',
         case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_config' and column_name = 'permissions') then 'STOP'
              else 'INFO' end,
         coalesce((select coalesce(permissions::jsonb -> 'ADMIN' ->> 'kdk', case when permissions::jsonb -> 'ADMIN' is null then '(설정 없음 → WRITE)' else '(키 없음 → HIDE)' end)
                     from public.app_config where id::text = 'primary'), '(primary 행 없음)')
  union all
  select 12, 'P1 ③ 상세 전제는 06_p1_premise_READONLY.sql(Q01~Q14)', 'INFO',
         'matches 컬럼·BEFORE trigger·우회 DEFINER 함수·status 값'
)
select chk as "check", verdict, detail from r order by o;
