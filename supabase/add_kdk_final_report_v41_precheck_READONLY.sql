-- ============================================================================
-- TEYEON KDK FINAL REPORT V4.1 — 설치 전 확인(READ-ONLY · SELECT 만 · 값 · 이름 출력 없음)
--   add_kdk_final_report_v41.sql 이 의존하는 운영 객체 · 컬럼이 있는지 확인한다.
--   기대: 모든 행 result = 'OK'. 'MISSING' 이 있으면 설치하지 말고 결과를 공유한다.
--     · P01~P04: 없으면 설치 SQL 이 실패(전체 취소 · 데이터 무변경)
--     · P05~P06: 없으면 설치는 되지만 V4.1 편집기 열기가 실패(동적 SQL)
--     · P07: 이미 V4.1 객체가 있으면 'EXISTS' — 재실행(안전) 여부 확인용 정보
-- ============================================================================
with need(check_id, tbl, col) as (values
  ('P01', 'kdk_final_reports', 'public_payload'), ('P01', 'kdk_final_reports', 'revision'), ('P01', 'kdk_final_reports', 'source_signature'),
  ('P01', 'kdk_final_reports', 'published_at'), ('P01', 'kdk_final_reports', 'published_by'), ('P01', 'kdk_final_reports', 'public_slug'),
  ('P02', 'members', 'role'), ('P02', 'members', 'auth_user_id'), ('P02', 'members', 'email'),
  ('P02', 'profiles', 'role'),
  ('P03', 'teyeon_archive_v1', 'raw_data'), ('P03', 'teyeon_archive_v1', 'archive_type'), ('P03', 'teyeon_archive_v1', 'is_official'), ('P03', 'teyeon_archive_v1', 'is_test'),
  ('P05', 'club_schedules', 'schedule_type'), ('P05', 'club_schedules', 'schedule_date'), ('P05', 'club_schedules', 'start_time'),
  ('P06', 'kdk_guest_penalty_payments', 'session_id'), ('P06', 'kdk_guest_penalty_payments', 'participant_id'), ('P06', 'kdk_guest_penalty_payments', 'charge_type'),
  ('P06', 'kdk_guest_penalty_payments', 'status'), ('P06', 'kdk_guest_penalty_payments', 'amount'), ('P06', 'kdk_guest_penalty_payments', 'paid_at'),
  ('P06', 'kdk_guest_penalty_payments', 'cancelled_at'), ('P06', 'kdk_guest_penalty_payments', 'updated_at')
)
select n.check_id, n.tbl || '.' || n.col as item,
       case when exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = n.tbl and c.column_name = n.col)
            then 'OK'
            when n.check_id in ('P05', 'P06') and to_regclass('public.' || n.tbl) is null then 'OK (table absent → skipped by design)'
            else 'MISSING' end as result
  from need n
union all
select 'P04', 'functions: publish_kdk_final_report · kdk_spotlight_is_admin · kdk_final_report_signature · auth.uid',
       case when to_regprocedure('public.publish_kdk_final_report(text,uuid,jsonb,text,integer)') is not null
             and to_regprocedure('public.kdk_spotlight_is_admin(uuid)') is not null
             and to_regprocedure('public.kdk_final_report_signature(jsonb)') is not null
             and to_regprocedure('auth.uid()') is not null then 'OK' else 'MISSING' end
union all
select 'P04', 'auth.users.email', case when exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email') then 'OK' else 'MISSING' end
union all
select 'P04', 'gen_random_uuid()', case when to_regprocedure('gen_random_uuid()') is not null or to_regprocedure('public.gen_random_uuid()') is not null or to_regprocedure('extensions.gen_random_uuid()') is not null then 'OK' else 'MISSING' end
union all
select 'P07', 'existing V4.1 objects (info)',
       case when to_regclass('public.kdk_final_report_revisions') is not null or to_regclass('public.kdk_final_report_settlements') is not null
              or to_regprocedure('public.publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)') is not null then 'EXISTS (재실행)' else 'none (신규 설치)' end
union all
select 'P08', 'published reports to copy into history (info)', (select count(*)::text from public.kdk_final_reports where public_payload is not null and revision >= 1)
order by 1, 2;
