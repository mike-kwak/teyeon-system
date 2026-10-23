-- =============================================================================
-- TEYEON OPEN LIVE — 영상 소스(YouTube 기본 · Cloudflare 백업) · YouTube 방송 주소 설정
--
--   ⚠ 초안 — 운영 Supabase 에 적용하려면 별도 승인이 필요하다.
--   ⚠ 선행 조건: add_hosted_tournament_live_match.sql (LIVE 중계 경기) 와 무관하게 단독 적용 가능.
--     기존 테이블 · 함수는 바꾸지 않는다. 새 테이블 1 · 함수 3 만 추가한다(되돌리기 = 삭제).
--
--   저장하는 것: 소스 선택('youtube' | 'cloudflare') · YouTube video ID(11자, 공개 시청 식별자) · 다시보기 video ID.
--   ⚠ 저장하지 않는 것: YouTube 스트림 키 · Cloudflare API 토큰 · RTMPS 주소 — 비밀 정보는 DB 에 두지 않는다.
--   ⚠ 소스 선택은 '시청자 화면이 어떤 플레이어를 보여 줄지' 일 뿐이다. 실제 송출 주소 전환은 현장 송출 앱(DJI Mimo)에서 한다.
--
--   함수
--     get_public_live_source(slug)   — anon · authenticated. 공개 대회(draft 아님)만. 소스 · video ID 만.
--     get_admin_live_source(slug)    — CEO · ADMIN(can_manage_tournaments). 버전 · 수정 시각 포함. 권한 없으면 null.
--     set_live_source(slug, source, youtube_video_id, youtube_replay_video_id, expected_version)
--                                    — CEO · ADMIN. 형식 검증 · 버전 충돌 · 같은 값이면 쓰지 않음 · 감사 로그.
-- =============================================================================

begin;

-- ── 1. 테이블 ────────────────────────────────────────────────────────────────
create table if not exists public.hosted_tournament_live_source (
    tournament_id           uuid        primary key
                                        references public.hosted_tournaments(id) on delete cascade,
    source                  text        not null default 'youtube'
                                        check (source in ('youtube', 'cloudflare')),
    -- YouTube video ID — 11자 [A-Za-z0-9_-]. 주소에서 뽑는 일은 화면(클라이언트)이 하고, DB 는 형식만 다시 확인한다.
    youtube_video_id        text        check (youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
    youtube_replay_video_id text        check (youtube_replay_video_id is null or youtube_replay_video_id ~ '^[A-Za-z0-9_-]{11}$'),
    version                 integer     not null default 1 check (version >= 1),
    updated_at              timestamptz not null default now(),
    updated_by              uuid        references auth.users(id) on delete set null
);

comment on table public.hosted_tournament_live_source is
    'LIVE 시청 화면의 영상 소스(YouTube 기본 · Cloudflare 백업)와 YouTube video ID. ⚠ 스트림 키 등 비밀 정보 저장 금지.';

-- RLS — 기본 차단(정책 없음). 읽기 · 쓰기는 아래 RPC 로만.
alter table public.hosted_tournament_live_source enable row level security;
revoke all on public.hosted_tournament_live_source from public, anon, authenticated;


-- ── 2. 공개 조회 ─────────────────────────────────────────────────────────────
create or replace function public.get_public_live_source(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_status text;
    v_row    public.hosted_tournament_live_source%rowtype;
begin
    select id, status into v_tid, v_status from public.hosted_tournaments where slug = p_slug;
    if v_tid is null or v_status = 'draft' then
        return jsonb_build_object('available', false);
    end if;

    select * into v_row from public.hosted_tournament_live_source where tournament_id = v_tid;
    -- 행이 없으면 기본값(YouTube · 주소 미설정).
    return jsonb_build_object(
        'available',           true,
        'source',              coalesce(v_row.source, 'youtube'),
        'youtubeVideoId',      v_row.youtube_video_id,
        'youtubeReplayVideoId', v_row.youtube_replay_video_id
    );
end;
$$;

revoke execute on function public.get_public_live_source(text) from public;
grant  execute on function public.get_public_live_source(text) to anon, authenticated;


-- ── 3. 관리자 조회 ───────────────────────────────────────────────────────────
create or replace function public.get_admin_live_source(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid uuid;
    v_row public.hosted_tournament_live_source%rowtype;
begin
    if not public.can_manage_tournaments() then
        return null;   -- 권한 없음은 null 로 구분한다
    end if;
    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return null;
    end if;

    select * into v_row from public.hosted_tournament_live_source where tournament_id = v_tid;
    return jsonb_build_object(
        'source',               coalesce(v_row.source, 'youtube'),
        'youtubeVideoId',       v_row.youtube_video_id,
        'youtubeReplayVideoId', v_row.youtube_replay_video_id,
        -- 행이 없으면 0 — 첫 저장의 expected_version 은 0 이다.
        'version',              coalesce(v_row.version, 0),
        'updatedAt',            v_row.updated_at
    );
end;
$$;

revoke execute on function public.get_admin_live_source(text) from public, anon;
grant  execute on function public.get_admin_live_source(text) to authenticated;


-- ── 4. 관리자 저장 ───────────────────────────────────────────────────────────
--   p_expected_version: 화면이 읽은 version(행이 없을 때 0). null 이면 충돌 검사 생략.
--   반환: { ok, changed, version } | { ok:false, reason: invalid_source | invalid_video_id | tournament_not_found | stale_version }
create or replace function public.set_live_source(
    p_slug                    text,
    p_source                  text,
    p_youtube_video_id        text    default null,
    p_youtube_replay_video_id text    default null,
    p_expected_version        integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_tid    uuid;
    v_row    public.hosted_tournament_live_source%rowtype;
    v_found  boolean;
    v_cur    integer;
    v_live   text := nullif(btrim(coalesce(p_youtube_video_id, '')), '');
    v_replay text := nullif(btrim(coalesce(p_youtube_replay_video_id, '')), '');
begin
    if not public.can_manage_tournaments() then
        raise exception 'not authorized: CEO/ADMIN role required' using errcode = '42501';
    end if;
    if p_source is null or p_source not in ('youtube', 'cloudflare') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_source');
    end if;
    if (v_live is not null and v_live !~ '^[A-Za-z0-9_-]{11}$')
       or (v_replay is not null and v_replay !~ '^[A-Za-z0-9_-]{11}$') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_video_id');
    end if;

    select id into v_tid from public.hosted_tournaments where slug = p_slug;
    if v_tid is null then
        return jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
    end if;

    perform pg_advisory_xact_lock(hashtext('hosted-tournament-live-source:' || v_tid::text));

    select * into v_row from public.hosted_tournament_live_source where tournament_id = v_tid for update;
    v_found := found;
    v_cur := case when v_found then v_row.version else 0 end;

    if p_expected_version is not null and p_expected_version <> v_cur then
        return jsonb_build_object('ok', false, 'reason', 'stale_version', 'version', v_cur);
    end if;

    -- 같은 값이면 쓰지 않는다.
    if v_found and v_row.source = p_source
       and v_row.youtube_video_id is not distinct from v_live
       and v_row.youtube_replay_video_id is not distinct from v_replay then
        return jsonb_build_object('ok', true, 'changed', false, 'version', v_cur);
    end if;

    if v_found then
        update public.hosted_tournament_live_source
           set source = p_source, youtube_video_id = v_live, youtube_replay_video_id = v_replay,
               version = version + 1, updated_at = now(), updated_by = auth.uid()
         where tournament_id = v_tid;
    else
        insert into public.hosted_tournament_live_source
               (tournament_id, source, youtube_video_id, youtube_replay_video_id, version, updated_by)
        values (v_tid, p_source, v_live, v_replay, 1, auth.uid());
    end if;

    insert into public.hosted_tournament_events
           (tournament_id, entity_type, entity_id, action, from_value, to_value, actor_user_id, actor_type)
    values (v_tid, 'tournament', v_tid, 'live_source_changed',
            case when v_found then jsonb_build_object('source', v_row.source, 'youtubeVideoId', v_row.youtube_video_id,
                                                      'youtubeReplayVideoId', v_row.youtube_replay_video_id) end,
            jsonb_build_object('source', p_source, 'youtubeVideoId', v_live, 'youtubeReplayVideoId', v_replay),
            auth.uid(), 'admin');

    return jsonb_build_object('ok', true, 'changed', true, 'version', v_cur + 1);
end;
$$;

revoke execute on function public.set_live_source(text,text,text,text,integer) from public, anon;
grant  execute on function public.set_live_source(text,text,text,text,integer) to authenticated;

notify pgrst, 'reload schema';

commit;
