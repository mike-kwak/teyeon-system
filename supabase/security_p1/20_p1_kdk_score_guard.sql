-- =============================================================================
-- SECURITY P1 — KDK 점수 권한 (최초 입력 = 로그인 누구나 · 정정/삭제/초기화 = 운영진)   [초안 · 승인 전 운영 실행 금지]
--
--   정책(2026-11-04 확정):
--     1) 로그인 사용자(MEMBER·GUEST 포함)는 "진행 중(playing) 경기의 최초 결과"만 저장할 수 있다(현행 화면 동작).
--     2) 이미 결과가 저장된 경기의 수정·삭제·초기화는 운영진(CEO·ADMIN)만.
--     3) 운영진이 되돌린 경기의 재입력도 운영진만.
--     4) 정정 사유는 P2. 여기서는 변경 이력만 자동 기록.
--     5) Special Match 는 현행 동작 보존(sync_tournament_matches 가 **있을 때만** "Special 행만 다루도록" 범위만 고정,
--        없으면 건너뜀 — 새 RPC 를 만들지 않는다. update_match_status 도 있을 때만 권한 회수).
--
--   판정 근거 = 영구 원장(kdk_match_results). SQL 명령 종류(INSERT/UPDATE/UPSERT)나 status·점수 값이 아니라
--     "이 경기 행(생애)에 결과가 한 번이라도 저장됐는가"로 판정한다.
--     - 생애: matches 행 INSERT ~ DELETE. 같은 id 를 지우고 다시 만들면 새 생애(정상 신규 입력 가능).
--       운영진이 선수·세션을 바꾸면(재배정) 새 생애. 되돌리기(→ waiting)·재투입은 같은 생애(원장 유지).
--     - 원장 행은 지우지 않고 closed_at 으로 닫는다(이력 보존). 회원은 원장·이력 테이블에 접근 불가.
--
--   적용 범위: PostgREST 직접 쓰기(current_user = anon/authenticated). SECURITY DEFINER RPC
--     (start_kdk_match · start_kdk_match_timer · delete_kdk_live_session — 내부 CEO/ADMIN 검사)는 그대로 통과.
--     원장·이력 기록(AFTER trigger)은 모든 경로에 적용.
--   바꾸지 않는 것: matches 컬럼·데이터·RLS·정책 · 기존 KDK RPC · 화면 코드 · Realtime · SPOTLIGHT v2.1.
--   P0(10·11·12)와 독립 — P0 적용 여부와 무관하게 동작(anon 도 trigger 에서 거부). P0 와 같은 배포에 묶지 않는다.
--   rollback: 20_p1_rollback.sql
-- =============================================================================
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.matches') is null or to_regclass('public.profiles') is null then
    raise exception 'STOP P1: matches/profiles 없음';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'app_config' and column_name = 'permissions') then
    raise exception 'STOP P1: app_config.permissions 없음 — 대진 생성 권한을 화면과 같게 판정할 수 없음';
  end if;
  -- 함수가 없으면(운영 2026-11-04 확인: 없음) 건너뛴다 — P1 은 이 함수를 새로 만들지 않는다.
  -- 있으면 원본(md5 일치)이거나 이미 P1 이 적용된 본문([P1] 표시)이어야 한다. 그 외는 STOP.
  if to_regprocedure('public.sync_tournament_matches(jsonb)') is not null
     and (select md5(replace(prosrc, E'\r', '')) is distinct from 'a27d801795e07e61e4c71c26d3ffa8ef' and prosrc not like '%[P1] Special 행만 허용%'
            from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)')) then
    raise exception 'STOP P1: 운영 sync_tournament_matches 본문이 저장소 원본(sync_rpc_v1.sql)과 다름 — 변경 없음';
  end if;
end $$;

-- 적용 전 상태 저장(rollback 근거, anon/authenticated 접근 불가 스키마)
create schema if not exists security_backup;
revoke all on schema security_backup from public, anon, authenticated;
create table if not exists security_backup.p1_state (
    captured_at timestamptz not null default now(),
    kind        text not null,      -- 'function' | 'table_grant'
    name        text not null,      -- 함수 서명 또는 grantee:privilege
    proacl      text,
    proconfig   text
);
alter table security_backup.p1_state add column if not exists restored_at timestamptz;
revoke all on security_backup.p1_state from public, anon, authenticated;
-- 이미 P1 이 설치돼 있으면(재실행) 백업 회차를 새로 만들지 않는다.
create temp table _p1_first_install on commit drop as
select not exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'kdk_p1_score_guard_trg') as yes;
insert into security_backup.p1_state (kind, name, proacl, proconfig)
select 'function', s, (select p.proacl::text from pg_proc p where p.oid = to_regprocedure(s)),
       (select array_to_string(p.proconfig, ' ') from pg_proc p where p.oid = to_regprocedure(s))
  from unnest(array['public.sync_tournament_matches(jsonb)', 'public.update_match_status(text,text,integer,integer,integer)']) s
 where to_regprocedure(s) is not null and (select yes from _p1_first_install);
insert into security_backup.p1_state (kind, name)
select 'table_grant', g.r || ':' || p.p
  -- authenticated 만 저장: anon 권한은 P0-A 소관이라 P1 rollback 이 anon 권한을 되살리지 않게 한다.
  from (values ('authenticated')) g(r), (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(p)
 where has_table_privilege(g.r, 'public.matches', p.p) and (select yes from _p1_first_install);

-- ── 1. 권한 판정 helper (화면 AuthContext 와 같은 규칙) ─────────────────────────
create or replace function public.kdk_p1_actor_role()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  -- AuthContext.normalizeRole: trim + upper, 알 수 없는 값·프로필 없음 = GUEST
  select case when r in ('CEO','ADMIN','OPERATOR','FINANCE_MANAGER','MEMBER','GUEST') then r else 'GUEST' end
    from (select upper(btrim(coalesce((select p.role::text from public.profiles p where p.id = auth.uid()), ''))) as r) x;
$$;

-- 결과 정정·삭제·초기화·재입력 권한(화면 isAdmin = CEO || ADMIN).
create or replace function public.kdk_p1_can_manage_results()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and public.kdk_p1_actor_role() in ('CEO','ADMIN');
$$;

-- 대진 생성(새 matches 행) 권한 — 화면과 동일:
--   대진 설정 화면(step 0~2)은 isAdmin(CEO·ADMIN)만 진입(비운영진은 step 3 으로 자동 이동, app/kdk/page.tsx),
--   그 안의 생성·수동 저장 버튼은 hasPermission('kdk') === 'WRITE' 를 추가로 요구한다.
--   hasPermission: CEO → 항상 WRITE / app_config.permissions[role] 없음 → ADMIN 은 WRITE / 있으면 permissions[role].kdk.
--   → DB 규칙 = CEO, 또는 ADMIN 이면서 (ADMIN 설정 없음 또는 ADMIN.kdk = 'WRITE'). MEMBER·GUEST 는 설정과 무관하게 불가(화면에서 진입 불가).
create or replace function public.kdk_p1_can_generate()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; v_perm jsonb;
begin
  if auth.uid() is null then return false; end if;
  v_role := public.kdk_p1_actor_role();
  if v_role = 'CEO' then return true; end if;
  if v_role <> 'ADMIN' then return false; end if;
  select c.permissions::jsonb -> 'ADMIN' into v_perm from public.app_config c where c.id::text = 'primary';
  if v_perm is null or jsonb_typeof(v_perm) <> 'object' then
    return true;
  end if;
  return coalesce(v_perm ->> 'kdk', '') = 'WRITE';
end;
$$;
revoke all on function public.kdk_p1_actor_role(), public.kdk_p1_can_manage_results(), public.kdk_p1_can_generate() from public, anon;
grant execute on function public.kdk_p1_actor_role(), public.kdk_p1_can_manage_results(), public.kdk_p1_can_generate() to authenticated, service_role;

-- ── 2. 영구 원장 · 변경 이력 ────────────────────────────────────────────────────
create table if not exists public.kdk_match_results (
    id              bigserial   primary key,
    match_id        text        not null,
    session_id      text,
    player_ids      text[],
    score1          integer,
    score2          integer,
    recorded_at     timestamptz not null default now(),
    recorded_by     uuid,
    recorded_role   text,
    source          text        not null,         -- 'first_entry' | 'pre_install' | 'inserted_complete'
    closed_at       timestamptz,
    closed_reason   text                          -- 'row_deleted' | 'reassigned'
);
create unique index if not exists kdk_match_results_active_uidx on public.kdk_match_results (match_id) where closed_at is null;
create index if not exists kdk_match_results_session_idx on public.kdk_match_results (session_id);
alter table public.kdk_match_results enable row level security;
revoke all on public.kdk_match_results from public, anon, authenticated;
revoke all on sequence public.kdk_match_results_id_seq from public, anon, authenticated;

create table if not exists public.kdk_match_score_history (
    id          bigserial   primary key,
    match_id    text        not null,
    session_id  text,
    kind        text        not null,   -- first_entry | correction | reset | delete_recorded | reassigned | inserted_complete
    actor       uuid,
    actor_role  text,
    db_role     text,
    old_status  text, old_score1 integer, old_score2 integer,
    new_status  text, new_score1 integer, new_score2 integer,
    at          timestamptz not null default now()
);
create index if not exists kdk_match_score_history_match_idx on public.kdk_match_score_history (match_id);
alter table public.kdk_match_score_history enable row level security;
revoke all on public.kdk_match_score_history from public, anon, authenticated;
revoke all on sequence public.kdk_match_score_history_id_seq from public, anon, authenticated;

-- 설치 시점에 이미 완료된 경기 = 결과 저장됨(회원 덮어쓰기 차단).
insert into public.kdk_match_results (match_id, session_id, player_ids, score1, score2, source)
select m.id::text, m.session_id::text, m.player_ids::text[], m.score1, m.score2, 'pre_install'
  from public.matches m
 where m.status = 'complete'
   and not exists (select 1 from public.kdk_match_results r where r.match_id = m.id::text and r.closed_at is null);

-- 이 경기 행(생애)에 결과가 저장돼 있는가(원장은 회원이 직접 읽을 수 없으므로 DEFINER).
create or replace function public.kdk_p1_result_recorded(p_match_id text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.kdk_match_results r where r.match_id = p_match_id and r.closed_at is null);
$$;
revoke all on function public.kdk_p1_result_recorded(text) from public, anon;
grant execute on function public.kdk_p1_result_recorded(text) to authenticated, service_role;

-- ── 3. BEFORE guard — 직접 API 쓰기만 검사 ────────────────────────────────────
create or replace function public.kdk_p1_score_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_recorded boolean;
  v_ignore constant text[] := array['status','score1','score2','updated_at'];
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);                         -- DEFINER RPC · SQL Editor · service_role
  end if;
  if auth.uid() is null or current_user = 'anon' then
    raise exception 'kdk: 로그인이 필요합니다' using errcode = '42501';
  end if;
  if public.kdk_p1_can_manage_results() then
    -- 운영진: 시작·취소·정정·되돌리기·삭제 등 기존 흐름 전부 허용(이력은 AFTER trigger).
    --   단 새 경기 행 생성(대진 생성·수동 저장 = INSERT/UPSERT 의 INSERT 단계)은 화면과 같은 생성 권한 필요.
    if tg_op = 'INSERT' and not public.kdk_p1_can_generate() then
      raise exception 'kdk: 대진 생성 권한이 없습니다(app_config 기능 권한 kdk)' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;

  -- 비운영진(MEMBER·GUEST 등 로그인 사용자): 경기 생성·삭제 불가, 수정은 최초 결과 저장만.
  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'kdk: 경기 생성·삭제는 운영진만 가능합니다' using errcode = '42501';
  end if;

  v_recorded := public.kdk_p1_result_recorded(old.id::text);
  if old.status::text = 'playing' and new.status::text = 'complete'
     and new.score1 is not null and new.score2 is not null
     and not v_recorded
     and (to_jsonb(new) - v_ignore) = (to_jsonb(old) - v_ignore) then
    return new;                                        -- 최초 결과 저장(로그인 누구나)
  end if;
  raise exception 'kdk: 저장된 결과의 수정·초기화 및 경기 정보 변경은 운영진만 가능합니다' using errcode = '42501';
end;
$$;
revoke all on function public.kdk_p1_score_guard() from public, anon, authenticated;

-- TRUNCATE 는 행 trigger 가 돌지 않으므로 별도 차단(권한 회수와 이중).
create or replace function public.kdk_p1_block_truncate()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'kdk: TRUNCATE 금지' using errcode = '42501';
  end if;
  return null;
end;
$$;
revoke all on function public.kdk_p1_block_truncate() from public, anon, authenticated;

-- ── 4. AFTER — 원장 · 이력 (모든 경로) ───────────────────────────────────────
create or replace function public.kdk_p1_score_ledger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_role text := case when auth.uid() is null then null else public.kdk_p1_actor_role() end;
  v_db text := session_user::text;
begin
  if tg_op = 'DELETE' then
    if old.status::text = 'complete' then
      insert into public.kdk_match_score_history (match_id, session_id, kind, actor, actor_role, db_role, old_status, old_score1, old_score2)
      values (old.id::text, old.session_id::text, 'delete_recorded', v_uid, v_role, v_db, old.status::text, old.score1, old.score2);
    end if;
    update public.kdk_match_results set closed_at = now(), closed_reason = 'row_deleted'
     where match_id = old.id::text and closed_at is null;
    return null;
  end if;

  if tg_op = 'UPDATE'
     and (new.session_id is distinct from old.session_id or new.player_ids is distinct from old.player_ids
          or new.id is distinct from old.id) then
    update public.kdk_match_results set closed_at = now(), closed_reason = 'reassigned'
     where match_id = old.id::text and closed_at is null;
    insert into public.kdk_match_score_history (match_id, session_id, kind, actor, actor_role, db_role, old_status, old_score1, old_score2, new_status, new_score1, new_score2)
    values (new.id::text, new.session_id::text, 'reassigned', v_uid, v_role, v_db, old.status::text, old.score1, old.score2, new.status::text, new.score1, new.score2);
  end if;

  if new.status::text = 'complete' then
    if not exists (select 1 from public.kdk_match_results r where r.match_id = new.id::text and r.closed_at is null) then
      insert into public.kdk_match_results (match_id, session_id, player_ids, score1, score2, recorded_by, recorded_role, source)
      values (new.id::text, new.session_id::text, new.player_ids::text[], new.score1, new.score2, v_uid, v_role,
              case when tg_op = 'INSERT' then 'inserted_complete' else 'first_entry' end)
      on conflict (match_id) where closed_at is null do nothing;
      insert into public.kdk_match_score_history (match_id, session_id, kind, actor, actor_role, db_role, old_status, old_score1, old_score2, new_status, new_score1, new_score2)
      values (new.id::text, new.session_id::text, case when tg_op = 'INSERT' then 'inserted_complete' else 'first_entry' end,
              v_uid, v_role, v_db,
              case when tg_op = 'UPDATE' then old.status::text end, case when tg_op = 'UPDATE' then old.score1 end,
              case when tg_op = 'UPDATE' then old.score2 end, new.status::text, new.score1, new.score2);
    elsif tg_op = 'UPDATE' and (new.score1 is distinct from old.score1 or new.score2 is distinct from old.score2
                                or old.status::text is distinct from 'complete') then
      insert into public.kdk_match_score_history (match_id, session_id, kind, actor, actor_role, db_role, old_status, old_score1, old_score2, new_status, new_score1, new_score2)
      values (new.id::text, new.session_id::text, 'correction', v_uid, v_role, v_db, old.status::text, old.score1, old.score2, new.status::text, new.score1, new.score2);
    end if;
  elsif tg_op = 'UPDATE' and old.status::text = 'complete' then
    insert into public.kdk_match_score_history (match_id, session_id, kind, actor, actor_role, db_role, old_status, old_score1, old_score2, new_status, new_score1, new_score2)
    values (new.id::text, new.session_id::text, 'reset', v_uid, v_role, v_db, old.status::text, old.score1, old.score2, new.status::text, new.score1, new.score2);
  end if;
  return null;
end;
$$;
revoke all on function public.kdk_p1_score_ledger() from public, anon, authenticated;

drop trigger if exists kdk_p1_score_guard_trg on public.matches;
create trigger kdk_p1_score_guard_trg before insert or update or delete on public.matches
  for each row execute function public.kdk_p1_score_guard();
drop trigger if exists kdk_p1_block_truncate_trg on public.matches;
create trigger kdk_p1_block_truncate_trg before truncate on public.matches
  for each statement execute function public.kdk_p1_block_truncate();
drop trigger if exists kdk_p1_score_ledger_trg on public.matches;
create trigger kdk_p1_score_ledger_trg after insert or update or delete on public.matches
  for each row execute function public.kdk_p1_score_ledger();

-- ── 5. 테이블 권한 보조(행 trigger 가 못 막는 것) ─────────────────────────────
-- authenticated 만. anon 테이블 권한은 P0-A 소관(P1 은 anon 을 trigger 로 거부) → P0-A 와 rollback 이 서로 얽히지 않는다.
revoke truncate, references, trigger on public.matches from authenticated;

-- ── 6. 우회 경로 RPC ────────────────────────────────────────────────────────────
-- update_match_status: 앱 코드 호출 없음(레거시) + 권한 검사 없이 아무 경기 상태·점수 변경 → 로그인 사용자도 실행 불가.
do $$
begin
  if to_regprocedure('public.update_match_status(text,text,integer,integer,integer)') is not null then
    revoke execute on function public.update_match_status(text,text,integer,integer,integer) from public, anon, authenticated;
    grant execute on function public.update_match_status(text,text,integer,integer,integer) to service_role;
  end if;
end $$;

-- sync_tournament_matches: Special 화면 전용인데 id 만 맞으면 KDK 경기도 덮어쓸 수 있다(DEFINER → guard 우회).
--   함수가 **있을 때만** 본문 맨 앞에 "Special 행(session_id 'SP-…')만" 검사를 추가한다. 없으면 아무것도 만들지 않는다.
--   Special 의 기존 동작(로그인 사용자 누구나 저장)은 그대로 — 권한 확대·축소 없음.
--   함수 설정(search_path)·실행 권한은 교체 전 그대로 유지한다(search_path 고정은 P0-B 소관).
do $p1sync$
declare v_cfg text;
begin
  if to_regprocedure('public.sync_tournament_matches(jsonb)') is null then
    raise notice 'P1: sync_tournament_matches 없음 — 건너뜀(새로 만들지 않음)';
    return;
  end if;
  select coalesce(array_to_string(proconfig, ' '), '') into v_cfg
    from pg_proc where oid = to_regprocedure('public.sync_tournament_matches(jsonb)');
  execute $ddl$
CREATE OR REPLACE FUNCTION public.sync_tournament_matches(p_matches JSONB)
RETURNS VOID
SET search_path = public, pg_temp
AS $fn$
BEGIN
    -- [P1] Special 행만 허용: 입력 session_id 와 이미 있는 같은 id 행의 session_id 가 모두 'SP-' 로 시작해야 한다.
    IF EXISTS (
        SELECT 1 FROM JSONB_ARRAY_ELEMENTS(COALESCE(p_matches, '[]'::jsonb)) AS m
         WHERE COALESCE(m->>'session_id', '') NOT LIKE 'SP-%'
            OR EXISTS (SELECT 1 FROM public.matches x
                        WHERE x.id = (m->>'id')::TEXT AND COALESCE(x.session_id, '') NOT LIKE 'SP-%')
    ) THEN
        RAISE EXCEPTION 'sync_tournament_matches: Special 경기(SP-)만 저장할 수 있습니다' USING ERRCODE = '42501';
    END IF;

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
  if v_cfg not like '%search_path%' then
    execute 'alter function public.sync_tournament_matches(jsonb) reset search_path';   -- 교체 전에도 없었다면 그대로 없음
  end if;
  raise notice 'P1: sync_tournament_matches — Special 행 범위 고정';
end $p1sync$;

commit;

select 'P1' as step,
       (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and not tgisinternal
          and tgname in ('kdk_p1_score_guard_trg','kdk_p1_block_truncate_trg','kdk_p1_score_ledger_trg') and tgenabled <> 'D') = 3 as triggers_on,
       (select count(*) from public.kdk_match_results where closed_at is null) as active_results,
       has_table_privilege('authenticated', 'public.matches', 'TRUNCATE') as auth_truncate,   -- false
       case when to_regprocedure('public.update_match_status(text,text,integer,integer,integer)') is null then null
            else has_function_privilege('authenticated', 'public.update_match_status(text,text,integer,integer,integer)', 'execute') end
         as auth_update_match_status; -- false(또는 함수 없음 null)
