-- KDK 세션 참가자 출생연도 처리 상태 점검 — 읽기 전용(SELECT 만, UPDATE/DDL 없음)
--   ⚠️ 이 파일은 마이그레이션이 아니다. 실행하지 않아도 앱은 정상 동작한다.
--      '생년 미입력으로 진행'(declined) 기능은 기존 kdk_session_attendee_meta.attendee_meta(jsonb)에
--      birthYearStatus 키만 추가로 넣으므로 새 테이블/새 컬럼/DDL 이 전혀 필요 없다.
--   ⚠️ Supabase SQL Editor(관리자)에서만 실행. 결과에 개인정보(출생연도)가 보이므로 외부 공유 금지.
--
--   attendee_meta 저장 형태(운영 상태값 추가 후):
--     { "<playerId>": { "birthYear": 1985, "birthYearStatus": "provided" } }   -- 출생연도 입력 완료
--     { "<playerId>": { "birthYearStatus": "declined" } }                      -- 운영자가 미입력 진행 승인
--     (키 자체가 없음)                                                          -- 아직 미처리 → 공식 확정 차단 대상
--
--   공식 라이브 순위 RPC(get_kdk_live_official_ranking)는 'birthYear' 키만 읽는다.
--   따라서 declined 는 서버에서도 그대로 '미제공 → 완전 동률 후순위'로 계산되어 폰/전광판이 일치한다.
--   RPC 수정 불필요.

-- ① 세션별 처리 상태 요약
SELECT '① 세션별 요약' AS section,
       meta.session_id,
       meta.updated_at,
       COUNT(*)                                                                    AS meta_entries,
       COUNT(*) FILTER (WHERE kv.value ->> 'birthYear' IS NOT NULL)                AS with_birth_year,
       COUNT(*) FILTER (WHERE kv.value ->> 'birthYearStatus' = 'declined')         AS declined,
       COUNT(*) FILTER (
         WHERE kv.value ->> 'birthYear' IS NULL
           AND COALESCE(kv.value ->> 'birthYearStatus', '') <> 'declined'
       )                                                                            AS meaningless_entries
FROM public.kdk_session_attendee_meta meta
CROSS JOIN LATERAL jsonb_each(COALESCE(meta.attendee_meta, '{}'::jsonb)) AS kv
GROUP BY meta.session_id, meta.updated_at
ORDER BY meta.updated_at DESC;

-- ② 특정 세션 상세 — 오늘 실사용 케이스(260811_KDK_01) 확인용.
--    session_id 는 필요에 따라 바꾼다. matches.session_title 로 잡힌 세션이면 ③ 을 함께 본다.
SELECT '② 세션 상세' AS section,
       kv.key                                  AS player_id,
       kv.value ->> 'birthYear'                AS birth_year,
       kv.value ->> 'birthYearStatus'          AS birth_year_status,
       CASE
         WHEN kv.value ->> 'birthYear' IS NOT NULL              THEN '해결(출생연도 확인)'
         WHEN kv.value ->> 'birthYearStatus' = 'declined'       THEN '해결(운영자 미입력 승인 → 동률 후순위)'
         ELSE '미해결(공식 확정 차단 대상)'
       END                                     AS resolution
FROM public.kdk_session_attendee_meta meta
CROSS JOIN LATERAL jsonb_each(COALESCE(meta.attendee_meta, '{}'::jsonb)) AS kv
WHERE meta.session_id = '260811_KDK_01'
ORDER BY kv.key;

-- ③ 해당 세션의 실제 참가자 대비 '메타가 아예 없는' 참가자 목록
--    (= 아직 아무 처리도 되지 않은 참가자. 회원은 members."나이" 로 해결될 수 있으므로 함께 표시)
WITH resolved AS (
  SELECT COALESCE(
    (SELECT m.session_id FROM public.matches m WHERE m.session_id = '260811_KDK_01' LIMIT 1),
    (SELECT m.session_id FROM public.matches m WHERE m.session_title = '260811_KDK_01' LIMIT 1)
  ) AS sid
),
participants AS (
  SELECT DISTINCT p.player_id,
         (array_agg(NULLIF(m.player_names[p.idx], '') ORDER BY m.id))[1] AS raw_name
  FROM public.matches m, resolved r
  CROSS JOIN LATERAL unnest(m.player_ids) WITH ORDINALITY AS p(player_id, idx)
  WHERE r.sid IS NOT NULL AND m.session_id = r.sid AND COALESCE(p.player_id, '') <> ''
  GROUP BY p.player_id
)
SELECT '③ 참가자별 해결 여부' AS section,
       pt.player_id,
       pt.raw_name,
       mem.nickname                                                    AS member_nickname,
       NULLIF(regexp_replace(COALESCE(mem."나이", ''), '\D', '', 'g'), '')::int AS member_birth_year,
       meta.attendee_meta -> pt.player_id ->> 'birthYear'              AS meta_birth_year,
       meta.attendee_meta -> pt.player_id ->> 'birthYearStatus'        AS meta_status,
       CASE
         WHEN meta.attendee_meta -> pt.player_id ->> 'birthYear' IS NOT NULL THEN '해결(세션 snapshot)'
         WHEN NULLIF(regexp_replace(COALESCE(mem."나이", ''), '\D', '', 'g'), '')::int
              BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int                THEN '해결(회원 나이)'
         WHEN meta.attendee_meta -> pt.player_id ->> 'birthYearStatus' = 'declined' THEN '해결(미입력 승인)'
         ELSE '미해결'
       END                                                             AS resolution
FROM participants pt
LEFT JOIN public.members mem ON mem.id::text = pt.player_id
LEFT JOIN public.kdk_session_attendee_meta meta ON meta.session_id = (SELECT sid FROM resolved)
ORDER BY resolution DESC, pt.raw_name;
