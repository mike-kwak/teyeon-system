-- KDK 공식 동률 규칙 fixture — SQL ↔ TypeScript 대조용 (읽기 전용 SELECT, DDL/쓰기 없음)
--
--   목적: scripts/verify_official_ranking.mts 와 '완전히 같은 입력'에 대해
--   서버 ORDER BY(get_kdk_live_official_ranking 의 ranked CTE 와 동일)가 같은 순서를 내는지 확인.
--
--   실행: Supabase SQL Editor 에 붙여 실행(테이블 접근 없음 — VALUES 만 사용하므로 안전).
--   기대: 모든 행의 names_ok / ids_ok 가 true.
--
--   재현하는 규칙: wins DESC, diff DESC, (birth_year IS NULL) ASC, birth_year ASC,
--                  name COLLATE "C" ASC, player_id COLLATE "C" ASC
--   출생연도 정규화: 숫자만 추출 → 1900 ~ 현재 연도만 인정(그 외 NULL) = normalizeBirthYear 동일.

WITH fixture(case_id, expected_names, expected_ids, player_id, name, wins, diff, birth_raw) AS (
  VALUES
    -- 01 완전 동률 1980 vs 1982 → 1980(연장자) 우선  [TS: 01 / 02 (입력 역순 동일 결과)]
    ('01', '이몽룡 > 임꺽정', NULL, 'mem-이몽룡', '이몽룡', 2, 6, '1980'),
    ('01', '이몽룡 > 임꺽정', NULL, 'mem-임꺽정', '임꺽정', 2, 6, '1982'),

    -- 03 이름순과 연장자 순이 충돌 → 연장자 우선
    ('03', '홍길동 > 김철수', NULL, 'mem-김철수', '김철수', 2, 6, '1982'),
    ('03', '홍길동 > 김철수', NULL, 'mem-홍길동', '홍길동', 2, 6, '1980'),

    -- 04 한 명만 출생연도 제공 → 제공자 우선
    ('04', '박제공 > 최미제공', NULL, 'mem-최미제공', '최미제공', 2, 6, NULL),
    ('04', '박제공 > 최미제공', NULL, 'mem-박제공', '박제공', 2, 6, '1985'),

    -- 04b 미제공자가 이름상 앞서도 제공자 우선
    ('04b', '하제공 > 가미제공', NULL, 'mem-가미제공', '가미제공', 2, 6, NULL),
    ('04b', '하제공 > 가미제공', NULL, 'mem-하제공', '하제공', 2, 6, '1999'),

    -- 05 둘 다 미제공 → 이름 가나다순
    ('05', '강호동 > 최민수', NULL, 'mem-최민수', '최민수', 2, 6, NULL),
    ('05', '강호동 > 최민수', NULL, 'mem-강호동', '강호동', 2, 6, ''),

    -- 06 같은 출생연도 → 이름 가나다순
    ('06', '김태호 > 나영석', NULL, 'mem-나영석', '나영석', 2, 6, '1981'),
    ('06', '김태호 > 나영석', NULL, 'mem-김태호', '김태호', 2, 6, '1981'),

    -- 07 같은 이름·같은 연도 → stable id 오름차순
    ('07', '홍길동 > 홍길동', 'a-001 > b-002', 'b-002', '홍길동', 2, 6, '1984'),
    ('07', '홍길동 > 홍길동', 'a-001 > b-002', 'a-001', '홍길동', 2, 6, '1984'),

    -- 08 승수가 다름 → 승수 우선(연장자보다 상위 기준)
    ('08', '김승수 > 이연장', NULL, 'mem-이연장', '이연장', 1, 9, '1970'),
    ('08', '김승수 > 이연장', NULL, 'mem-김승수', '김승수', 2, -5, '1990'),

    -- 09 2차 성적 기준(득실)이 다름 → 득실 우선
    ('09', '김득실 > 이연장', NULL, 'mem-이연장', '이연장', 1, 2, '1970'),
    ('09', '김득실 > 이연장', NULL, 'mem-김득실', '김득실', 1, 7, '1990'),

    -- 10 게스트 vs 회원 완전 동률 → 동일한 연장자 규칙(회원 우대 없음)
    ('10', '김회원 > 이게스트(G)', NULL, 'manual-guest-이게스트', '이게스트(G)', 2, 6, '1981'),
    ('10', '김회원 > 이게스트(G)', NULL, 'mem-김회원', '김회원', 2, 6, '1979'),

    -- 10b 게스트가 연장자면 게스트 우선(게스트 후순위 규칙 없음)
    ('10b', '박게스트(G) > 정회원', NULL, 'mem-정회원', '정회원', 2, 6, '1988'),
    ('10b', '박게스트(G) > 정회원', NULL, 'manual-guest-박게스트', '박게스트(G)', 2, 6, '1975'),

    -- 11b 미래 연도 → 미제공 취급 → 후순위
    ('11b', '하정상 > 가미래', NULL, 'mem-가미래', '가미래', 2, 6, (EXTRACT(YEAR FROM now())::int + 1)::text),
    ('11b', '하정상 > 가미래', NULL, 'mem-하정상', '하정상', 2, 6, '1990'),

    -- 12b 만 나이 숫자 → 미제공 취급 → 후순위
    ('12b', '하정상 > 가만나이', NULL, 'mem-가만나이', '가만나이', 2, 6, '43'),
    ('12b', '하정상 > 가만나이', NULL, 'mem-하정상', '하정상', 2, 6, '1990'),

    -- 13b 기존 year-only 게스트 문자열 → 정상 비교(연장자 우선)
    ('13b', '숫자회원 > 문자열게스트(G)', NULL, 'manual-guest-문자열게스트', '문자열게스트(G)', 2, 6, '1982'),
    ('13b', '숫자회원 > 문자열게스트(G)', NULL, 'mem-숫자회원', '숫자회원', 2, 6, '1980'),

    -- 17 혼합 풀 — 전체 정렬 결정성(TS fixture 17 과 동일 기대값)
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'mem-김가', '김가', 3, 5, '1980'),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'mem-김나', '김나', 3, 5, '1980'),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'mem-박다', '박다', 3, 5, '1975'),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'mem-이라', '이라', 3, 5, NULL),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'manual-guest-최마', '최마(G)', 3, 5, '1991'),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'mem-정바', '정바', 3, 5, '1991'),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'mem-한사', '한사', 2, 12, '1975'),
    ('17', '박다 > 김가 > 김나 > 정바 > 최마(G) > 오아(G) > 이라 > 한사', NULL, 'manual-guest-오아', '오아(G)', 3, 5, NULL)
),
normalized AS (
  -- RPC 와 동일한 정규화: 숫자만 추출 → 1900 ~ 현재 연도만 인정
  SELECT f.*,
         CASE
           WHEN cand.v BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int THEN cand.v
           ELSE NULL
         END AS birth_year
  FROM fixture f
  CROSS JOIN LATERAL (
    SELECT NULLIF(regexp_replace(COALESCE(f.birth_raw, ''), '\D', '', 'g'), '')::int AS v
  ) cand
),
ranked AS (
  SELECT case_id, expected_names, expected_ids, player_id, name,
         ROW_NUMBER() OVER (
           PARTITION BY case_id
           ORDER BY wins DESC,
                    diff DESC,
                    (birth_year IS NULL) ASC,
                    birth_year ASC,
                    name COLLATE "C" ASC,
                    player_id COLLATE "C" ASC
         ) AS rank
  FROM normalized
)
SELECT case_id,
       string_agg(name, ' > ' ORDER BY rank)      AS actual_names,
       expected_names,
       string_agg(name, ' > ' ORDER BY rank) = expected_names AS names_ok,
       string_agg(player_id, ' > ' ORDER BY rank) AS actual_ids,
       expected_ids,
       (expected_ids IS NULL
         OR string_agg(player_id, ' > ' ORDER BY rank) = expected_ids) AS ids_ok
FROM ranked
GROUP BY case_id, expected_names, expected_ids
ORDER BY case_id;
