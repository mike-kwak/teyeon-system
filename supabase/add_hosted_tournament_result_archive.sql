-- =============================================================================
-- TEYEON OPEN 공식 결과 아카이브 (RESULTS) — 대회별 불변 스냅샷 + 시상 사진 · 영상 연결
--
--   추가만 한다: 새 테이블 2 + 함수(내부 2 · 공개 2 · 관리자 6). 기존 대회 운영 테이블 · 함수 · 경기 데이터는 바꾸지 않는다.
--
--   · hosted_tournament_result_archives — 대회(tournament_id)당 1행. 회차(edition_no)는 대회마다 고유.
--       snapshot = 공식 확정 순간의 공개 기록 그대로(get_public_preliminary_draw · get_public_knockout_bracket 결과)
--                  + 입상(우승 · 준우승 · 공동 3위) + 검증 결과. ⚠ 재계산해 덮어쓰지 않는다.
--       확정 뒤 snapshot 은 트리거가 막는다 — 정정은 amend_tournament_result(사유 필수 · 이전 스냅샷을 이벤트에 보관)로만.
--       삭제 불가(트리거).
--   · hosted_tournament_result_media — 시상 사진(Storage 경로) · YouTube 영상(영상 ID). 공개 승인(is_public)된 것만 공개.
--   · 공개 조회는 공개(is_public)된 아카이브만. 관리(확정 · 정정 · 공개 · 사진 · 영상)는 CEO/ADMIN(can_manage_tournaments)만.
--   ⚠ 확정은 자동으로 하지 않는다 — 관리자가 미리보기의 지문(sourceMd5)을 확인하고 같은 값으로 요청해야 확정된다.
--   ⚠ 사진 파일 저장소(Storage 버킷 · 정책)는 add_hosted_tournament_result_media_storage.sql 로 따로 적용한다.
-- =============================================================================

begin;

-- ── 테이블 ──────────────────────────────────────────────────────────────────

create table if not exists public.hosted_tournament_result_archives (
    tournament_id  uuid        primary key references public.hosted_tournaments(id) on delete restrict,
    edition_no     integer     not null unique check (edition_no > 0),
    edition_label  text        not null check (length(btrim(edition_label)) between 1 and 40),
    snapshot       jsonb       not null,
    snapshot_md5   text        not null,
    version        integer     not null default 1 check (version > 0),
    is_public      boolean     not null default false,
    confirmed_at   timestamptz not null default now(),
    confirmed_by   uuid,
    published_at   timestamptz,
    updated_at     timestamptz not null default now()
);

create table if not exists public.hosted_tournament_result_media (
    id             uuid        primary key default gen_random_uuid(),
    tournament_id  uuid        not null references public.hosted_tournaments(id) on delete restrict,
    kind           text        not null check (kind in ('photo', 'video')),
    category       text        not null check (category in ('hero', 'champion', 'runner_up', 'semifinal', 'group',
                                                            'highlight', 'final', 'semifinal_match', 'ceremony', 'sketch')),
    title          text        check (title is null or length(title) <= 80),
    storage_path   text,
    youtube_id     text,
    is_public      boolean     not null default false,
    display_order  integer     not null default 0,
    created_by     uuid,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    -- 사진 = 이 대회 폴더 안의 저장 경로만, 영상 = YouTube 영상 ID(11자)만
    constraint result_media_photo_path check (kind <> 'photo' or (storage_path is not null and youtube_id is null
        and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$')),
    constraint result_media_video_id check (kind <> 'video' or (youtube_id is not null and storage_path is null
        and youtube_id ~ '^[A-Za-z0-9_-]{11}$')),
    constraint result_media_category_kind check (
        (kind = 'photo' and category in ('hero', 'champion', 'runner_up', 'semifinal', 'group'))
        or (kind = 'video' and category in ('highlight', 'final', 'semifinal_match', 'ceremony', 'sketch')))
);
create index if not exists hosted_tournament_result_media_t on public.hosted_tournament_result_media (tournament_id, kind, display_order);

alter table public.hosted_tournament_result_archives enable row level security;
alter table public.hosted_tournament_result_media    enable row level security;
revoke all on public.hosted_tournament_result_archives from public, anon, authenticated;
revoke all on public.hosted_tournament_result_media    from public, anon, authenticated;

-- 확정 스냅샷 보호 — 정정 함수(amend)가 켠 표시가 있을 때만 snapshot 을 바꿀 수 있다. 행 삭제는 막는다.
create or replace function public.hosted_tournament_result_archive_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if tg_op = 'DELETE' then
        raise exception 'official result archive cannot be deleted' using errcode = '42501';
    end if;
    if (new.snapshot is distinct from old.snapshot or new.snapshot_md5 is distinct from old.snapshot_md5
        or new.tournament_id is distinct from old.tournament_id or new.confirmed_at is distinct from old.confirmed_at)
       and coalesce(current_setting('teyeon.result_amend', true), '') <> 'on' then
        raise exception 'official result snapshot is immutable (use amend_tournament_result)' using errcode = '42501';
    end if;
    return new;
end;
$$;
drop trigger if exists hosted_tournament_result_archive_guard on public.hosted_tournament_result_archives;
create trigger hosted_tournament_result_archive_guard
    before update or delete on public.hosted_tournament_result_archives
    for each row execute function public.hosted_tournament_result_archive_guard();

-- ── 내부: 공식 기록 스냅샷 만들기(쓰기 없음) ─────────────────────────────────
--   원본 = 참가자에게 공개된 공식 조회 결과 그대로. 순위 · 승자 · 진출을 여기서 다시 계산하지 않는다.
--   입상은 저장된 본선 경기에서만 고른다: 우승 자리로 가는 경기(결승)의 승자 · 패자, 결승 자리로 가는 두 경기(4강)의 패자.
create or replace function public.hosted_tournament_result_build(p_tid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_t        public.hosted_tournaments%rowtype;
    v_draw     jsonb;
    v_ko       jsonb;
    v_champ    jsonb;
    v_final    jsonb;
    v_semis    jsonb;
    v_awards   jsonb := null;
    v_checks   jsonb := '[]'::jsonb;
    v_prelim_n integer := 0; v_prelim_done integer := 0; v_groups_final boolean := false;
    v_ko_n     integer := 0; v_ko_done integer := 0;
    v_r1       integer := 0; v_bye integer := 0; v_entrants integer := 0;
    v_bad_adv  integer := 0;
    v_ok       boolean;
    v_body     jsonb;
begin
    select * into v_t from public.hosted_tournaments where id = p_tid;
    if v_t.id is null then return null; end if;

    v_draw := public.get_public_preliminary_draw(v_t.slug);
    v_ko   := public.get_public_knockout_bracket(v_t.slug);

    if v_draw is not null and (v_draw ->> 'published')::boolean is true then
        select count(*), count(*) filter (where m ->> 'status' = 'completed')
          into v_prelim_n, v_prelim_done
          from (select jsonb_array_elements(g -> 'matches') m from jsonb_array_elements(v_draw -> 'groups') g
                union all select jsonb_array_elements(coalesce(v_draw -> 'placement', '[]'::jsonb))) x;
        v_groups_final := not exists (select 1 from jsonb_array_elements(v_draw -> 'groups') g where g ->> 'rankingStatus' <> 'FINAL');
    end if;

    if v_ko is not null and (v_ko ->> 'available')::boolean is true then
        select count(*), count(*) filter (where m ->> 'status' = 'completed') into v_ko_n, v_ko_done
          from jsonb_array_elements(v_ko -> 'matches') m;
        select count(*), count(*) filter (where s ->> 'slotType' = 'bye'), count(*) filter (where s -> 'team' is not null and s -> 'team' <> 'null'::jsonb)
          into v_r1, v_bye, v_entrants
          from jsonb_array_elements(v_ko -> 'slots') s where (s ->> 'roundNo')::integer = 1;
        -- 승자 진출 정합성: 완료 경기의 승자가 다음 자리(targetSlot)에 있어야 한다
        select count(*) into v_bad_adv
          from jsonb_array_elements(v_ko -> 'matches') m
          left join lateral (select s from jsonb_array_elements(v_ko -> 'slots') s where s ->> 'publicKey' = m ->> 'targetSlotPublicKey') t on true
         where m ->> 'status' = 'completed'
           and ((t.s -> 'team' ->> 'teamNo') is distinct from
                (case m ->> 'winnerSide' when '1' then m -> 'team1' ->> 'teamNo' when '2' then m -> 'team2' ->> 'teamNo' end));

        v_champ := nullif(v_ko -> 'champion', 'null'::jsonb);
        select m into v_final from jsonb_array_elements(v_ko -> 'matches') m
         where m ->> 'targetSlotPublicKey' = (select s ->> 'publicKey' from jsonb_array_elements(v_ko -> 'slots') s
                                              where (s ->> 'isFinalSlot')::boolean limit 1)
         limit 1;
        if v_final is not null then
            select coalesce(jsonb_agg(m order by (m ->> 'matchNo')::integer), '[]'::jsonb) into v_semis
              from jsonb_array_elements(v_ko -> 'matches') m
             where m ->> 'targetSlotPublicKey' in (select jsonb_array_elements_text(v_final -> 'feederSlotPublicKeys'));
        end if;
    end if;

    v_ok := v_final is not null and v_final ->> 'status' = 'completed' and v_final ->> 'winnerSide' in ('1', '2')
        and v_champ is not null
        and (case v_final ->> 'winnerSide' when '1' then v_final -> 'team1' ->> 'teamNo' else v_final -> 'team2' ->> 'teamNo' end) = v_champ ->> 'teamNo'
        and jsonb_array_length(coalesce(v_semis, '[]'::jsonb)) = 2
        and not exists (select 1 from jsonb_array_elements(v_semis) m where m ->> 'status' <> 'completed' or m ->> 'winnerSide' not in ('1', '2'));
    if v_ok then
        v_awards := jsonb_build_object(
            'champion', jsonb_build_object('team', case v_final ->> 'winnerSide' when '1' then v_final -> 'team1' else v_final -> 'team2' end,
                                           'matchNo', (v_final ->> 'matchNo')::integer),
            'runnerUp', jsonb_build_object('team', case v_final ->> 'winnerSide' when '1' then v_final -> 'team2' else v_final -> 'team1' end,
                                           'matchNo', (v_final ->> 'matchNo')::integer),
            'final', jsonb_build_object('matchNo', (v_final ->> 'matchNo')::integer, 'score1', (v_final ->> 'score1')::integer,
                                        'score2', (v_final ->> 'score2')::integer, 'team1', v_final -> 'team1', 'team2', v_final -> 'team2',
                                        'winnerSide', (v_final ->> 'winnerSide')::integer),
            'semifinalists', (select jsonb_agg(jsonb_build_object(
                                  'team', case m ->> 'winnerSide' when '1' then m -> 'team2' else m -> 'team1' end,
                                  'matchNo', (m ->> 'matchNo')::integer,
                                  'lostTo', case m ->> 'winnerSide' when '1' then m -> 'team1' else m -> 'team2' end,
                                  'score1', (m ->> 'score1')::integer, 'score2', (m ->> 'score2')::integer,
                                  'loserSide', case m ->> 'winnerSide' when '1' then 2 else 1 end)
                                  order by (m ->> 'matchNo')::integer)
                              from jsonb_array_elements(v_semis) m));
    end if;

    v_checks := jsonb_build_array(
        jsonb_build_object('key', 'prelim_published', 'ok', v_draw is not null and (v_draw ->> 'published')::boolean is true, 'value', null),
        jsonb_build_object('key', 'prelim_all_completed', 'ok', v_prelim_n > 0 and v_prelim_n = v_prelim_done, 'value', v_prelim_done || '/' || v_prelim_n),
        jsonb_build_object('key', 'groups_final', 'ok', v_groups_final, 'value', null),
        jsonb_build_object('key', 'knockout_published', 'ok', v_ko is not null and (v_ko ->> 'available')::boolean is true, 'value', null),
        jsonb_build_object('key', 'knockout_completed', 'ok', v_ko ->> 'publication' is not null and v_ko -> 'publication' ->> 'bracketStatus' = 'completed', 'value', v_ko -> 'publication' ->> 'bracketStatus'),
        jsonb_build_object('key', 'knockout_all_completed', 'ok', v_ko_n > 0 and v_ko_n = v_ko_done, 'value', v_ko_done || '/' || v_ko_n),
        jsonb_build_object('key', 'advancement_consistent', 'ok', v_ko_n > 0 and v_bad_adv = 0, 'value', v_bad_adv),
        jsonb_build_object('key', 'awards_resolved', 'ok', v_ok, 'value', null));

    v_body := jsonb_build_object(
        'schemaVersion', 1,
        'tournament', jsonb_build_object('slug', v_t.slug, 'title', v_t.title, 'subtitle', v_t.subtitle,
                                         'eventDate', v_t.event_date, 'venueName', v_t.venue_name, 'organizerName', v_t.organizer_name),
        'preliminary', v_draw,
        'knockout', v_ko,
        'awards', v_awards,
        'counts', jsonb_build_object('preliminaryMatches', v_prelim_n, 'preliminaryCompleted', v_prelim_done,
                                     'knockoutMatches', v_ko_n, 'knockoutCompleted', v_ko_done,
                                     'firstRoundSlots', v_r1, 'byeSlots', v_bye, 'entrants', v_entrants),
        'checks', v_checks);
    return v_body;
end;
$$;
revoke all on function public.hosted_tournament_result_build(uuid) from public, anon, authenticated;

create or replace function public.hosted_tournament_result_ok(p_body jsonb)
returns boolean
language sql
immutable
as $$
    select p_body is not null and not exists (select 1 from jsonb_array_elements(p_body -> 'checks') c where (c ->> 'ok')::boolean is not true);
$$;

-- ── 공개 조회 ───────────────────────────────────────────────────────────────

-- 공개된 회차 목록(최신 회차 먼저) — 우승팀 이름까지만.
create or replace function public.get_public_tournament_result_editions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select jsonb_build_object('editions', coalesce(jsonb_agg(jsonb_build_object(
               'slug', a.snapshot -> 'tournament' ->> 'slug',
               'editionNo', a.edition_no,
               'editionLabel', a.edition_label,
               'title', a.snapshot -> 'tournament' ->> 'title',
               'eventDate', a.snapshot -> 'tournament' ->> 'eventDate',
               'venueName', a.snapshot -> 'tournament' ->> 'venueName',
               'champion', a.snapshot -> 'awards' -> 'champion' -> 'team')
             order by a.edition_no desc), '[]'::jsonb))
      from public.hosted_tournament_result_archives a
     where a.is_public;
$$;

-- 한 회차의 공식 기록 — 공개된 아카이브만(아니면 null). 사진 · 영상은 공개 승인된 것만.
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
                                                               'storagePath', m.storage_path, 'youtubeId', m.youtube_id, 'displayOrder', m.display_order)
                                             order by m.kind, m.display_order, m.created_at)
                             from public.hosted_tournament_result_media m
                            where m.tournament_id = v_tid and m.is_public), '[]'::jsonb));
end;
$$;

-- ── 관리자 ─────────────────────────────────────────────────────────────────

-- 상태 · 미리보기(지금 공식 기록으로 만들 내용 + 검증) · 사진/영상 전체 · 정정 이력. 쓰기 없음.
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
                                                               'isPublic', m.is_public, 'displayOrder', m.display_order, 'createdAt', m.created_at)
                                             order by m.kind, m.display_order, m.created_at)
                             from public.hosted_tournament_result_media m where m.tournament_id = v_tid), '[]'::jsonb),
        'history', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'note', e.note,
                                                                 'fromVersion', e.from_value ->> 'version', 'toVersion', e.to_value ->> 'version')
                                               order by e.created_at desc)
                               from public.hosted_tournament_events e
                              where e.tournament_id = v_tid and e.action like 'result_archive_%'), '[]'::jsonb));
end;
$$;

-- 공식 결과 확정 — 관리자가 본 미리보기 지문(p_expected_md5)과 지금 만든 스냅샷이 같고, 검증이 모두 통과해야 한다. 1회만.
create or replace function public.confirm_tournament_result(p_slug text, p_edition_no integer, p_edition_label text, p_expected_md5 text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_body jsonb;
    v_md5  text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); end if;
    if p_edition_no is null or p_edition_no < 1 or p_edition_label is null or length(btrim(p_edition_label)) not between 1 and 40 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_edition');
    end if;
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-result:' || v_tid::text));
    if exists (select 1 from public.hosted_tournament_result_archives where tournament_id = v_tid) then
        return jsonb_build_object('ok', false, 'reason', 'already_confirmed');
    end if;
    if exists (select 1 from public.hosted_tournament_result_archives where edition_no = p_edition_no) then
        return jsonb_build_object('ok', false, 'reason', 'edition_taken');
    end if;
    v_body := public.hosted_tournament_result_build(v_tid);
    v_md5 := md5(v_body::text);
    if not public.hosted_tournament_result_ok(v_body) then
        return jsonb_build_object('ok', false, 'reason', 'validation_failed', 'checks', v_body -> 'checks');
    end if;
    if p_expected_md5 is distinct from v_md5 then
        return jsonb_build_object('ok', false, 'reason', 'stale_preview', 'sourceMd5', v_md5);
    end if;
    insert into public.hosted_tournament_result_archives (tournament_id, edition_no, edition_label, snapshot, snapshot_md5, confirmed_by)
    values (v_tid, p_edition_no, btrim(p_edition_label), v_body, v_md5, auth.uid());
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_archive_confirmed', null,
        jsonb_build_object('version', 1, 'editionNo', p_edition_no, 'snapshotMd5', v_md5), '공식 결과 확정');
    return jsonb_build_object('ok', true, 'version', 1, 'snapshotMd5', v_md5);
end;
$$;

-- 공식 기록 정정 — LIVE 기록을 정식 절차로 고친 뒤에만. 사유 필수 · 이전 스냅샷 전체를 이벤트에 보관 · 버전 +1.
create or replace function public.amend_tournament_result(p_slug text, p_reason text, p_expected_version integer, p_expected_md5 text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid  uuid;
    v_a    public.hosted_tournament_result_archives%rowtype;
    v_body jsonb;
    v_md5  text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_reason is null or length(btrim(p_reason)) < 5 then return jsonb_build_object('ok', false, 'reason', 'reason_required'); end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); end if;
    perform pg_advisory_xact_lock(hashtext('hosted-tournament-result:' || v_tid::text));
    select * into v_a from public.hosted_tournament_result_archives where tournament_id = v_tid for update;
    if v_a.tournament_id is null then return jsonb_build_object('ok', false, 'reason', 'not_confirmed'); end if;
    if p_expected_version is distinct from v_a.version then return jsonb_build_object('ok', false, 'reason', 'stale_version', 'version', v_a.version); end if;
    v_body := public.hosted_tournament_result_build(v_tid);
    v_md5 := md5(v_body::text);
    if not public.hosted_tournament_result_ok(v_body) then
        return jsonb_build_object('ok', false, 'reason', 'validation_failed', 'checks', v_body -> 'checks');
    end if;
    if p_expected_md5 is distinct from v_md5 then return jsonb_build_object('ok', false, 'reason', 'stale_preview', 'sourceMd5', v_md5); end if;
    if v_md5 = v_a.snapshot_md5 then return jsonb_build_object('ok', false, 'reason', 'no_change'); end if;
    perform set_config('teyeon.result_amend', 'on', true);
    update public.hosted_tournament_result_archives
       set snapshot = v_body, snapshot_md5 = v_md5, version = version + 1, updated_at = now()
     where tournament_id = v_tid;
    perform set_config('teyeon.result_amend', 'off', true);
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_archive_amended',
        jsonb_build_object('version', v_a.version, 'snapshotMd5', v_a.snapshot_md5, 'snapshot', v_a.snapshot),
        jsonb_build_object('version', v_a.version + 1, 'snapshotMd5', v_md5), btrim(p_reason));
    return jsonb_build_object('ok', true, 'version', v_a.version + 1, 'snapshotMd5', v_md5);
end;
$$;

-- 공개 · 비공개 — 확정된 아카이브만.
create or replace function public.set_tournament_result_public(p_slug text, p_public boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid; v_was boolean;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    select is_public into v_was from public.hosted_tournament_result_archives where tournament_id = v_tid for update;
    if v_was is null then return jsonb_build_object('ok', false, 'reason', 'not_confirmed'); end if;
    if v_was = coalesce(p_public, false) then return jsonb_build_object('ok', true, 'changed', false); end if;
    update public.hosted_tournament_result_archives
       set is_public = coalesce(p_public, false),
           published_at = case when coalesce(p_public, false) then coalesce(published_at, now()) else published_at end,
           updated_at = now()
     where tournament_id = v_tid;
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid,
        case when p_public then 'result_archive_published' else 'result_archive_unpublished' end, null, null, null);
    return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

-- 사진 · 영상 저장(새로 만들기 · 고치기). 공식 기록(스냅샷)과 무관하다.
create or replace function public.save_tournament_result_media(
    p_slug text, p_id uuid, p_kind text, p_category text, p_title text,
    p_storage_path text, p_youtube_id text, p_is_public boolean, p_display_order integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid; v_id uuid;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then return jsonb_build_object('ok', false, 'reason', 'tournament_not_found'); end if;
    if p_kind = 'photo' and (p_storage_path is null or split_part(p_storage_path, '/', 1) <> v_tid::text) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_path');
    end if;
    begin
        if p_id is null then
            insert into public.hosted_tournament_result_media (tournament_id, kind, category, title, storage_path, youtube_id, is_public, display_order, created_by)
            values (v_tid, p_kind, p_category, nullif(btrim(coalesce(p_title, '')), ''), p_storage_path, p_youtube_id,
                    coalesce(p_is_public, false), coalesce(p_display_order, 0), auth.uid())
            returning id into v_id;
        else
            update public.hosted_tournament_result_media
               set category = p_category, title = nullif(btrim(coalesce(p_title, '')), ''),
                   youtube_id = case when kind = 'video' then p_youtube_id else youtube_id end,
                   is_public = coalesce(p_is_public, false), display_order = coalesce(p_display_order, 0), updated_at = now()
             where id = p_id and tournament_id = v_tid
            returning id into v_id;
            if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
        end if;
    exception when check_violation then
        return jsonb_build_object('ok', false, 'reason', 'invalid_media');
    end;
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_media_saved', null,
        jsonb_build_object('id', v_id, 'kind', p_kind, 'category', p_category, 'isPublic', coalesce(p_is_public, false)), null);
    return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 사진 · 영상 연결 삭제 — 행만 지운다(사진 파일은 화면이 Storage 에서 지운다). 돌려줄 경로 = 지울 파일.
create or replace function public.delete_tournament_result_media(p_slug text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid; v_path text; v_kind text;
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    delete from public.hosted_tournament_result_media where id = p_id and tournament_id = v_tid
    returning storage_path, kind into v_path, v_kind;
    if v_kind is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    perform public.hosted_tournament_log_event(v_tid, 'tournament', v_tid, 'result_media_deleted', jsonb_build_object('id', p_id, 'kind', v_kind), null, null);
    return jsonb_build_object('ok', true, 'storagePath', v_path);
end;
$$;

revoke all on function public.get_public_tournament_result_editions() from public;
revoke all on function public.get_public_tournament_result(text) from public;
grant execute on function public.get_public_tournament_result_editions() to anon, authenticated;
grant execute on function public.get_public_tournament_result(text) to anon, authenticated;

revoke all on function public.get_admin_tournament_result(text) from public, anon;
revoke all on function public.confirm_tournament_result(text, integer, text, text) from public, anon;
revoke all on function public.amend_tournament_result(text, text, integer, text) from public, anon;
revoke all on function public.set_tournament_result_public(text, boolean) from public, anon;
revoke all on function public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer) from public, anon;
revoke all on function public.delete_tournament_result_media(text, uuid) from public, anon;
grant execute on function public.get_admin_tournament_result(text) to authenticated;
grant execute on function public.confirm_tournament_result(text, integer, text, text) to authenticated;
grant execute on function public.amend_tournament_result(text, text, integer, text) to authenticated;
grant execute on function public.set_tournament_result_public(text, boolean) to authenticated;
grant execute on function public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer) to authenticated;
grant execute on function public.delete_tournament_result_media(text, uuid) to authenticated;

commit;
