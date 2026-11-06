-- =============================================================================
-- TEYEON MATCH SPOTLIGHT — 적용 직전 안전 백업 (public.matches 스냅샷)
--   SPOTLIGHT SQL 은 matches 의 데이터·컬럼을 바꾸지 않는다(trigger 만 추가). 그래도 적용 직전 상태를 남긴다.
--   ⚠ public 스키마에 백업 테이블을 만들면 Supabase 기본 권한으로 anon 이 읽을 수 있다 →
--     API 에 노출되지 않는 별도 스키마(spotlight_backup)에 만들고 anon/authenticated 권한을 모두 회수한다.
--   결과: 마지막 SELECT 1행(백업 행 수 = 원본 행 수 이어야 함).
-- =============================================================================
begin;
create schema if not exists spotlight_backup;
revoke all on schema spotlight_backup from public, anon, authenticated;

create table spotlight_backup.matches_20261104 as table public.matches;   -- 이미 있으면 오류 → 중단(덮어쓰지 않음)
revoke all on spotlight_backup.matches_20261104 from public, anon, authenticated;
alter table spotlight_backup.matches_20261104 enable row level security;
commit;

select (select count(*) from public.matches)                    as matches_rows,
       (select count(*) from spotlight_backup.matches_20261104) as backup_rows,
       has_table_privilege('anon', 'spotlight_backup.matches_20261104', 'select') as anon_can_read;  -- false 여야 함

-- 백업 삭제(SPOTLIGHT 운영 안정 확인 후, 별도 판단):
--   drop table spotlight_backup.matches_20261104; drop schema spotlight_backup;
