-- =============================================================================
-- ROLLBACK — SECURITY P1-b (공식 Archive 쓰기 보호). 문장 1개(DO 블록).
--   P1-b trigger·함수 제거 + authenticated 권한을 "아직 되돌리지 않은 가장 최근 회차" 백업대로 복원.
--   anon 권한은 건드리지 않는다(P0-A 가 회수한 anon 쓰기를 다시 열지 않음). 데이터·SELECT·P0/P1 무변경.
--   백업 회차가 없으면 trigger·함수만 제거(권한은 그대로).
-- =============================================================================
do $p1brb$
declare
  v_batch timestamptz;
  r record;
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regclass('public.teyeon_archive_v1') is not null then
    drop trigger if exists p1b_archive_guard_trg on public.teyeon_archive_v1;
    drop trigger if exists p1b_archive_block_truncate_trg on public.teyeon_archive_v1;
  end if;
  drop function if exists public.p1b_archive_guard();
  drop function if exists public.p1b_archive_block_truncate();

  if to_regclass('security_backup.p1b_state') is null then
    raise notice 'P1-b rollback: 백업 테이블 없음 — trigger·함수만 제거';
    return;
  end if;
  select max(captured_at) into v_batch from security_backup.p1b_state where restored_at is null;
  if v_batch is null then
    raise notice 'P1-b rollback: 되돌릴 회차 없음 — trigger·함수만 제거';
    return;
  end if;
  for r in select * from security_backup.p1b_state where captured_at = v_batch loop
    continue when r.grantee <> 'authenticated';          -- 방어: authenticated 외 역할은 복원하지 않는다
    continue when to_regclass('public.' || r.table_name) is null;
    continue when r.privilege not in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
    execute format('grant %s on public.%I to authenticated', r.privilege, r.table_name);
  end loop;
  update security_backup.p1b_state set restored_at = now() where captured_at = v_batch;
end
$p1brb$;

select (select count(*) from pg_trigger where tgrelid = to_regclass('public.teyeon_archive_v1') and tgname like 'p1b_%') = 0 as p1b_triggers_removed,
       has_table_privilege('authenticated', 'public.teyeon_archive_v1', 'TRUNCATE') as auth_archive_truncate_restored,
       has_table_privilege('anon', 'public.teyeon_archive_v1', 'INSERT')             as anon_archive_insert;   -- false 유지(P0-A)
