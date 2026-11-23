-- *****************************************************************************
-- **  [운영 적용 이력] 2026-11-24 사용자가 Supabase SQL Editor 에서 직접 실행 · 결과 전달(Claude Code 는 운영 미접속).
-- **  이 rollback 은 운영에서 실행하지 않았다. 필요 시 별도 승인 후에만(실행하면 RLS 켜짐 · 정책 0 장애 상태로 돌아감).
-- **  ⚠ 재실행 금지 — 다시 실행하려면 별도 승인. 아래 본문은 적용 당시 그대로 보존(추적 · 재현용, 수정 금지).
-- *****************************************************************************
-- #############################################################################
-- ##  [초안 · 사용자 승인 전 운영 실행 금지]  R1 rollback — matches RLS 를 R1 직전 상태(켜짐 · 정책 0)로 되돌림  ##
-- #############################################################################
--   ⚠ 되돌린 상태 = 로컬 재현 B: 화면 · 전광판 조회 0행, 대진 생성 42501, 점수 저장 · 복귀 0행(경기가 playing 에 갇힘).
--     KDK 운영 중에는 실행하지 않는다. R1 이후 "RLS 꺼짐" 자체가 문제로 판명된 경우에만, 정책 방안(B) 준비와 함께 사용.
--   정책 · GRANT · trigger · 데이터는 바꾸지 않는다.
begin;
set local lock_timeout = '3s';
do $rb$
begin
  if (select relrowsecurity from pg_class where oid = 'public.matches'::regclass) then
    raise exception 'STOP R1-RB: 이미 RLS 켜짐 — 변경 없음';
  end if;
end
$rb$;
alter table public.matches enable row level security;
commit;

select (select relrowsecurity from pg_class where oid = 'public.matches'::regclass) as rls,                  -- true
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'matches') as policies; -- 0
