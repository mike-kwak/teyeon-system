-- =============================================================================
-- ROLLBACK — SECURITY P1 (KDK 점수 권한). trigger·helper 제거, RPC·권한을 적용 직전 상태로 복원.
--   원장(kdk_match_results)·이력(kdk_match_score_history)은 기록 보존을 위해 남긴다(필요 시 맨 아래 주석 실행).
--   matches 데이터·컬럼·기존 KDK RPC 는 건드리지 않는다.
-- =============================================================================
begin;
set local lock_timeout = '3s';
drop trigger if exists kdk_p1_score_guard_trg on public.matches;
drop trigger if exists kdk_p1_block_truncate_trg on public.matches;
drop trigger if exists kdk_p1_score_ledger_trg on public.matches;
drop function if exists public.kdk_p1_score_guard();
drop function if exists public.kdk_p1_block_truncate();
drop function if exists public.kdk_p1_score_ledger();
drop function if exists public.kdk_p1_can_generate();
drop function if exists public.kdk_p1_result_recorded(text);
drop function if exists public.kdk_p1_can_manage_results();
drop function if exists public.kdk_p1_actor_role();

-- sync_tournament_matches: P1 이 실제로 바꾼 경우([P1] 표시가 있을 때)만 저장소 원본 본문으로 되돌린다. 없으면 만들지 않는다.
do $p1rb$
begin
  if to_regprocedure('public.sync_tournament_matches(jsonb)') is null
     or (select prosrc not like '%[P1] Special 행만 허용%' from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')) then
    raise notice 'P1 rollback: sync_tournament_matches 변경 없음 — 건너뜀';
    return;
  end if;
  execute $ddl$
CREATE OR REPLACE FUNCTION public.sync_tournament_matches(p_matches JSONB)
RETURNS VOID AS $fn$
BEGIN
    INSERT INTO public.matches (
        id, club_id, session_id, session_title, round, court, 
        player_ids, player_names, score1, score2, status, mode, group_name
    )
    SELECT 
        (m->>'id')::TEXT,
        (m->>'club_id')::TEXT,
        (m->>'session_id')::TEXT,
        (m->>'session_title')::TEXT,
        (m->>'round')::INTEGER,
        (m->>'court')::INTEGER,
        -- Handle both playerIds (frontend) and player_ids (db) naming
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(m->'playerIds', m->'player_ids'))),
        ARRAY(SELECT jsonb_array_elements_text(m->'player_names')),
        COALESCE((m->>'score1')::INTEGER, 0),
        COALESCE((m->>'score2')::INTEGER, 0),
        COALESCE((m->>'status')::TEXT, 'waiting'),
        COALESCE((m->>'mode')::TEXT, 'KDK'),
        COALESCE(m->>'groupName', m->>'group_name')
    FROM JSONB_ARRAY_ELEMENTS(p_matches) AS m
    ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        court = EXCLUDED.court,
        score1 = EXCLUDED.score1,
        score2 = EXCLUDED.score2,
        player_names = EXCLUDED.player_names,
        player_ids = EXCLUDED.player_ids,
        group_name = EXCLUDED.group_name;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER
$ddl$;
end $p1rb$;

do $$
declare r record; v_first timestamptz; p0b_on boolean;
begin
  if to_regclass('security_backup.p1_state') is null then raise exception 'STOP: P1 백업 없음'; end if;
  alter table security_backup.p1_state add column if not exists restored_at timestamptz;
  select max(captured_at) into v_first from security_backup.p1_state where restored_at is null;
  for r in select * from security_backup.p1_state where captured_at = v_first loop
    -- P0-B 가 지금 설치돼 있는 함수(되돌리지 않은 P0-B 회차가 있음)는 P0-B 상태를 존중: search_path 고정 유지, PUBLIC/anon 재부여 안 함.
    --   백업 테이블이 없으면(P0-B 미적용) false. 있을 때만 동적 SQL 로 조회한다 — 정적 SQL 로 쓰면 PL/pgSQL 이
    --   식 전체를 계획하면서 테이블 부재로 rollback 전체가 실패한다(2026-11-05 로컬 재현).
    p0b_on := false;
    if to_regclass('security_backup.function_acl_p0b') is not null then
      execute 'select exists (select 1 from security_backup.function_acl_p0b b where b.signature = $1 and b.restored_at is null)'
        into p0b_on using r.name;
    end if;
    if r.kind = 'function' and to_regprocedure(r.name) is not null then
      -- P1 적용 직전 설정 그대로(그때 P0-B 가 적용돼 있었다면 search_path 고정 유지).
      if coalesce(r.proconfig, '') like '%search_path%' or p0b_on then
        execute format('alter function %s set search_path = public, pg_temp', r.name);
      else
        execute format('alter function %s reset search_path', r.name);
      end if;
      if r.name like 'public.update_match_status%' then
        if not p0b_on and (r.proacl is null or r.proacl ~ '(^|[{,])=X') then execute format('grant execute on function %s to public', r.name); end if;
        if not p0b_on and r.proacl ~ '(^|[{,])anon=X' then execute format('grant execute on function %s to anon', r.name); end if;
        if r.proacl is null or r.proacl ~ '(^|[{,])authenticated=X' then execute format('grant execute on function %s to authenticated', r.name); end if;
      end if;
    elsif r.kind = 'table_grant' then
      execute format('grant %s on public.matches to %I', split_part(r.name, ':', 2), split_part(r.name, ':', 1));
    end if;
  end loop;
  if v_first is not null then
    update security_backup.p1_state set restored_at = now() where captured_at = v_first;
  end if;
end $$;
commit;

select (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and tgname like 'kdk_p1_%') = 0 as p1_triggers_removed,
       (select md5(replace(prosrc, E'\r', '')) from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')) as sync_md5;  -- 함수 없으면 null

-- 원장·이력까지 지우려면(되돌릴 수 없음):
--   drop table public.kdk_match_score_history; drop table public.kdk_match_results;
