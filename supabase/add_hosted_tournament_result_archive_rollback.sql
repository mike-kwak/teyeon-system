-- 공식 결과 아카이브 되돌리기 — 추가한 것만 지운다(대회 운영 테이블 · 경기 · 대진 데이터와 무관).
-- ┌──────────────────────────────────────────────────────────────────────────────┐
-- │ ⛔ 공식 결과를 [확정]한 뒤에는 이 SQL 을 실행하지 마세요.                       │
-- │    확정한 공식 기록(스냅샷) · 정정 이력 대상 · 사진/영상 연결이 함께 사라집니다.  │
-- │    아래 첫 단계가 확정 기록이 1건이라도 있으면 STOP 으로 멈추고 아무것도 지우지 않습니다. │
-- └──────────────────────────────────────────────────────────────────────────────┘
--   이 롤백은 '적용 직후 · 확정 전' 에 문제가 있을 때만 쓴다(검증 SQL 이 CHECK 를 낸 경우 등).
--   ⚠ Storage 버킷의 사진 파일은 지우지 않는다(정책만 제거). 파일 정리는 Storage 화면에서 따로 한다.
begin;
do $$
begin
    if to_regclass('public.hosted_tournament_result_archives') is not null
       and exists (select 1 from public.hosted_tournament_result_archives) then
        raise exception 'STOP: 확정된 공식 결과가 있어 롤백하지 않습니다(공식 기록 보호). 아무것도 바뀌지 않았습니다.';
    end if;
end $$;
drop policy if exists "tournament results media read" on storage.objects;
drop policy if exists "tournament results media insert" on storage.objects;
drop policy if exists "tournament results media update" on storage.objects;
drop policy if exists "tournament results media delete" on storage.objects;
drop function if exists public.hosted_tournament_result_photo_is_public(text);
drop function if exists public.delete_tournament_result_media(text, uuid);
drop function if exists public.save_tournament_result_media(text, uuid, text, text, text, text, text, boolean, integer);
drop function if exists public.set_tournament_result_public(text, boolean);
drop function if exists public.amend_tournament_result(text, text, integer, text);
drop function if exists public.confirm_tournament_result(text, integer, text, text);
drop function if exists public.get_admin_tournament_result(text);
drop function if exists public.get_public_tournament_result(text);
drop function if exists public.get_public_tournament_result_editions();
drop function if exists public.hosted_tournament_result_ok(jsonb);
drop function if exists public.hosted_tournament_result_build(uuid);
drop table if exists public.hosted_tournament_result_media;
drop trigger if exists hosted_tournament_result_archive_guard on public.hosted_tournament_result_archives;
drop table if exists public.hosted_tournament_result_archives;
drop function if exists public.hosted_tournament_result_archive_guard();
commit;
