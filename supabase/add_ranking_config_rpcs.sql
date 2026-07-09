-- =============================================================================
-- TEYEON Ranking — publish 원자 RPC
--   publish_ranking_config: 현재 published 를 archived 로 내리고 새 version 을 published 로 삽입.
--   · 단일 함수(트랜잭션) → 두 운영자 동시 publish 충돌·중복 published 방지(부분 unique 와 이중 방어).
--   · 권한: can_manage_ranking() (CEO OR ranking_managers) 만. 그 외 예외.
--   · 값 검증: 범위 밖이면 예외(테이블 CHECK 와 이중). SECURITY DEFINER 지만 내부에서 권한 재검증.
--
-- ⚠️ 초안. 승인 후 실행. 선행: add_ranking_managers.sql, add_ranking_config.sql.
-- rollback: supabase/add_ranking_config_rpcs_rollback.sql
-- =============================================================================

create or replace function public.publish_ranking_config(
    p_season_key             text,
    p_participation          int,
    p_win                    int,
    p_bonus_first            int,
    p_bonus_second           int,
    p_bonus_third            int,
    p_min_sessions           int,
    p_best_winrate_min_games int,
    p_reason                 text
)
returns public.ranking_config
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_next_version int;
    v_row public.ranking_config;
begin
    -- 권한 재검증(SECURITY DEFINER — RLS 를 우회하므로 함수 내부에서 반드시 확인).
    if not public.can_manage_ranking() then
        raise exception 'not authorized to manage ranking'
            using errcode = '42501';
    end if;

    if p_season_key is null or length(trim(p_season_key)) = 0 then
        raise exception 'season_key is required' using errcode = '22023';
    end if;
    if p_reason is null or length(trim(p_reason)) < 4 then
        raise exception 'reason is required (min 4 chars)' using errcode = '22023';
    end if;

    -- 값 범위 검증(테이블 CHECK 와 이중 — 명시적 예외 메시지 제공).
    if p_participation not between 0 and 1000
       or p_win not between 0 and 1000
       or p_bonus_first not between 0 and 1000
       or p_bonus_second not between 0 and 1000
       or p_bonus_third not between 0 and 1000
       or p_min_sessions not between 1 and 100
       or p_best_winrate_min_games not between 1 and 1000 then
        raise exception 'ranking config value out of range' using errcode = '22003';
    end if;

    -- 동시 publish 직렬화 — 같은 season_key 행을 advisory lock 으로 잠근다.
    perform pg_advisory_xact_lock(hashtext('ranking_config:' || p_season_key));

    -- 다음 version = 해당 season_key 최대 version + 1 (없으면 1).
    select coalesce(max(version), 0) + 1 into v_next_version
      from public.ranking_config
     where season_key = p_season_key;

    -- 현재 published → archived (부분 unique index 충돌 방지 위해 먼저 내린다).
    update public.ranking_config
       set status = 'archived'
     where season_key = p_season_key and status = 'published';

    -- 새 version 을 published 로 삽입.
    insert into public.ranking_config (
        season_key, version,
        participation, win, bonus_first, bonus_second, bonus_third,
        min_sessions, best_winrate_min_games,
        status, reason, changed_by
    ) values (
        p_season_key, v_next_version,
        p_participation, p_win, p_bonus_first, p_bonus_second, p_bonus_third,
        p_min_sessions, p_best_winrate_min_games,
        'published', trim(p_reason), auth.uid()
    )
    returning * into v_row;

    return v_row;
end;
$$;

revoke execute on function public.publish_ranking_config(text,int,int,int,int,int,int,int,text) from public;
revoke execute on function public.publish_ranking_config(text,int,int,int,int,int,int,int,text) from anon;
grant  execute on function public.publish_ranking_config(text,int,int,int,int,int,int,int,text) to authenticated;

notify pgrst, 'reload schema';
