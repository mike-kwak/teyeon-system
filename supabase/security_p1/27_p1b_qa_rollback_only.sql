-- =============================================================================
-- P1-b 운영 QA — 공식 Archive 쓰기 보호 · 항상 전체 ROLLBACK   [승인 전 운영 실행 금지]
--   문장 1개(DO 블록) + 마지막에 결과를 담은 "의도적 예외" → QA 로 만든 Archive 행 · 정정 이력 · 레거시 시도 모두 취소된다.
--   화면에 빨간 ERROR 로 보이는 것이 정상이며 메시지 안의 PASS/FAIL 이 결과다.
--   요청 흉내: set_config('request.jwt.claims' / 'request.jwt.claim.sub') + SET LOCAL ROLE authenticated|anon (PostgREST 와 같은 방식).
--   일반 회원 = profiles 에 없는 임의 UUID(GUEST 취급) · MEMBER = profiles 의 MEMBER 1명(읽기만 · claims 에만 사용)
--   운영진 = profiles 의 CEO 1명 · ADMIN 1명(읽기만). 기존 공식 기록은 읽기만 하며 QA 전용 행(QA-P1B-*)만 쓴다.
--   TRUNCATE 는 실제로 실행하지 않는다(테이블 전체 잠금 방지) — 권한·trigger 존재로 확인.
-- =============================================================================
do $qa$
declare
  v_id    text := 'QA-P1B-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v_sp    text := 'QA-P1B-SP-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v_guest uuid := gen_random_uuid();
  v_member uuid; v_ceo uuid; v_admin uuid;
  v_before jsonb; v_next jsonb; v_res jsonb;
  v_base_hash text; v_base_total bigint; v_after_hash text;
  out text := ''; pass int := 0; fail int := 0; r text; n bigint;
begin
  perform set_config('lock_timeout', '3s', true);
  -- 0) 전제
  if (select count(*) from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname like 'p1b_%' and tgenabled <> 'D') <> 2 then
    raise exception 'P1-b QA 중단: P1-b trigger 없음(미적용) — 변경 없음';
  end if;
  begin
    execute 'set local role authenticated'; if current_user <> 'authenticated' then raise exception 'x'; end if; execute 'reset role';
    execute 'set local role anon';          if current_user <> 'anon' then raise exception 'x'; end if;          execute 'reset role';
  exception when others then
    raise exception 'P1-b QA 중단: 실행 계정(%)이 authenticated/anon 으로 전환할 수 없음 — 시험 불가 · 변경 없음', session_user;
  end;
  select id into v_ceo    from public.profiles where upper(btrim(role::text)) = 'CEO'    limit 1;
  select id into v_admin  from public.profiles where upper(btrim(role::text)) = 'ADMIN'  limit 1;
  select id into v_member from public.profiles where upper(btrim(role::text)) = 'MEMBER' limit 1;
  if v_ceo is null then raise exception 'P1-b QA 중단: profiles 에 CEO 없음 — 변경 없음'; end if;
  v_admin := coalesce(v_admin, v_ceo);
  v_member := coalesce(v_member, v_guest);

  -- 기준값(기존 행 전체 해시 · QA 행 제외)
  select count(*), md5(string_agg(md5(t::text), '|' order by id)) into v_base_total, v_base_hash
    from public.teyeon_archive_v1 t where id not like 'QA-P1B-%';

  -- QA 픽스처: 1경기 4명, 6:3 → 정정 6:4(정정 RPC 불변식을 모두 만족하는 최소 구조)
  v_before := jsonb_build_object(
    'title', 'P1-b QA(rollback)', 'date', '2026-11-05', 'total_matches', 1, 'total_rounds', 1, 'player_metadata', '{}'::jsonb,
    'settlement_meta', jsonb_build_object('guest_fee', 0, 'prizes', jsonb_build_object('first', 10000, 'l1', 3000, 'l2', 5000)),
    'snapshot_data', jsonb_build_array(jsonb_build_object('id', 'qa-m1', 'status', 'complete', 'score1', 6, 'score2', 3, 'round', 1, 'group_name', 'A',
                                                          'player_ids', jsonb_build_array('qa-p1', 'qa-p2', 'qa-p3', 'qa-p4'))),
    'ranking_data', jsonb_build_array(
       jsonb_build_object('id', 'qa-p1', 'name', 'QA1', 'wins', 1, 'losses', 0, 'diff', 3), jsonb_build_object('id', 'qa-p2', 'name', 'QA2', 'wins', 1, 'losses', 0, 'diff', 3),
       jsonb_build_object('id', 'qa-p3', 'name', 'QA3', 'wins', 0, 'losses', 1, 'diff', -3), jsonb_build_object('id', 'qa-p4', 'name', 'QA4', 'wins', 0, 'losses', 1, 'diff', -3)),
    'settlement_data', jsonb_build_array(
       jsonb_build_object('player_id', 'qa-p1', 'player_name', 'QA1', 'is_guest', false, 'is_associate_guest_fee_member', false, 'rank', 1, 'wins', 1, 'losses', 0,
                          'points_for', 6, 'points_against', 3, 'diff', 3, 'penalty_level', null, 'penalty_amount', 0, 'guest_fee_amount', 0, 'prize_amount', 10000, 'final_amount', 10000),
       jsonb_build_object('player_id', 'qa-p2', 'player_name', 'QA2', 'is_guest', false, 'is_associate_guest_fee_member', false, 'rank', 2, 'wins', 1, 'losses', 0,
                          'points_for', 6, 'points_against', 3, 'diff', 3, 'penalty_level', null, 'penalty_amount', 0, 'guest_fee_amount', 0, 'prize_amount', 0, 'final_amount', 0),
       jsonb_build_object('player_id', 'qa-p3', 'player_name', 'QA3', 'is_guest', false, 'is_associate_guest_fee_member', false, 'rank', 3, 'wins', 0, 'losses', 1,
                          'points_for', 3, 'points_against', 6, 'diff', -3, 'penalty_level', 'L1', 'penalty_amount', -3000, 'guest_fee_amount', 0, 'prize_amount', 0, 'final_amount', -3000),
       jsonb_build_object('player_id', 'qa-p4', 'player_name', 'QA4', 'is_guest', false, 'is_associate_guest_fee_member', false, 'rank', 4, 'wins', 0, 'losses', 1,
                          'points_for', 3, 'points_against', 6, 'diff', -3, 'penalty_level', 'L2', 'penalty_amount', -5000, 'guest_fee_amount', 0, 'prize_amount', 0, 'final_amount', -5000)));
  v_next := jsonb_set(jsonb_set(jsonb_set(v_before,
              '{snapshot_data,0,score2}', '4'),
              '{ranking_data}', jsonb_build_array(
                 jsonb_build_object('id', 'qa-p1', 'name', 'QA1', 'wins', 1, 'losses', 0, 'diff', 2), jsonb_build_object('id', 'qa-p2', 'name', 'QA2', 'wins', 1, 'losses', 0, 'diff', 2),
                 jsonb_build_object('id', 'qa-p3', 'name', 'QA3', 'wins', 0, 'losses', 1, 'diff', -2), jsonb_build_object('id', 'qa-p4', 'name', 'QA4', 'wins', 0, 'losses', 1, 'diff', -2))),
              '{settlement_data}', (select jsonb_agg(case when (e->>'rank')::int <= 2
                                                          then e || jsonb_build_object('points_against', 4, 'diff', 2)
                                                          else e || jsonb_build_object('points_for', 4, 'diff', -2) end order by (e->>'rank')::int)
                                      from jsonb_array_elements(v_before->'settlement_data') e));

  -- ── A · B · L : 조회 유지 ────────────────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
    execute 'select count(*) from public.teyeon_archive_v1' into n; r := n::text;
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm; end;
  if r = v_base_total::text then pass := pass + 1; out := out || E'\nPASS A 비로그인 Archive 조회(' || r || '건)';
  else fail := fail + 1; out := out || E'\nFAIL A 비로그인 Archive 조회 (' || r || ')'; end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_member::text, true);
    execute 'set local role authenticated';
    execute 'select count(*) from public.teyeon_archive_v1' into n; r := n::text;
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm; end;
  if r = v_base_total::text then pass := pass + 1; out := out || E'\nPASS B 회원 Archive 조회(' || r || '건)';
  else fail := fail + 1; out := out || E'\nFAIL B 회원 Archive 조회 (' || r || ')'; end if;

  r := '';
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_member::text, true);
    execute 'set local role authenticated';
    if to_regclass('public.matches_archive') is not null then execute 'select count(*) from public.matches_archive'; end if;
    if to_regclass('public.sessions_archive') is not null then execute 'select count(*) from public.sessions_archive'; end if;
    if to_regclass('public.kdk_sessions') is not null then execute 'select count(*) from public.kdk_sessions'; end if;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
    if to_regclass('public.kdk_sessions') is not null then execute 'select count(*) from public.kdk_sessions'; end if;
    execute 'reset role';
    r := 'ok';
  exception when others then r := sqlstate || '|' || sqlerrm; end;
  if r = 'ok' then pass := pass + 1; out := out || E'\nPASS L 레거시 3개 조회 유지(회원 · 비로그인)';
  else fail := fail + 1; out := out || E'\nFAIL L 레거시 조회 (' || r || ')'; end if;

  -- ── H · K : 운영진 저장(KDK 공식 저장 upsert · Special insert) ───────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_ceo, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_ceo::text, true);
    execute 'set local role authenticated';
    execute format('insert into public.teyeon_archive_v1 (id, raw_data) values (%L, %L::jsonb) on conflict (id) do update set id = excluded.id, raw_data = excluded.raw_data', v_id, v_before::text);
    execute format('update public.teyeon_archive_v1 set archive_type = %L where id = %L', 'kdk', v_id);
    execute format('insert into public.teyeon_archive_v1 (id, raw_data) values (%L, %L::jsonb) on conflict (id) do update set id = excluded.id, raw_data = excluded.raw_data', v_id, v_before::text);
    execute format('insert into public.teyeon_archive_v1 (id, raw_data) values (%L, %L::jsonb)', v_sp, '{"title":"P1-b QA Special(rollback)"}');
    execute 'reset role';
    select count(*) into n from public.teyeon_archive_v1 where id = v_id; r := n::text;
  exception when others then r := sqlstate || '|' || sqlerrm; end;
  if r = '1' then pass := pass + 1; out := out || E'\nPASS H CEO 공식 저장 upsert(같은 id 2회 → 1행)';
  else fail := fail + 1; out := out || E'\nFAIL H CEO 공식 저장 upsert (' || r || ')'; end if;
  if exists (select 1 from public.teyeon_archive_v1 where id = v_sp) then pass := pass + 1; out := out || E'\nPASS K Special 저장(CEO insert)';
  else fail := fail + 1; out := out || E'\nFAIL K Special 저장'; end if;

  -- ── C · D · E · G : 회원·게스트 직접 쓰기 차단 ───────────────────────────
  declare
    s text; who uuid; lbl text;
  begin
    for who, lbl in select * from (values (v_member, 'MEMBER'), (v_guest, 'GUEST')) x(w, l) loop
      for s in select unnest(array[
          format('insert into public.teyeon_archive_v1 (id, raw_data) values (%L, %L::jsonb)', v_id || '-X', '{}'),
          format('update public.teyeon_archive_v1 set is_official = true where id = %L', v_id),
          format('update public.teyeon_archive_v1 set raw_data = %L::jsonb where id = %L', '{"title":"tamper"}', v_id),
          format('delete from public.teyeon_archive_v1 where id = %L', v_id),
          format('insert into public.teyeon_archive_v1 (id, raw_data) values (%L, %L::jsonb) on conflict (id) do update set raw_data = excluded.raw_data', v_id, '{"title":"tamper"}')]) loop
        begin
          perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', who::text, true);
          execute 'set local role authenticated';
          execute s; get diagnostics n = row_count; r := n || '행';
          execute 'reset role';
        exception when others then r := sqlstate || '|' || sqlerrm; end;
        if r like '42501|archive:%' then pass := pass + 1;
        else fail := fail + 1; out := out || E'\nFAIL ' || lbl || ' 쓰기 차단: ' || left(s, 60) || ' → ' || r; end if;
      end loop;
    end loop;
  end;
  out := out || E'\nPASS C·D·E·G 회원·게스트 INSERT/UPDATE(is_official·raw_data)/DELETE/UPSERT 10건 → 실패 줄이 없으면 모두 42501(archive:)';
  if (select raw_data->>'title' from public.teyeon_archive_v1 where id = v_id) = 'P1-b QA(rollback)' then pass := pass + 1; out := out || E'\nPASS C~G 후 QA 행 내용 그대로';
  else fail := fail + 1; out := out || E'\nFAIL C~G 후 QA 행이 바뀜'; end if;

  -- ── F : TRUNCATE(실행하지 않고 권한·trigger 로 확인) ─────────────────────
  if not has_table_privilege('authenticated', 'public.teyeon_archive_v1', 'TRUNCATE')
     and exists (select 1 from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname = 'p1b_archive_block_truncate_trg' and tgenabled <> 'D') then
    pass := pass + 1; out := out || E'\nPASS F TRUNCATE: authenticated 권한 없음 + 차단 trigger';
  else fail := fail + 1; out := out || E'\nFAIL F TRUNCATE 보호 없음'; end if;

  -- ── J : 정정 RPC(SECURITY DEFINER) — 운영진 성공 · 회원 거부 ──────────────
  if to_regprocedure('public.correct_kdk_archive_match_score(text,text,integer,integer,text,text,jsonb,jsonb)') is null then
    out := out || E'\nSKIP J 정정 RPC 없음';
  else
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_member::text, true);
      execute 'set local role authenticated';
      execute 'select public.correct_kdk_archive_match_score($1, $2, $3, $4, $5, $6, $7, $8)' into v_res
        using v_id, 'qa-m1', 6, 4, 'P1-b QA 정정 시험', (select md5(raw_data::text) from public.teyeon_archive_v1 where id = v_id), v_next, '{}'::jsonb;
      execute 'reset role';
      r := coalesce(v_res->>'reason', v_res::text);
    exception when others then r := sqlstate || '|' || sqlerrm; end;
    if r = 'forbidden' or r like '42501|%' then pass := pass + 1; out := out || E'\nPASS J1 회원 정정 RPC 거부(' || left(r, 30) || ')';
    else fail := fail + 1; out := out || E'\nFAIL J1 회원 정정 RPC (' || r || ')'; end if;
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true);
      execute 'set local role authenticated';
      execute 'select public.correct_kdk_archive_match_score($1, $2, $3, $4, $5, $6, $7, $8)' into v_res
        using v_id, 'qa-m1', 6, 4, 'P1-b QA 정정 시험', (select md5(raw_data::text) from public.teyeon_archive_v1 where id = v_id), v_next, '{}'::jsonb;
      execute 'reset role';
      r := coalesce(v_res->>'ok', '') || ' ' || coalesce(v_res->>'reason', '');
    exception when others then r := sqlstate || '|' || sqlerrm; end;
    if btrim(r) = 'true' and (select raw_data #>> '{snapshot_data,0,score2}' from public.teyeon_archive_v1 where id = v_id) = '4' then
      pass := pass + 1; out := out || E'\nPASS J2 운영진 정정 RPC 성공(6:3 → 6:4 · DEFINER 경로도 trigger 통과)';
    else fail := fail + 1; out := out || E'\nFAIL J2 운영진 정정 RPC (' || r || ')'; end if;
  end if;

  -- ── I : ADMIN 공식 확정 · 해제 · 삭제 ────────────────────────────────────
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', v_admin::text, true);
    execute 'set local role authenticated';
    execute format('update public.teyeon_archive_v1 set is_official = true, is_test = false, confirmed_at = now(), confirmed_by = %L where id = %L', 'p1b-qa', v_id);
    execute format('update public.teyeon_archive_v1 set is_official = false, confirmed_at = null, confirmed_by = null where id = %L', v_id);
    execute format('delete from public.teyeon_archive_v1 where id in (%L, %L)', v_id, v_sp); get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm; end;
  if r = '2행' then pass := pass + 1; out := out || E'\nPASS I 운영진 공식 확정 · 해제 · 삭제';
  else fail := fail + 1; out := out || E'\nFAIL I 운영진 확정·해제·삭제 (' || r || ')'; end if;

  -- ── M : 레거시 직접 쓰기 차단(회원 · 운영진 모두 — 앱 쓰기 경로 없음) ─────
  declare s text; who uuid; bad int := 0; tried int := 0;
  begin
    for who in select unnest(array[v_member, v_ceo]) loop
      for s in select q from (values
          ('matches_archive',  'insert into public.matches_archive default values'),
          ('matches_archive',  'delete from public.matches_archive where false'),
          ('sessions_archive', 'insert into public.sessions_archive default values'),
          ('sessions_archive', 'update public.sessions_archive set id = id where false'),
          ('kdk_sessions',     'insert into public.kdk_sessions default values'),
          ('kdk_sessions',     'delete from public.kdk_sessions where false')) x(t, q)
         where to_regclass('public.' || x.t) is not null loop
        tried := tried + 1;
        begin
          perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', who::text, true);
          execute 'set local role authenticated';
          execute s; r := 'allowed';
          execute 'reset role';
        exception when others then r := sqlstate; end;
        if r <> '42501' then bad := bad + 1; out := out || E'\nFAIL M 레거시 쓰기 허용됨: ' || s || ' → ' || r; end if;
      end loop;
    end loop;
    if bad = 0 then pass := pass + 1; out := out || E'\nPASS M 레거시 직접 쓰기 차단(' || tried || '건 · 회원·운영진 모두 42501)'; else fail := fail + 1; end if;
  end;

  -- ── P : 다른 보안 정책 유지 ──────────────────────────────────────────────
  if not has_table_privilege('anon', 'public.teyeon_archive_v1', 'INSERT') and not has_table_privilege('anon', 'public.teyeon_archive_v1', 'UPDATE')
     and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D')
     and (select count(*) from pg_trigger where tgrelid = to_regclass('public.matches') and tgname like 'kdk_p1_%' and tgenabled <> 'D') = 3 then
    pass := pass + 1; out := out || E'\nPASS P P0-A(anon 쓰기 없음) · P0-C · P1 유지';
  else fail := fail + 1; out := out || E'\nFAIL P 다른 보안 정책 상태 확인 필요'; end if;

  -- ── Q : 기존 행 무변경(QA 행 제외 해시) ──────────────────────────────────
  select md5(string_agg(md5(t::text), '|' order by id)) into v_after_hash from public.teyeon_archive_v1 t where id not like 'QA-P1B-%';
  if v_after_hash is not distinct from v_base_hash then pass := pass + 1; out := out || E'\nPASS Q 기존 Archive ' || v_base_total || '행 해시 동일';
  else fail := fail + 1; out := out || E'\nFAIL Q 기존 Archive 행이 바뀜'; end if;

  raise exception using errcode = 'P0001',
    message = format('P1-b QA 결과: PASS %s · FAIL %s — 의도적 ROLLBACK(운영 DB 변경 없음)%s%s', pass, fail, out,
                     E'\nINFO 기존 Archive ' || v_base_total || '행 · 해시 ' || left(v_base_hash, 12) || ' (26 의 C 행 · QA 잔여물 0 으로 재확인)');
end
$qa$;
