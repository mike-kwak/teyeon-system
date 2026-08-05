-- 출생연도 데이터 점검 — 읽기 전용(SELECT 만, UPDATE/DDL 없음)
--   목적: 회원(members."나이")과 게스트(kdk_guest_profiles / kdk_session_attendee_meta)의
--   출생연도 값이 공식 normalizeBirthYear 규칙(1900 ~ 현재 연도의 4자리 연도)에 맞는지 확인.
--   ⚠️ 자동 보정하지 않는다. 이상값이 나오면 별도 보고 후 사용자 승인 하에 수정한다.
--   ⚠️ Supabase SQL Editor(관리자)에서만 실행. 결과에 개인정보가 보이므로 외부 공유 금지.

-- ① 회원 members."나이" 분포 요약
SELECT '① members.나이 요약' AS section,
       COUNT(*)                                                              AS total_members,
       COUNT(*) FILTER (WHERE COALESCE("나이", '') = '')                      AS blank_value,
       COUNT(*) FILTER (WHERE "나이" ~ '^\s*[0-9]{4}\s*$')                    AS four_digit_shape,
       COUNT(*) FILTER (WHERE COALESCE("나이", '') <> '' AND "나이" !~ '^\s*[0-9]{4}\s*$') AS non_four_digit_shape,
       COUNT(*) FILTER (
         WHERE NULLIF(regexp_replace(COALESCE("나이", ''), '\D', '', 'g'), '')::int
               BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
       )                                                                      AS normalizes_ok,
       COUNT(*) FILTER (
         WHERE COALESCE("나이", '') <> ''
           AND COALESCE(
                 NULLIF(regexp_replace(COALESCE("나이", ''), '\D', '', 'g'), '')::int, -1
               ) NOT BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
       )                                                                      AS normalizes_null_despite_value
FROM public.members;

-- ② 회원 이상값 상세 (값이 있는데 normalize 결과가 NULL 이 되는 행 — 만 나이/미래 연도/오타 후보)
SELECT '② members 이상값' AS section,
       m.id, m.nickname, m."나이" AS raw_value,
       NULLIF(regexp_replace(COALESCE(m."나이", ''), '\D', '', 'g'), '')::int AS digits_only,
       CASE
         WHEN NULLIF(regexp_replace(COALESCE(m."나이", ''), '\D', '', 'g'), '')::int
              > EXTRACT(YEAR FROM now())::int THEN '미래 연도'
         WHEN NULLIF(regexp_replace(COALESCE(m."나이", ''), '\D', '', 'g'), '')::int < 1900
              THEN '만 나이/비정상 소수 자릿수'
         ELSE '숫자 없음/형식 이상'
       END AS reason
FROM public.members m
WHERE COALESCE(m."나이", '') <> ''
  AND COALESCE(
        NULLIF(regexp_replace(COALESCE(m."나이", ''), '\D', '', 'g'), '')::int, -1
      ) NOT BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
ORDER BY m.nickname;

-- ③ 게스트 영구 프로필(kdk_guest_profiles.birth_year) 점검
SELECT '③ kdk_guest_profiles' AS section,
       COUNT(*)                                                            AS total_rows,
       COUNT(*) FILTER (WHERE birth_year IS NULL)                          AS null_value,
       COUNT(*) FILTER (WHERE birth_year BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int) AS normalizes_ok,
       COUNT(*) FILTER (
         WHERE birth_year IS NOT NULL
           AND birth_year NOT BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
       )                                                                    AS out_of_range
FROM public.kdk_guest_profiles;

-- ④ 게스트 영구 프로필 이상값 상세
SELECT '④ kdk_guest_profiles 이상값' AS section, *
FROM public.kdk_guest_profiles
WHERE birth_year IS NOT NULL
  AND birth_year NOT BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int;

-- ⑤ 세션 snapshot(kdk_session_attendee_meta.attendee_meta -> *.birthYear) 점검
WITH flat AS (
  SELECT meta.session_id,
         kv.key   AS player_id,
         kv.value ->> 'birthYear' AS raw_value
  FROM public.kdk_session_attendee_meta meta
  CROSS JOIN LATERAL jsonb_each(COALESCE(meta.attendee_meta, '{}'::jsonb)) AS kv
)
SELECT '⑤ attendee_meta snapshot' AS section,
       COUNT(*)                                                        AS total_entries,
       COUNT(*) FILTER (WHERE COALESCE(raw_value, '') = '')            AS blank_value,
       COUNT(*) FILTER (
         WHERE NULLIF(regexp_replace(COALESCE(raw_value, ''), '\D', '', 'g'), '')::int
               BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
       )                                                                AS normalizes_ok,
       COUNT(*) FILTER (
         WHERE COALESCE(raw_value, '') <> ''
           AND COALESCE(
                 NULLIF(regexp_replace(COALESCE(raw_value, ''), '\D', '', 'g'), '')::int, -1
               ) NOT BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
       )                                                                AS out_of_range
FROM flat;

-- ⑥ 세션 snapshot 이상값 상세
WITH flat AS (
  SELECT meta.session_id,
         kv.key   AS player_id,
         kv.value ->> 'birthYear' AS raw_value
  FROM public.kdk_session_attendee_meta meta
  CROSS JOIN LATERAL jsonb_each(COALESCE(meta.attendee_meta, '{}'::jsonb)) AS kv
)
SELECT '⑥ attendee_meta 이상값' AS section, session_id, player_id, raw_value
FROM flat
WHERE COALESCE(raw_value, '') <> ''
  AND COALESCE(
        NULLIF(regexp_replace(COALESCE(raw_value, ''), '\D', '', 'g'), '')::int, -1
      ) NOT BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int
ORDER BY session_id, player_id;
