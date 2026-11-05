-- =============================================================================
-- KDK 36 — 김영호 부회장 KDK 관리자 등록(1명)   [초안 · 승인 전 운영 실행 금지]
--   rollback: 36_kdk_manager_register_rollback.sql   확인: 35_kdk_manager_target_READONLY.sql · 37_kdk_manager_verify_READONLY.sql
--
--   실행 전: 35 를 실행해 T05 = READY 인지 확인하고, 거기 나온 "계정 지문"(12자리)을 아래 v_expected_fp 에 넣는다.
--            지문을 넣지 않거나 다르면 STOP — 이름만으로는 등록되지 않는다(UID 일치 검증).
--   하는 일: kdk_managers 에 그 계정 1행 INSERT. 그 외 아무것도 바꾸지 않는다.
--   바꾸지 않는 것: profiles.role · members.role · CEO/ADMIN 권한 · 다른 계정 · 경기/Archive 데이터.
--   검사(하나라도 어긋나면 STOP · 전체 취소):
--     members 에서 공백 무시 닉네임 '김영호' + 직책에 '부회장' + 탈회 아님 + 계정 연결 → 정확히 1명
--     연결 UID 가 auth.users 에 존재(삭제 아님) · profiles 1행 · 앱 권한 MEMBER · 그 계정에 연결된 members 1행
--     계정 지문 = v_expected_fp
--     등록 후: 대상만 can_manage_kdk() = true · kdk_can_operate_court() = true · 앱 권한 분포 변화 없음 · 등록 수 정확히 +1
--   문장 1개(DO 블록). 이미 등록돼 있으면 아무것도 하지 않는다(재실행 안전).
-- =============================================================================
do $kdk36$
declare
  v_expected_fp constant text := '____REPLACE_WITH_T05_FINGERPRINT____';   -- ← 35 의 T05 에 나온 12자리
  v_uid    uuid;
  v_n      int;
  v_before int;
  v_roles0 text;
  v_roles1 text;
  v_mgr    boolean;
  v_court  boolean;
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regclass('public.kdk_managers') is null or to_regprocedure('public.can_manage_kdk()') is null then
    raise exception 'STOP KDK36: SQL 30 미적용(kdk_managers · can_manage_kdk 없음) — 변경 없음';
  end if;
  if v_expected_fp !~ '^[0-9a-f]{12}$' then
    raise exception 'STOP KDK36: v_expected_fp 에 35 의 T05 계정 지문(12자리)을 넣지 않음 — 변경 없음';
  end if;

  select count(*), min(m.auth_user_id::text)::uuid into v_n, v_uid
    from public.members m
   where replace(coalesce(m.nickname, ''), ' ', '') = '김영호'
     and exists (select 1 from unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v) where btrim(r.v) = '부회장')
     and not exists (select 1 from unnest(string_to_array(coalesce(m.role::text, ''), ',')) r(v) where btrim(r.v) = '탈회')
     and m.auth_user_id is not null;
  if v_n <> 1 then
    raise exception 'STOP KDK36: 조건(김영호 · 부회장 · 탈회 아님 · 계정 연결)을 만족하는 회원이 % 명 — 정확히 1명이어야 함, 변경 없음', v_n;
  end if;
  if left(md5(v_uid::text), 12) <> v_expected_fp then
    raise exception 'STOP KDK36: 계정 지문 불일치 — 35 를 다시 실행해 확인, 변경 없음';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and (to_jsonb(u) ->> 'deleted_at') is null) then
    raise exception 'STOP KDK36: 연결 UID 가 auth 계정에 없거나 삭제됨 — 변경 없음';
  end if;
  if (select count(*) from public.profiles p where p.id::text = v_uid::text) <> 1
     or (select upper(btrim(coalesce(p.role::text, ''))) from public.profiles p where p.id::text = v_uid::text) <> 'MEMBER' then
    raise exception 'STOP KDK36: 대상 프로필이 없거나 앱 권한이 MEMBER 가 아님 — 변경 없음(권한은 바꾸지 않는다)';
  end if;
  if (select count(*) from public.members x where x.auth_user_id::text = v_uid::text) <> 1 then
    raise exception 'STOP KDK36: 같은 계정에 연결된 members 행이 여러 개 — 변경 없음';
  end if;
  if exists (select 1 from public.kdk_managers k where k.user_id = v_uid) then
    raise notice 'KDK36: 이미 KDK 관리자로 등록됨 — 변경 없음';
    return;
  end if;

  select count(*) into v_before from public.kdk_managers;
  select string_agg(r || '=' || n, ',' order by r) into v_roles0
    from (select upper(btrim(coalesce(role::text, ''))) r, count(*) n from public.profiles group by 1) t;

  insert into public.kdk_managers (user_id, note, granted_by)
  values (v_uid, '김영호 부회장 — KDK 전용 관리자(대진·설정·정정·당일 공식 저장)', 'sql-editor');

  -- 등록 직후 확인(같은 트랜잭션 · 이 블록 안에서만 대상 계정으로 판정 → 끝나면 원래대로)
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  v_mgr := public.can_manage_kdk();
  v_court := public.kdk_can_operate_court();
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select string_agg(r || '=' || n, ',' order by r) into v_roles1
    from (select upper(btrim(coalesce(role::text, ''))) r, count(*) n from public.profiles group by 1) t;
  if not v_mgr or not v_court then
    raise exception 'STOP KDK36: 등록 후 판정 실패(관리=% · 코트=%) — 전체 취소', v_mgr, v_court;
  end if;
  if (select count(*) from public.kdk_managers) <> v_before + 1 then
    raise exception 'STOP KDK36: 등록 수가 1 늘지 않음 — 전체 취소';
  end if;
  if v_roles1 is distinct from v_roles0 then
    raise exception 'STOP KDK36: 앱 권한 분포가 바뀜 — 전체 취소';
  end if;
  raise notice 'KDK36: 등록 완료(계정 지문 %)', v_expected_fp;
end
$kdk36$;

select 'KDK36' as step,
       (select count(*) from public.kdk_managers) as managers,                                        -- 1
       (select string_agg(left(md5(user_id::text), 12), ',') from public.kdk_managers) as manager_fp; -- 35 의 지문과 같아야 함
