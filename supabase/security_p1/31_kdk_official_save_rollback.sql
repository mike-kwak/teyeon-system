-- =============================================================================
-- KDK 31 rollback — 31_kdk_official_save.sql 되돌리기   [승인 후에만 실행]
--   · p1b_archive_guard → 백업한 25 원본 정의 그대로 복원(KDK 관리자 분기 제거 = P1-b 원래대로 CEO·ADMIN 만).
--   · save_kdk_official_archive 삭제.
--   · 감사 기록 kdk_official_saves 는 남긴다(기록 보존). Archive 행 · 경기 데이터는 건드리지 않는다.
--   · 문장 1개(DO 블록) · 재실행 안전.
-- =============================================================================
do $kdkm31_rb$
declare
  r record;
  v_n int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  drop function if exists public.save_kdk_official_archive(text, text, jsonb);
  if to_regclass('security_backup.kdk_mgr_fn_backup') is not null then
    for r in select ctid, sig, def from security_backup.kdk_mgr_fn_backup
              where step = 'KDK31' and restored_at is null order by captured_at loop
      if to_regprocedure(r.sig) is not null then
        execute r.def;
        v_n := v_n + 1;
      end if;
      update security_backup.kdk_mgr_fn_backup set restored_at = now() where ctid = r.ctid;
    end loop;
  end if;
  if exists (select 1 from pg_proc where oid = to_regprocedure('public.p1b_archive_guard()') and prosrc like '%[KDKM]%') then
    raise exception 'STOP KDK31 rollback: p1b_archive_guard 원본 백업이 없어 복원하지 못함 — 전체 취소(수동 확인 필요)';
  end if;
  raise notice 'KDK31 rollback: 원본 함수 % 개 복원', v_n;
end
$kdkm31_rb$;

notify pgrst, 'reload schema';

select 'KDK31 rollback' as step,
       to_regprocedure('public.save_kdk_official_archive(text,text,jsonb)') is null as rpc_removed,                                       -- true
       coalesce((select prosrc not like '%[KDKM]%' from pg_proc where oid = to_regprocedure('public.p1b_archive_guard()')), true) as guard_original,  -- true
       (select count(*) from pg_trigger where tgrelid = 'public.teyeon_archive_v1'::regclass and tgname like 'p1b_%' and tgenabled <> 'D') as p1b_triggers;  -- 2(P1-b 유지)
