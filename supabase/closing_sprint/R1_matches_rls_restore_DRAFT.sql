-- *****************************************************************************
-- **  [운영 적용 이력] 2026-11-24 사용자가 Supabase SQL Editor 에서 직접 실행 · 결과 전달(Claude Code 는 운영 미접속).
-- **  결과: rls=false · force_rls=false · policies=0 · guard_on=true · anon_write=false · anon_select=true · auth_siud=true → PASS
-- **  ⚠ 재실행 금지 — 다시 실행하려면 별도 승인. 아래 본문은 적용 당시 그대로 보존(추적 · 재현용, 수정 금지).
-- *****************************************************************************
-- #############################################################################
-- ##  [초안 · 사용자 승인 전 운영 실행 금지]  R1 — public.matches RLS 를 P1 설계 상태(꺼짐)로 복구        ##
-- ##  rollback: R1_matches_rls_restore_rollback_DRAFT.sql                                                 ##
-- #############################################################################
--   대상: public.matches 하나만. 다른 테이블 · 정책 · GRANT · trigger · RPC · 데이터 · publication 은 바꾸지 않는다.
--   근거: 2026-11-04 운영 사전 점검(security_p0/10_p0a 주석)에서 matches = RLS 꺼짐. P0-A(anon 쓰기 회수) · P1(trigger 보호) ·
--         KDK30 · SPOTLIGHT 가 모두 이 상태를 전제로 설계 · 운영 검증됐다(20_p1 "바꾸지 않는 것: RLS").
--   현재: RLS 켜짐 · 정책 0 → anon/authenticated 의 SELECT 0행 · UPDATE/DELETE 0행 · INSERT 42501(로컬 재현 B).
--
--   실행 전 조건(하나라도 아니면 STOP · 무변경)
--     ① R1_rls_scope_READONLY.sql 결과 검토 완료 — 다른 테이블도 바뀌었으면 이 초안만으로 끝내지 말고 범위 재판정.
--     ② matches RLS = 켜짐 · 강제 꺼짐 · 정책 0 (누군가 정책을 추가했다면 의도된 변경일 수 있으므로 STOP).
--     ③ ALTER TABLE 에 반응하며 RLS 를 다루는 event trigger 없음(있으면 ALTER 직후 다시 켜질 수 있음).
--     ④ P1 보호 trigger 2개(score guard · truncate 차단) 켜짐 — 꺼진 상태에서 RLS 만 끄면 보호가 사라진다.
--     ⑤ anon 에 쓰기 권한 없음(P0-A 유지) — 있으면 STOP.
--     ⑥ 진행 중(playing) 경기 0 — KDK 운영 시간 외에만.
--   예상 영향: 테이블 재작성 없음. ACCESS EXCLUSIVE 잠금을 잠깐 잡음(lock_timeout 3s 초과 시 실패 · 무변경).
--             데이터 · xmin 불변(SPOTLIGHT 인증 영향 없음). 화면 조회 · 대진 생성 · 점수 저장 · 복귀 · Realtime 이 11-04 이전 동작으로 돌아감.
--   사후 검증: 마지막 SELECT — rls=false · force=false · policies=0 · guard_on=true · anon_write=false.
--             이어서 K1_rls_identity_publication_READONLY.sql I05 = false / false / 0.
--   실패 시: 오류면 트랜잭션 전체 취소(무변경). 55P03(lock_timeout)이면 잠시 후 재실행.
--
--   [2026-11-24 운영 조회 반영]
--     - T01/T02: 11-04 기준 13개 중 matches 만 변경(1/13) → 대상 범위 matches 하나 유지.
--     - pgss: postgres 역할로 "-- Added by Supabase: enable Row Level Security on newly created tables
--             ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY" 2회(stats_since 2026-11-23 16:07 UTC). 실행 주체 · 자동 여부 미확정.
--     - 실행 시 주의: 이 파일 전체만 SQL Editor 에 붙여 실행(다른 SQL 과 섞지 않음). 이 파일에는 CREATE TABLE 문구가 없다.
--       실행 중 "RLS 활성화" 류 제안 · 자동 추가 문구가 보이면 실행하지 말고 중단.
--     - 사후 검증 SQL: K1_rls_identity_publication_READONLY.sql (I05 · I07 · I08), 수 분 뒤 I05 한 번 더(재활성 여부).
-- =============================================================================
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $r1$
declare
  v_rls boolean; v_force boolean; v_pol int; v_evt text;
begin
  if to_regclass('public.matches') is null then
    raise exception 'STOP R1: public.matches 없음 — 변경 없음';
  end if;
  select relrowsecurity, relforcerowsecurity into v_rls, v_force from pg_class where oid = 'public.matches'::regclass;
  select count(*) into v_pol from pg_policies where schemaname = 'public' and tablename = 'matches';
  if not v_rls then
    raise exception 'STOP R1: matches RLS 가 이미 꺼져 있음 — 변경 불필요';
  end if;
  if v_force or v_pol <> 0 then
    raise exception 'STOP R1: 강제 RLS(%) 또는 정책(%개)이 있음 — 의도된 변경일 수 있어 변경 없음', v_force, v_pol;
  end if;
  -- ALTER TABLE 에도 반응할 수 있는 것(태그 미지정 또는 ALTER TABLE 포함)만 STOP. CREATE TABLE 전용 자동 RLS 장치는
  -- 이번 ALTER ... DISABLE 직후 다시 켜지 않으므로 통과(단, 이후 CREATE TABLE 실행 시 재발 위험은 별도 관리).
  select string_agg(e.evtname, ',') into v_evt
    from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid
   where e.evtenabled <> 'D' and (p.prosrc ilike '%row level security%' or p.prosrc ilike '%rowsecurity%')
     and (e.evttags is null or 'ALTER TABLE' = any (e.evttags));
  if v_evt is not null then
    raise exception 'STOP R1: RLS 를 다루는 event trigger(%) 있음 — ALTER 직후 다시 켜질 수 있어 변경 없음', v_evt;
  end if;
  -- 'O'(기본) · 'A'(항상)만 인정. 'R'(replica 전용)은 일반 세션에서 실행되지 않으므로 꺼진 것으로 본다.
  if (select count(*) from pg_trigger where tgrelid = 'public.matches'::regclass and tgenabled in ('O', 'A')
        and tgname in ('kdk_p1_score_guard_trg', 'kdk_p1_block_truncate_trg')) <> 2 then
    raise exception 'STOP R1: P1 보호 trigger 2개가 켜져 있지 않음 — RLS 를 끄면 보호가 사라짐, 변경 없음';
  end if;
  if has_table_privilege('anon', 'public.matches', 'INSERT') or has_table_privilege('anon', 'public.matches', 'UPDATE')
     or has_table_privilege('anon', 'public.matches', 'DELETE') or has_table_privilege('anon', 'public.matches', 'TRUNCATE') then
    raise exception 'STOP R1: anon 쓰기 권한이 있음(P0-A 미적용 상태) — 변경 없음';
  end if;
  if exists (select 1 from public.matches where status = 'playing') then
    raise exception 'STOP R1: 진행 중 경기가 있음 — KDK 운영 시간 외에 실행';
  end if;
end
$r1$;

alter table public.matches disable row level security;

commit;

select 'R1' as step,
       (select relrowsecurity from pg_class where oid = 'public.matches'::regclass) as rls,                 -- false
       (select relforcerowsecurity from pg_class where oid = 'public.matches'::regclass) as force_rls,      -- false
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'matches') as policies, -- 0
       (select count(*) = 2 from pg_trigger where tgrelid = 'public.matches'::regclass and tgenabled in ('O', 'A')
          and tgname in ('kdk_p1_score_guard_trg', 'kdk_p1_block_truncate_trg')) as guard_on,               -- true
       (has_table_privilege('anon', 'public.matches', 'INSERT') or has_table_privilege('anon', 'public.matches', 'UPDATE')
          or has_table_privilege('anon', 'public.matches', 'DELETE') or has_table_privilege('anon', 'public.matches', 'TRUNCATE')) as anon_write, -- false
       has_table_privilege('anon', 'public.matches', 'SELECT') as anon_select,                                -- true (공개 조회 · 11-04 와 동일)
       (has_table_privilege('authenticated', 'public.matches', 'SELECT') and has_table_privilege('authenticated', 'public.matches', 'INSERT')
          and has_table_privilege('authenticated', 'public.matches', 'UPDATE') and has_table_privilege('authenticated', 'public.matches', 'DELETE')) as auth_siud; -- true (P1 trigger 가 행 단위 제한)
