-- TEYEON OPEN 2026(제1회) — 입상팀 4팀의 선수별 소속 클럽 고정(1회용).
--   ⚠ add_hosted_tournament_result_team_clubs.sql 적용 뒤에 실행한다.
--   ⚠ 공식 스냅샷의 입상팀 번호 · 이름이 예상과 같고, 경기 운영 팀(hosted_tournament_teams)의 선수별 클럽이
--     아래 값(공개 참가팀 화면에 공개된 값)과 정확히 같을 때만 저장한다. 하나라도 다르면 STOP(전체 취소).
--       우승     TEAM 3  박창규(천안2030) · 박강진(Team테연)
--       준우승   TEAM 21 박상혁(천안나이테) · 전용원(Team테연)
--       공동 3위 TEAM 46 구봉준(Team테연/아산클럽) · 이경열(아산하나로클럽)
--       공동 3위 TEAM 4  김재형(Team테연) · 신상운(천안스카이)
--   ⚠ 공식 스냅샷 · 공개 상태 · 사진은 바꾸지 않는다. 새 테이블에 4줄만 추가한다.
begin;

do $$
declare
    v_tid uuid; v_aw jsonb; v_got text; v_want text; v_r jsonb;
begin
    select id into v_tid from public.hosted_tournaments where slug = '2026-teyeon-open';
    if v_tid is null then raise exception 'STOP: 대회 없음'; end if;
    select snapshot -> 'awards' into v_aw from public.hosted_tournament_result_archives where tournament_id = v_tid;
    if v_aw is null then raise exception 'STOP: 공식 결과 아카이브 없음'; end if;

    -- 1) 공식 스냅샷의 입상팀
    v_got := concat_ws(' | ',
        (v_aw -> 'champion' -> 'team' ->> 'teamNo') || ' ' || (v_aw -> 'champion' -> 'team' ->> 'player1Name') || '·' || (v_aw -> 'champion' -> 'team' ->> 'player2Name'),
        (v_aw -> 'runnerUp' -> 'team' ->> 'teamNo') || ' ' || (v_aw -> 'runnerUp' -> 'team' ->> 'player1Name') || '·' || (v_aw -> 'runnerUp' -> 'team' ->> 'player2Name'),
        (select string_agg((s -> 'team' ->> 'teamNo') || ' ' || (s -> 'team' ->> 'player1Name') || '·' || (s -> 'team' ->> 'player2Name'), ' | '
                           order by (s -> 'team' ->> 'teamNo')::int)
           from jsonb_array_elements(v_aw -> 'semifinalists') s));
    v_want := '3 박창규·박강진 | 21 박상혁·전용원 | 4 김재형·신상운 | 46 구봉준·이경열';
    if v_got is distinct from v_want then raise exception 'STOP: 공식 입상팀이 예상과 다름: %', v_got; end if;

    -- 2) 경기 운영 팀의 선수별 클럽(옮겨 올 원본)
    select string_agg(t.team_no || ' ' || t.player1_name || '(' || coalesce(t.player1_club_name, '-') || ')·'
                      || t.player2_name || '(' || coalesce(t.player2_club_name, '-') || ')', ' | ' order by t.team_no)
      into v_got
      from public.hosted_tournament_teams t where t.tournament_id = v_tid and t.team_no in (3, 4, 21, 46);
    v_want := '3 박창규(천안2030)·박강진(Team테연) | 4 김재형(Team테연)·신상운(천안스카이) | 21 박상혁(천안나이테)·전용원(Team테연) | 46 구봉준(Team테연/아산클럽)·이경열(아산하나로클럽)';
    if v_got is distinct from v_want then raise exception 'STOP: 팀 클럽 원본이 예상과 다름: %', v_got; end if;

    if exists (select 1 from public.hosted_tournament_result_team_clubs where tournament_id = v_tid) then
        raise exception 'STOP: 이미 고정된 클럽 기록이 있음(다시 실행할 필요 없음)';
    end if;

    -- 3) 고정(관리자 함수와 같은 내부 함수)
    v_r := public.hosted_tournament_result_capture_clubs(v_tid, null);
    if (v_r ->> 'saved')::int <> 4 or jsonb_array_length(v_r -> 'skippedTeamNos') <> 0 then
        raise exception 'STOP: 4팀 저장 실패: %', v_r;
    end if;
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_team_clubs_captured', null, v_r, '2026 제1회 입상팀 클럽 고정(backfill)');
end;
$$;

commit;
