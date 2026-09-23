-- =============================================================================
-- ROLLBACK — add_hosted_tournament_bracket.sql (Batch 4A)
--
--   되돌리는 것: 이 Batch 가 새로 만든 RPC 12개.
--   되돌리지 않는 것(데이터 손실 방지):
--     · bracket 테이블 4개 — 경기이사가 입력한 진출팀 · 구조 · 배치가 사라진다.
--     · hosted_tournament_matches 의 nullable 컬럼 2개와 partial unique index —
--       knockout 경기가 없으면 완전히 무해하고, 있으면 지우는 순간 연결이 끊긴다.
--     · hosted_tournament_events 의 entity_type CHECK 확장 —
--       이미 기록된 'bracket' 이벤트가 있으면 되돌릴 때 제약 위반이 난다.
--   ⚠ 정말 구조까지 지워야 할 때만 파일 맨 아래 주석 블록을 사람이 직접 실행한다.
--
--   ⚠ 기존 Preliminary · Match Engine 에는 영향이 없다.
--     4A 는 기존 함수를 하나도 CREATE OR REPLACE 하지 않았으므로 되돌릴 대상도 없다.
--   ⚠ 이 파일에도 기존 행 UPDATE / DELETE 는 없다.
-- =============================================================================

begin;

drop function if exists public.get_admin_bracket(text);
drop function if exists public.unlock_bracket(text, text, integer);
drop function if exists public.lock_bracket(text, integer);
drop function if exists public.validate_bracket(text);
drop function if exists public.replace_bracket_slots(text, jsonb, integer);
drop function if exists public.assign_bracket_slot(text, uuid, text, uuid, integer);
drop function if exists public.set_bracket_structure(text, jsonb, integer);
drop function if exists public.set_bracket_entrants(text, jsonb, integer);
drop function if exists public.create_bracket(text, text, integer);
drop function if exists public.hosted_tournament_bracket_validate(uuid);
drop function if exists public.hosted_tournament_bracket_bump(uuid);
drop function if exists public.hosted_tournament_bracket_begin(text, integer);

notify pgrst, 'reload schema';

commit;


-- =============================================================================
-- (선택) 구조까지 완전히 되돌릴 때만 — 데이터가 사라지므로 기본 rollback 에 넣지 않는다.
--   실행 전 반드시 확인:
--     select count(*) from public.hosted_tournament_brackets;                 -- 0 이어야 안전
--     select count(*) from public.hosted_tournament_matches where stage = 'knockout';  -- 0 이어야 안전
--
--   begin;
--   drop index if exists public.hosted_tmatch_bracket_target_uniq;
--   alter table public.hosted_tournament_matches
--       drop constraint if exists hosted_tmatch_bracket_shape,
--       drop constraint if exists hosted_tmatch_bracket_slot_fk,
--       drop constraint if exists hosted_tmatch_bracket_fk,
--       drop column if exists bracket_target_slot_id,
--       drop column if exists bracket_id;
--   drop table if exists public.hosted_tournament_bracket_slots;     -- ⚠ 자리 · 배치 · 연결 소멸
--   drop table if exists public.hosted_tournament_bracket_entrants;  -- ⚠ 진출팀 스냅샷 소멸
--   drop table if exists public.hosted_tournament_bracket_rounds;
--   drop table if exists public.hosted_tournament_brackets;
--   -- events CHECK 되돌리기는 'bracket' / 'bracket_slot' 이벤트가 하나도 없을 때만 가능하다.
--   -- alter table public.hosted_tournament_events drop constraint hosted_tevent_entity_type_check;
--   -- alter table public.hosted_tournament_events add constraint hosted_tevent_entity_type_check
--   --     check (entity_type in ('tournament','team','court','group','membership','bracket_round','match'));
--   notify pgrst, 'reload schema';
--   commit;
-- =============================================================================
