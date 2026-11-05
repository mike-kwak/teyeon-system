-- =============================================================================
-- ROLLBACK — SECURITY P0-B (1단계). 아직 되돌리지 않은 가장 최근 적용 회차의 상태로 실행 권한·search_path 복원.
-- =============================================================================
begin;
set local lock_timeout = '3s';
do $$
declare r record; v_first timestamptz;
begin
  if to_regclass('security_backup.function_acl_p0b') is null then
    raise exception 'STOP: 백업 테이블 없음';
  end if;
  alter table security_backup.function_acl_p0b add column if not exists restored_at timestamptz;
  select max(captured_at) into v_first from security_backup.function_acl_p0b where restored_at is null;
  if v_first is null then
    raise notice 'P0-B rollback: 되돌릴 적용 회차 없음(대상 함수가 없어 P0-B 가 바꾼 것이 없거나 이미 rollback 됨) — 변경 없음';
    return;
  end if;
  for r in select * from security_backup.function_acl_p0b where captured_at = v_first loop
    if to_regprocedure(r.signature) is null then continue; end if;
    -- P1(KDK 점수 권한)이 설치돼 있으면 update_match_status 는 P1 이 별도로 잠근 상태 — P0-B rollback 이 다시 열지 않는다.
    if r.signature like 'public.update_match_status%'
       and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.matches') and tgname = 'kdk_p1_score_guard_trg') then
      raise notice 'P0-B rollback: P1 설치 중 — % 실행 권한은 P1 상태 유지', r.signature;
      continue;
    end if;
    -- 기존 ACL 이 null(기본값 = PUBLIC 실행) 이거나 PUBLIC(=X) 항목이 있었으면 PUBLIC 복원,
    -- anon=X 항목이 있었으면 anon 복원. (authenticated · service_role 부여는 P0-B 이전에도 있던 것과 같으므로 유지)
    if r.proacl is null or r.proacl ~ '(^|[{,])=X' then
      execute format('grant execute on function %s to public', r.signature);
    end if;
    if r.proacl ~ '(^|[{,])anon=X' then
      execute format('grant execute on function %s to anon', r.signature);
    end if;
    if r.proconfig is null or r.proconfig not like '%search_path%' then
      execute format('alter function %s reset search_path', r.signature);
    end if;
  end loop;
  update security_backup.function_acl_p0b set restored_at = now() where captured_at = v_first;
end $$;
commit;
select signature, has_function_privilege('anon', signature, 'execute') as anon_exec
  from security_backup.function_acl_p0b
 where captured_at = (select max(captured_at) from security_backup.function_acl_p0b where restored_at is not null)
   and to_regprocedure(signature) is not null;
