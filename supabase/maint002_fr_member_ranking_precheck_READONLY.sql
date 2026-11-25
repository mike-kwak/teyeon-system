-- MAINT-002 PRECHECK — READ ONLY (SELECT 한 문장 · 쓰기 없음 · 이름/ID/이메일 미출력)
--   적용 전 운영 상태 확인. SQL Editor 에서 파일 전체 실행 → (id, item, value, result) 행.
--   result: OK · STOP(적용하지 말 것) · INFO · CHECK(값을 확인 후 판단)
--   P06 · P07 값은 적용 후 verify 의 V09 · V10 과 같아야 한다(발행 원본 · 정산 함수 무변경 확인용) — 기록해 두기.
with fn as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig, p.prosecdef,
         md5(replace(p.prosrc, chr(13), '')) as src_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
)
select 'P01' as id, 'prereq kdk_final_reports' as item, (to_regclass('public.kdk_final_reports') is not null)::text as value,
       case when to_regclass('public.kdk_final_reports') is not null then 'OK' else 'STOP' end as result
union all
select 'P01', 'prereq teyeon_archive_v1', (to_regclass('public.teyeon_archive_v1') is not null)::text,
       case when to_regclass('public.teyeon_archive_v1') is not null then 'OK' else 'STOP' end
union all
select 'P01', 'prereq members.auth_user_id',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'auth_user_id')::text,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'auth_user_id') then 'OK' else 'STOP' end
union all
select 'P01', 'prereq members.club_id',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'club_id')::text,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'members' and column_name = 'club_id') then 'OK' else 'STOP' end
union all
select 'P01', 'prereq kdk_final_report_signature(jsonb)', (to_regprocedure('public.kdk_final_report_signature(jsonb)') is not null)::text,
       case when to_regprocedure('public.kdk_final_report_signature(jsonb)') is not null then 'OK' else 'STOP' end
union all
select 'P01', 'prereq auth.uid()', (to_regprocedure('auth.uid()') is not null)::text,
       case when to_regprocedure('auth.uid()') is not null then 'OK' else 'STOP' end
union all
-- P02: 신규 함수 이름(5개) 현황 — 0 = NEW_INSTALL, 5 = ALREADY_APPLIED(재실행 안전), 그 밖 = CHECK
select 'P02', 'maint002 functions present',
       (select count(*) from fn where proname in ('kdk_fr_can_view_ranking', 'kdk_fr_public_names', 'kdk_fr_public_text', 'kdk_fr_public_view', 'get_kdk_final_report_member'))::text,
       case (select count(*) from fn where proname in ('kdk_fr_can_view_ranking', 'kdk_fr_public_names', 'kdk_fr_public_text', 'kdk_fr_public_view', 'get_kdk_final_report_member'))
            when 0 then 'NEW_INSTALL' when 5 then 'ALREADY_APPLIED' else 'CHECK' end
union all
-- P03: 현재 공개 함수 본문 지문(줄 끝 CR 제거).
--   fd6774c7… = 저장소 add_kdk_final_report.sql §7 원문(적용 전 기대값) · bb6aee68… = MAINT-002 적용본. 그 밖 = 저장소와 다른 정의(CHECK · 적용 보류 후 원인 확인)
select 'P03', 'get_public_kdk_final_report(text) src_md5', coalesce((select src_md5 from fn where sig = 'get_public_kdk_final_report(text)'), 'MISSING'),
       case (select src_md5 from fn where sig = 'get_public_kdk_final_report(text)')
            when 'fd6774c7ba5cfcc99377f3dacc343bee' then 'OK_ORIGINAL'
            when 'bb6aee68927aec2e40a94479a092949a' then 'ALREADY_APPLIED'
            else case when (select src_md5 from fn where sig = 'get_public_kdk_final_report(text)') is null then 'STOP' else 'CHECK' end end
union all
select 'P04', 'anon EXECUTE get_public_kdk_final_report',
       coalesce(has_function_privilege('anon', 'public.get_public_kdk_final_report(text)', 'EXECUTE')::text, 'n/a'), 'INFO'
union all
select 'P05', 'reports ' || r.status || ' edition=' || coalesce(r.public_payload->>'edition', 'none') || ' layout=' || coalesce(r.public_payload->'v41'->>'layout', 'none'),
       count(*)::text, 'INFO'
  from public.kdk_final_reports r group by r.status, r.public_payload->>'edition', r.public_payload->'v41'->>'layout'
union all
-- P06: 발행 원본 지문(적용 후에도 같아야 함)
select 'P06', 'kdk_final_reports public_payload md5',
       coalesce((select md5(string_agg(r.id::text || ':' || coalesce(r.public_payload::text, ''), '|' order by r.id)) from public.kdk_final_reports r), 'EMPTY'), 'INFO'
union all
-- P07: 정산 함수 본문 지문(적용 후에도 같아야 함)
select 'P07', f.sig || ' src_md5', f.src_md5, 'INFO'
  from fn f where f.sig in ('kdk_can_view_settlement(uuid)', 'get_kdk_final_report_settlement(text)', 'publish_kdk_final_report(text,uuid,jsonb,text,integer)')
union all
-- P08: 클럽 범위 — 리포트 club_id 종류 수(1 기대) · 회원 토큰이 있는 연결 계정 중 리포트 클럽 행이 없는 계정 수(0 기대).
--   0 이 아니면 그 계정은 적용 후 공개본만 보게 된다(members.club_id 누락 · 다른 값) → 적용 보류 후 확인.
select 'P08', 'distinct report club_id', (select count(distinct club_id) from public.kdk_final_reports)::text,
       case when (select count(distinct club_id) from public.kdk_final_reports) <= 1 then 'OK' else 'CHECK' end
union all
select 'P08', 'linked member accounts without report-club row',
       (select count(distinct m.auth_user_id) from public.members m
         where m.auth_user_id is not null
           and m.role ~ '(정회원|준회원|회장|부회장|총무|재무|경기|섭외|CEO)' and m.role !~ '탈회'
           and not exists (select 1 from public.members m2 join public.kdk_final_reports r on r.club_id = m2.club_id::text
                            where m2.auth_user_id = m.auth_user_id))::text,
       case when (select count(distinct m.auth_user_id) from public.members m
         where m.auth_user_id is not null
           and m.role ~ '(정회원|준회원|회장|부회장|총무|재무|경기|섭외|CEO)' and m.role !~ '탈회'
           and not exists (select 1 from public.members m2 join public.kdk_final_reports r on r.club_id = m2.club_id::text
                            where m2.auth_user_id = m.auth_user_id)) = 0 then 'OK' else 'CHECK' end
union all
-- P09: (정보) 회원 전용 정산 스냅샷 모드별 건수. live 행에는 참가자 이름 · 청구 벌금(순위 기반)이 있고,
--   정산 열람 자격(kdk_can_view_settlement — 이번 작업에서 변경하지 않음)은 순위 자격보다 넓다(profiles CEO · ADMIN · FINANCE_MANAGER · 이메일 매칭).
select 'P09', 'settlement snapshots mode=' || coalesce(s.mode, 'null'), count(*)::text, 'INFO'
  from public.kdk_final_report_settlements s group by s.mode
order by 1, 2;
