-- =============================================================================
-- TEYEON OPEN 공식 결과 — 시상 사진 저장소(Supabase Storage)
--   선행: add_hosted_tournament_result_archive.sql (hosted_tournament_result_media · archives)
--
--   · 버킷 tournament-results — 비공개(public=false). 파일 10MB 이하, JPEG · PNG · WebP 만.
--     경로 = <tournament_id>/<uuid>.<jpg|png|webp> (화면이 만든다, 원래 파일 이름은 쓰지 않는다).
--   · 올리기 · 바꾸기 · 지우기 = CEO/ADMIN(can_manage_tournaments)만.
--   · 읽기 = CEO/ADMIN 은 전부, 그 밖(비로그인 포함)은 '공개된 아카이브 + 공개 승인된 사진 연결'이 있는 파일만.
--     → 공개 화면은 서명 URL(createSignedUrl)로 읽는다. 승인 전 사진 · 연결 안 된 파일은 주소를 알아도 열리지 않는다.
--   ⚠ 기존 버킷 · 다른 기능의 Storage 정책은 바꾸지 않는다(이 버킷 이름으로만 조건을 건다).
-- =============================================================================

begin;

-- 버킷 — 없으면 만든다. ⚠ 이미 있으면 덮어쓰지 않는다:
--   이 SQL 이 만든 것과 같은 설정(비공개 · 10MB · JPEG/PNG/WebP)이면 그대로 두고(재실행 안전), 다르면 STOP(아무것도 바꾸지 않음).
do $$
declare v storage.buckets%rowtype;
begin
    select * into v from storage.buckets where id = 'tournament-results';
    if v.id is null then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('tournament-results', 'tournament-results', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);
    elsif v.public is distinct from false or v.file_size_limit is distinct from 10485760
          or v.allowed_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp'] then
        raise exception 'STOP: 기존 Storage 버킷 tournament-results 가 다른 설정으로 이미 있습니다(public=%, limit=%). 덮어쓰지 않습니다 — 아무것도 바뀌지 않았습니다.',
            v.public, v.file_size_limit;
    end if;
end $$;

-- 이 파일이 '공개된 아카이브 + 공개 승인된 사진 연결' 인가 — 정책에서 부른다(연결 테이블은 직접 읽을 수 없으므로 함수로).
create or replace function public.hosted_tournament_result_photo_is_public(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    -- 관리자(CEO/ADMIN)는 전부 — 비로그인은 관리자 판정 함수를 직접 실행할 수 없으므로 여기(definer)에서 함께 본다.
    select public.can_manage_tournaments()
        or exists (select 1 from public.hosted_tournament_result_media m
                     join public.hosted_tournament_result_archives a on a.tournament_id = m.tournament_id
                    where m.storage_path = p_name and m.kind = 'photo' and m.is_public and a.is_public);
$$;
revoke all on function public.hosted_tournament_result_photo_is_public(text) from public;
grant execute on function public.hosted_tournament_result_photo_is_public(text) to anon, authenticated;

drop policy if exists "tournament results media read" on storage.objects;
create policy "tournament results media read" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'tournament-results' and public.hosted_tournament_result_photo_is_public(name));

drop policy if exists "tournament results media insert" on storage.objects;
create policy "tournament results media insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'tournament-results' and public.can_manage_tournaments()
                and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

drop policy if exists "tournament results media update" on storage.objects;
create policy "tournament results media update" on storage.objects
    for update to authenticated
    using (bucket_id = 'tournament-results' and public.can_manage_tournaments())
    with check (bucket_id = 'tournament-results' and public.can_manage_tournaments());

drop policy if exists "tournament results media delete" on storage.objects;
create policy "tournament results media delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'tournament-results' and public.can_manage_tournaments());

commit;
