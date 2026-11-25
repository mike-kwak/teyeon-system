-- MAINT-002 VERIFY — READ ONLY (SELECT 한 문장 · 쓰기 없음 · 이름/ID/이메일 미출력)
--   적용 후 확인. SQL Editor 에서 파일 전체 실행 → (id, item, value, result). 모든 OK 여야 한다(INFO 는 기록용).
--   V09 · V10 은 precheck 의 P06 · P07 값과 같아야 한다(발행 원본 · 정산 함수 무변경).
with fn as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig,
         md5(replace(p.prosrc, chr(13), '')) as src_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
), want(sig, definer, anon_x, auth_x) as (
  values ('get_public_kdk_final_report(text)', true, true, true),
         ('get_kdk_final_report_member(text)', true, false, true),
         ('kdk_fr_can_view_ranking(uuid,text)', true, false, false),
         ('kdk_fr_public_names(jsonb,jsonb)', false, false, false),
         ('kdk_fr_public_text(text,text[],integer)', false, false, false),
         ('kdk_fr_public_view(jsonb,jsonb)', false, false, false)
), pubs as (
  select r.public_payload, a.raw_data, public.get_public_kdk_final_report(r.public_slug) as res
    from public.kdk_final_reports r left join public.teyeon_archive_v1 a on a.id = r.session_id
   where r.status = 'published'
), leak as (
  select p.res->>'state' as st,
         (p.res ? 'officialSessionId')
         or coalesce(jsonb_array_length(case when jsonb_typeof(p.res->'payload'->'standings') = 'array' then p.res->'payload'->'standings' end), 0) > 0
         or coalesce(jsonb_array_length(case when jsonb_typeof(p.res->'payload'->'podium') = 'array' then p.res->'payload'->'podium' end), 0) > 0
         or coalesce(jsonb_array_length(case when jsonb_typeof(p.res->'payload'->'featured') = 'array' then p.res->'payload'->'featured' end), 0) > 0
         or coalesce(jsonb_array_length(case when jsonb_typeof(p.res->'payload'->'highlights') = 'array' then p.res->'payload'->'highlights' end), 0) > 0
         or coalesce(jsonb_array_length(case when jsonb_typeof(p.res->'payload'->'v41'->'heroes') = 'array' then p.res->'payload'->'v41'->'heroes' end), 0) > 0
         or coalesce(jsonb_array_length(case when jsonb_typeof(p.res->'payload'->'v41'->'mentions') = 'array' then p.res->'payload'->'v41'->'mentions' end), 0) > 0
         or jsonb_typeof(p.res->'payload'->'v41'->'rivalry') = 'object'
         or exists (select 1 from unnest(public.kdk_fr_public_names(p.public_payload, p.raw_data)) nm
                     where strpos(coalesce((p.res->'payload')::text, '') || coalesce(p.res->>'title', ''), nm) > 0) as leaked
    from pubs p
)
select 'V01' as id, 'exists ' || w.sig as item, (f.oid is not null)::text as value, case when f.oid is not null then 'OK' else 'FAIL' end as result
  from want w left join fn f on f.sig = w.sig
union all
select 'V02', 'security definer ' || w.sig, coalesce(f.prosecdef::text, 'missing'), case when f.prosecdef = w.definer then 'OK' else 'FAIL' end
  from want w left join fn f on f.sig = w.sig
union all
select 'V03', 'search_path ' || w.sig, coalesce(array_to_string(f.proconfig, ';'), 'none'),
       case when f.proconfig = array['search_path=public, pg_temp'] then 'OK' else 'FAIL' end
  from want w left join fn f on f.sig = w.sig
union all
select 'V04', 'anon EXECUTE ' || w.sig, coalesce(has_function_privilege('anon', f.oid, 'EXECUTE')::text, 'missing'),
       case when f.oid is not null and has_function_privilege('anon', f.oid, 'EXECUTE') = w.anon_x then 'OK' else 'FAIL' end
  from want w left join fn f on f.sig = w.sig
union all
select 'V05', 'authenticated EXECUTE ' || w.sig, coalesce(has_function_privilege('authenticated', f.oid, 'EXECUTE')::text, 'missing'),
       case when f.oid is not null and has_function_privilege('authenticated', f.oid, 'EXECUTE') = w.auth_x then 'OK' else 'FAIL' end
  from want w left join fn f on f.sig = w.sig
union all
select 'V06', 'get_public_kdk_final_report src_md5 = MAINT-002', coalesce((select src_md5 from fn where sig = 'get_public_kdk_final_report(text)'), 'missing'),
       case when (select src_md5 from fn where sig = 'get_public_kdk_final_report(text)') = 'bb6aee68927aec2e40a94479a092949a' then 'OK' else 'FAIL' end
union all
-- V07: 발행 리포트 전부 — 공개 응답에 순위 · TOP3 · 주요 경기 · 개인 기록 · 참가자 이름 · 세션 id 가 없어야 한다(0)
select 'V07', 'published reports leaking via public RPC', (select count(*) from leak where leaked)::text,
       case when (select count(*) from leak where leaked) = 0 then 'OK' else 'FAIL' end
union all
select 'V08', 'public RPC state=' || coalesce(st, 'null'), count(*)::text, 'INFO' from leak group by st
union all
-- V09: 발행 원본 무변경(precheck P06 과 같아야 함)
select 'V09', 'kdk_final_reports public_payload md5',
       coalesce((select md5(string_agg(r.id::text || ':' || coalesce(r.public_payload::text, ''), '|' order by r.id)) from public.kdk_final_reports r), 'EMPTY'), 'INFO'
union all
-- V10: 정산 · 발행 함수 무변경(precheck P07 과 같아야 함)
select 'V10', f.sig || ' src_md5', f.src_md5, 'INFO'
  from fn f where f.sig in ('kdk_can_view_settlement(uuid)', 'get_kdk_final_report_settlement(text)', 'publish_kdk_final_report(text,uuid,jsonb,text,integer)')
order by 1, 2;
