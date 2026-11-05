-- =============================================================================
-- P1 운영 QA — 실제 회원 계정 없이 DB 권한 판정 검증 · 항상 전체 ROLLBACK   [승인 전 운영 실행 금지]
--
--   안전 장치
--     · 문장 1개(DO 블록) — SQL Editor 가 문장을 세션별로 나눠 실행해도 중간 커밋이 생길 수 없다.
--     · 마지막에 결과를 담은 예외를 "일부러" 발생 → DO 블록 전체가 취소된다(테스트 경기·원장·이력 모두 사라짐).
--       ※ 화면에 빨간 ERROR 로 보이는 것이 정상이다. 메시지 안의 PASS/FAIL 이 결과다.
--     · 테스트 경기는 전용 club/session(QA-P1-ROLLBACK-*) · 새 UUID id → 진행 중 실제 경기와 겹치지 않는다.
--     · 실제 회원·운영진의 profiles/members/auth 는 읽기만 한다(운영진 id 는 역할 판정용으로 claims 에만 사용).
--     · 공식 KDK 세션 · Archive · Finance 는 조회도 수정도 하지 않는다.
--   롤백되지 않는 것(무해): kdk_match_results / kdk_match_score_history 의 id 시퀀스 번호가 몇 칸 건너뛴다.
--   Realtime: 커밋되지 않은 변경은 발행되지 않는다(전광판·KDK 화면에 이벤트 없음).
--
--   방법: PostgREST 와 같은 방식으로 요청 컨텍스트를 흉내 낸다 —
--     set_config('request.jwt.claims' / 'request.jwt.claim.sub') + SET LOCAL ROLE authenticated|anon.
--   일반 회원 = profiles 에 없는 임의 UUID(P1 판정상 GUEST = 비운영진, MEMBER 와 같은 경로).
--   운영진   = profiles 의 CEO(없으면 ADMIN) 1명 — 읽기만 함.
-- =============================================================================
do $qa$
declare
  v_club   constant text := 'QA-P1-ROLLBACK-CLUB';
  v_sess   text := 'QA-P1-ROLLBACK-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v_m1     text := gen_random_uuid()::text;   -- 최초 입력 · 재수정 · 운영진 정정
  v_m2     text := gen_random_uuid()::text;   -- anon 차단
  v_member uuid := gen_random_uuid();          -- 비운영진 로그인 사용자(프로필 없음 → GUEST)
  v_member2 uuid := gen_random_uuid();         -- 다른 비운영진
  v_admin  uuid;
  v_admin_role text;
  out      text := '';
  pass     int := 0;
  fail     int := 0;
  r        text;
  n        bigint;
  v_led0 bigint; v_hist0 bigint;
begin
  -- 0) 전제 확인(실패하면 아무것도 하지 않고 예외로 종료)
  if not exists (select 1 from pg_trigger where tgrelid = 'public.matches'::regclass and tgname = 'kdk_p1_score_guard_trg' and tgenabled <> 'D') then
    raise exception 'P1 QA 중단: kdk_p1_score_guard_trg 없음(P1 미적용) — 변경 없음';
  end if;
  -- 실행 계정이 authenticated / anon 으로 전환 가능한지 먼저 확인(불가하면 이후 42501 이 "권한 차단"인지 "전환 실패"인지
  --   구분할 수 없으므로 시험을 하지 않는다 — 거짓 PASS 방지).
  begin
    execute 'set local role authenticated';
    if current_user <> 'authenticated' then raise exception 'role 전환 실패'; end if;
    execute 'reset role';
    execute 'set local role anon';
    if current_user <> 'anon' then raise exception 'role 전환 실패'; end if;
    execute 'reset role';
  exception when others then
    raise exception 'P1 QA 중단: 실행 계정(%)이 authenticated/anon 으로 전환할 수 없음(%) — 이 방식으로는 시험 불가 · 변경 없음', session_user, sqlerrm;
  end;
  select p.id, upper(btrim(p.role::text)) into v_admin, v_admin_role
    from public.profiles p where upper(btrim(p.role::text)) in ('CEO', 'ADMIN')
   order by case upper(btrim(p.role::text)) when 'CEO' then 0 else 1 end limit 1;
  select count(*) into v_led0 from public.kdk_match_results;
  select count(*) into v_hist0 from public.kdk_match_score_history;

  -- 1) 테스트 경기 2개(관리자 컨텍스트 = postgres → P1 guard 통과). status=playing · 생성 기본값 1:1
  execute format($f$insert into public.matches (id, club_id, session_id, session_title, round, court, player_ids, player_names, score1, score2, status, mode, group_name)
                    values (%L, %L, %L, 'P1 QA(rollback)', 1, 98, array['qa-a','qa-b','qa-c','qa-d'], array['QA A','QA B','QA C','QA D'], 1, 1, 'playing', 'KDK', 'A'),
                           (%L, %L, %L, 'P1 QA(rollback)', 1, 99, array['qa-e','qa-f','qa-g','qa-h'], array['QA E','QA F','QA G','QA H'], 1, 1, 'playing', 'KDK', 'A')$f$,
                 v_m1, v_club, v_sess, v_m2, v_club, v_sess);

  -- 요청 흉내: claims · role 을 바꿔 실행하고 결과(행 수 또는 SQLSTATE)를 돌려준다. 실패 시 서브트랜잭션이 role·claims 도 되돌린다.
  -- (DO 블록 안에서는 함수 선언이 어려워 각 시나리오를 같은 패턴으로 반복한다)

  -- A) 비운영진 최초 입력(1:1 → 6:2 · finishMatch 와 같은 UPDATE) → 1행
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member::text, true);
    execute 'set local role authenticated';
    execute format('update public.matches set status = %L, score1 = 6, score2 = 2 where id = %L and status = %L', 'complete', v_m1, 'playing');
    get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || ' ' || sqlerrm;
  end;
  if r = '1행' then pass := pass + 1; out := out || E'\nPASS A 일반 회원 최초 입력 허용 (' || r || ')';
  else fail := fail + 1; out := out || E'\nFAIL A 일반 회원 최초 입력 허용 (' || r || ')'; end if;

  -- 원장 기록 확인(관리자 컨텍스트에서 읽기)
  if exists (select 1 from public.kdk_match_results where match_id = v_m1 and closed_at is null and source = 'first_entry') then
    pass := pass + 1; out := out || E'\nPASS A2 원장 first_entry 기록';
  else fail := fail + 1; out := out || E'\nFAIL A2 원장 first_entry 기록 없음'; end if;

  -- B) 같은 회원 재수정(complete → complete) → 42501
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member::text, true);
    execute 'set local role authenticated';
    execute format('update public.matches set status = %L, score1 = 0, score2 = 6 where id = %L and status = %L', 'complete', v_m1, 'complete');
    get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm;
  end;
  if r like '42501|kdk:%' then pass := pass + 1; out := out || E'\nPASS B 같은 회원 재수정 차단 (42501 · P1 guard)';
  else fail := fail + 1; out := out || E'\nFAIL B 같은 회원 재수정 차단 (' || r || ')'; end if;

  -- C) 다른 회원 수정 → 42501
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member2, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member2::text, true);
    execute 'set local role authenticated';
    execute format('update public.matches set score1 = 0 where id = %L', v_m1);
    get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm;
  end;
  if r like '42501|kdk:%' then pass := pass + 1; out := out || E'\nPASS C 다른 회원 수정 차단 (42501 · P1 guard)';
  else fail := fail + 1; out := out || E'\nFAIL C 다른 회원 수정 차단 (' || r || ')'; end if;

  -- E) 회원 초기화(완료 → 대기) · 삭제 → 42501
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member::text, true);
    execute 'set local role authenticated';
    execute format('update public.matches set status = %L, score1 = 1, score2 = 1 where id = %L', 'waiting', v_m1);
    get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm;
  end;
  if r like '42501|kdk:%' then pass := pass + 1; out := out || E'\nPASS E1 회원 초기화 차단 (42501 · P1 guard)';
  else fail := fail + 1; out := out || E'\nFAIL E1 회원 초기화 차단 (' || r || ')'; end if;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member::text, true);
    execute 'set local role authenticated';
    execute format('delete from public.matches where id = %L', v_m1);
    get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm;
  end;
  if r like '42501|kdk:%' then pass := pass + 1; out := out || E'\nPASS E2 회원 삭제 차단 (42501 · P1 guard)';
  else fail := fail + 1; out := out || E'\nFAIL E2 회원 삭제 차단 (' || r || ')'; end if;

  -- F) anon 최초 입력(경기 2) → 42501 (P0-A 권한 또는 P1 guard)
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
    execute format('update public.matches set status = %L, score1 = 6, score2 = 0 where id = %L and status = %L', 'complete', v_m2, 'playing');
    get diagnostics n = row_count; r := n || '행';
    execute 'reset role';
  exception when others then r := sqlstate || '|' || sqlerrm;
  end;
  -- anon 은 P0-A(테이블 권한) 또는 P1 guard 어느 쪽이든 42501 이면 차단. role 전환 실패는 전제 확인에서 이미 걸러짐.
  if r like '42501|%' then pass := pass + 1; out := out || E'\nPASS F 비로그인(anon) 입력 차단 (' || r || ')';
  else fail := fail + 1; out := out || E'\nFAIL F 비로그인(anon) 입력 차단 (' || r || ')'; end if;

  -- D) 운영진 정정(complete → complete) → 1행
  if v_admin is null then
    out := out || E'\nSKIP D 운영진 정정 — profiles 에 CEO/ADMIN 없음';
  else
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', v_admin::text, true);
      execute 'set local role authenticated';
      execute format('update public.matches set status = %L, score1 = 6, score2 = 3 where id = %L and status = %L', 'complete', v_m1, 'complete');
      get diagnostics n = row_count; r := n || '행';
      execute 'reset role';
    exception when others then r := sqlstate || ' ' || sqlerrm;
    end;
    if r = '1행' then pass := pass + 1; out := out || E'\nPASS D 운영진(' || v_admin_role || ') 정정 허용 (1행)';
    else fail := fail + 1; out := out || E'\nFAIL D 운영진(' || v_admin_role || ') 정정 허용 (' || r || ')'; end if;
  end if;

  -- 이력 확인
  select string_agg(kind || ':' || coalesce(actor_role, '?'), ',' order by id) into r
    from public.kdk_match_score_history where match_id = v_m1;
  out := out || E'\nINFO 이력 ' || coalesce(r, '(없음)');

  -- 최종 상태 확인(관리자 컨텍스트)
  select score1 || ':' || score2 || ' ' || status into r from public.matches where id::text = v_m1;   -- 운영 matches.id = uuid
  out := out || E'\nINFO 테스트 경기 최종 ' || coalesce(r, '?') || ' (운영진 정정 6:3 이어야 함)';

  -- 결과를 예외로 내보내며 전체 취소(테스트 경기 · 원장 · 이력 모두 사라짐)
  raise exception using
    errcode = 'P0001',
    message = format('P1 QA 결과: PASS %s · FAIL %s — 의도적 ROLLBACK(운영 DB 변경 없음)%s%s',
                     pass, fail, out,
                     E'\nINFO 실행 전 원장 ' || v_led0 || '행 · 이력 ' || v_hist0 || '행(이후 23_p1_qa_leftover_check 로 같은지 확인)');
end
$qa$;
