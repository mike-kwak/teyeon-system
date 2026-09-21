-- ============================================================================
--  2026 TEYEON OPEN — Batch 3B (예선 순위 / 동률 확정) 검증
--
--  사용법: Supabase SQL Editor 에 전체를 붙여넣고 1회 실행.
--          seq / check_name / result(PASS·FAIL) 한 개의 표가 나온다.
--
--  ⚠ 100% 읽기 전용. INSERT/UPDATE/DELETE/DDL 없음, 운영 RPC 호출 없음(카탈로그 조회만).
--
--  선행: Batch 1 4종 + Batch 2A + bulk follow-up + 3A matches
--        + add_hosted_tournament_standings.sql
--
--  알고리즘 계약(순위 산출·동률·진출 판정)은 이 파일이 아니라
--  supabase/verify_hosted_tournament_standings_fixture.sql 이 실제 데이터로 검증한다.
--  여기서는 구조 · 권한 · 개인정보 · 정책 불변식만 본다.
--
--  ★ 코어 분리(add_hosted_tournament_public_draw.sql) 이후용 사본.
--    계산식이 get_preliminary_standings → hosted_tournament_preliminary_standings_core 로
--    글자 그대로 옮겨졌으므로, 본문 문자열을 보는 항목(50 · 52 · 54~64)의 대상만 코어로 바꿨다.
--    항목 번호 · 이름 · 기대값은 원본과 같다. 14 · 41 · 81 은 래퍼와 코어 **둘 다** 검사한다.
--    93~97 은 래퍼/코어 구조 검사(신규), 98 은 코어 계산 SQL 토큰이 3B 원문과 같은지 확인
--    (주석 제거 + 공백 정규화 후 md5 — 줄바꿈 · 들여쓰기 · 주석 차이는 무시, 토큰 변경은 FAIL).
-- ============================================================================

with
fn as (
    select
        to_regprocedure('public.hosted_tournament_group_results_fingerprint(uuid)')           as f_fp,
        to_regprocedure('public.get_preliminary_standings(text)')                             as f_stand,
        to_regprocedure('public.hosted_tournament_preliminary_standings_core(uuid)')         as f_core,
        to_regprocedure('public.resolve_group_age_tie(text,integer,uuid[],text,text)')        as f_resolve,
        to_regprocedure('public.amend_completed_match_score(uuid,integer,integer,text,integer)') as f_amend
),
all_fn as (
    select unnest(array[f_fp, f_stand, f_resolve, f_amend]) as oid from fn
),
src as (
    select
        (select prosrc from pg_proc where oid = (select f_stand   from fn)) as s_stand,
        (select prosrc from pg_proc where oid = (select f_core    from fn)) as s_core,
        (select prosrc from pg_proc where oid = (select f_resolve from fn)) as s_resolve,
        (select prosrc from pg_proc where oid = (select f_amend   from fn)) as s_amend,
        (select prosrc from pg_proc where oid = (select f_fp      from fn)) as s_fp
),
pub_exec as (
    select count(*) as n
      from pg_proc p join all_fn a on a.oid = p.oid,
           lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     where x.grantee = 0 and x.privilege_type = 'EXECUTE'
),
anon_exec as (
    select count(*) as n
      from pg_proc p join all_fn a on a.oid = p.oid
     where has_function_privilege('anon', p.oid, 'EXECUTE')
),
hardening as (
    select count(*) as total,
           count(*) filter (where p.prosecdef) as secdef,
           count(*) filter (where exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                           where c like 'search\_path=%')) as pinned
      from pg_proc p join all_fn a on a.oid = p.oid
),
tcon as (select conname, contype, pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = to_regclass('public.hosted_tournament_group_tie_resolutions')),
tcol as (select column_name
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'hosted_tournament_group_tie_resolutions'),
tidx as (select indexname, indexdef
           from pg_indexes
          where schemaname = 'public'
            and tablename = 'hosted_tournament_group_tie_resolutions'),
prod as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
checks as (

-- ── 1. 테이블 / RLS / 권한 ──────────────────────────────────────────────────
select  1, '[table] hosted_tournament_group_tie_resolutions 존재',
        to_regclass('public.hosted_tournament_group_tie_resolutions') is not null
union all select  2, '[RLS] RLS 활성',
        (select relrowsecurity from pg_class
          where relname = 'hosted_tournament_group_tie_resolutions'
            and relnamespace = 'public'::regnamespace)
union all select  3, '[RLS] SELECT 정책 1개(운영진 전용)',
        (select count(*) = 1 from pg_policies
          where schemaname = 'public' and tablename = 'hosted_tournament_group_tie_resolutions'
            and cmd = 'SELECT')
union all select  4, '[RLS] INSERT/UPDATE/DELETE 정책 0개(RPC 경유만)',
        (select count(*) = 0 from pg_policies
          where schemaname = 'public' and tablename = 'hosted_tournament_group_tie_resolutions'
            and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
union all select  5, '[RLS] SELECT 정책이 can_manage_tournaments 사용',
        (select bool_and(coalesce(qual, '') like '%can_manage_tournaments%') from pg_policies
          where schemaname = 'public' and tablename = 'hosted_tournament_group_tie_resolutions'
            and cmd = 'SELECT')
union all select  6, '[grant] anon 에게 테이블 권한 없음',
        (select count(*) = 0 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'hosted_tournament_group_tie_resolutions'
            and grantee = 'anon')
union all select  7, '[grant] authenticated 는 SELECT 만',
        (select coalesce(bool_and(privilege_type = 'SELECT'), true)
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'hosted_tournament_group_tie_resolutions'
            and grantee = 'authenticated')
union all select  8, '[grant] PUBLIC 에게 테이블 권한 없음',
        (select count(*) = 0 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'hosted_tournament_group_tie_resolutions'
            and grantee = 'PUBLIC')

-- ── 2. 개인정보 방화벽 ──────────────────────────────────────────────────────
union all select 10, '[PII] 확정 테이블에 age 계열 컬럼 없음',
        (select count(*) = 0 from tcol where column_name ilike '%age%')
union all select 11, '[PII] 확정 테이블에 birth/dob/year 계열 컬럼 없음',
        (select count(*) = 0 from tcol
          where column_name ilike '%birth%' or column_name ilike '%dob%'
             or column_name ilike '%born%'  or column_name ilike '%year%')
union all select 12, '[PII] 확정 테이블에 연락처/주민 계열 컬럼 없음',
        (select count(*) = 0 from tcol
          where column_name ilike '%phone%' or column_name ilike '%resident%'
             or column_name ilike '%jumin%' or column_name ilike '%email%')
union all select 13, '[PII] 확정 테이블 컬럼 집합이 설계와 일치(12개)',
        (select count(*) = 12
             and count(*) filter (where column_name <> all (array[
                   'id', 'tournament_id', 'group_id', 'team_id', 'resolved_order', 'reason',
                   'source_fingerprint', 'resolved_by', 'resolved_at',
                   'invalidated_at', 'invalidated_reason', 'created_at'])) = 0
           from tcol)
union all select 14, '[PII] standings RPC 가 접수 원장을 참조하지 않음',
        (select s_stand not like '%hosted_tournament_registrations%'
            and s_core  not like '%hosted_tournament_registrations%' from src)
union all select 15, '[PII] resolve RPC 가 접수 원장을 참조하지 않음',
        (select s_resolve not like '%hosted_tournament_registrations%' from src)
union all select 16, '[PII] 두 RPC 어디에도 birth/dob/combined_age 토큰 없음',
        (select s_stand   not ilike '%birth%' and s_stand   not ilike '%dob%'
            and s_stand   not ilike '%combined_age%'
            and s_resolve not ilike '%birth%' and s_resolve not ilike '%dob%'
            and s_resolve not ilike '%combined_age%' from src)
-- ⚠ pg_get_function_identity_arguments 는 **인자 이름까지** 찍는다
--   (`p_slug text, p_group_no integer, p_ordered_team_ids uuid[], …`).
--   그래서 타입 문자열과 비교하거나 substring 으로 금지어를 찾으면 오탐한다.
--   금지 파라미터는 proargnames 를 **토큰 단위 완전일치**로 본다.
--   ⚠ 타입 시그니처 자체는 seq 32(to_regprocedure)가 이미 고정하고 있다.
union all select 17, '[PII] resolve 입력 인자에 나이/생년 파라미터 없음',
        (select p.pronargs = 5
                and coalesce(array_length(p.proargnames, 1), 0) = 5
                and not exists (
                      select 1 from unnest(p.proargnames) as a(nm)
                       where lower(btrim(a.nm)) = any (array[
                             'age', 'p_age', 'ages', 'p_ages',
                             'birth', 'p_birth', 'birthday', 'p_birthday',
                             'birth_year', 'p_birth_year', 'birthyear', 'p_birthyear',
                             'dob', 'p_dob', 'date_of_birth', 'p_date_of_birth',
                             'combined_age', 'p_combined_age',
                             'age_sum', 'p_age_sum', 'total_age', 'p_total_age']))
           from pg_proc p where p.oid = (select f_resolve from fn))
union all select 18, '[PII] standings 스냅샷 테이블을 만들지 않음',
        to_regclass('public.hosted_tournament_standings') is null
        and to_regclass('public.hosted_tournament_group_standings') is null

-- ── 3. 제약 / 인덱스 ────────────────────────────────────────────────────────
union all select 20, '[con] tournament FK 존재',
        (select count(*) = 1 from tcon where contype = 'f' and def ilike '%hosted_tournaments(id)%')
union all select 21, '[con] (tournament_id, group_id) 복합 FK',
        (select count(*) = 1 from tcon
          where contype = 'f' and def ilike '%hosted_tournament_groups(tournament_id, id)%')
union all select 22, '[con] (tournament_id, team_id) 복합 FK',
        (select count(*) = 1 from tcon
          where contype = 'f' and def ilike '%hosted_tournament_teams(tournament_id, id)%')
union all select 23, '[con] resolved_order >= 1 체크',
        (select count(*) >= 1 from tcon where contype = 'c' and def ilike '%resolved_order%')
union all select 24, '[con] reason 길이 체크(2..200)',
        (select count(*) >= 1 from tcon
          where contype = 'c' and def ilike '%reason%' and def like '%200%')
union all select 25, '[idx] 유효 확정 팀 유일 partial unique',
        (select count(*) = 1 from tidx
          where indexdef ilike '%unique%' and indexdef ilike '%(group_id, team_id)%'
            and indexdef ilike '%invalidated_at IS NULL%')
union all select 26, '[idx] 유효 확정 순위 유일 partial unique',
        (select count(*) = 1 from tidx
          where indexdef ilike '%unique%' and indexdef ilike '%(group_id, resolved_order)%'
            and indexdef ilike '%invalidated_at IS NULL%')
union all select 27, '[idx] (tournament_id, group_id) 조회 인덱스',
        (select count(*) >= 1 from tidx where indexdef ilike '%(tournament_id, group_id)%')
union all select 28, '[con] 이력 보존 — 무효화 컬럼 2종 존재',
        (select count(*) = 2 from tcol
          where column_name in ('invalidated_at', 'invalidated_reason'))

-- ── 4. 함수 존재 / 하드닝 ───────────────────────────────────────────────────
union all select 30, '[fn] hosted_tournament_group_results_fingerprint(uuid)',
        (select f_fp is not null from fn)
union all select 31, '[fn] get_preliminary_standings(text)',
        (select f_stand is not null from fn)
union all select 32, '[fn] resolve_group_age_tie(text,integer,uuid[],text,text)',
        (select f_resolve is not null from fn)
union all select 33, '[fn] amend_completed_match_score 존재(3B 로 교체됨)',
        (select f_amend is not null from fn)
union all select 34, '[sec] 4개 모두 SECURITY DEFINER',
        (select total = 4 and secdef = 4 from hardening)
union all select 35, '[sec] 4개 모두 search_path 고정',
        (select total = 4 and pinned = 4 from hardening)
union all select 36, '[sec] PUBLIC EXECUTE 0건',
        (select n = 0 from pub_exec)
union all select 37, '[sec] anon EXECUTE 0건',
        (select n = 0 from anon_exec)
union all select 38, '[sec] authenticated 는 standings/resolve/amend 만 실행 가능',
        (has_function_privilege('authenticated', (select f_stand from fn), 'EXECUTE')
         and has_function_privilege('authenticated', (select f_resolve from fn), 'EXECUTE')
         and has_function_privilege('authenticated', (select f_amend from fn), 'EXECUTE'))
union all select 39, '[sec] 내부 helper(fingerprint) 는 authenticated 도 실행 불가',
        (not has_function_privilege('authenticated', (select f_fp from fn), 'EXECUTE'))
union all select 40, '[fn] standings 는 STABLE(쓰기 없음)',
        (select provolatile = 's' from pg_proc where oid = (select f_stand from fn))
union all select 41, '[fn] standings 본문에 쓰기 구문 없음',
        (select s_stand !~* '(^|[^a-z_])(insert|update|delete|truncate|alter|drop)[[:space:]]+'
            and s_core  !~* '(^|[^a-z_])(insert|update|delete|truncate|alter|drop)[[:space:]]+' from src)
union all select 42, '[auth] standings 가 can_manage_tournaments 로 시작 검증',
        (select s_stand like '%can_manage_tournaments()%' from src)
union all select 43, '[auth] resolve 가 42501 로 권한 실패를 올림',
        (select s_resolve like '%42501%' from src)

-- ── 5. 순위 알고리즘 불변식(본문 고정) ──────────────────────────────────────
--   ⚠ 여기서 고정하는 문자열은 fixture 스크립트가 복제해서 검증하는 식과 동일하다.
--     둘이 어긋나면 이 구간이 FAIL 로 잡힌다.
union all select 50, '[rank] 정렬 키가 승률 → 득실 두 단계로 고정',
        (select s_core like '%order by c.win_rate desc nulls last, c.game_diff desc%' from src)
union all select 51, '[rank] 3차 tie-breaker(team_no/이름/uuid/등록순)를 쓰지 않음',
        (select s_stand not like '%win_rate desc nulls last, c.game_diff desc,%' from src)
union all select 52, '[rank] 승률은 numeric 나눗셈(float 오차 배제)',
        (select s_core like '%wins::numeric / nullif(a.played, 0)%' from src)
union all select 53, '[rank] resolve 도 동일한 정렬 규칙을 사용',
        (select s_resolve like '%wins::numeric / nullif(a.played, 0)%'
            and s_resolve like '%desc nulls last%' from src)
union all select 54, '[calc] COMPLETED 경기만 집계에 포함',
        (select s_core like '%where status = ''completed''%' from src)
union all select 55, '[calc] placement 는 standings 집계에서 제외',
        (select s_core like '%g.group_type = ''preliminary''%' from src)
union all select 56, '[calc] 조 기대 경기수를 N(N-1)/2 일반식으로 계산(3 하드코딩 없음)',
        (select s_core like '%(gs.members * (gs.members - 1)) / 2%' from src)
union all select 57, '[state] rankingStatus 3종 모두 존재',
        (select s_core like '%PROVISIONAL%' and s_core like '%AGE_CHECK_REQUIRED%'
            and s_core like '%''FINAL''%' from src)
union all select 58, '[state] CANCELLED 잔존 시 policyRequired 발급',
        (select s_core like '%cancelled_matches_present%' from src)
union all select 59, '[state] 미완료 조는 무조건 PROVISIONAL',
        (select s_core like '%when not gs.complete%then ''PROVISIONAL''%' from src)
union all select 60, '[qual] 미완료 조의 진출 판정은 전부 PENDING',
        (select s_core like '%when not gs.complete then ''PENDING''%' from src)
union all select 61, '[qual] 동률 묶음이 진출권 안쪽이면 QUALIFIED',
        (select s_core like '%rk.auto_rank + ts.tsize - 1 <= v_qualify then ''QUALIFIED''%' from src)
union all select 62, '[qual] 동률 묶음이 진출권 밖이면 NOT_QUALIFIED',
        (select s_core like '%when rk.auto_rank > v_qualify then ''NOT_QUALIFIED''%' from src)
union all select 63, '[qual] 진출 인원이 한 곳(v_qualify)에만 정의됨',
        (select s_core like '%v_qualify integer := 2%' from src)
union all select 64, '[rank] tie group 은 전원 확정됐을 때만 resolved',
        (select s_core like '%= t.tsize as resolved%' from src)

-- ── 6. 동률 확정 RPC 계약 ───────────────────────────────────────────────────
union all select 70, '[resolve] resolved_order 를 서버가 계산(tie 시작 rank + 입력 순서)',
        (select s_resolve like '%v_tie_rank + (u.ord - 1)%' from src)
-- ⚠ resolved_order 라는 문자열이 **본문에** 있는 것은 정상이다(서버가 계산한다 — seq 70).
--   여기서 봐야 하는 것은 '입력 인자로 받는가' 하나뿐이므로 proargnames 를 본다.
--   ⚠ substring 금지: 정상 인자 p_ordered_team_ids 가 'order' 를 포함한다.
union all select 71, '[resolve] 클라이언트가 resolved_order 를 입력으로 보내지 않음',
        (select p.pronargs = 5
                and not exists (
                      select 1 from unnest(coalesce(p.proargnames, '{}'::text[])) as a(nm)
                       where lower(btrim(a.nm)) = any (array[
                             'resolved_order', 'p_resolved_order',
                             'order', 'p_order', 'orders', 'p_orders',
                             'rank', 'p_rank', 'ranks', 'p_ranks',
                             'final_rank', 'p_final_rank',
                             'resolved_rank', 'p_resolved_rank']))
           from pg_proc p where p.oid = (select f_resolve from fn))
union all select 72, '[resolve] 조 미완료 시 거부(group_not_complete)',
        (select s_resolve like '%group_not_complete%' from src)
union all select 73, '[resolve] 결과 지문 불일치 시 거부(standings_changed)',
        (select s_resolve like '%standings_changed%' from src)
union all select 74, '[resolve] 입력 팀 집합이 실제 동률 묶음과 다르면 거부',
        (select s_resolve like '%tie_set_mismatch%' from src)
union all select 75, '[resolve] 입력 중복 팀 거부',
        (select s_resolve like '%duplicate_team_in_list%' from src)
union all select 76, '[resolve] placement 조는 순위 확정 대상이 아님',
        (select s_resolve like '%placement_not_rankable%' from src)
union all select 77, '[resolve] 사유 필수',
        (select s_resolve like '%reason_required%' from src)
union all select 78, '[resolve] 재확정 시 기존 행을 삭제하지 않고 무효화',
        (select s_resolve like '%invalidated_at = now()%'
            and s_resolve !~* '(^|[^a-z_])delete[[:space:]]+from' from src)
union all select 79, '[resolve] 감사 로그에 팀 번호만 기록(선수명 없음)',
        (select s_resolve like '%orderedTeamNos%'
            and s_resolve not like '%player1_name%' from src)
union all select 80, '[lock] resolve 가 matches 네임스페이스 advisory lock 1개만 사용',
        (select s_resolve like '%hosted-tournament-matches:%'
            and (length(s_resolve) - length(replace(s_resolve, 'pg_advisory_xact_lock', '')))
                / length('pg_advisory_xact_lock') = 1 from src)
union all select 81, '[lock] standings 는 lock 을 잡지 않음(조회 전용)',
        (select s_stand not like '%pg_advisory%' and s_core not like '%pg_advisory%' from src)

-- ── 7. amend 연동(원자적 무효화) ────────────────────────────────────────────
union all select 85, '[amend] 같은 조의 유효 확정을 무효화',
        (select s_amend like '%hosted_tournament_group_tie_resolutions%'
            and s_amend like '%invalidated_reason = ''score_amended''%' from src)
union all select 86, '[amend] 무효화가 점수 수정과 같은 함수(=같은 트랜잭션) 안에서 일어남',
        (select s_amend like '%update public.hosted_tournament_group_tie_resolutions%' from src)
union all select 87, '[amend] 3A 의 자리표시 주석이 제거됨',
        (select s_amend not like '%3B 에서 합산연령%' from src)
union all select 88, '[amend] 반환에 invalidatedResolutions 포함(가산적)',
        (select s_amend like '%''invalidatedResolutions'', v_inval%' from src)
union all select 89, '[amend] 무효화도 감사 로그로 남음',
        (select s_amend like '%group_age_tie_resolution_invalidated%' from src)
union all select 90, '[amend] 확정 행을 삭제하지 않음',
        (select s_amend !~* '(^|[^a-z_])delete[[:space:]]+from' from src)
union all select 91, '[amend] 기존 계약 유지 — 완료 경기만 수정 가능',
        (select s_amend like '%match_not_completed%' from src)
union all select 92, '[events] entity_type 에 group 이 이미 허용됨(스키마 변경 불필요)',
        (select count(*) >= 1 from pg_constraint c
          where c.conrelid = 'public.hosted_tournament_events'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) ilike '%entity_type%'
            and pg_get_constraintdef(c.oid) ilike '%''group''%')

-- ── 7b. 코어 분리 구조(신규) ────────────────────────────────────────────────
union all select 93, '[core] 계산 코어 함수 존재',
        ((select f_core from fn) is not null)
union all select 94, '[core] 코어는 anon · authenticated · PUBLIC 모두 직접 실행 불가',
        (not has_function_privilege('anon', (select f_core from fn), 'EXECUTE')
         and not has_function_privilege('authenticated', (select f_core from fn), 'EXECUTE')
         and not exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                          where p.oid = (select f_core from fn) and x.grantee = 0 and x.privilege_type = 'EXECUTE'))
union all select 95, '[core] 코어는 STABLE · SECURITY DEFINER · search_path 고정',
        (select provolatile = 's' and prosecdef
                and exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search\_path=%')
           from pg_proc where oid = (select f_core from fn))
union all select 96, '[core] 운영 래퍼가 코어를 호출하고 계산식을 따로 갖지 않음',
        (select s_stand like '%hosted_tournament_preliminary_standings_core(v_tid)%'
            and s_stand not like '%order by c.win_rate%' from src)
union all select 97, '[core] 코어에 권한 분기 · 슬러그 조회 없음(순수 계산)',
        (select s_core not like '%can_manage_tournaments%' and s_core not like '%p_slug%' from src)

union all select 98, '[core] 코어 계산 SQL 토큰이 3B 원문과 동일(주석/공백/줄바꿈 제외)',
        (select strpos(z.n, 'with grp as (') > 0
            and strpos(z.n, ('where g.tournament_id = v_tid and g.group_type = ''placement''' || chr(59))) > 0
            and md5(substr(z.n, strpos(z.n, 'with grp as ('),
                           strpos(z.n, ('where g.tournament_id = v_tid and g.group_type = ''placement''' || chr(59))) + length(('where g.tournament_id = v_tid and g.group_type = ''placement''' || chr(59)))
                           - strpos(z.n, 'with grp as ('))) = 'b225df53c40f3295531324e96e269fa9'
           from (select btrim(regexp_replace(regexp_replace(s_core,
                            '--[^' || chr(10) || ']*', ' ', 'g'), '\s+', ' ', 'g')) as n
                   from src) as z)

-- ── 8. Production 보호 ──────────────────────────────────────────────────────
union all select 100, '[prod] 2026-teyeon-open 동률 확정 0건',
        (select count(*) = 0 from public.hosted_tournament_group_tie_resolutions r, prod
          where r.tournament_id = prod.id)
union all select 101, '[prod] 2026-teyeon-open 경기 0건(3B 가 경기를 만들지 않음)',
        (select count(*) = 0 from public.hosted_tournament_matches m, prod
          where m.tournament_id = prod.id)
union all select 102, '[prod] 2026-teyeon-open 조편성 draft 유지',
        (select preliminary_draw_status = 'draft' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 103, '[prod] 대회 status registration_open 유지',
        (select status = 'registration_open' from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 104, '[prod] 승격된 접수 0건',
        (select count(*) = 0 from public.hosted_tournament_teams
          where registration_id is not null)
union all select 105, '[prod] fixture self-test 잔재 없음(rollback 확인)',
        (select count(*) = 0 from public.hosted_tournaments
          where slug like 'zz-fixture-standings-selftest%')

)
select seq, check_name, case when ok then 'PASS' else 'FAIL' end as result
  from checks as c(seq, check_name, ok)
union all
select 999, 'SUMMARY  PASS=' || (select count(*) filter (where ok) from checks as c2(seq, check_name, ok))
         || ' / FAIL=' || (select count(*) filter (where not ok or ok is null) from checks as c3(seq, check_name, ok))
         || ' / TOTAL=' || (select count(*) from checks as c4(seq, check_name, ok)),
       case when (select count(*) filter (where not ok or ok is null) from checks as c5(seq, check_name, ok)) = 0
            then 'ALL PASS' else 'CHECK FAILED' end
 order by 1;
