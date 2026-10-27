-- TEYEON OPEN 공식 결과 — 입상 사진 ↔ 입상팀 연결(team_no).
--
--   왜: 지금 hosted_tournament_result_media 에는 사진이 '어느 입상팀' 사진인지 적는 칸이 없다(분류 · 제목 · 순서뿐).
--       우승 · 준우승은 분류만으로 팀이 하나로 정해지지만, 공동 3위는 두 팀이라 순서에 기대면 사진이 서로 바뀔 수 있다.
--   무엇: ① team_no 칸 추가(입상 사진만, 비어 있으면 '미지정') ② 사진 저장 함수에 p_team_no 를 받는 새 판(10개 인자)
--         — 공식 확정 기록(스냅샷)의 그 분류 입상팀 번호일 때만 받는다 ③ 공개 · 관리자 조회에 teamNo 를 내보낸다.
--   ⚠ 공식 스냅샷 · 확정 · 정정 · 공개 상태 · Storage 는 건드리지 않는다. 기존 사진 행은 team_no 가 빈 채로 남는다
--     (기존 9개 인자 저장 함수도 그대로 둔다 — 새 화면 배포 전까지 지금 화면이 계속 동작).
--   ⚠ 여러 번 실행해도 같은 결과(멱등).

alter table public.hosted_tournament_result_media add column if not exists team_no integer;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'result_media_team_no'
                     and conrelid = 'public.hosted_tournament_result_media'::regclass) then
        alter table public.hosted_tournament_result_media add constraint result_media_team_no check (
            team_no is null or (team_no > 0 and kind = 'photo' and category in ('champion', 'runner_up', 'semifinal')));
    end if;
end;
$$;

-- 사진 · 영상 연결 저장(팀 지정 판). 새 사진의 공동 3위는 팀 지정 필수, 지정한 팀은 공식 확정 기록의 그 분류 입상팀이어야 한다.
create or replace function public.save_tournament_result_media(
    p_slug text, p_id uuid, p_kind text, p_category text, p_title text,
    p_storage_path text, p_youtube_id text, p_is_public boolean, p_display_order integer, p_team_no integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid; v_id uuid; v_awards jsonb;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); end if;
    if p_kind = 'photo' and (p_storage_path is null or split_part(p_storage_path, '/', 1) <> v_tid::text) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_path');
    end if;
    if p_id is null and p_kind = 'photo' and p_category = 'semifinal' and p_team_no is null then
        return jsonb_build_object('ok', false, 'reason', 'team_required');
    end if;
    if p_team_no is not null then
        select a.snapshot -> 'awards' into v_awards from public.hosted_tournament_result_archives a where a.tournament_id = v_tid;
        if v_awards is null or jsonb_typeof(v_awards) <> 'object' or not (
               (p_category = 'champion'  and (v_awards -> 'champion' -> 'team' ->> 'teamNo')::integer = p_team_no)
            or (p_category = 'runner_up' and (v_awards -> 'runnerUp' -> 'team' ->> 'teamNo')::integer = p_team_no)
            or (p_category = 'semifinal' and exists (select 1 from jsonb_array_elements(v_awards -> 'semifinalists') s
                                                      where (s -> 'team' ->> 'teamNo')::integer = p_team_no))) then
            return jsonb_build_object('ok', false, 'reason', 'team_mismatch');
        end if;
    end if;
    begin
        if p_id is null then
            insert into public.hosted_tournament_result_media (tournament_id, kind, category, title, storage_path, youtube_id, is_public, display_order, team_no, created_by)
            values (v_tid, p_kind, p_category, nullif(btrim(coalesce(p_title, '')), ''), p_storage_path, p_youtube_id,
                    coalesce(p_is_public, false), coalesce(p_display_order, 0), p_team_no, auth.uid())
            returning id into v_id;
        else
            update public.hosted_tournament_result_media
               set category = p_category, title = nullif(btrim(coalesce(p_title, '')), ''),
                   youtube_id = case when kind = 'video' then p_youtube_id else youtube_id end,
                   is_public = coalesce(p_is_public, false), display_order = coalesce(p_display_order, 0),
                   team_no = p_team_no, updated_at = now()
             where id = p_id and tournament_id = v_tid
            returning id into v_id;
            if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
        end if;
    exception when check_violation then
        return jsonb_build_object('ok', false, 'reason', 'invalid_media');
    end;
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_media_saved', null,
        jsonb_build_object('id', v_id, 'kind', p_kind, 'category', p_category, 'isPublic', coalesce(p_is_public, false), 'teamNo', p_team_no), null);
    return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer, integer) to authenticated;

-- 조회 두 개 — 사진마다 teamNo 를 더 내보낸다(나머지는 기존과 같음).
create or replace function public.get_public_tournament_result(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_a   public.hosted_tournament_result_archives%rowtype;
begin
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;
    select * into v_a from public.hosted_tournament_result_archives where tournament_id = v_tid and is_public;
    if v_a.tournament_id is null then return null; end if;
    return jsonb_build_object(
        'editionNo', v_a.edition_no, 'editionLabel', v_a.edition_label,
        'version', v_a.version, 'confirmedAt', v_a.confirmed_at,
        'snapshot', v_a.snapshot - 'checks',
        'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'category', m.category, 'title', m.title,
                                                               'storagePath', m.storage_path, 'youtubeId', m.youtube_id, 'displayOrder', m.display_order,
                                                               'teamNo', m.team_no)
                                             order by m.kind, m.display_order, m.created_at)
                             from public.hosted_tournament_result_media m
                            where m.tournament_id = v_tid and m.is_public), '[]'::jsonb));
end;
$$;

create or replace function public.get_admin_tournament_result(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_a    public.hosted_tournament_result_archives%rowtype;
    v_prev jsonb;
begin
    if not public.can_manage_tournaments() then return null; end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return null; end if;
    select * into v_a from public.hosted_tournament_result_archives where tournament_id = v_tid;
    v_prev := public.hosted_tournament_result_build(v_tid);
    return jsonb_build_object(
        'tournamentId', v_tid,
        'archive', case when v_a.tournament_id is null then null else jsonb_build_object(
            'editionNo', v_a.edition_no, 'editionLabel', v_a.edition_label, 'version', v_a.version, 'isPublic', v_a.is_public,
            'confirmedAt', v_a.confirmed_at, 'publishedAt', v_a.published_at, 'snapshotMd5', v_a.snapshot_md5,
            'awards', v_a.snapshot -> 'awards', 'counts', v_a.snapshot -> 'counts') end,
        'preview', jsonb_build_object('sourceMd5', md5(v_prev::text), 'ok', public.hosted_tournament_result_ok(v_prev),
                                      'checks', v_prev -> 'checks', 'counts', v_prev -> 'counts', 'awards', v_prev -> 'awards',
                                      'tournament', v_prev -> 'tournament',
                                      'matchesArchive', v_a.tournament_id is not null and md5(v_prev::text) = v_a.snapshot_md5),
        'usedEditionNos', coalesce((select jsonb_agg(edition_no order by edition_no) from public.hosted_tournament_result_archives), '[]'::jsonb),
        'media', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'category', m.category, 'title', m.title,
                                                               'storagePath', m.storage_path, 'youtubeId', m.youtube_id,
                                                               'isPublic', m.is_public, 'displayOrder', m.display_order, 'createdAt', m.created_at,
                                                               'teamNo', m.team_no)
                                             order by m.kind, m.display_order, m.created_at)
                             from public.hosted_tournament_result_media m where m.tournament_id = v_tid), '[]'::jsonb),
        'history', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'note', e.note,
                                                                 'fromVersion', e.from_value ->> 'version', 'toVersion', e.to_value ->> 'version')
                                               order by e.created_at desc)
                               from public.hosted_tournament_events e
                              where e.tournament_id = v_tid and e.action like 'result_archive_%'), '[]'::jsonb));
end;
$$;

notify pgrst, 'reload schema';
