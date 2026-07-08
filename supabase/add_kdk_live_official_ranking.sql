-- KDK 공식 라이브 순위 RPC — 서버 단일 계산 (anon 전광판 포함 모든 화면의 공식 순위 source)
--   ⚠️ 사용자 승인 후 실행. add_kdk_guest_profiles.sql(테이블/보안) 적용 후 실행할 것.
--
--   목적: 폰(/kdk)과 전광판(/kdk/display)이 동일한 공식 순위를 보되,
--   공개 응답에는 birth_year/UUID/개인정보를 절대 포함하지 않는다.
--
--   공식 comparator (lib/kdk/officialRanking.ts 와 반드시 동일 — fixture 대조 필수):
--     ① 승수 ↓ ② 득실 ↓ ③ 출생연도 제공자 우선 → 제공 시 큰 값(연소자) 우선
--     ④ 이름(코드포인트 = COLLATE "C") ↑ ⑤ 내부 stable id ↑ (정렬에만 사용, 미반환)
--   이름 정렬: TS localeCompare('ko') 와 PG collation 차이를 없애기 위해 양쪽 모두
--   유니코드 코드포인트 비교로 통일(한글 음절은 코드포인트 = 가나다순 — 순수 한글 이름 순서 동일).
--
--   경기 포함 규칙: status='complete' AND score1<>score2 (동점·미완료·무효 제외 — 전 화면 통일)
--   birthYear: 게스트 = kdk_session_attendee_meta snapshot / 회원 = members."나이",
--   양쪽 모두 1900~현재연도만 인정(normalizeBirthYear 와 동일).
--
--   반환(공개 안전 필드만): name(표시명, 게스트 '(G)'), wins, losses, pf, pa, diff, rank, isGuest
--   반환 금지: birth_year/age/UUID/auth_user_id/전화/이메일/guest_key/player_id/attendee_meta 원문.
--   공개 범위: 현재 anon 전광판이 이미 보는 정보(이름·전적)를 넘지 않는다.

CREATE OR REPLACE FUNCTION public.get_kdk_live_official_ranking(p_session_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH resolved AS (
  -- 전광판과 동일한 세션 해석: session_id 우선, 없으면 session_title
  SELECT COALESCE(
    (SELECT m.session_id FROM public.matches m WHERE m.session_id = p_session_id LIMIT 1),
    (SELECT m.session_id FROM public.matches m WHERE m.session_title = p_session_id LIMIT 1)
  ) AS sid
),
tm AS (
  SELECT m.id, m.player_ids, m.player_names, m.score1, m.score2
  FROM public.matches m, resolved r
  WHERE r.sid IS NOT NULL
    AND m.session_id = r.sid
    AND m.status = 'complete'
    AND COALESCE(m.score1, 0) <> COALESCE(m.score2, 0)
),
slots AS (
  SELECT p.player_id,
         p.idx,
         COALESCE(NULLIF(tm.player_names[p.idx], ''), p.player_id) AS raw_name,
         CASE WHEN p.idx <= 2 THEN COALESCE(tm.score1, 0) ELSE COALESCE(tm.score2, 0) END AS my_score,
         CASE WHEN p.idx <= 2 THEN COALESCE(tm.score2, 0) ELSE COALESCE(tm.score1, 0) END AS opp_score
  FROM tm
  CROSS JOIN LATERAL unnest(tm.player_ids) WITH ORDINALITY AS p(player_id, idx)
  WHERE COALESCE(p.player_id, '') <> ''
),
stats AS (
  SELECT player_id,
         (array_agg(raw_name ORDER BY idx))[1] AS raw_name,
         (COUNT(*) FILTER (WHERE my_score > opp_score))::int AS wins,
         (COUNT(*) FILTER (WHERE my_score < opp_score))::int AS losses,
         COALESCE(SUM(my_score), 0)::int AS pf,
         COALESCE(SUM(opp_score), 0)::int AS pa
  FROM slots
  GROUP BY player_id
),
enriched AS (
  SELECT s.player_id, s.raw_name, s.wins, s.losses, s.pf, s.pa,
         mem.nickname AS member_name,
         (mem.id IS NULL
           OR s.player_id ILIKE 'manual-guest-%'
           OR s.player_id ILIKE 'g-%'
           OR s.raw_name ~* '\(G\)\s*$') AS is_guest,
         by_check.birth_year
  FROM stats s
  LEFT JOIN public.members mem ON mem.id::text = s.player_id
  LEFT JOIN public.kdk_session_attendee_meta meta
    ON meta.session_id = (SELECT sid FROM resolved)
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN cand.v BETWEEN 1900 AND EXTRACT(YEAR FROM now())::int THEN cand.v
      ELSE NULL
    END AS birth_year
    FROM (
      SELECT COALESCE(
        NULLIF(meta.attendee_meta -> s.player_id ->> 'birthYear', '')::int,          -- 게스트: 세션 snapshot
        NULLIF(regexp_replace(COALESCE(mem."나이", ''), '\D', '', 'g'), '')::int      -- 회원: members."나이"
      ) AS v
    ) cand
  ) by_check
),
named AS (
  SELECT e.*,
    CASE
      WHEN e.member_name IS NOT NULL AND NOT e.is_guest THEN e.member_name
      WHEN e.player_id ILIKE 'manual-guest-%'
        THEN regexp_replace(regexp_replace(e.raw_name, '^manual-guest-', '', 'i'), '\s*\(G\)\s*$', '', 'i') || '(G)'
      WHEN e.raw_name ~* '\(G\)\s*$'
        THEN regexp_replace(e.raw_name, '\s*\(G\)\s*$', '', 'i') || '(G)'
      -- 이름 해석 실패 엣지(회원 미매칭 + player_names 공백): 내부 UUID 를 표시명으로 절대 노출하지 않음
      WHEN e.raw_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN '이름 확인 중'
      WHEN e.is_guest THEN e.raw_name || '(G)'
      ELSE e.raw_name
    END AS display_name
  FROM enriched e
),
ranked AS (
  SELECT display_name, wins, losses, pf, pa, (pf - pa) AS diff, is_guest,
         (ROW_NUMBER() OVER (
           ORDER BY wins DESC,
                    (pf - pa) DESC,
                    (birth_year IS NULL) ASC,   -- 미제공은 후순위
                    birth_year DESC,            -- 제공 시 연소자(큰 연도) 우선
                    display_name COLLATE "C" ASC,
                    player_id COLLATE "C" ASC   -- 내부 정렬 전용(미반환)
         ))::int AS rank
  FROM named
)
SELECT COALESCE(
  jsonb_agg(
    jsonb_build_object(
      'name', display_name,
      'wins', wins,
      'losses', losses,
      'pf', pf,
      'pa', pa,
      'diff', diff,
      'rank', rank,
      'isGuest', is_guest
    ) ORDER BY rank
  ),
  '[]'::jsonb
)
FROM ranked;
$$;

-- 실행 권한: anon(공개 전광판) + authenticated 만. 그 외 전부 revoke.
REVOKE ALL ON FUNCTION public.get_kdk_live_official_ranking(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_kdk_live_official_ranking(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
