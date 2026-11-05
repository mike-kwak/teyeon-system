-- =============================================================================
-- KDK 30 rollback — 30_kdk_managers_court_ops.sql 되돌리기   [승인 후에만 실행]
--   · 31(공식 저장)이 적용돼 있으면 먼저 31_kdk_official_save_rollback.sql 을 실행해야 한다(STOP 으로 안내).
--   · start_kdk_match · start_kdk_match_timer · kdk_p1_score_guard · kdk_p1_can_generate → 백업해 둔 원본 정의 그대로 복원.
--   · can_manage_kdk · kdk_can_operate_court · kdk_actor_withdrawn 삭제.
--   · kdk_managers 표는 기본적으로 남긴다(등록 기록 보존 · 아무 함수도 참조하지 않으면 권한 효과 없음).
--     완전히 지우려면 맨 아래 주석의 drop table 을 별도로 실행.
--   · 문장 1개(DO 블록). 되돌릴 회차가 없으면 아무것도 바꾸지 않는다(재실행 안전).
-- =============================================================================
do $kdkm_rb$
declare
  r record;
  p record;
  v_n int := 0;
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regprocedure('public.save_kdk_official_archive(text,text,jsonb)') is not null then
    raise exception 'STOP KDK30 rollback: 31(공식 저장)이 적용돼 있음 — 먼저 31_kdk_official_save_rollback.sql 실행';
  end if;
  if to_regclass('security_backup.kdk_mgr_fn_backup') is not null then
    for r in select ctid, sig, def from security_backup.kdk_mgr_fn_backup
              where step = 'KDK30' and restored_at is null order by captured_at, sig loop
      if to_regprocedure(r.sig) is not null then
        execute r.def;                                   -- 원본 정의(CREATE OR REPLACE · ACL 유지)
        v_n := v_n + 1;
      end if;
      update security_backup.kdk_mgr_fn_backup set restored_at = now() where ctid = r.ctid;
    end loop;
  end if;
  -- 원본 복원 후에도 확장 표시가 남은 함수(start·timer·guard·generate)가 있으면 중단(전체 취소).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%[KDKM]%'
              and proname in ('start_kdk_match', 'start_kdk_match_timer', 'kdk_p1_score_guard', 'kdk_p1_can_generate')) then
    raise exception 'STOP KDK30 rollback: 원본 백업이 없어 복원하지 못한 함수가 있음 — 전체 취소(수동 확인 필요)';
  end if;
  -- kdk_session_meta 쓰기 정책: 관리자 정책 삭제 → 백업한 원래 정책(정의 그대로) 복원. 함수 삭제 전에(정책이 함수를 참조).
  if to_regclass('public.kdk_session_meta') is not null then
    drop policy if exists kdk_session_meta_insert_mgr on public.kdk_session_meta;
    drop policy if exists kdk_session_meta_update_mgr on public.kdk_session_meta;
    drop policy if exists kdk_session_meta_delete_mgr on public.kdk_session_meta;
    if to_regclass('security_backup.kdk_mgr_policy_backup') is not null then
      for p in select ctid, b.* from security_backup.kdk_mgr_policy_backup b where restored_at is null order by captured_at, policyname loop
        if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'kdk_session_meta' and policyname = p.policyname) then
          execute format('create policy %I on public.kdk_session_meta as %s for %s to %s%s%s',
                         p.policyname, p.permissive, p.cmd,
                         (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ') from unnest(p.roles) x),
                         case when p.qual is not null then ' using (' || p.qual || ')' else '' end,
                         case when p.with_check is not null then ' with check (' || p.with_check || ')' else '' end);
        end if;
        update security_backup.kdk_mgr_policy_backup set restored_at = now() where ctid = p.ctid;
      end loop;
    end if;
  end if;
  drop function if exists public.kdk_can_operate_court();
  drop function if exists public.can_manage_kdk();
  drop function if exists public.kdk_actor_withdrawn();
  raise notice 'KDK30 rollback: 원본 함수 % 개 복원', v_n;
end
$kdkm_rb$;

notify pgrst, 'reload schema';

select 'KDK30 rollback' as step,
       (select count(*) from pg_proc where prosrc like '%[KDKM]%' and pronamespace = 'public'::regnamespace) as kdkm_funcs,   -- 0
       to_regprocedure('public.can_manage_kdk()') is null as helper_removed,                                                 -- true
       has_function_privilege('anon', 'public.start_kdk_match(text,text)', 'execute') as anon_start,                         -- false
       (select string_agg(policyname || '(' || cmd || ')', ' · ' order by policyname) from pg_policies
         where schemaname = 'public' and tablename = 'kdk_session_meta' and cmd <> 'SELECT') as meta_write_policies;      -- 원래 정책(운영: write_kdk_session_meta(ALL))
-- 등록 기록까지 지우려면(선택 · 별도 실행):  drop table if exists public.kdk_managers;
