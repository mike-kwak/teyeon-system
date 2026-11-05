-- =============================================================================
-- ISS-005 · 38 rollback — anon SELECT 를 적용 전 그대로 되돌린다   [승인 후에만 실행]
--   security_backup.archive_anon_read_p2 의 미복원 회차만 다시 GRANT. 데이터 · 다른 권한 무변경. 재실행 안전.
-- =============================================================================
do $iss005_rb$
declare
  r record;
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regclass('security_backup.archive_anon_read_p2') is null then
    raise notice 'ISS-005 rollback: 백업 없음 — 변경 없음';
    return;
  end if;
  for r in select ctid, table_name, column_name from security_backup.archive_anon_read_p2 where restored_at is null loop
    if to_regclass('public.' || r.table_name) is not null then
      if r.column_name is null then
        execute format('grant select on public.%I to anon', r.table_name);
      else
        execute format('grant select (%I) on public.%I to anon', r.column_name, r.table_name);
      end if;
    end if;
    update security_backup.archive_anon_read_p2 set restored_at = now() where ctid = r.ctid;
  end loop;
end
$iss005_rb$;

notify pgrst, 'reload schema';

select 'ISS-005 rollback' as step,
       has_table_privilege('anon', 'public.teyeon_archive_v1', 'SELECT') as anon_archive_read;   -- 적용 전과 같음(운영: true)
