-- ────────────────────────────────────────────────────────────────────────────
-- VERIFY — KDK 공식 기록 정정 (add_kdk_archive_correction.sql 적용 확인)
--
-- ⚠ 전부 SELECT 다. INSERT/UPDATE/DELETE/DDL/RPC 호출이 없다.
-- ⚠ §1~§5 는 **설치 검증**이다. 특정 대회·참가자에 의존하지 않으므로
--    언제 어느 환경에서 돌려도 같은 기준으로 판정된다.
-- ⚠ §6 은 정정 작업 때 쓰는 **점검 템플릿**이다. 맨 위 params 의 두 값만
--    바꿔서 쓴다. 특정 사건의 id·이름·금액을 이 파일에 적어 두지 않는다
--    (운영 기록은 kdk_archive_corrections 감사 로그에 남는다).
--
-- 적용: supabase/add_kdk_archive_correction.sql  ·  되돌리기: ..._rollback.sql
-- ────────────────────────────────────────────────────────────────────────────


-- ════════════════════════════════════════════════════════════════════════════
-- §1~§5. 설치 검증 — 한 번에 Run 하면 결과표 한 장이 나온다
--   기대: 모든 행 verdict = PASS
-- ════════════════════════════════════════════════════════════════════════════
with
fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_kdk_archive_correction_context',
                       'correct_kdk_archive_match_score')
),
checks(seq, step, item, expected, actual) as (
  values
  -- §1. 테이블 · 인덱스
  (1, '§1', 'audit 테이블 생성 + RLS 활성',
     'kdk_archive_corrections / rls=true',
     coalesce((select c.relname || ' / rls=' || c.relrowsecurity::text
                 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = 'kdk_archive_corrections'),
              '(테이블 없음)')),
  (2, '§1', '인덱스',
     '2개 (archive_idx, match_idx)',
     coalesce((select count(*)::text || '개: ' || string_agg(indexname, ', ' order by indexname)
                 from pg_indexes
                where schemaname = 'public' and tablename = 'kdk_archive_corrections'),
              '0개')),
  (3, '§1', 'append-only 보장 컬럼',
     'before_raw_data(jsonb, not null) 존재',
     coalesce((select a.attname || '(' || format_type(a.atttypid, a.atttypmod) || ', '
                     || case when a.attnotnull then 'not null' else 'nullable' end || ')'
                 from pg_attribute a
                where a.attrelid = to_regclass('public.kdk_archive_corrections')
                  and a.attname = 'before_raw_data' and a.attnum > 0),
              '(컬럼 없음)')),
  -- §2. RLS 정책
  (4, '§2', 'RLS 정책 — SELECT 1건만',
     '1건 / kdk_corrections_select_admin / SELECT',
     coalesce((select count(*)::text || '건: '
                     || string_agg(policyname || '(' || cmd || ')', ', ' order by policyname)
                 from pg_policies
                where schemaname = 'public' and tablename = 'kdk_archive_corrections'),
              '0건')),
  (5, '§2', 'RLS 쓰기 정책 (INSERT/UPDATE/DELETE/ALL)',
     '0건 — RPC 로만 기록',
     (select count(*)::text || '건'
        from pg_policies
       where schemaname = 'public' and tablename = 'kdk_archive_corrections'
         and cmd <> 'SELECT')),
  -- §3. 함수 · SECURITY DEFINER · search_path
  (6, '§3', '함수 생성',
     '2개 (context, correct)',
     coalesce((select count(*)::text || '개: ' || string_agg(proname, ', ' order by proname)
                 from fn), '0개')),
  (7, '§3', 'SECURITY DEFINER',
     '2개 모두 true',
     coalesce((select string_agg(proname || '=' || prosecdef::text, ', ' order by proname)
                 from fn), '(함수 없음)')),
  (8, '§3', 'search_path 고정',
     '2개 모두 search_path=public, pg_temp',
     coalesce((select string_agg(proname || '=' || coalesce(array_to_string(proconfig, ' | '), '(없음)'),
                                 '  //  ' order by proname)
                 from fn), '(함수 없음)')),
  -- §4. 실행 권한
  (9, '§4', 'anon EXECUTE 권한',
     '2개 모두 false',
     coalesce((select string_agg(proname || '=' || has_function_privilege('anon', oid, 'EXECUTE')::text,
                                 ', ' order by proname)
                 from fn), '(함수 없음)')),
  (10, '§4', 'authenticated EXECUTE 권한',
     '2개 모두 true (함수 내부에서 is_full_admin 재확인)',
     coalesce((select string_agg(proname || '=' || has_function_privilege('authenticated', oid, 'EXECUTE')::text,
                                 ', ' order by proname)
                 from fn), '(함수 없음)')),
  (11, '§4', 'PUBLIC 잔여 권한',
     '0건',
     (select count(*)::text || '건'
        from fn,
             lateral aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
       where a.grantee = 0)),
  (12, '§4', '선행 함수 is_full_admin',
     '존재',
     coalesce((select 'OK: ' || p.proname
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'is_full_admin'),
              '(없음)')),
  -- §5. 감사 로그 상태(환경 전체 — 특정 사건에 의존하지 않는다)
  (13, '§5', '감사 로그 누적 건수',
     '(환경에 따라 다름 — 설치 직후면 0)',
     (select count(*)::text || '건' from public.kdk_archive_corrections)),
  (14, '§5', '감사 로그 무결성 — pre-image 누락',
     '0건',
     (select count(*)::text || '건'
        from public.kdk_archive_corrections
       where before_raw_data is null
          or jsonb_typeof(before_raw_data -> 'snapshot_data') <> 'array'))
)
select c.seq, c.step, c.item, c.expected, c.actual,
       case
         when c.seq = 13 then 'INFO'
         when c.seq = 1  and c.actual = 'kdk_archive_corrections / rls=true'            then 'PASS'
         when c.seq = 2  and c.actual like '2개:%'                                       then 'PASS'
         when c.seq = 3  and c.actual = 'before_raw_data(jsonb, not null)'               then 'PASS'
         when c.seq = 4  and c.actual = '1건: kdk_corrections_select_admin(SELECT)'      then 'PASS'
         when c.seq = 5  and c.actual = '0건'                                            then 'PASS'
         when c.seq = 6  and c.actual like '2개:%'                                       then 'PASS'
         when c.seq = 7  and c.actual not like '%=false%' and c.actual <> '(함수 없음)'   then 'PASS'
         when c.seq = 8  and c.actual like '%search_path=public, pg_temp%'               then 'PASS'
         when c.seq = 9  and c.actual not like '%=true%'  and c.actual <> '(함수 없음)'   then 'PASS'
         when c.seq = 10 and c.actual not like '%=false%' and c.actual <> '(함수 없음)'   then 'PASS'
         when c.seq = 11 and c.actual = '0건'                                            then 'PASS'
         when c.seq = 12 and c.actual = 'OK: is_full_admin'                              then 'PASS'
         when c.seq = 14 and c.actual = '0건'                                            then 'PASS'
         else 'CHECK'
       end as verdict
  from checks c
 order by c.seq;


-- ════════════════════════════════════════════════════════════════════════════
-- §6. 정정 작업 점검 템플릿  (선택 — 실제로 정정할 때만)
--
--   ⚠ 아래 params 의 두 값만 바꾼 뒤 이 블록 전체를 Run 한다.
--     정정 **전** 에 한 번(점수·순위·금액의 BEFORE 확보),
--     정정 **후** 에 한 번 더 돌려 그 차이를 눈으로 대조한다.
--   ⚠ 기대값을 이 파일에 적어 두지 않는다 — 대회마다 다르고,
--     무엇이 바뀌어야 하는지는 앱의 '변경 영향 미리보기'와 감사 로그가 알려 준다.
-- ════════════════════════════════════════════════════════════════════════════
/*
with params as (
  select '<ARCHIVE_ID>'::text as archive_id,          -- 예: KDK-YYYYMMDD-XXXXXXXXX
         '<MATCH_UUID>'::text as match_id             -- snapshot_data[].id
),
a as (
  select t.* from public.teyeon_archive_v1 t, params p where t.id = p.archive_id
)
select
  -- 대상 Archive
  (select id from a)                                              as archive_id,
  (select archive_type from a)                                    as archive_type,
  (select is_official from a)                                     as is_official,
  (select is_test from a)                                         as is_test,
  (select md5(raw_data::text) from a)                             as fingerprint,
  (select jsonb_array_length(raw_data -> 'snapshot_data') from a)  as matches,
  (select jsonb_array_length(raw_data -> 'ranking_data') from a)   as players,
  -- 대상 경기
  (select count(*) from a, jsonb_array_elements(a.raw_data -> 'snapshot_data') m(m), params p
    where m.m ->> 'id' = p.match_id)                              as match_rows,
  (select (m.m ->> 'score1') || ' : ' || (m.m ->> 'score2') || ' / ' || (m.m ->> 'status')
     from a, jsonb_array_elements(a.raw_data -> 'snapshot_data') m(m), params p
    where m.m ->> 'id' = p.match_id limit 1)                      as score_status,
  -- 정산 합계(정정 전후 비교용)
  (select sum((s.m ->> 'penalty_amount')::int)
     from a, jsonb_array_elements(a.raw_data -> 'settlement_data') s(m))   as penalty_total,
  (select sum((s.m ->> 'prize_amount')::int)
     from a, jsonb_array_elements(a.raw_data -> 'settlement_data') s(m))   as prize_total,
  (select sum((s.m ->> 'guest_fee_amount')::int)
     from a, jsonb_array_elements(a.raw_data -> 'settlement_data') s(m))   as guest_fee_total,
  (select sum((s.m ->> 'final_amount')::int)
     from a, jsonb_array_elements(a.raw_data -> 'settlement_data') s(m))   as final_total,
  -- 이 Archive 의 정정 이력
  (select count(*) from public.kdk_archive_corrections c, params p
    where c.archive_id = p.archive_id)                            as corrections,
  -- Finance 연동 현황(0 이 아니면 금액 변동 정정 시 수동 확인 필요)
  (select count(*) from public.finance_dues_receivables r, params p
    where r.related_kdk_session_id = p.archive_id)                as fin_receivables,
  (select count(*) from public.kdk_guest_penalty_payments g, params p
    where g.session_id = p.archive_id)                            as fin_guest_payments,
  (select count(*) from public.finance_kdk_prize_payouts z, params p
    where z.related_kdk_session_id = p.archive_id)                as fin_prize_payouts,
  (select count(*) from public.finance_kdk_settlement_notices t, params p
    where t.related_kdk_session_id = p.archive_id)                as fin_notices;
*/

-- 공식 순위 전체(정정 전후 대조용) — params 를 같은 값으로 바꿔 쓴다.
/*
with params as (
  select '<ARCHIVE_ID>'::text as archive_id
)
select r.i as rank, r.m ->> 'name' as name,
       (r.m ->> 'wins')::int as wins, (r.m ->> 'losses')::int as losses,
       (r.m ->> 'diff')::int as diff,
       (s.m ->> 'points_for')::int     as pf,
       (s.m ->> 'points_against')::int as pa,
       s.m ->> 'penalty_level'         as lv,
       (s.m ->> 'penalty_amount')::int as penalty,
       (s.m ->> 'prize_amount')::int   as prize,
       (s.m ->> 'final_amount')::int   as final
  from public.teyeon_archive_v1 a, params p,
       jsonb_array_elements(a.raw_data -> 'ranking_data')    with ordinality r(m, i),
       jsonb_array_elements(a.raw_data -> 'settlement_data') with ordinality s(m, i)
 where a.id = p.archive_id and r.i = s.i
 order by r.i;
*/

-- 정정 이력 + pre-image 보존 확인 — params 를 같은 값으로 바꿔 쓴다.
/*
with params as (
  select '<ARCHIVE_ID>'::text as archive_id
)
select c.id, c.match_id,
       c.before_score1, c.before_score2, c.after_score1, c.after_score2,
       c.reason, c.was_official, c.corrected_by, c.corrected_at,
       jsonb_array_length(c.before_raw_data -> 'snapshot_data') as pre_image_matches,
       c.impact -> 'rankChanges'                               as rank_changes
  from public.kdk_archive_corrections c, params p
 where c.archive_id = p.archive_id
 order by c.corrected_at desc;
*/
