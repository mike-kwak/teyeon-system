-- =============================================================================
-- ROLLBACK — add_hosted_tournament_public_knockout.sql (Batch 4D-2)
--
--   되돌리는 것
--     · publish_bracket / unpublish_bracket / get_public_knockout_bracket
--     · 내부 공개 키 helper
--
--   되돌리지 않는 것
--     · brackets.published_at 값 — 이미 공개한 대회를 조용히 비공개로 바꾸지 않는다.
--       (공개를 내리려면 되돌리기 전에 unpublish_bracket 을 먼저 실행하라.)
--     · 4A 의 published_at 컬럼 자체(4A 소관).
--     · 4C 엔진 · 4D-0 qualifier · 예선 공개 DRAW — 이 Batch 가 건드리지 않았다.
--
--   ⚠ 되돌리면 공개 화면이 데이터를 받지 못한다(공개 조회 RPC 가 사라진다).
--     앱의 NEXT_PUBLIC_PUBLIC_KNOCKOUT_ENABLED 를 먼저 끄는 편이 안전하다.
--   ⚠ 이 파일에도 기존 행 UPDATE / DELETE 는 없다.
-- =============================================================================

begin;

drop function if exists public.get_public_knockout_bracket(text);
drop function if exists public.unpublish_bracket(text, text, integer);
drop function if exists public.publish_bracket(text, integer);
drop function if exists public.hosted_tournament_public_slot_key(integer, integer);

do $chk$
declare
    v_pub integer;
begin
    select count(*) into v_pub from public.hosted_tournament_brackets where published_at is not null;
    if v_pub > 0 then
        raise notice '공개 상태인 본선이 %건 남아 있다(published_at 유지). 공개 화면은 조회 RPC 가 없어 비공개로 보인다.', v_pub;
    end if;
end $chk$;

notify pgrst, 'reload schema';

commit;
