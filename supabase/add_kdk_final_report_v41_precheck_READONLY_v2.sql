-- TEYEON FINAL REPORT V4.1 precheck v2 (READ-ONLY, single SELECT, ASCII labels only)
-- Run the whole text once in a NEW empty SQL Editor tab. Expected: 33 rows.
with need(check_id, tbl, col) as (values
  ('P01', 'kdk_final_reports', 'public_payload'),
  ('P01', 'kdk_final_reports', 'revision'),
  ('P01', 'kdk_final_reports', 'source_signature'),
  ('P01', 'kdk_final_reports', 'published_at'),
  ('P01', 'kdk_final_reports', 'published_by'),
  ('P01', 'kdk_final_reports', 'public_slug'),
  ('P02', 'members', 'role'),
  ('P02', 'members', 'auth_user_id'),
  ('P02', 'members', 'email'),
  ('P02', 'profiles', 'role'),
  ('P03', 'teyeon_archive_v1', 'raw_data'),
  ('P03', 'teyeon_archive_v1', 'archive_type'),
  ('P03', 'teyeon_archive_v1', 'is_official'),
  ('P03', 'teyeon_archive_v1', 'is_test'),
  ('P05', 'club_schedules', 'schedule_type'),
  ('P05', 'club_schedules', 'schedule_date'),
  ('P05', 'club_schedules', 'start_time'),
  ('P06', 'kdk_guest_penalty_payments', 'session_id'),
  ('P06', 'kdk_guest_penalty_payments', 'participant_id'),
  ('P06', 'kdk_guest_penalty_payments', 'charge_type'),
  ('P06', 'kdk_guest_penalty_payments', 'status'),
  ('P06', 'kdk_guest_penalty_payments', 'amount'),
  ('P06', 'kdk_guest_penalty_payments', 'paid_at'),
  ('P06', 'kdk_guest_penalty_payments', 'cancelled_at'),
  ('P06', 'kdk_guest_penalty_payments', 'updated_at')
)
select n.check_id,
       n.tbl || '.' || n.col as item,
       case
         when exists (select 1 from information_schema.columns c
                       where c.table_schema = 'public' and c.table_name = n.tbl and c.column_name = n.col) then 'OK'
         when n.check_id in ('P05', 'P06') and to_regclass('public.' || n.tbl) is null then 'OK_TABLE_ABSENT_SKIPPED'
         else 'MISSING'
       end as result
  from need n
union all
select 'P04', 'fn_publish_kdk_final_report',
       case when to_regprocedure('public.publish_kdk_final_report(text,uuid,jsonb,text,integer)') is not null then 'OK' else 'MISSING' end
union all
select 'P04', 'fn_kdk_spotlight_is_admin',
       case when to_regprocedure('public.kdk_spotlight_is_admin(uuid)') is not null then 'OK' else 'MISSING' end
union all
select 'P04', 'fn_kdk_final_report_signature',
       case when to_regprocedure('public.kdk_final_report_signature(jsonb)') is not null then 'OK' else 'MISSING' end
union all
select 'P04', 'fn_auth_uid',
       case when to_regprocedure('auth.uid()') is not null then 'OK' else 'MISSING' end
union all
select 'P04', 'auth_users_email',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'auth' and table_name = 'users' and column_name = 'email') then 'OK' else 'MISSING' end
union all
select 'P04', 'fn_gen_random_uuid',
       case when to_regprocedure('gen_random_uuid()') is not null
              or to_regprocedure('public.gen_random_uuid()') is not null
              or to_regprocedure('extensions.gen_random_uuid()') is not null then 'OK' else 'MISSING' end
union all
select 'P07', 'v41_objects_state',
       case when to_regclass('public.kdk_final_report_revisions') is not null
              or to_regclass('public.kdk_final_report_settlements') is not null
              or to_regprocedure('public.publish_kdk_final_report_v41(text,uuid,jsonb,text,integer,jsonb)') is not null
            then 'ALREADY_INSTALLED' else 'NEW_INSTALL' end
union all
select 'P08', 'published_report_count',
       (select count(*)::text from public.kdk_final_reports where public_payload is not null and revision >= 1)
order by 1, 2;
