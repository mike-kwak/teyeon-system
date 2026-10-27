-- TEYEON OPEN 공식 결과 — 입상팀 소속 클럽 검증(읽기 전용). 결과의 ok 가 모두 true 여야 한다.
--   add_hosted_tournament_result_team_clubs.sql · backfill_..._2026.sql 적용 뒤 실행.
with t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
     a as (select * from public.hosted_tournament_result_archives where tournament_id = (select id from t)),
     c as (select * from public.hosted_tournament_result_team_clubs where tournament_id = (select id from t)),
     pub as (select public.get_public_tournament_result_clubs('2026-teyeon-open') j)
select * from (values
  ('01 새 테이블 · RLS 켜짐', (select relrowsecurity from pg_class where oid = 'public.hosted_tournament_result_team_clubs'::regclass)),
  ('02 anon · authenticated 테이블 직접 권한 없음',
     not has_table_privilege('anon', 'public.hosted_tournament_result_team_clubs', 'select')
     and not has_table_privilege('authenticated', 'public.hosted_tournament_result_team_clubs', 'select')),
  ('03 수정 · 삭제 막는 트리거', exists (select 1 from pg_trigger where tgname = 'hosted_tournament_result_team_clubs_guard' and not tgisinternal)),
  ('04 내부 함수는 anon · authenticated 실행 불가',
     not has_function_privilege('anon', 'public.hosted_tournament_result_capture_clubs(uuid, uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.hosted_tournament_result_capture_clubs(uuid, uuid)', 'execute')),
  ('05 공개 함수 anon 실행 가능 · 관리자 함수 anon 불가',
     has_function_privilege('anon', 'public.get_public_tournament_result_clubs(text)', 'execute')
     and not has_function_privilege('anon', 'public.capture_tournament_result_clubs(text)', 'execute')),
  ('06 2026 입상팀 4팀 고정', (select count(*) from c) = 4),
  ('07 고정 값 = 대회 당시 선수별 클럽',
     (select string_agg(team_no || ' ' || player1_name || '(' || coalesce(player1_club, '-') || ')·' || player2_name || '(' || coalesce(player2_club, '-') || ')', ' | ' order by team_no) from c)
     = '3 박창규(천안2030)·박강진(Team테연) | 4 김재형(Team테연)·신상운(천안스카이) | 21 박상혁(천안나이테)·전용원(Team테연) | 46 구봉준(Team테연/아산클럽)·이경열(아산하나로클럽)'),
  ('08 공개 함수가 4팀을 돌려줌', jsonb_array_length((select j from pub)) = 4),
  ('09 공식 스냅샷 그대로(version 1 · 공개)', (select version = 1 and is_public from a)),
  ('10 스냅샷 지문 = 저장된 지문', (select snapshot_md5 = md5(snapshot::text) from a))
) v(check_name, ok);
