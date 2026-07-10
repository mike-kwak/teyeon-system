-- =============================================================================
-- TEYEON Ranking 산식 v2 — ranking_config.formula_version 추가 + publish RPC 확장
--
-- 목적: 산식 버전을 config row 로 구분한다.
--   · formula_version = 1 : 기존(고정 TOP3 보너스). bonus_first/second/third 사용.
--   · formula_version = 2 : 참가 인원 역산형 순위포인트(세션 인원 N − 최종 순위 R + 1). bonus_* 무시.
--
-- ⚠ 운영 원칙:
--   · 기존 모든 row 는 formula_version=1 로 유지된다(add column default 1) → 배포만으로 점수 불변.
--   · v2 는 Ranking Manager 가 formula_version=2 config 를 Publish 한 시점부터만 적용된다.
--   · bonus_first/second/third 컬럼은 DROP 하지 않는다(기존 published 호환·이력·이전 snapshot 재현·rollback).
--
-- ⚠ 배포 순서 안전(핵심):
--   기존 publish_ranking_config(9-arg)를 DROP 하고 마지막에 p_formula_version(default 1)을 붙인
--   10-arg 단일 함수로 재생성한다. 함수는 하나만 존재하므로 PostgREST 오버로드 모호성이 없고,
--   기존 배포 코드가 9개 인자로 호출하면 p_formula_version 이 default 1 로 채워져 v1 과 100% 동일하게 동작한다.
--   (신규 코드는 10번째 인자로 1 또는 2 를 명시 전달한다.)
--
-- ⚠ 초안. 승인 후 실행. 선행: add_ranking_managers.sql, add_ranking_config.sql, add_ranking_config_rpcs.sql.
-- rollback: supabase/add_ranking_formula_version_rollback.sql
-- =============================================================================

-- ── 1. 컬럼 추가(기존 row 전부 1) ───────────────────────────────────────────────
alter table public.ranking_config
    add column if not exists formula_version int not null default 1;

alter table public.ranking_config
    drop constraint if exists ranking_config_formula_version_check;
alter table public.ranking_config
    add constraint ranking_config_formula_version_check check (formula_version in (1, 2));

comment on column public.ranking_config.formula_version is
    '산식 버전: 1=고정 TOP3 보너스(bonus_* 사용), 2=참가 인원 역산형 순위포인트(bonus_* 무시). 기존 row 는 1.';

-- ── 2. publish RPC 재생성 — 9-arg DROP 후 10-arg(마지막 p_formula_version default 1) ──
drop function if exists public.publish_ranking_config(text,int,int,int,int,int,int,int,text);

create or replace function public.publish_ranking_config(
    p_season_key             text,
    p_participation          int,
    p_win                    int,
    p_bonus_first            int,
    p_bonus_second           int,
    p_bonus_third            int,
    p_min_sessions           int,
    p_best_winrate_min_games int,
    p_reason                 text,
    p_formula_version        int default 1   -- 신규(마지막·default 1). 구코드 9-arg 호출 시 1 로 동작.
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
    -- 권한 재검증(SECURITY DEFINER — RLS 우회하므로 함수 내부에서 반드시 확인).
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

    -- 값 범위 검증(테이블 CHECK 와 이중).
    if p_participation not between 0 and 1000
       or p_win not between 0 and 1000
       or p_bonus_first not between 0 and 1000
       or p_bonus_second not between 0 and 1000
       or p_bonus_third not between 0 and 1000
       or p_min_sessions not between 1 and 100
       or p_best_winrate_min_games not between 1 and 1000 then
        raise exception 'ranking config value out of range' using errcode = '22003';
    end if;
    if coalesce(p_formula_version, 1) not in (1, 2) then
        raise exception 'formula_version must be 1 or 2' using errcode = '22023';
    end if;

    -- 동시 publish 직렬화.
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
        min_sessions, best_winrate_min_games, formula_version,
        status, reason, changed_by
    ) values (
        p_season_key, v_next_version,
        p_participation, p_win, p_bonus_first, p_bonus_second, p_bonus_third,
        p_min_sessions, p_best_winrate_min_games, coalesce(p_formula_version, 1),
        'published', trim(p_reason), auth.uid()
    )
    returning * into v_row;

    return v_row;
end;
$$;

revoke execute on function public.publish_ranking_config(text,int,int,int,int,int,int,int,text,int) from public;
revoke execute on function public.publish_ranking_config(text,int,int,int,int,int,int,int,text,int) from anon;
grant  execute on function public.publish_ranking_config(text,int,int,int,int,int,int,int,text,int) to authenticated;

notify pgrst, 'reload schema';
