-- 공식 결과 아카이브 적용 확인 (읽기 전용 · 쓰기 없음)
--   add_hosted_tournament_result_archive.sql · add_hosted_tournament_result_media_storage.sql 실행 직후 SQL Editor 에서 실행.
--   모든 행의 result 가 ok 이면 적용 성공. CHECK 가 있으면 배포 · 확정하지 말고 알려 주세요.
--   ⚠ 공식 결과 확정은 이 SQL 이 하지 않는다 — 관리자 화면에서 검증을 보고 직접 누른다.
with t as (select id, slug from public.hosted_tournaments where slug = '2026-teyeon-open'),
     prev as (select public.hosted_tournament_result_build((select id from t)) b)
select 1 as no, '테이블 2개 · RLS 켜짐 · 직접 접근 권한 없음' as item,
       case when to_regclass('public.hosted_tournament_result_archives') is not null and to_regclass('public.hosted_tournament_result_media') is not null
             and (select bool_and(relrowsecurity) from pg_class where oid in ('public.hosted_tournament_result_archives'::regclass, 'public.hosted_tournament_result_media'::regclass))
             and not has_table_privilege('anon', 'public.hosted_tournament_result_archives', 'select')
             and not has_table_privilege('authenticated', 'public.hosted_tournament_result_media', 'select') then 'ok' else 'CHECK' end as result, '' as detail
union all
select 2, '확정 기록 보호 트리거',
       case when exists (select 1 from pg_trigger where tgname = 'hosted_tournament_result_archive_guard' and not tgisinternal) then 'ok' else 'CHECK' end, ''
union all
select 3, '공개 함수 2개 — 비로그인 실행 가능',
       case when has_function_privilege('anon', 'public.get_public_tournament_result(text)', 'execute')
             and has_function_privilege('anon', 'public.get_public_tournament_result_editions()', 'execute') then 'ok' else 'CHECK' end, ''
union all
select 4, '관리 함수 6개 — 비로그인 실행 불가',
       case when not has_function_privilege('anon', 'public.get_admin_tournament_result(text)', 'execute')
             and not has_function_privilege('anon', 'public.confirm_tournament_result(text,integer,text,text)', 'execute')
             and not has_function_privilege('anon', 'public.amend_tournament_result(text,text,integer,text)', 'execute')
             and not has_function_privilege('anon', 'public.set_tournament_result_public(text,boolean)', 'execute')
             and not has_function_privilege('anon', 'public.save_tournament_result_media(text,uuid,text,text,text,text,text,boolean,integer)', 'execute')
             and not has_function_privilege('anon', 'public.delete_tournament_result_media(text,uuid)', 'execute') then 'ok' else 'CHECK' end, ''
union all
select 5, '사진 버킷 = 비공개 · 10MB · JPEG/PNG/WebP',
       case when exists (select 1 from storage.buckets where id = 'tournament-results' and public = false and file_size_limit = 10485760) then 'ok' else 'CHECK' end, ''
union all
select 6, '사진 저장소 정책 4개',
       case when (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'tournament results media %') = 4 then 'ok' else 'CHECK' end, ''
union all
select 7, '아직 확정 · 사진 · 영상 0건(적용 직후)',
       case when (select count(*) from public.hosted_tournament_result_archives) = 0 and (select count(*) from public.hosted_tournament_result_media) = 0 then 'ok' else 'CHECK' end, ''
union all
select 8, '미리보기 검증 8항목 모두 통과(확정 가능 상태)',
       case when public.hosted_tournament_result_ok((select b from prev)) then 'ok' else 'CHECK' end,
       (select string_agg((c ->> 'key') || '=' || (c ->> 'ok'), ' · ') from jsonb_array_elements((select b from prev) -> 'checks') c)
union all
select 9, '개수 — 예선 52 · 본선 35 · 64강 자리 64 · BYE 28 · 본선 진출 36',
       case when (select b from prev) -> 'counts' @> '{"preliminaryMatches":52,"preliminaryCompleted":52,"knockoutMatches":35,"knockoutCompleted":35,"firstRoundSlots":64,"byeSlots":28,"entrants":36}'::jsonb then 'ok' else 'CHECK' end,
       ((select b from prev) -> 'counts')::text
union all
select 10, '입상(참고) — 우승 · 준우승 · 공동 3위', 'ok',
       (select '우승 ' || (a -> 'champion' -> 'team' ->> 'player1Name') || '·' || (a -> 'champion' -> 'team' ->> 'player2Name')
             || ' / 준우승 ' || (a -> 'runnerUp' -> 'team' ->> 'player1Name') || '·' || (a -> 'runnerUp' -> 'team' ->> 'player2Name')
             || ' / 공동 3위 ' || (select string_agg((s -> 'team' ->> 'player1Name') || '·' || (s -> 'team' ->> 'player2Name'), ', ') from jsonb_array_elements(a -> 'semifinalists') s)
          from (select (select b from prev) -> 'awards' a) x)
order by no;
