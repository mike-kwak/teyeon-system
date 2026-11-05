-- =============================================================================
-- (선택) P0-C 적용 직전 역할 스냅샷 — profiles 의 id·role 만 별도 스키마에 복사(anon/authenticated 접근 불가)
--   P0-C 는 profiles 데이터를 바꾸지 않는다. 이 백업은 "적용 전후 role 이 같다"를 증명·복구하기 위한 보조 기록.
--   이미 있으면 오류로 멈춘다(덮어쓰지 않음). 결과 1행: 백업 행 수 = profiles 행 수.
-- =============================================================================
begin;
create schema if not exists security_backup;
revoke all on schema security_backup from public, anon, authenticated;
create table security_backup.profiles_roles_p0c as
select id, role, now() as captured_at from public.profiles;
revoke all on security_backup.profiles_roles_p0c from public, anon, authenticated;
commit;

select (select count(*) from public.profiles) as profiles_rows,
       (select count(*) from security_backup.profiles_roles_p0c) as backup_rows;

-- 적용 후 비교(바뀐 role 이 0행이어야 함):
--   select count(*) from public.profiles p join security_backup.profiles_roles_p0c b on b.id = p.id
--    where p.role is distinct from b.role;
