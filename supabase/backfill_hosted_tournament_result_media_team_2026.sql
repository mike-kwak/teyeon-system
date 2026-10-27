-- TEYEON OPEN 2026(제1회) — 기존 공동 3위 사진 2장에 입상팀 번호 연결(1회용).
--   ⚠ add_hosted_tournament_result_media_team.sql 적용 뒤에 실행한다.
--   ⚠ 사진 id · 저장 경로 · 분류 · 현재 team_no(비어 있음) · 공식 기록의 공동 3위 팀 번호가 모두 예상과 같을 때만 바꾼다. 하나라도 다르면 STOP.
--   ⚠ 사진 내용(누가 찍혔는가)은 SQL 이 알 수 없다 — 실행 전 관리자 화면 · 공개 화면에서 아래 연결이 맞는지 눈으로 확인한다.
--       0d2c9ce4-… (올린 순서 3, 연두색 상의) → TEAM 46 구봉준 · 이경열 (4강 M85)
--       ea1482cf-… (올린 순서 4, 하늘색 상의) → TEAM 4  김재형 · 신상운 (4강 M86)
--   우승 · 준우승 사진은 분류만으로 팀이 하나로 정해지므로 바꾸지 않는다.
do $$
declare
    v_tid uuid; v_semis int[]; v_n int;
begin
    select id into v_tid from public.hosted_tournaments where slug = '2026-teyeon-open';
    if v_tid is null then raise exception 'STOP: 대회 없음'; end if;
    select array_agg((s -> 'team' ->> 'teamNo')::int order by (s -> 'team' ->> 'teamNo')::int) into v_semis
      from public.hosted_tournament_result_archives a, jsonb_array_elements(a.snapshot -> 'awards' -> 'semifinalists') s
     where a.tournament_id = v_tid;
    if v_semis is distinct from array[4, 46] then raise exception 'STOP: 공식 기록의 공동 3위 팀 번호가 예상(4, 46)과 다름: %', v_semis; end if;
    select count(*) into v_n from public.hosted_tournament_result_media
     where tournament_id = v_tid and kind = 'photo' and category = 'semifinal' and team_no is null
       and ((id = '0d2c9ce4-12d1-42e3-a6f6-e49afc09564f' and storage_path = v_tid || '/6fb0b3b8-ca6f-4521-b5ba-860ab5a0a18d.webp')
         or (id = 'ea1482cf-90d9-44f4-b4ff-ad59f100a497' and storage_path = v_tid || '/9b70fb96-7127-4a87-98f9-126ae7195ed9.webp'));
    if v_n <> 2 then raise exception 'STOP: 대상 사진 2장이 예상 상태가 아님(찾은 수 %) — 이미 연결됐거나 바뀜', v_n; end if;
    update public.hosted_tournament_result_media set team_no = 46, updated_at = now() where id = '0d2c9ce4-12d1-42e3-a6f6-e49afc09564f' and tournament_id = v_tid;
    update public.hosted_tournament_result_media set team_no = 4,  updated_at = now() where id = 'ea1482cf-90d9-44f4-b4ff-ad59f100a497' and tournament_id = v_tid;
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_media_team_backfilled', null,
        jsonb_build_object('0d2c9ce4-12d1-42e3-a6f6-e49afc09564f', 46, 'ea1482cf-90d9-44f4-b4ff-ad59f100a497', 4), null);
end;
$$;
