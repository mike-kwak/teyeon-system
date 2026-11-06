-- =============================================================================
-- MATCH SPOTLIGHT 테스트 환경 — 가상 데이터 (실존 회원·실제 경기 데이터 없음)
--
-- ⚠️ 테스트 전용 프로젝트에서만. 모든 세션 id 는 QA- / SP-QA- 접두사.
--   로그인 화면 QA 를 하려면 테스트 프로젝트에서 가입한 계정의 auth.users.id 로 아래 profiles 를 바꾼다.
-- =============================================================================
insert into public.profiles (id, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'CEO'),
  ('00000000-0000-4000-8000-0000000000a1', 'ADMIN'),
  ('00000000-0000-4000-8000-0000000000e1', 'MEMBER')
on conflict (id) do update set role = excluded.role;

-- KDK 세션(대기 8경기 · 2라운드 · 조 A/B) — 가상 이름, 게스트 1명 포함
insert into public.matches (id, club_id, session_id, session_title, round, court, player_ids, player_names, score1, score2, status, mode, group_name)
select 'qa-kdk-' || g, 'QA-CLUB', 'QA-KDK-20261103', 'QA 정기 KDK', (g + 3) / 4, ((g - 1) % 4) + 1,
       array['qa-m' || g, 'qa-m' || (g + 10), 'qa-m' || (g + 20), case when g = 3 then 'g-qa-guest' else 'qa-m' || (g + 30) end],
       array['가상' || g, '가상' || (g + 10), '가상' || (g + 20), case when g = 3 then '게스트손님(G)' else '가상' || (g + 30) end],
       1, 1, 'waiting', 'KDK', case when g % 2 = 0 then 'B' else 'A' end
  from generate_series(1, 8) g
on conflict (id) do nothing;

-- Special Match 세션(SP- 접두사 · court null · sync_tournament_matches 로 운영되는 경로)
insert into public.matches (id, club_id, session_id, session_title, round, court, player_ids, player_names, status, mode)
select 'qa-sp-' || g, 'QA-CLUB', 'SP-QA-20261103', 'QA 스페셜', g, null,
       array['qa-s' || g, 'qa-s' || (g + 10), 'qa-s' || (g + 20), 'qa-s' || (g + 30)],
       array['스페셜' || g, '스페셜' || (g + 10), '스페셜' || (g + 20), '스페셜' || (g + 30)], 'waiting', 'SPECIAL'
  from generate_series(1, 4) g
on conflict (id) do nothing;
