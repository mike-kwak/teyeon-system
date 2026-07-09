-- =============================================================================
-- TEYEON Ranking — 시즌 종료(finalize) / 재오픈(reopen) 원자 RPC
--   · finalize: CEO OR ranking_managers. 검증 후 snapshot INSERT(시즌당 finalized 1건).
--   · reopen:   CEO only. finalized → superseded 로 전이(새 snapshot 생성 없음, 이후 live 복귀).
--   · 계산은 클라이언트 TS(computeClubRanking)가 수행하고, RPC 는 저장 + 무결성 검증만 담당.
--     (PostgreSQL 에서 클럽 랭킹 포인트 산식을 재구현하지 않는다 — 이중 산식 발산 방지.)
--
-- ⚠️ 초안. 승인 후 실행. 선행: add_ranking_managers.sql, add_ranking_config.sql, add_ranking_snapshots.sql.
-- rollback: supabase/add_ranking_snapshot_rpcs_rollback.sql
-- =============================================================================

-- ── finalize_ranking_season ───────────────────────────────────────────────────
create or replace function public.finalize_ranking_season(
    p_season_key             text,
    p_season_name            text,
    p_config_id              uuid,
    p_config_version         int,
    p_snapshot_data          jsonb,
    p_member_count           int,
    p_official_session_count int,
    p_latest_archive_date    text,
    p_archive_fingerprint    text,
    p_finalize_reason        text
)
returns public.ranking_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_pub public.ranking_config;
    v_row public.ranking_snapshots;
begin
    -- 1) 권한 재검증(SECURITY DEFINER — RLS 우회하므로 함수 내부에서 필수).
    if not public.can_manage_ranking() then
        raise exception 'not authorized to finalize ranking season' using errcode = '42501';
    end if;

    -- 2) 입력 형식 검증.
    if p_season_key is null or p_season_key !~ '^[0-9]{4}$' then
        raise exception 'season_key must be a 4-digit year' using errcode = '22023';
    end if;
    if p_season_name is null or length(trim(p_season_name)) = 0 then
        raise exception 'season_name is required' using errcode = '22023';
    end if;
    if p_finalize_reason is null or length(trim(p_finalize_reason)) < 4 then
        raise exception 'finalize_reason is required (min 4 chars)' using errcode = '22023';
    end if;
    if coalesce(p_official_session_count, 0) < 1 then
        raise exception 'season has no official sessions' using errcode = '22023';
    end if;
    if coalesce(p_member_count, 0) < 1 then
        raise exception 'season has no aggregated members' using errcode = '22023';
    end if;

    -- 3) snapshot_data 구조 검증(최소 스키마).
    if p_snapshot_data is null or jsonb_typeof(p_snapshot_data) <> 'object' then
        raise exception 'snapshot_data must be a JSON object' using errcode = '22023';
    end if;
    if jsonb_typeof(p_snapshot_data -> 'entries') <> 'array' then
        raise exception 'snapshot_data.entries must be an array' using errcode = '22023';
    end if;
    if jsonb_typeof(p_snapshot_data -> 'awards') <> 'object' then
        raise exception 'snapshot_data.awards must be an object' using errcode = '22023';
    end if;
    if coalesce((p_snapshot_data ->> 'schemaVersion')::int, 0) <> 1 then
        raise exception 'snapshot schemaVersion mismatch (expected 1)' using errcode = '22023';
    end if;

    -- 4) 동시 finalize 직렬화.
    perform pg_advisory_xact_lock(hashtext('ranking_snapshot:' || p_season_key));

    -- 5) published config 존재 + 전달 config 일치(클라 계산이 현재 published 산식으로 됐는지 대조).
    select * into v_pub
      from public.ranking_config
     where season_key = p_season_key and status = 'published'
     limit 1;
    if v_pub.id is null then
        raise exception 'no published ranking_config for this season' using errcode = '22023';
    end if;
    if v_pub.id <> p_config_id or v_pub.version <> p_config_version then
        raise exception 'config version mismatch with current published config' using errcode = '22023';
    end if;

    -- 6) 중복 finalize 차단(부분 unique 와 이중 방어).
    if exists (select 1 from public.ranking_snapshots where season_key = p_season_key and status = 'finalized') then
        raise exception 'season already finalized' using errcode = '23505';
    end if;

    -- 7) snapshot INSERT(서버가 finalized_at/by 기록).
    insert into public.ranking_snapshots (
        season_key, season_name, status, config_id, config_version, schema_version,
        snapshot_data, member_count, official_session_count, latest_archive_date, archive_fingerprint,
        finalize_reason, finalized_at, finalized_by
    ) values (
        p_season_key, trim(p_season_name), 'finalized', p_config_id, p_config_version, 1,
        p_snapshot_data, p_member_count, p_official_session_count, p_latest_archive_date, p_archive_fingerprint,
        trim(p_finalize_reason), now(), auth.uid()
    )
    returning * into v_row;

    -- 8) 재동결이면(이전 superseded 존재) 연결 — superseded_by = 새 snapshot.
    update public.ranking_snapshots
       set superseded_by = v_row.id, updated_at = now()
     where season_key = p_season_key and status = 'superseded' and superseded_by is null;

    return v_row;
end;
$$;

revoke execute on function public.finalize_ranking_season(text,text,uuid,int,jsonb,int,int,text,text,text) from public;
revoke execute on function public.finalize_ranking_season(text,text,uuid,int,jsonb,int,int,text,text,text) from anon;
grant  execute on function public.finalize_ranking_season(text,text,uuid,int,jsonb,int,int,text,text,text) to authenticated;

-- ── reopen_ranking_season (CEO only) ──────────────────────────────────────────
create or replace function public.reopen_ranking_season(
    p_season_key    text,
    p_reopen_reason text
)
returns public.ranking_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_row public.ranking_snapshots;
begin
    -- CEO 만(can_manage_ranking 으로 부족 — profiles.role='CEO' 직접 재검증).
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'CEO') then
        raise exception 'reopen requires CEO' using errcode = '42501';
    end if;
    if p_reopen_reason is null or length(trim(p_reopen_reason)) < 4 then
        raise exception 'reopen_reason is required (min 4 chars)' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('ranking_snapshot:' || p_season_key));

    select * into v_row
      from public.ranking_snapshots
     where season_key = p_season_key and status = 'finalized'
     limit 1;
    if v_row.id is null then
        raise exception 'no finalized snapshot to reopen' using errcode = '22023';
    end if;

    -- finalized → superseded (삭제하지 않음). 새 snapshot 은 생성하지 않는다(이후 live 복귀 → 재동결은 finalize).
    update public.ranking_snapshots
       set status = 'superseded', reopened_at = now(), reopened_by = auth.uid(),
           reopen_reason = trim(p_reopen_reason), updated_at = now()
     where id = v_row.id
    returning * into v_row;

    return v_row;
end;
$$;

revoke execute on function public.reopen_ranking_season(text,text) from public;
revoke execute on function public.reopen_ranking_season(text,text) from anon;
grant  execute on function public.reopen_ranking_season(text,text) to authenticated;

notify pgrst, 'reload schema';
