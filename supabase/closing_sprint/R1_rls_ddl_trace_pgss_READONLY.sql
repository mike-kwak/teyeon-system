-- =============================================================================
-- [R1 · RLS 변경 DDL 흔적(pg_stat_statements) · 조회 전용]  SELECT 1문장 · 쓰기 없음
--   실행 조건: R1_rls_scope_READONLY.sql 의 T05 에 pg_stat_statements 가 보일 때만(없으면 이 파일은 오류로 끝남 — 무해).
--             T05 의 스키마가 extensions 가 아니면 아래 extensions. 을 그 스키마 이름으로 바꿔 실행.
--   한계(단정 금지):
--     - 통계는 "실행된 문장 종류 · 실행 역할 · 횟수"만 남고 실행 시각은 없다(PG17 이상은 stats_since = 통계 항목 생성 시각).
--     - 통계 초기화(pg_stat_statements_reset) · 항목 수 한도 초과 시 오래된 항목은 사라진다 → "없음"이 "실행 안 됨"을 뜻하지 않는다.
--     - 상수는 $1 등으로 치환되어 저장된다. 행 데이터 · 개인정보는 담기지 않는다(쿼리 문장 앞 160자만 출력).
-- =============================================================================
select pg_get_userbyid(s.userid) as role_name,
       s.calls,
       to_jsonb(s) ->> 'stats_since' as stats_since_pg17,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 160) as query_head
  from extensions.pg_stat_statements s
 where (s.query ilike '%row level security%' or s.query ilike '%create policy%' or s.query ilike '%drop policy%')
   and s.query ilike '%matches%'
   and s.query not ilike '%pg_class%'          -- 점검용 조회문 제외
 order by s.calls desc
 limit 30;
