-- =============================================================================
-- 검증 SQL — add_member_achievement_fields.sql 적용 후 확인(읽기 전용).
-- =============================================================================

-- 1) organization/year 컬럼 존재
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'member_achievements'
   and column_name in ('organization', 'year')
 order by column_name;  -- 기대 2행 (organization=text, year=integer)

-- 2) CHECK 제약 4개 존재
select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
 where conrelid = 'public.member_achievements'::regclass
   and conname in ('member_achievements_org_chk', 'member_achievements_division_chk',
                   'member_achievements_result_chk', 'member_achievements_year_chk')
 order by conname;  -- 기대 4행

-- 3) 연도 인덱스 존재
select indexname from pg_indexes
 where tablename = 'member_achievements' and indexname = 'member_achievements_member_year_idx';  -- 기대 1행

-- 4) 잔존 레거시 값 점검(모두 0 이어야 정상)
select
  count(*) filter (where result not in ('우승','준우승','입상'))            as bad_result,
  count(*) filter (where division is not null and division not in ('신인부','오픈부')) as bad_division,
  count(*) filter (where organization is not null and organization not in ('KATO','KATA','KTA')) as bad_org
  from public.member_achievements;  -- 기대 bad_result=0, bad_division=0, bad_org=0

-- 5) RLS 정책 무회귀(기존 select/insert/update/delete 유지 확인)
select policyname
  from pg_policies
 where schemaname = 'public' and tablename = 'member_achievements'
 order by policyname;
-- 기대: member_achievements_select / _insert / _update / _delete
