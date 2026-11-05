-- =============================================================================
-- KDK 30 — KDK 전용 관리자(kdk_managers) + 일반 회원 현장 코트 운영(빈 코트 투입 · 타이머 시작)
--   [초안 · 승인 전 운영 실행 금지]   rollback: 30_kdk_managers_rollback.sql   상태: 32_kdk_mgr_state_READONLY.sql
--
--   선행: P0-A · P0-B · P0-C · P1(20) 적용. P1-b(25)와 무관(공식 저장은 31 번 파일).
--   문장 1개(DO 블록) — SQL Editor 가 세션을 나눠 실행해도 안전, 임시 테이블 없음. 중간 실패 시 전체 취소.
--
--   바뀌는 것
--     1) public.kdk_managers (user_id PK) — 등록은 SQL Editor(운영자) 전용. 화면·API 로 자기 등록 불가(쓰기 정책 없음).
--     2) public.can_manage_kdk()     = 로그인 + (profiles CEO·ADMIN  또는  kdk_managers 등재 + 앱 권한 MEMBER·OPERATOR·FINANCE_MANAGER + 탈회 아님)
--     3) public.kdk_can_operate_court() = 로그인 + (CEO·ADMIN  또는  앱 권한 MEMBER·OPERATOR·FINANCE_MANAGER + 탈회 아님)  — GUEST·비로그인 불가
--     4) start_kdk_match · start_kdk_match_timer — 권한 한 줄만 확장(… ) or public.kdk_can_operate_court() into v_is_admin;).
--        대기 상태 · 빈 코트 · 선수 중복 · 조별 코트 · 세션 잠금 · 코트 unique index 등 기존 검사는 글자 하나 바꾸지 않는다.
--        운영 본문이 검토된 본문(md5)일 때만 진행, 아니면 STOP·무변경.
--     6) kdk_session_meta(게스트비 · 조별 코트 · 전광판 문구 · 정모 연결) 쓰기 = can_manage_kdk() 만.
--        기존 "로그인 누구나" 쓰기 정책(write_kdk_session_meta FOR ALL)을 백업 후 교체. 읽기 정책은 그대로(전광판 · 회원 화면).
--     5) P1 score guard — KDK 관리자 분기 추가: 수정(정정·되돌리기·취소) 허용 · 새 경기 행(대진 생성)은 생성 권한 필요 · 삭제 불가.
--        kdk_p1_can_generate() — KDK 관리자 포함. CEO·ADMIN 판정은 그대로.
--   바뀌지 않는 것: profiles.role · members.role · 회원 점수 규칙(P1) · 세션 삭제(delete_kdk_live_session = CEO·ADMIN) ·
--                   Archive(P1-b) · matches 데이터 · RLS · Realtime · 화면 코드.
--   원본 함수 정의는 security_backup.kdk_mgr_fn_backup 에 보관 → rollback 이 그대로 되돌린다.
-- =============================================================================
do $kdkm$
declare
  v_def   text;
  v_new   text;
  v_md5   text;
  v_first boolean;
  v_mark  constant text := ') into v_is_admin;';
  r record;
begin
  perform set_config('lock_timeout', '3s', true);
  perform set_config('statement_timeout', '120s', true);

  -- ── 0. 사전 점검(하나라도 어긋나면 STOP · 무변경) ─────────────────────────
  if to_regclass('public.matches') is null or to_regclass('public.profiles') is null then
    raise exception 'STOP KDK30: matches/profiles 없음 — 변경 없음';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'auth_user_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'role') then
    raise exception 'STOP KDK30: members(auth_user_id, role) 없음 — 탈회 판정 불가, 변경 없음';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'kdk_p1_score_guard_trg' and tgenabled <> 'D') then
    raise exception 'STOP KDK30: P1(20) 미적용 — 먼저 P1 을 적용해야 함, 변경 없음';
  end if;
  for r in
    select * from (values
      ('public.start_kdk_match(text,text)',       array['81257f29c2abed42a8e28bc9e8376626', '8b6c074d6e336c45f5e24bba2e1fd460']),
      ('public.start_kdk_match_timer(text,text)', array['a5b9875242bb9c28f33f9b1ad910ccc7']),
      ('public.kdk_p1_score_guard()',             array['82f7e3a705449d4b522e9a7945083bf6']),
      ('public.kdk_p1_can_generate()',            array['74e6681b3a3c5a0963aacb52be5a3a35']),
      ('public.kdk_p1_actor_role()',              array['5f76a50daed2c7bf557c6a90e2b34be2'])) v(sig, allowed)
  loop
    if to_regprocedure(r.sig) is null then
      raise exception 'STOP KDK30: % 없음 — 변경 없음', r.sig;
    end if;
    select md5(replace(prosrc, E'\r', '')), prosrc like '%[KDKM]%' into v_md5, v_first
      from pg_proc where oid = to_regprocedure(r.sig);
    if not v_first and v_md5 <> all(r.allowed) then
      raise exception 'STOP KDK30: % 운영 본문이 검토된 본문(md5 허용 목록)과 다름 — 변경 없음', r.sig;
    end if;
  end loop;

  -- kdk_session_meta: RLS 켜짐 + 누구나 읽기 정책이 있어야 쓰기 정책만 바꿔도 읽기가 유지된다.
  if to_regclass('public.kdk_session_meta') is null
     or not (select relrowsecurity from pg_class where oid = 'public.kdk_session_meta'::regclass) then
    raise exception 'STOP KDK30: kdk_session_meta 없음 또는 RLS 꺼짐 — 정책 교체로 보호 불가, 변경 없음';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'kdk_session_meta'
                  and cmd = 'SELECT' and permissive = 'PERMISSIVE' and btrim(qual) = 'true'
                  and roles && array['public', 'anon', 'authenticated']::name[]) then
    raise exception 'STOP KDK30: kdk_session_meta 에 "누구나 읽기" SELECT 정책이 없음 — 쓰기 정책 교체 시 읽기가 끊길 수 있음, 변경 없음';
  end if;

  -- ── 1. 원본 정의 백업(첫 설치 회차만) ─────────────────────────────────────
  create schema if not exists security_backup;
  revoke all on schema security_backup from public, anon, authenticated;
  create table if not exists security_backup.kdk_mgr_fn_backup (
      captured_at timestamptz not null default now(),
      step        text not null,       -- 'KDK30' | 'KDK31'
      sig         text not null,
      def         text not null,       -- pg_get_functiondef 원문(ACL 은 CREATE OR REPLACE 가 유지)
      restored_at timestamptz
  );
  revoke all on security_backup.kdk_mgr_fn_backup from public, anon, authenticated;
  v_first := not exists (select 1 from security_backup.kdk_mgr_fn_backup where step = 'KDK30' and restored_at is null);
  if v_first then
    insert into security_backup.kdk_mgr_fn_backup (step, sig, def)
    select 'KDK30', s, pg_get_functiondef(to_regprocedure(s))
      from unnest(array['public.start_kdk_match(text,text)', 'public.start_kdk_match_timer(text,text)',
                        'public.kdk_p1_score_guard()', 'public.kdk_p1_can_generate()']) s
     where (select prosrc not like '%[KDKM]%' from pg_proc where oid = to_regprocedure(s));
    if (select count(*) from security_backup.kdk_mgr_fn_backup where step = 'KDK30' and restored_at is null) <> 4 then
      raise exception 'STOP KDK30: 원본 백업 4개를 확보하지 못함(일부가 이미 변경된 상태) — 변경 없음';
    end if;
  end if;

  -- ── 2. KDK 관리자 화이트리스트 ─────────────────────────────────────────────
  create table if not exists public.kdk_managers (
      user_id    uuid        primary key references auth.users(id) on delete cascade,
      note       text,
      granted_by text,
      granted_at timestamptz not null default now()
  );
  comment on table public.kdk_managers is
    'KDK 전용 관리자(additive). profiles.role 을 바꾸지 않는다. 등록·해제는 SQL Editor 전용(화면/API 쓰기 정책 없음).';
  alter table public.kdk_managers enable row level security;
  revoke all on public.kdk_managers from public, anon, authenticated;
  grant select on public.kdk_managers to authenticated;
  drop policy if exists kdk_managers_select_self on public.kdk_managers;
  create policy kdk_managers_select_self on public.kdk_managers for select to authenticated using (user_id = auth.uid());
  drop policy if exists kdk_managers_select_admin on public.kdk_managers;
  create policy kdk_managers_select_admin on public.kdk_managers for select to authenticated using (public.is_full_admin());

  -- ── 3. 판정 helper (DEFINER · 고정 search_path · 파라미터 없음 · 동적 SQL 없음) ──────────────
  execute $f$
create or replace function public.kdk_actor_withdrawn()
returns boolean language sql stable security definer set search_path = public, pg_temp as $b$
  -- members.role 쉼표 다중값 중 '탈회'(is_withdrawn_member_role 과 같은 규칙)
  select exists (select 1 from public.members m, unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v)
                  where m.auth_user_id::text = auth.uid()::text and btrim(r.v) = '탈회');
$b$ $f$;

  execute $f$
create or replace function public.can_manage_kdk()
returns boolean language sql stable security definer set search_path = public, pg_temp as $b$
  -- [KDKM] KDK 관리자: CEO·ADMIN 또는 등재된 회원(MEMBER·OPERATOR·FINANCE_MANAGER, 탈회 아님). GUEST 로 바뀌면 자동 상실.
  --   역할 정규화는 AuthContext.normalizeRole 과 같다(trim + upper). P1 helper 에 의존하지 않는다(P1 rollback 과 독립).
  select auth.uid() is not null and (
           x.r in ('CEO', 'ADMIN')
        or (exists (select 1 from public.kdk_managers k where k.user_id = auth.uid())
            and x.r in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER')
            and not public.kdk_actor_withdrawn()))
    from (select upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = auth.uid()::text), ''))) as r) x;
$b$ $f$;

  execute $f$
create or replace function public.kdk_can_operate_court()
returns boolean language sql stable security definer set search_path = public, pg_temp as $b$
  -- [KDKM] 현장 코트 운영(빈 코트 투입 · 타이머 시작): 로그인 회원 전원. GUEST · 비로그인 · 탈회 불가.
  select auth.uid() is not null and (
           x.r in ('CEO', 'ADMIN')
        or (x.r in ('MEMBER', 'OPERATOR', 'FINANCE_MANAGER') and not public.kdk_actor_withdrawn()))
    from (select upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = auth.uid()::text), ''))) as r) x;
$b$ $f$;
  revoke all on function public.kdk_actor_withdrawn(), public.can_manage_kdk(), public.kdk_can_operate_court() from public, anon;
  grant execute on function public.kdk_actor_withdrawn(), public.can_manage_kdk(), public.kdk_can_operate_court() to authenticated, service_role;

  -- ── 4. 투입 · 타이머 RPC — 권한 한 줄만 확장 ───────────────────────────────
  foreach v_md5 in array array['public.start_kdk_match(text,text)', 'public.start_kdk_match_timer(text,text)'] loop
    if (select prosrc like '%[KDKM]%' from pg_proc where oid = to_regprocedure(v_md5)) then
      continue;                                             -- 재실행: 이미 확장됨
    end if;
    v_def := pg_get_functiondef(to_regprocedure(v_md5));
    if (length(v_def) - length(replace(v_def, v_mark, ''))) / length(v_mark) <> 1 then
      raise exception 'STOP KDK30: % 권한 판정 위치를 정확히 1곳 찾지 못함 — 변경 없음', v_md5;
    end if;
    v_new := replace(v_def, v_mark, ') or public.kdk_can_operate_court() into v_is_admin;  -- [KDKM] 로그인 회원(GUEST 제외) 현장 운영');
    execute v_new;
  end loop;

  -- ── 5. P1 guard · 생성 권한 — KDK 관리자 분기 ───────────────────────────────
  execute $f$
create or replace function public.kdk_p1_can_generate()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $b$
declare v_role text; v_perm jsonb;
begin
  if auth.uid() is null then return false; end if;
  v_role := public.kdk_p1_actor_role();
  if v_role = 'CEO' then return true; end if;
  if v_role = 'ADMIN' then
    select c.permissions::jsonb -> 'ADMIN' into v_perm from public.app_config c where c.id::text = 'primary';
    if v_perm is null or jsonb_typeof(v_perm) <> 'object' then
      return true;
    end if;
    return coalesce(v_perm ->> 'kdk', '') = 'WRITE';
  end if;
  -- [KDKM] KDK 관리자(등재 회원): 대진 생성·수동 저장 허용(app_config 기능 권한과 무관 — 등재 자체가 권한).
  return public.can_manage_kdk();
end;
$b$ $f$;

  execute $f$
create or replace function public.kdk_p1_score_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $b$
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
    if tg_op = 'INSERT' and not public.kdk_p1_can_generate() then
      raise exception 'kdk: 대진 생성 권한이 없습니다(app_config 기능 권한 kdk)' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;

  -- [KDKM] KDK 관리자: 대진 생성(INSERT) · 정정 · 되돌리기 · 취소(UPDATE) 허용. 경기 삭제(세션 삭제 · 전체 초기화)는 불가.
  if public.can_manage_kdk() then
    if tg_op = 'DELETE' then
      raise exception 'kdk: 경기 삭제(세션 삭제·초기화)는 운영진(CEO·ADMIN)만 가능합니다' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and not public.kdk_p1_can_generate() then
      raise exception 'kdk: 대진 생성 권한이 없습니다' using errcode = '42501';
    end if;
    return new;
  end if;

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
$b$ $f$;
  revoke all on function public.kdk_p1_score_guard() from public, anon, authenticated;
  revoke all on function public.kdk_p1_can_generate() from public, anon;
  grant execute on function public.kdk_p1_can_generate() to authenticated, service_role;

  -- ── 6. kdk_session_meta 쓰기 = KDK 관리자 · CEO · ADMIN ──────────────────────
  --   기존 SELECT 외 정책(운영: write_kdk_session_meta FOR ALL authenticated)을 정의 그대로 백업 → 삭제 → 관리자 정책 3개.
  --   UPSERT(INSERT … ON CONFLICT UPDATE)는 INSERT + UPDATE 정책을 모두 통과해야 하므로 둘 다 같은 판정.
  --   DEFINER RPC 는 테이블 소유자라 RLS 영향 없음.
  create table if not exists security_backup.kdk_mgr_policy_backup (
      captured_at timestamptz not null default now(),
      policyname  name not null,
      permissive  text not null,
      roles       name[] not null,
      cmd         text not null,
      qual        text,
      with_check  text,
      restored_at timestamptz
  );
  revoke all on security_backup.kdk_mgr_policy_backup from public, anon, authenticated;
  if not exists (select 1 from security_backup.kdk_mgr_policy_backup where restored_at is null) then
    insert into security_backup.kdk_mgr_policy_backup (policyname, permissive, roles, cmd, qual, with_check)
    select p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'kdk_session_meta' and p.cmd <> 'SELECT'
       and p.policyname not like 'kdk_session_meta_%_mgr';
  end if;
  for r in select p.policyname from pg_policies p
            where p.schemaname = 'public' and p.tablename = 'kdk_session_meta' and p.cmd <> 'SELECT' loop
    execute format('drop policy %I on public.kdk_session_meta', r.policyname);
  end loop;
  create policy kdk_session_meta_insert_mgr on public.kdk_session_meta for insert to authenticated
    with check (public.can_manage_kdk());
  create policy kdk_session_meta_update_mgr on public.kdk_session_meta for update to authenticated
    using (public.can_manage_kdk()) with check (public.can_manage_kdk());
  create policy kdk_session_meta_delete_mgr on public.kdk_session_meta for delete to authenticated
    using (public.can_manage_kdk());

  -- 최종 확인: 확장 표시가 4개 함수에 모두 있어야 한다.
  if (select count(*) from pg_proc where oid in (to_regprocedure('public.start_kdk_match(text,text)'), to_regprocedure('public.start_kdk_match_timer(text,text)'),
                                                 to_regprocedure('public.kdk_p1_score_guard()'), to_regprocedure('public.kdk_p1_can_generate()'))
        and prosrc like '%[KDKM]%') <> 4 then
    raise exception 'STOP KDK30: 확장 확인 실패 — 전체 취소';
  end if;
  if has_function_privilege('anon', 'public.start_kdk_match(text,text)', 'execute')
     or has_function_privilege('anon', 'public.start_kdk_match_timer(text,text)', 'execute')
     or has_function_privilege('anon', 'public.can_manage_kdk()', 'execute') then
    raise exception 'STOP KDK30: anon 실행 권한이 남아 있음(P0-B 미적용?) — 전체 취소';
  end if;
end
$kdkm$;

notify pgrst, 'reload schema';

select 'KDK30' as step,
       (select count(*) from pg_proc where prosrc like '%[KDKM]%' and pronamespace = 'public'::regnamespace) as kdkm_funcs,   -- 6 (31 적용 후 8)
       (select count(*) from public.kdk_managers) as managers,                                                              -- 0 (등록은 별도)
       has_function_privilege('anon', 'public.start_kdk_match(text,text)', 'execute') as anon_start,                         -- false
       has_function_privilege('authenticated', 'public.can_manage_kdk()', 'execute') as auth_can_manage,                     -- true
       (select count(*) from security_backup.kdk_mgr_fn_backup where step = 'KDK30' and restored_at is null) as backup_rows,  -- 4
       (select string_agg(policyname || '(' || cmd || ')', ' · ' order by policyname) from pg_policies
         where schemaname = 'public' and tablename = 'kdk_session_meta' and cmd <> 'SELECT') as meta_write_policies;      -- *_mgr 3개만
