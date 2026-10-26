-- 공식 결과 아카이브 — 운영 적용 전 사전 점검 (읽기 전용 · 쓰기 없음)
--   SQL 1 · 2 를 실행하기 전에 SQL Editor 에서 먼저 실행. 모든 행이 ok 여야 진행한다. STOP/CHECK 가 하나라도 있으면 중단하고 알려 주세요.
--   ⚠ 백업 상태는 SQL 로 볼 수 없다 — Dashboard → Database → Backups 에서 최근 백업(또는 PITR) 시각을 확인한다.
with t as (select id, slug, title, event_date from public.hosted_tournaments where slug = '2026-teyeon-open'),
     d as (select public.get_public_preliminary_draw('2026-teyeon-open') v),
     k as (select public.get_public_knockout_bracket('2026-teyeon-open') v),
     fm as (select m from k, jsonb_array_elements(k.v -> 'matches') m
             where m ->> 'targetSlotPublicKey' = (select s ->> 'publicKey' from k, jsonb_array_elements(k.v -> 'slots') s where (s ->> 'isFinalSlot')::boolean limit 1))
select 1 as no, 'TEYEON 운영 프로젝트(2026 TEYEON OPEN 존재)' as item,
       case when (select count(*) from t) = 1 then 'ok' else 'STOP' end as result,
       (select title || ' · ' || event_date from t) as detail
union all
select 2, 'Storage 버킷 tournament-results 없음(새로 만든다)',
       case when not exists (select 1 from storage.buckets where id = 'tournament-results') then 'ok' else 'STOP' end,
       coalesce((select 'public=' || public || ' limit=' || coalesce(file_size_limit::text, 'null') from storage.buckets where id = 'tournament-results'), '없음')
union all
select 3, '결과 아카이브 테이블 · 함수 아직 없음(이름 충돌 없음)',
       case when to_regclass('public.hosted_tournament_result_archives') is null and to_regclass('public.hosted_tournament_result_media') is null
             and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public' and p.proname in ('get_public_tournament_result', 'get_public_tournament_result_editions',
                                'get_admin_tournament_result', 'confirm_tournament_result', 'amend_tournament_result', 'set_tournament_result_public',
                                'save_tournament_result_media', 'delete_tournament_result_media', 'hosted_tournament_result_build', 'hosted_tournament_result_ok',
                                'hosted_tournament_result_archive_guard', 'hosted_tournament_result_photo_is_public'))
            then 'ok' else 'STOP' end, ''
union all
select 4, 'Storage 정책 이름 충돌 없음',
       case when not exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'tournament results media %') then 'ok' else 'STOP' end, ''
union all
select 5, '선행 함수 존재(권한 판정 · 이벤트 기록 · 공개 조회)',
       case when to_regprocedure('public.can_manage_tournaments()') is not null and to_regprocedure('public.hosted_tournament_log_event(uuid,text,uuid,text,jsonb,jsonb,text)') is not null
             and to_regprocedure('public.get_public_preliminary_draw(text)') is not null and to_regprocedure('public.get_public_knockout_bracket(text)') is not null then 'ok' else 'STOP' end, ''
union all
select 6, '예선 52경기 완료',
       case when (select count(*) filter (where m.status = 'completed') from public.hosted_tournament_matches m join t on t.id = m.tournament_id where m.stage <> 'knockout') = 52
             and (select count(*) from public.hosted_tournament_matches m join t on t.id = m.tournament_id where m.stage <> 'knockout') = 52 then 'ok' else 'CHECK' end, ''
union all
select 7, '본선 35경기 완료 · 대진 completed',
       case when (select count(*) filter (where m.status = 'completed') from public.hosted_tournament_matches m join t on t.id = m.tournament_id where m.stage = 'knockout') = 35
             and (select count(*) from public.hosted_tournament_matches m join t on t.id = m.tournament_id where m.stage = 'knockout') = 35
             and (select k.v -> 'publication' ->> 'bracketStatus' from k) = 'completed' then 'ok' else 'CHECK' end, ''
union all
select 8, '64강 BYE 28',
       case when (select count(*) from k, jsonb_array_elements(k.v -> 'slots') s where (s ->> 'roundNo')::int = 1 and s ->> 'slotType' = 'bye') = 28 then 'ok' else 'CHECK' end, ''
union all
select 9, '결승 M87 · 우승 박창규·박강진 · 준우승 박상혁·전용원',
       case when (select (m ->> 'matchNo')::int from fm) = 87
             and (select case m ->> 'winnerSide' when '1' then m -> 'team1' ->> 'player1Name' else m -> 'team2' ->> 'player1Name' end from fm) = '박창규'
             and (select case m ->> 'winnerSide' when '1' then m -> 'team2' ->> 'player1Name' else m -> 'team1' ->> 'player1Name' end from fm) = '박상혁'
            then 'ok' else 'CHECK' end,
       (select 'M' || (m ->> 'matchNo') || ' ' || (m ->> 'score1') || ':' || (m ->> 'score2') from fm)
order by no;
