-- =============================================================================
-- ROLLBACK — add_ranking_formula_version.sql 되돌리기.
--   · 10-arg publish RPC 를 DROP 하고 원래 9-arg 로 복원.
--   · formula_version CHECK 제약과 컬럼 제거.
--
-- ⚠ 주의: formula_version=2 로 Publish 된 config 가 존재하는 상태에서 롤백하면
--   해당 row 의 산식 버전 정보가 소실된다(컬럼 삭제). 롤백 전 v2 published 가 없는지 확인할 것.
--   (이 단계 작업에서는 v2 Publish 를 하지 않으므로 안전.)
-- =============================================================================

-- ── 1. 10-arg RPC 제거 후 원본 9-arg 복원 ──────────────────────────────────────
drop function if exists public.publish_ranking_config(text,int,int,int,int,int,int,int,text,int);

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

    if p_participation not between 0 and 1000
       or p_win not between 0 and 1000
       or p_bonus_first not between 0 and 1000
       or p_bonus_second not between 0 and 1000
       or p_bonus_third not between 0 and 1000
       or p_min_sessions not between 1 and 100
       or p_best_winrate_min_games not between 1 and 1000 then
        raise exception 'ranking config value out of range' using errcode = '22003';
    end if;

    perform pg_advisory_xact_lock(hashtext('ranking_config:' || p_season_key));

    select coalesce(max(version), 0) + 1 into v_next_version
      from public.ranking_config
     where season_key = p_season_key;

    update public.ranking_config
       set status = 'archived'
     where season_key = p_season_key and status = 'published';

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

-- ── 2. formula_version 제약·컬럼 제거 ──────────────────────────────────────────
alter table public.ranking_config
    drop constraint if exists ranking_config_formula_version_check;
alter table public.ranking_config
    drop column if exists formula_version;

notify pgrst, 'reload schema';
