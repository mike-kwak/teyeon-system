-- =============================================================================
-- [R1 · RLS 변경 범위 확인 · 조회 전용]  SELECT 1문장 · 쓰기/DDL/SET/권한 변경 없음 · 개인정보 없음(행 내용 미조회)
--   목적: matches 의 RLS 가 "matches 하나만" 켜졌는지, public 테이블 여러 개가 한꺼번에 켜졌는지(대시보드 일괄 조치 ·
--         보안 권고 일괄 적용 등) 구분한다. 결과에 따라 복구 범위(R1 초안)가 달라진다.
--   기준(저장소 근거 · 2026-11-04 운영 사전 점검, security_p0/10_p0a 주석):
--     RLS 꺼짐 + anon 쓰기였던 8개 = kdk_sessions · matches · matches_archive · notice_comments · notice_likes · notices ·
--                                    sessions_archive · teyeon_archive_v1   (P0-A 적용 후 anon=SELECT)
--     RLS 켜짐이었던 것 = app_logs · teyeon_special_sessions (+ kdk_session_meta · kdk_managers · profiles 등 정책 기반 테이블)
--   T03 해석: kdk_match_results · kdk_match_score_history · kdk_match_lifecycle* · kdk_match_predictions 등
--             DEFINER 함수 전용 테이블은 "RLS 켜짐 · 정책 0"이 의도된 설계(직접 접근 차단)다. 화면이 직접 읽고 쓰는 테이블
--             (matches · teyeon_archive_v1 · notices 등)이 이 목록에 있을 때만 문제다.
--   T05~T06 은 DDL 변경 흔적을 찾을 수 있는 수단이 있는지만 확인한다(없으면 "누가 · 언제"는 확인 불가).
-- =============================================================================
with base(t, was_rls) as (values
  ('kdk_sessions', false), ('matches', false), ('matches_archive', false), ('notice_comments', false), ('notice_likes', false),
  ('notices', false), ('sessions_archive', false), ('teyeon_archive_v1', false),
  ('app_logs', true), ('teyeon_special_sessions', true), ('kdk_session_meta', true), ('kdk_managers', true), ('profiles', true)
), cur as (
  select b.t, b.was_rls, c.oid, c.relrowsecurity as rls, c.relforcerowsecurity as frc,
         (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = b.t) as pol
    from base b left join pg_class c on c.oid = to_regclass('public.' || b.t)
)
select 'T01' k, '기준 테이블: 이름=11-04 RLS→현재 RLS/강제/정책 수 [변화]' item,
       (select string_agg(t || '=' || was_rls::text || '→' || coalesce(rls::text, '없음') || '/' || coalesce(frc::text, '-') || '/' || pol::text
               || case when oid is not null and rls is distinct from was_rls then ' [변화]' else '' end, ', ' order by t) from cur) result
union all select 'T02', '11-04 기준 대비 RLS 가 바뀐 테이블 수 / 기준 수',
       (select count(*) filter (where oid is not null and rls is distinct from was_rls)::text || ' / ' || count(*)::text from cur)
union all select 'T03', 'public 전체: RLS 켜짐·정책 0 테이블(익명·로그인 사용자 전면 차단 상태)',
       (select coalesce(string_agg(c.relname, ', ' order by c.relname), '없음')
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
           and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname))
union all select 'T04', 'public 전체: RLS 꺼짐 테이블',
       (select coalesce(string_agg(c.relname, ', ' order by c.relname), '없음')
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity)
union all select 'T05', 'DDL 흔적 수단: pg_stat_statements · pgaudit 설치 여부',
       (select coalesce(string_agg(extname || ' ' || extversion || ' @' || extnamespace::regnamespace::text, ', '), '둘 다 없음')
          from pg_extension where extname in ('pg_stat_statements', 'pgaudit'))
union all select 'T06', 'DDL 흔적 수단: log_statement · pgaudit.log 설정',
       coalesce(current_setting('log_statement', true), '조회 불가') || ' · pgaudit.log=' || coalesce(current_setting('pgaudit.log', true), '없음')
union all select 'T07', 'matches 행 수 · 진행 중 경기 수(건수만)',
       (select count(*)::text || ' · playing=' || count(*) filter (where status = 'playing')::text from public.matches);
