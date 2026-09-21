-- ============================================================================
--  2026 TEYEON OPEN — Public Preliminary DRAW 검증 (카탈로그 · 보안)
--
--  사용법: Supabase SQL Editor 에 전체를 붙여넣고 1회 실행 → seq / check_name / result 표.
--  ⚠ 100% 읽기 전용. INSERT/UPDATE/DELETE/DDL 없음, RPC 호출 없음(카탈로그 조회만).
--  실동작(공개 조건 · 자동 비공개 · 페이로드 · Admin=Public 일치)은
--  verify_hosted_tournament_public_draw_fixture.sql 이 검증한다.
-- ============================================================================

with
fn as (
    select
        to_regprocedure('public.hosted_tournament_preliminary_standings_core(uuid)') as f_core,
        to_regprocedure('public.get_preliminary_standings(text)')                   as f_stand,
        to_regprocedure('public.publish_preliminary_draw(text,integer)')            as f_pub,
        to_regprocedure('public.unpublish_preliminary_draw(text,text,integer)')     as f_unpub,
        to_regprocedure('public.unlock_preliminary_draw(text,text,integer)')        as f_unlock,
        to_regprocedure('public.lock_preliminary_draw(text,integer)')               as f_lock,
        to_regprocedure('public.get_admin_preliminary_draw_publication(text)')      as f_aread,
        to_regprocedure('public.get_public_preliminary_draw(text)')                 as f_public,
        to_regprocedure('public.get_admin_match_board(text)')                       as f_board,
        to_regprocedure('public.resolve_group_age_tie(text,integer,uuid[],text,text)') as f_resolve,
        to_regprocedure('public.get_public_tournament(text)')                       as f_ptour,
        to_regprocedure('public.get_public_tournament_teams(text)')                 as f_pteams
),
src as (
    select
        (select prosrc from pg_proc where oid = (select f_core   from fn)) as s_core,
        (select prosrc from pg_proc where oid = (select f_stand  from fn)) as s_stand,
        (select prosrc from pg_proc where oid = (select f_pub    from fn)) as s_pub,
        (select prosrc from pg_proc where oid = (select f_unpub  from fn)) as s_unpub,
        (select prosrc from pg_proc where oid = (select f_unlock from fn)) as s_unlock,
        (select prosrc from pg_proc where oid = (select f_lock   from fn)) as s_lock,
        (select prosrc from pg_proc where oid = (select f_aread  from fn)) as s_aread,
        (select prosrc from pg_proc where oid = (select f_public from fn)) as s_public
),
newfn as (
    select unnest(array[(select f_core from fn), (select f_pub from fn), (select f_unpub from fn),
                        (select f_unlock from fn), (select f_aread from fn), (select f_public from fn),
                        (select f_stand from fn)]) as oid
),
raw_t as (
    select unnest(array['hosted_tournament_groups', 'hosted_tournament_group_members', 'hosted_tournament_teams', 'hosted_tournament_matches', 'hosted_tournament_group_tie_resolutions', 'hosted_tournament_registrations', 'hosted_tournament_courts', 'hosted_tournament_events']) as t
),
checks as (

-- ── 1. 스키마 ───────────────────────────────────────────────────────────────
select  1, '[schema] preliminary_draw_published_at 컬럼 존재(timestamptz, nullable)',
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'hosted_tournaments'
            and column_name = 'preliminary_draw_published_at'
            and data_type = 'timestamp with time zone' and is_nullable = 'YES')
union all select  2, '[schema] 기본값 없음(기존 대회는 전부 비공개로 시작)',
        (select column_default is null from information_schema.columns
          where table_schema = 'public' and table_name = 'hosted_tournaments'
            and column_name = 'preliminary_draw_published_at')
union all select  3, '[schema] preliminary_draw_status(locked/draft) 는 그대로 존재(별개 개념)',
        (select count(*) = 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'hosted_tournaments'
            and column_name = 'preliminary_draw_status')

-- ── 2. 함수 존재 · 하드닝 ───────────────────────────────────────────────────
union all select 10, '[fn] 신규/재생성 함수 7개 모두 존재',
        (select count(*) = 7 from newfn where oid is not null)
union all select 11, '[fn] 전부 SECURITY DEFINER',
        (select bool_and(p.prosecdef) from pg_proc p join newfn n on n.oid = p.oid)
union all select 12, '[fn] 전부 search_path 고정',
        (select bool_and(exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                                  where c like 'search\_path=%'))
           from pg_proc p join newfn n on n.oid = p.oid)
union all select 13, '[fn] 조회 함수(core · standings · admin read · public)는 STABLE',
        (select bool_and(provolatile = 's') from pg_proc
          where oid in ((select f_core from fn), (select f_stand from fn),
                        (select f_aread from fn), (select f_public from fn)))

-- ── 3. 실행 권한 ────────────────────────────────────────────────────────────
union all select 20, '[sec] 계산 코어는 anon · authenticated · PUBLIC 실행 불가',
        (not has_function_privilege('anon', (select f_core from fn), 'EXECUTE')
         and not has_function_privilege('authenticated', (select f_core from fn), 'EXECUTE'))
union all select 21, '[sec] anon 은 publish / unpublish 실행 불가',
        (not has_function_privilege('anon', (select f_pub from fn), 'EXECUTE')
         and not has_function_privilege('anon', (select f_unpub from fn), 'EXECUTE'))
union all select 22, '[sec] anon 은 운영 RPC(standings · board · resolve · unlock · lock · admin read) 실행 불가',
        (not has_function_privilege('anon', (select f_stand from fn), 'EXECUTE')
         and not has_function_privilege('anon', (select f_board from fn), 'EXECUTE')
         and not has_function_privilege('anon', (select f_resolve from fn), 'EXECUTE')
         and not has_function_privilege('anon', (select f_unlock from fn), 'EXECUTE')
         and not has_function_privilege('anon', (select f_lock from fn), 'EXECUTE')
         and not has_function_privilege('anon', (select f_aread from fn), 'EXECUTE'))
union all select 23, '[sec] authenticated 는 운영 RPC 실행 가능(권한은 본문 can_manage 로 판정)',
        (has_function_privilege('authenticated', (select f_pub from fn), 'EXECUTE')
         and has_function_privilege('authenticated', (select f_unpub from fn), 'EXECUTE')
         and has_function_privilege('authenticated', (select f_aread from fn), 'EXECUTE')
         and has_function_privilege('authenticated', (select f_unlock from fn), 'EXECUTE'))
union all select 24, '[sec] anon · authenticated 는 공개 DRAW RPC 실행 가능',
        (has_function_privilege('anon', (select f_public from fn), 'EXECUTE')
         and has_function_privilege('authenticated', (select f_public from fn), 'EXECUTE'))
union all select 25, '[sec] 운영 RPC 들이 can_manage_tournaments 로 권한 확인',
        (select s_pub like '%can_manage_tournaments()%' and s_unpub like '%can_manage_tournaments()%'
            and s_aread like '%can_manage_tournaments()%' and s_stand like '%can_manage_tournaments()%'
           from src)
union all select 26, '[sec] 공개 RPC 는 권한 분기 없이 공개 조건만 본다',
        (select s_public not like '%can_manage_tournaments%' from src)

-- ── 4. 원본 테이블 anon 차단 유지(RLS · 정책) ───────────────────────────────
union all select 30, '[raw] 대회 관련 원본 테이블 8개 모두 RLS 활성',
        (select bool_and(c.relrowsecurity) from raw_t
           join pg_class c on c.relname = raw_t.t and c.relnamespace = 'public'::regnamespace)
union all select 31, '[raw] 조 · 조원 · 팀 · 경기 · 동률 · 코트 · 이벤트 테이블에 anon/PUBLIC 대상 정책 없음',
        (select count(*) = 0 from pg_policies
          where schemaname = 'public'
            and tablename in ('hosted_tournament_groups', 'hosted_tournament_group_members',
                              'hosted_tournament_teams', 'hosted_tournament_matches',
                              'hosted_tournament_group_tie_resolutions', 'hosted_tournament_courts',
                              'hosted_tournament_events')
            and (roles && array['anon', 'public']::name[]))
union all select 32, '[raw] 접수 원장에 anon SELECT 정책 없음(등록 보안 회귀 없음)',
        (select count(*) = 0 from pg_policies
          where schemaname = 'public' and tablename = 'hosted_tournament_registrations'
            and cmd in ('SELECT', 'ALL') and (roles && array['anon', 'public']::name[]))
union all select 33, '[raw] 이번 마이그레이션이 테이블 정책을 추가하지 않음(조 · 경기 SELECT 정책은 운영진 1개씩)',
        (select count(*) filter (where tablename = 'hosted_tournament_groups' and cmd = 'SELECT') = 1
            and count(*) filter (where tablename = 'hosted_tournament_matches' and cmd = 'SELECT') = 1
           from pg_policies where schemaname = 'public')
union all select 34, '[regress] 기존 공개 RPC(get_public_tournament · teams) 유지 · anon 실행 가능',
        ((select f_ptour from fn) is not null and (select f_pteams from fn) is not null
         and has_function_privilege('anon', (select f_ptour from fn), 'EXECUTE')
         and has_function_privilege('anon', (select f_pteams from fn), 'EXECUTE'))

-- ── 5. 공개 조건 · 최소 필드 ────────────────────────────────────────────────
union all select 40, '[public] 대회 draft 면 반환 없음',
        (select s_public like '%v_tstatus = ''draft''%' from src)
union all select 41, '[public] 조편성 locked 가 아니면 반환 없음',
        (select s_public like '%v_dstatus <> ''locked''%' from src)
union all select 42, '[public] 공개 시각이 없으면 반환 없음',
        (select s_public like '%v_pub is null%' from src)
union all select 43, '[public] 운영과 같은 계산 코어 사용(Single Source of Truth)',
        (select s_public like '%hosted_tournament_preliminary_standings_core(v_tid)%'
            and s_public not like '%order by c.win_rate%' from src)
union all select 44, '[public] 접수 원장을 참조하지 않음',
        (select s_public not like '%hosted_tournament_registrations%' from src)
union all select 45, '[public] 출력 키에 uuid 계열 없음(teamId · groupId · matchId · tournamentId · winnerTeamId)',
        (select s_public not like '%''teamId'',%' and s_public not like '%''groupId'',%'
            and s_public not like '%''matchId'',%' and s_public not like '%''tournamentId'',%'
            and s_public not like '%''winnerTeamId'',%' and s_public not like '%''loserTeamId'',%'
           from src)
union all select 46, '[public] 결과 지문 · 동률 상세 · 확정 사유 · 버전 미반환',
        (select s_public not like '%''resultsFingerprint'',%' and s_public not like '%''tieGroups'',%'
            and s_public not like '%''resolvedReason'',%' and s_public not like '%''resolvedOrder'',%'
            and s_public not like '%''resolvedAt'',%' and s_public not like '%''version'',%'
            and s_public not like '%''publishedAt'',%' from src)
union all select 47, '[public] 연락처 · 입금 · 동의 · 메모 · 나이 계열 없음',
        (select s_public !~* '(phone|email|depositor|payment|consent|admin_note|birth|dob|combined_age|age_sum)' from src)
union all select 48, '[public] 쓰기 구문 없음',
        (select s_public !~* '(^|[^a-z_])(insert|update|delete|truncate|alter|drop)[[:space:]]+' from src)

-- ── 6. publish / unpublish / unlock 계약 ───────────────────────────────────
union all select 50, '[publish] locked 에서만 공개(draw_not_locked)',
        (select s_pub like '%draw_not_locked%' from src)
union all select 51, '[publish] expected_version 필수 + 충돌 보호',
        (select s_pub like '%version_required%' and s_pub like '%version_conflict%' from src)
union all select 52, '[publish] 조편성 네임스페이스 advisory lock',
        (select s_pub like '%hosted-tournament-groups:%' from src)
union all select 53, '[publish] 공개 직전 조편성 유효성 재검증',
        (select s_pub like '%hosted_tournament_draw_validate(v_tid)%' from src)
union all select 54, '[publish] 이미 공개면 오류(draw_already_published)',
        (select s_pub like '%draw_already_published%' from src)
union all select 55, '[publish] 버전 증가 + audit',
        (select s_pub like '%hosted_tournament_draw_bump(v_tid)%'
            and s_pub like '%''publish_preliminary_draw''%' from src)
union all select 56, '[unpublish] 사유 필수 · 비공개면 오류 · audit',
        (select s_unpub like '%reason_required%' and s_unpub like '%draw_not_published%'
            and s_unpub like '%''unpublish_preliminary_draw''%' from src)
union all select 57, '[unlock] 같은 트랜잭션에서 공개 시각을 NULL 로',
        (select s_unlock like '%preliminary_draw_published_at = null%' from src)
union all select 58, '[unlock] 자동 비공개를 audit 로 남김(원인 draw_unlocked)',
        (select s_unlock like '%draw_unlocked%' and s_unlock like '%''unpublish_preliminary_draw''%' from src)
union all select 59, '[unlock] 자동 재공개 없음',
        (select s_unlock not like '%preliminary_draw_published_at = now()%' from src)
union all select 60, '[unlock] 3A 계약 유지(진행 경기 차단 · 호명 초기화 · 삭제 없음)',
        (select s_unlock like '%matches_in_progress%' and s_unlock like '%calling_reset%'
            and s_unlock ilike '%status = ''waiting'', called_at = null%'
            and s_unlock not ilike '%delete from public.hosted_tournament_matches%' from src)
union all select 61, '[lock] LOCK 은 공개하지 않음(공개 시각을 건드리지 않음)',
        (select s_lock not like '%published_at%' from src)
union all select 62, '[audit] 공개 관련 audit 에 선수명 없음',
        (select s_pub not like '%player1_name%' and s_unpub not like '%player1_name%' from src)

-- ── 7. Production 보호 ──────────────────────────────────────────────────────
union all select 70, '[prod] 적용 직후 2026-teyeon-open 은 비공개(공개 시각 NULL)',
        (select preliminary_draw_published_at is null from public.hosted_tournaments
          where slug = '2026-teyeon-open')
union all select 71, '[prod] public draw fixture 잔재 없음(rollback 확인)',
        (select count(*) = 0 from public.hosted_tournaments where slug like 'zz-fixture-public-draw%')

)
select seq, check_name, case when ok then 'PASS' else 'FAIL' end as result
  from checks as c(seq, check_name, ok)
union all
select 999, 'SUMMARY  PASS=' || (select count(*) filter (where ok) from checks as c2(seq, check_name, ok))
         || ' / FAIL=' || (select count(*) filter (where not ok or ok is null) from checks as c3(seq, check_name, ok)),
       case when (select count(*) filter (where not ok or ok is null) from checks as c4(seq, check_name, ok)) = 0
            then 'ALL PASS' else 'CHECK FAILED' end
 order by 1;
