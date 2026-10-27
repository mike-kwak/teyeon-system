-- 읽기 전용 — 입상 사진 ↔ 입상팀 연결 적용 확인. 모든 행 ok = true 여야 한다.
with t as (select id from public.hosted_tournaments where slug = '2026-teyeon-open'),
     a as (select a.snapshot -> 'awards' aw from public.hosted_tournament_result_archives a, t where a.tournament_id = t.id),
     m as (select m.* from public.hosted_tournament_result_media m, t where m.tournament_id = t.id)
select * from (values
  ('1 team_no 칸', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hosted_tournament_result_media' and column_name = 'team_no'), null::text),
  ('2 team_no 제약', exists (select 1 from pg_constraint where conname = 'result_media_team_no'), null),
  ('3 저장 함수 10개 인자 판', exists (select 1 from pg_proc where proname = 'save_tournament_result_media' and pronargs = 10), null),
  ('4 기존 9개 인자 판 유지', exists (select 1 from pg_proc where proname = 'save_tournament_result_media' and pronargs = 9), null),
  ('5 anon 은 저장 함수 실행 불가', not has_function_privilege('anon', 'public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer, integer)', 'execute'), null),
  ('6 공개 조회에 teamNo', (select bool_and(x ? 'teamNo') from jsonb_array_elements(public.get_public_tournament_result('2026-teyeon-open') -> 'media') x), null),
  ('7 공동 3위 사진 연결(46 · 4 각 1장)', (select count(*) filter (where team_no = 46) = 1 and count(*) filter (where team_no = 4) = 1 from m where category = 'semifinal'),
     (select string_agg(left(id::text, 8) || '→' || coalesce(team_no::text, '미지정'), ', ' order by display_order) from m where category = 'semifinal')),
  ('8 연결된 팀은 모두 공식 입상팀', not exists (select 1 from m, a where m.team_no is not null and not (
        (m.category = 'champion' and (a.aw -> 'champion' -> 'team' ->> 'teamNo')::int = m.team_no)
     or (m.category = 'runner_up' and (a.aw -> 'runnerUp' -> 'team' ->> 'teamNo')::int = m.team_no)
     or (m.category = 'semifinal' and exists (select 1 from jsonb_array_elements(a.aw -> 'semifinalists') s where (s -> 'team' ->> 'teamNo')::int = m.team_no)))), null),
  ('9 공식 기록 그대로(버전 · 공개)', (select version = 1 and is_public from public.hosted_tournament_result_archives, t where tournament_id = t.id), (select snapshot_md5 from public.hosted_tournament_result_archives, t where tournament_id = t.id)),
  ('10 공개 승인 사진 6장 그대로', (select count(*) = 6 from m where kind = 'photo' and is_public), (select count(*)::text from m where kind = 'photo' and is_public))
) v(check_name, ok, detail);
