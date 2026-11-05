-- =============================================================================
-- KDK 31 — KDK 관리자 "당일 최초 공식 저장" 전용 경로   [초안 · 승인 전 운영 실행 금지]
--   rollback: 31_kdk_official_save_rollback.sql   상태: 32_kdk_mgr_state_READONLY.sql
--
--   선행: 30_kdk_managers_court_ops.sql · P1-b(25) 적용(공식 기록 쓰기 = CEO·ADMIN 만).
--   문장 1개(DO 블록) · 임시 테이블 없음 · 중간 실패 시 전체 취소.
--
--   P1-b 를 약화하지 않는다:
--     · teyeon_archive_v1 직접 쓰기(INSERT·UPDATE·DELETE·UPSERT)는 지금처럼 CEO·ADMIN 만. 테이블 권한·정책 무변경.
--     · KDK 관리자는 save_kdk_official_archive() RPC 안에서만, 그 RPC 가 지금 저장 중인 세션 id 1건의 INSERT 만 통과.
--       (trigger 가 확인: DB 실행 주체가 anon/authenticated 가 아님(=DEFINER 함수 내부) + 함수 내부 표식(teyeon.kdk_official_save = new.id)
--        + can_manage_kdk(). 표식은 PostgREST 요청으로 설정할 수 없고, RPC 가 INSERT 직후 지운다.)
--     · UPDATE · DELETE 는 어떤 경로든 CEO·ADMIN 만(관리자 분기 없음) → 과거 Archive 수정·삭제 불가.
--   RPC 검증(하나라도 어긋나면 저장 안 함):
--     세션 id 형식 KDK-YYYYMMDD-… · 당일(한국 날짜 기준 전날~오늘 생성) · 이미 Archive 행/저장 기록 있으면 거부(최초 1회) ·
--     snapshot_data = DB 라이브 경기와 id · 상태 · 점수 · 선수 · 라운드 1:1 일치 · 승패/득실 = snapshot 재계산 ·
--     순위 순서(승수 → 득실) · 정산 금액 = 정산식 재계산 · 게스트비 = kdk_session_meta.guest_fee · 상금 범위 ·
--     허용된 최상위 키만 · 크기 제한. 저장 행은 미확정(is_official = false, 기본값) — 공식 확정은 지금처럼 CEO·ADMIN 이 Archive 에서.
--   동시 저장: 세션 단위 advisory lock + 라이브 경기 FOR UPDATE + 기존 행 재확인 → 두 번째 요청은 already_archived.
--   저장 후 같은 트랜잭션에서 검증한 라이브 경기만 삭제(관리자는 직접 삭제 권한이 없으므로 RPC 가 정리).
--   감사 기록: public.kdk_official_saves (조회 = CEO·ADMIN, 쓰기 = RPC 만).
-- =============================================================================
do $kdkm31$
declare
  v_md5   text;
  v_first boolean;
begin
  perform set_config('lock_timeout', '3s', true);
  perform set_config('statement_timeout', '120s', true);

  -- ── 0. 사전 점검 ───────────────────────────────────────────────────────────
  if to_regprocedure('public.can_manage_kdk()') is null or to_regclass('security_backup.kdk_mgr_fn_backup') is null then
    raise exception 'STOP KDK31: 30_kdk_managers_court_ops.sql 미적용 — 변경 없음';
  end if;
  if to_regprocedure('public.is_full_admin()') is null then
    raise exception 'STOP KDK31: is_full_admin() 없음 — 변경 없음';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname = 'p1b_archive_guard_trg' and tgenabled <> 'D') then
    raise exception 'STOP KDK31: P1-b(25) 미적용 — P1-b 를 먼저 적용해야 함(이 파일은 P1-b 위에서만 동작), 변경 없음';
  end if;
  if to_regprocedure('public.p1b_archive_guard()') is null then
    raise exception 'STOP KDK31: p1b_archive_guard() 없음 — 변경 없음';
  end if;
  select md5(replace(prosrc, E'\r', '')), prosrc like '%[KDKM]%' into v_md5, v_first
    from pg_proc where oid = to_regprocedure('public.p1b_archive_guard()');
  if not v_first and v_md5 <> '34a96f1a7c750f5b91402a5576f359cc' then
    raise exception 'STOP KDK31: p1b_archive_guard 운영 본문이 검토된 본문(25 원본)과 다름 — 변경 없음';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'kdk_session_meta' and column_name = 'guest_fee') then
    raise exception 'STOP KDK31: kdk_session_meta.guest_fee 없음 — 게스트비 검증 불가, 변경 없음';
  end if;

  -- ── 1. 원본 백업(P1-b guard) ───────────────────────────────────────────────
  if not exists (select 1 from security_backup.kdk_mgr_fn_backup where step = 'KDK31' and restored_at is null) then
    if v_first then
      raise exception 'STOP KDK31: p1b_archive_guard 가 이미 확장돼 있으나 원본 백업이 없음 — 변경 없음';
    end if;
    insert into security_backup.kdk_mgr_fn_backup (step, sig, def)
    values ('KDK31', 'public.p1b_archive_guard()', pg_get_functiondef(to_regprocedure('public.p1b_archive_guard()')));
  end if;

  -- ── 2. 감사 기록 ───────────────────────────────────────────────────────────
  create table if not exists public.kdk_official_saves (
      id           bigserial   primary key,
      session_id   text        not null unique,
      archive_id   text        not null,
      club_id      text,
      saved_by     uuid,
      saved_role   text,
      via_manager  boolean     not null,
      match_count  integer     not null,
      player_count integer     not null,
      deleted_live integer     not null,
      raw_md5      text        not null,
      saved_at     timestamptz not null default now()
  );
  comment on table public.kdk_official_saves is 'KDK 관리자 공식 저장(save_kdk_official_archive) 감사 기록. 쓰기 = RPC 만, 조회 = CEO·ADMIN.';
  alter table public.kdk_official_saves enable row level security;
  revoke all on public.kdk_official_saves from public, anon, authenticated;
  revoke all on sequence public.kdk_official_saves_id_seq from public, anon, authenticated;
  grant select on public.kdk_official_saves to authenticated;
  drop policy if exists kdk_official_saves_select_admin on public.kdk_official_saves;
  create policy kdk_official_saves_select_admin on public.kdk_official_saves for select to authenticated using (public.is_full_admin());

  -- ── 3. P1-b guard 확장(INSERT 1건 · RPC 내부 한정). 그 외 판정은 25 원본과 동일 ─────────────
  execute $fn$
create or replace function public.p1b_archive_guard()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $g$
declare
  v_jwt_role text;
begin
  v_jwt_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
  if current_user in ('anon', 'authenticated') or v_jwt_role in ('anon', 'authenticated') then
    if auth.uid() is null then
      raise exception 'archive: 로그인이 필요합니다' using errcode = '42501';
    end if;
    if public.is_full_admin() then
      return coalesce(new, old);
    end if;
    -- [KDKM] KDK 관리자 당일 최초 저장: save_kdk_official_archive() 내부의 INSERT 1건만.
    --   current_user 가 anon/authenticated 가 아님 = DEFINER 함수 내부(직접 API 호출 불가) ·
    --   표식 = 그 RPC 가 지금 저장 중인 세션 id · can_manage_kdk(). UPDATE · DELETE 는 해당 없음.
    if tg_op = 'INSERT'
       and current_user not in ('anon', 'authenticated')
       and coalesce(current_setting('teyeon.kdk_official_save', true), '') <> ''
       and current_setting('teyeon.kdk_official_save', true) = new.id::text
       and public.can_manage_kdk() then
      return new;
    end if;
    raise exception 'archive: 공식 기록 쓰기는 운영진(CEO·ADMIN)만 가능합니다' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$g$
$fn$;
  revoke all on function public.p1b_archive_guard() from public, anon, authenticated;

  -- ── 4. 저장 RPC ────────────────────────────────────────────────────────────
  execute $fn$
create or replace function public.save_kdk_official_archive(p_session_id text, p_club_id text, p_raw_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $s$
declare
  -- [KDKM] KDK 관리자 당일 최초 공식 저장
  v_uid       uuid := auth.uid();
  v_sdate     date;
  v_today     date := (now() at time zone 'Asia/Seoul')::date;
  v_db_n      int;
  v_snap      jsonb;
  v_rank      jsonb;
  v_set       jsonb;
  v_meta      jsonb;
  v_pm        jsonb;
  v_n         int;
  v_bad       int;
  v_bottom    int;
  v_pen_count int;
  v_first     int;
  v_l1        int;
  v_l2        int;
  v_gf        int;
  v_db_gf     int;
  v_ids       text[];
  v_deleted   int;
  v_role      text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth_required');
  end if;
  if not public.can_manage_kdk() then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- 입력 형식
  if p_session_id is null or p_session_id !~ '^KDK-[0-9]{8}-[A-Z0-9]{1,24}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;
  if p_club_id is null or length(btrim(p_club_id)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end if;
  begin
    v_sdate := to_date(substr(p_session_id, 5, 8), 'YYYYMMDD');
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'invalid_session');
  end;
  -- 당일: 세션 id 날짜(화면이 UTC 날짜로 만듦)가 한국 날짜 기준 전날~오늘.
  if v_sdate < v_today - 1 or v_sdate > v_today then
    return jsonb_build_object('ok', false, 'reason', 'not_same_day');
  end if;
  if p_raw_data is null or jsonb_typeof(p_raw_data) <> 'object' or octet_length(p_raw_data::text) > 2000000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  if exists (select 1 from jsonb_object_keys(p_raw_data) k
              where k not in ('title', 'date', 'ranking_data', 'settlement_data', 'settlement_meta', 'snapshot_data',
                              'player_metadata', 'total_matches', 'total_rounds')) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload', 'field', 'keys');
  end if;

  -- 동시 저장 직렬화(세션 단위) → 최초 1회 확인
  perform pg_advisory_xact_lock(hashtextextended('kdk-official-save:' || p_session_id, 0));
  if exists (select 1 from public.teyeon_archive_v1 a where a.id = p_session_id)
     or exists (select 1 from public.kdk_official_saves s where s.session_id = p_session_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_archived');
  end if;

  -- 라이브 경기(DB) 잠금
  select array_agg(x.id) into v_ids
    from (select m.id::text as id from public.matches m
           where m.club_id::text = p_club_id and m.session_id::text = p_session_id
           for update) x;
  v_db_n := coalesce(array_length(v_ids, 1), 0);
  if v_db_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_live_matches');
  end if;
  if exists (select 1 from public.matches m where m.club_id::text = p_club_id and m.session_id::text = p_session_id
               and coalesce(m.status::text, '') = 'playing') then
    return jsonb_build_object('ok', false, 'reason', 'match_in_progress');
  end if;
  if not exists (select 1 from public.matches m where m.club_id::text = p_club_id and m.session_id::text = p_session_id
                   and m.status::text = 'complete') then
    return jsonb_build_object('ok', false, 'reason', 'no_completed_matches');
  end if;

  select gf.guest_fee into v_db_gf from public.kdk_session_meta gf where gf.session_id::text = p_session_id;
  if v_db_gf is null then
    return jsonb_build_object('ok', false, 'reason', 'guest_fee_missing');
  end if;

  begin
    v_snap := p_raw_data -> 'snapshot_data';
    v_rank := p_raw_data -> 'ranking_data';
    v_set  := p_raw_data -> 'settlement_data';
    v_meta := p_raw_data -> 'settlement_meta';
    v_pm   := coalesce(p_raw_data -> 'player_metadata', '{}'::jsonb);
    if jsonb_typeof(v_snap) <> 'array' or jsonb_typeof(v_rank) <> 'array' or jsonb_typeof(v_set) <> 'array'
       or jsonb_typeof(v_meta) <> 'object' or jsonb_typeof(v_pm) <> 'object'
       or jsonb_typeof(p_raw_data -> 'title') <> 'string' or length(p_raw_data ->> 'title') > 120
       or jsonb_typeof(p_raw_data -> 'date') <> 'string' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload', 'field', 'types');
    end if;
    if (p_raw_data ->> 'date') not in (to_char(v_today, 'YYYY-MM-DD'), to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD')) then
      return jsonb_build_object('ok', false, 'reason', 'not_same_day', 'field', 'date');
    end if;

    -- (a) snapshot_data = DB 라이브 경기 1:1
    if jsonb_array_length(v_snap) <> v_db_n
       or (select count(distinct e ->> 'id') from jsonb_array_elements(v_snap) e) <> v_db_n
       or exists (select 1 from jsonb_array_elements(v_snap) e where jsonb_typeof(e) <> 'object'
                     or jsonb_typeof(e -> 'player_ids') <> 'array') then
      return jsonb_build_object('ok', false, 'reason', 'snapshot_mismatch', 'field', 'count');
    end if;
    select count(*) into v_bad
      from jsonb_array_elements(v_snap) e
      left join public.matches m on m.id::text = e ->> 'id' and m.club_id::text = p_club_id and m.session_id::text = p_session_id
     where m.id is null
        or coalesce(e ->> 'status', '') <> coalesce(m.status::text, '')
        or (m.status::text = 'complete' and ((e ->> 'score1') is distinct from m.score1::text or (e ->> 'score2') is distinct from m.score2::text))
        or coalesce((e ->> 'round'), '') <> coalesce(m.round::text, '')
        or array(select x from jsonb_array_elements_text(e -> 'player_ids') with ordinality t(x, o) order by o)
           is distinct from coalesce(m.player_ids::text[], '{}'::text[]);
    if v_bad > 0 then
      return jsonb_build_object('ok', false, 'reason', 'snapshot_mismatch', 'rows', v_bad);
    end if;
    if (p_raw_data -> 'total_matches') is distinct from to_jsonb(v_db_n)
       or (p_raw_data -> 'total_rounds') is distinct from
          to_jsonb((select coalesce(max(coalesce(m.round, 1)), 1) from public.matches m where m.club_id::text = p_club_id and m.session_id::text = p_session_id)) then
      return jsonb_build_object('ok', false, 'reason', 'snapshot_mismatch', 'field', 'totals');
    end if;

    -- (b) 참가자 명단: 순위표 id 중복 없음 · 경기 출전 선수 전원 포함 · 그 외는 참가자 설정(player_metadata)에 있는 사람만
    v_n := jsonb_array_length(v_rank);
    if v_n < 2 or (select count(distinct r ->> 'id') from jsonb_array_elements(v_rank) r) <> v_n
       or exists (select 1 from jsonb_array_elements(v_rank) r where coalesce(r ->> 'id', '') = '') then
      return jsonb_build_object('ok', false, 'reason', 'roster_mismatch', 'field', 'ranking_ids');
    end if;
    if exists (select 1 from public.matches m, unnest(m.player_ids::text[]) p(id)
                where m.club_id::text = p_club_id and m.session_id::text = p_session_id
                  and not exists (select 1 from jsonb_array_elements(v_rank) r where r ->> 'id' = p.id))
       or exists (select 1 from jsonb_array_elements(v_rank) r
                   where not exists (select 1 from public.matches m, unnest(m.player_ids::text[]) p(id)
                                      where m.club_id::text = p_club_id and m.session_id::text = p_session_id and p.id = r ->> 'id')
                     and (v_pm -> (r ->> 'id')) is null) then
      return jsonb_build_object('ok', false, 'reason', 'roster_mismatch', 'field', 'participants');
    end if;
    if jsonb_array_length(v_set) <> v_n then
      return jsonb_build_object('ok', false, 'reason', 'roster_mismatch', 'field', 'settlement_length');
    end if;
    select count(*) into v_bad
      from jsonb_array_elements(v_set) with ordinality s(m, i)
      join jsonb_array_elements(v_rank) with ordinality r(m, i) using (i)
     where (s.m ->> 'rank') is distinct from s.i::text
        or coalesce(s.m ->> 'player_id', '') <> coalesce(r.m ->> 'id', '');
    if v_bad > 0 then
      return jsonb_build_object('ok', false, 'reason', 'settlement_order_mismatch', 'rows', v_bad);
    end if;

    -- (c) 승패 · 득실 = DB 완료 경기 재계산(lib/kdk/aggregate 와 같은 규칙: 동점 경기 제외)
    with slots as (
      select p.id as pid, (p.ord - 1) as slot, coalesce(m.score1, 0) as s1, coalesce(m.score2, 0) as s2
        from public.matches m, unnest(m.player_ids::text[]) with ordinality p(id, ord)
       where m.club_id::text = p_club_id and m.session_id::text = p_session_id
         and m.status::text = 'complete' and coalesce(m.score1, 0) <> coalesce(m.score2, 0) and coalesce(p.id, '') <> ''
    ), counted as (
      select pid,
             sum(case when slot < 2 then s1 else s2 end)::int as pf,
             sum(case when slot < 2 then s2 else s1 end)::int as pa,
             count(*) filter (where (slot < 2 and s1 > s2) or (slot >= 2 and s2 > s1))::int as wins,
             count(*) filter (where (slot < 2 and s1 < s2) or (slot >= 2 and s2 < s1))::int as losses
        from slots group by pid
    ), expected as (
      select r.m ->> 'id' as pid, coalesce(c.wins, 0) wins, coalesce(c.losses, 0) losses,
             coalesce(c.pf, 0) pf, coalesce(c.pa, 0) pa, coalesce(c.pf, 0) - coalesce(c.pa, 0) diff
        from jsonb_array_elements(v_rank) r(m) left join counted c on c.pid = r.m ->> 'id'
    )
    select count(*) into v_bad
      from expected e
      join jsonb_array_elements(v_rank) r(m) on r.m ->> 'id' = e.pid
      join jsonb_array_elements(v_set)  s(m) on s.m ->> 'player_id' = e.pid
     where (r.m ->> 'wins')::int is distinct from e.wins or (r.m ->> 'losses')::int is distinct from e.losses
        or (r.m ->> 'diff')::int is distinct from e.diff
        or (s.m ->> 'wins')::int is distinct from e.wins or (s.m ->> 'losses')::int is distinct from e.losses
        or (s.m ->> 'points_for')::int is distinct from e.pf or (s.m ->> 'points_against')::int is distinct from e.pa
        or (s.m ->> 'diff')::int is distinct from e.diff;
    if v_bad > 0 then
      return jsonb_build_object('ok', false, 'reason', 'aggregate_mismatch', 'rows', v_bad);
    end if;

    -- (d) 순위 순서: 승수 내림차순 → 같은 승수면 득실 내림차순(그다음 연장자 · 이름은 화면 규칙, 여기서는 검사하지 않음)
    select count(*) into v_bad
      from (select (r.m ->> 'wins')::int w, (r.m ->> 'diff')::int d,
                   lag((r.m ->> 'wins')::int) over (order by r.i) pw, lag((r.m ->> 'diff')::int) over (order by r.i) pd
              from jsonb_array_elements(v_rank) with ordinality r(m, i)) t
     where t.pw is not null and (t.w > t.pw or (t.w = t.pw and t.d > t.pd));
    if v_bad > 0 then
      return jsonb_build_object('ok', false, 'reason', 'order_not_monotonic', 'rows', v_bad);
    end if;

    -- (e) 정산: 게스트비 = 세션 설정값 · 상금 범위 · 금액 = 정산식(lib/kdk/settlement.computeSettlement) 재계산
    if (v_meta ->> 'guest_fee') is distinct from v_db_gf::text then
      return jsonb_build_object('ok', false, 'reason', 'settlement_mismatch', 'field', 'guest_fee');
    end if;
    if jsonb_typeof(v_meta -> 'prizes') <> 'object'
       or exists (select 1 from jsonb_object_keys(v_meta) k where k not in ('guest_fee', 'prizes', 'generated_at'))
       or exists (select 1 from jsonb_object_keys(v_meta -> 'prizes') k where k not in ('first', 'l1', 'l2'))
       or exists (select 1 from jsonb_each(v_meta -> 'prizes') e
                   where jsonb_typeof(e.value) <> 'number' or (e.value)::text !~ '^[0-9]{1,7}$' or (e.value::text)::int > 1000000) then
      return jsonb_build_object('ok', false, 'reason', 'settlement_mismatch', 'field', 'prizes');
    end if;
    v_bottom    := ceil(v_n / 2.0)::int;
    v_pen_count := ceil(v_bottom / 2.0)::int;
    v_first     := coalesce(nullif((v_meta -> 'prizes' ->> 'first')::int, 0), 10000);
    v_l1        := coalesce(nullif((v_meta -> 'prizes' ->> 'l1')::int, 0), 3000);
    v_l2        := coalesce(nullif((v_meta -> 'prizes' ->> 'l2')::int, 0), 5000);
    v_gf        := v_db_gf;
    -- 게스트 표시: 게스트 id 형식(manual-guest- · g-)은 반드시 게스트. 형식이 아닌 id 는 화면 판정(이름 표시 등)을 따른다.
    if exists (select 1 from jsonb_array_elements(v_set) s(m)
                where (s.m ->> 'player_id') ~* '^(manual-guest-|g-)' and coalesce(s.m ->> 'is_guest', 'false') <> 'true') then
      return jsonb_build_object('ok', false, 'reason', 'settlement_mismatch', 'field', 'is_guest');
    end if;
    select count(*) into v_bad
      from (select (s.m ->> 'rank')::int - 1 idx,
                   coalesce((s.m ->> 'is_guest')::boolean, false) is_guest,
                   coalesce((s.m ->> 'is_associate_guest_fee_member')::boolean, false) assoc,
                   (s.m ->> 'penalty_amount')::int got_pen, (s.m ->> 'prize_amount')::int got_prize,
                   (s.m ->> 'guest_fee_amount')::int got_gf, (s.m ->> 'final_amount')::int got_final,
                   s.m ->> 'penalty_level' got_level
              from jsonb_array_elements(v_set) s(m)) t,
           lateral (select case when t.idx = 0 and not t.is_guest then v_first else 0 end exp_prize,
                           case when t.idx >= v_n - v_pen_count then -v_l2 when t.idx >= v_n - v_bottom then -v_l1 else 0 end exp_pen,
                           case when t.is_guest or t.assoc then -v_gf else 0 end exp_gf,
                           case when t.idx >= v_n - v_pen_count then 'L2' when t.idx >= v_n - v_bottom then 'L1' end exp_level) e
     where t.got_prize is distinct from e.exp_prize or t.got_pen is distinct from e.exp_pen
        or t.got_gf is distinct from e.exp_gf or t.got_final is distinct from (e.exp_prize + e.exp_pen + e.exp_gf)
        or coalesce(t.got_level, '') <> coalesce(e.exp_level, '');
    if v_bad > 0 then
      return jsonb_build_object('ok', false, 'reason', 'settlement_mismatch', 'rows', v_bad);
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch or invalid_parameter_value then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload', 'field', 'value');
  end;

  -- 저장(INSERT 1건 — 같은 id 가 있으면 PK 충돌로 실패, 덮어쓰기 없음). 표식은 이 INSERT 동안만.
  perform set_config('teyeon.kdk_official_save', p_session_id, true);
  insert into public.teyeon_archive_v1 (id, raw_data) values (p_session_id, p_raw_data);
  perform set_config('teyeon.kdk_official_save', '', true);

  -- 검증한(잠근) 라이브 경기만 정리(관리자는 직접 삭제 권한 없음). 잠근 뒤 새로 생긴 행은 건드리지 않는다.
  delete from public.matches m where m.club_id::text = p_club_id and m.session_id::text = p_session_id and m.id::text = any(v_ids);
  get diagnostics v_deleted = row_count;

  v_role := upper(btrim(coalesce((select p.role::text from public.profiles p where p.id::text = v_uid::text), '')));
  insert into public.kdk_official_saves (session_id, archive_id, club_id, saved_by, saved_role, via_manager, match_count, player_count, deleted_live, raw_md5)
  values (p_session_id, p_session_id, p_club_id, v_uid, v_role, v_role not in ('CEO', 'ADMIN'), v_db_n, v_n, v_deleted, md5(p_raw_data::text));

  return jsonb_build_object('ok', true, 'archiveId', p_session_id, 'matchCount', v_db_n, 'playerCount', v_n, 'deletedLive', v_deleted);
end;
$s$
$fn$;
  revoke all on function public.save_kdk_official_archive(text, text, jsonb) from public, anon;
  grant execute on function public.save_kdk_official_archive(text, text, jsonb) to authenticated;

  if (select count(*) from pg_proc where oid in (to_regprocedure('public.p1b_archive_guard()'), to_regprocedure('public.save_kdk_official_archive(text,text,jsonb)'))
        and prosrc like '%[KDKM]%') <> 2 then
    raise exception 'STOP KDK31: 확장 확인 실패 — 전체 취소';
  end if;
end
$kdkm31$;

notify pgrst, 'reload schema';

select 'KDK31' as step,
       (select count(*) from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname like 'p1b_%' and tgenabled <> 'D') = 2 as p1b_triggers_on,  -- true
       has_function_privilege('anon', 'public.save_kdk_official_archive(text,text,jsonb)', 'execute') as anon_save,                                         -- false
       has_table_privilege('authenticated', 'public.kdk_official_saves', 'INSERT') as auth_audit_insert,                                                   -- false
       (select count(*) from public.kdk_official_saves) as saves,                                                                                          -- 0
       (select count(*) from security_backup.kdk_mgr_fn_backup where step = 'KDK31' and restored_at is null) as backup_rows;                               -- 1
