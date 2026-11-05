-- =============================================================================
-- ROLLBACK — SECURITY P0-A. 적용 직전 저장한 anon 테이블 권한(security_backup.table_grants_p0a)을 그대로 되돌린다.
--   아직 되돌리지 않은 가장 최근 적용 회차(restored_at is null 중 최신 captured_at)만 복원하고, 그 회차에 restored_at 을 남긴다.
--   → 다른 단계(P1 등)가 그 뒤에 바꾼 권한을 오래된 상태로 덮어쓰지 않는다.
-- =============================================================================
begin;
set local lock_timeout = '3s';
do $$
declare r record; v_first timestamptz;
begin
  if to_regclass('security_backup.table_grants_p0a') is null then
    raise exception 'STOP: 백업 테이블 없음 — P0-A 가 적용되지 않았거나 백업이 삭제됨';
  end if;
  alter table security_backup.table_grants_p0a add column if not exists restored_at timestamptz;
  select max(captured_at) into v_first from security_backup.table_grants_p0a where restored_at is null;
  if v_first is null then raise exception 'STOP: 되돌릴 P0-A 적용 회차 없음(이미 rollback 됨)'; end if;
  for r in select distinct table_name from security_backup.table_grants_p0a where captured_at = v_first loop
    -- P0-A 가 바꾼 범위만 원상복구: app_logs 의 SELECT 포함, 쓰기 권한 전부.
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', r.table_name);
  end loop;
  for r in select table_name, privilege from security_backup.table_grants_p0a where captured_at = v_first loop
    execute format('grant %s on public.%I to anon', r.privilege, r.table_name);
  end loop;
  update security_backup.table_grants_p0a set restored_at = now() where captured_at = v_first;
end $$;
commit;
select table_name, string_agg(privilege, ',' order by privilege) as restored_anon
  from security_backup.table_grants_p0a
 where captured_at = (select max(captured_at) from security_backup.table_grants_p0a where restored_at is not null)
 group by table_name order by table_name;
