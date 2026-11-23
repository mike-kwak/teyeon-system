-- [K1 보충 점검 · 조회 전용] SELECT 만 사용 · 개인정보 없음
select 'S01' k, 'matches 컬럼' item,
  (select string_agg(column_name||':'||data_type||case when is_nullable='NO' then '!' else '' end, ', ' order by ordinal_position)
     from information_schema.columns where table_schema='public' and table_name='matches') result
union all select 'S02', 'trigger(실행 순서: BEFORE→AFTER, 이름순)',
  (select string_agg(case when tgtype&2=2 then 'B:' else 'A:' end||tgname||case when tgenabled='D' then '(꺼짐)' else '' end, ', '
          order by (tgtype&2=2) desc, tgname)
     from pg_trigger where tgrelid='public.matches'::regclass and not tgisinternal)
union all select 'S03', 'RLS 활성 / 강제',
  (select relrowsecurity::text||' / '||relforcerowsecurity::text from pg_class where oid='public.matches'::regclass)
union all select 'S04', 'RLS 정책(이름:명령:역할)',
  (select coalesce(string_agg(policyname||':'||cmd||':'||array_to_string(roles,'|'), ', ' order by policyname), '없음')
     from pg_policies where schemaname='public' and tablename='matches')
-- S05 기대값 정정(2026-11-24): 9ad744bd 는 저장소 최신본(2106e5b + KDKM) md5 이고, 운영 본문은 9568938e(99012c3 + KDKM)다.
--   차이: 저장소판만 23505(unique_violation) → court_conflict 응답 변환 처리가 있다. 운영판은 이 처리 없음(기존 차이 · K1 무관).
--   K1 호환성: 운영 본문 9568938e 기준 prodlike 시험 36/36 PASS. 9ad744bd 를 운영 기대값으로 해석하지 말 것.
union all select 'S05', 'start_kdk_match 본문 md5(운영 기대 9568938e · 저장소 최신 9ad744bd)',
  (select coalesce(string_agg(left(md5(replace(prosrc,E'\r','')),8)||case when prosecdef then ' DEFINER' else '' end, ','), '없음')
     from pg_proc where pronamespace='public'::regnamespace and proname='start_kdk_match')
union all select 'S06', '함수 md5: timer 6cdae88f · guard 5ba5474d · ledger 8ded7e73 · capture 08a83c90 · recert 457e28d8',
  (select string_agg(proname||'='||left(md5(replace(prosrc,E'\r','')),8), ', ' order by proname)
     from pg_proc where pronamespace='public'::regnamespace and proname in
     ('start_kdk_match_timer','kdk_p1_score_guard','kdk_p1_score_ledger','kdk_match_lifecycle_capture','kdk_match_lifecycle_recert'))
union all select 'S07', '진행 중 경기 / 진행·대기 경기가 있는 세션',
  (select count(*) filter (where status='playing')||' / '||count(distinct session_id) filter (where status in ('playing','waiting')) from public.matches)
union all select 'S08', '최근 matches 활동(경기 중인지 판단용)',
  (select coalesce(max(created_at)::text,'없음') from public.matches)
union all select 'S09', 'play_epoch·epoch·version 류 컬럼 / K1 함수·trigger 존재',
  (select coalesce(string_agg(column_name, ','), '없음') from information_schema.columns
    where table_schema='public' and table_name='matches' and (column_name ilike '%epoch%' or column_name ilike '%version%'))
  ||' / '||(to_regprocedure('public.kdk_play_epoch_guard()') is not null)::text
  ||' / '||exists(select 1 from pg_trigger where tgname='kdk_play_epoch_trg')::text
union all select 'S10', 'kdk_play_epoch_trg 보다 뒤에 실행될 BEFORE trigger',
  (select coalesce(string_agg(tgname, ','), '없음') from pg_trigger
    where tgrelid='public.matches'::regclass and not tgisinternal and tgtype&2=2 and tgname > 'kdk_play_epoch_trg');
