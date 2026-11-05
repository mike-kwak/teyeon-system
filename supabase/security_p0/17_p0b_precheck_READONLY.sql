-- =============================================================================
-- P0-B 사전 점검 — 읽기 전용 · SELECT 1개 · 아무것도 바꾸지 않음 (DDL/DML/GRANT/REVOKE 없음)
--   B 행  : 11_p0b_rpc_revoke_anon.sql 대상 6개 — 존재 · 본문 md5 허용 여부 · 현재 실행 권한 · search_path · P0-B 가 할 동작
--   I 행  : public 스키마 SECURITY DEFINER 함수 중 anon 이 지금 실행 가능한 전체 목록(오버로드 별도 행)
--           — P0-B 대상이 아닌 것은 "공개 RPC(유지)"인지 "추가 검토"인지 보고서에서 판정
--   C 행  : 이미 적용된 P0-A · P0-C 상태(참고 · 이번에 건드리지 않음)
-- =============================================================================
with tgt(o, sig, allowed) as (
  values
    (1, 'public.sync_tournament_matches(jsonb)', null::text[]),
    (2, 'public.update_match_status(text,text,integer,integer,integer)', null::text[]),
    (3, 'public.date_match_status(text)', null::text[]),
    (4, 'public.delete_kdk_live_session(text,text)', array['9f7a0b856885da2899766c4daefcf6d1', '77c38499351b4920dfd3eb6f3cb3726c']),
    (5, 'public.start_kdk_match(text,text)',         array['81257f29c2abed42a8e28bc9e8376626', '8b6c074d6e336c45f5e24bba2e1fd460']),
    (6, 'public.start_kdk_match_timer(text,text)',   array['a5b9875242bb9c28f33f9b1ad910ccc7'])
),
b as (
  select t.o, t.sig, to_regprocedure(t.sig) as oid, t.allowed from tgt t
),
brow as (
  select b.o,
         'B ' || b.sig as item,
         case
           when b.oid is null then 'SKIP(없음)'
           when b.allowed is not null and (select md5(replace(p.prosrc, E'\r', '')) from pg_proc p where p.oid = b.oid) <> all(b.allowed) then 'STOP(md5 불일치)'
           when not has_function_privilege('anon', b.oid, 'execute')
                and (select coalesce(array_to_string(p.proconfig, ' '), '') like '%search_path%' from pg_proc p where p.oid = b.oid) then 'SKIP(이미 적용)'
           else 'APPLY(anon 회수)'
         end as verdict,
         case when b.oid is null then '운영에 없음 — P0-B 가 새로 만들지 않음'
         else concat_ws(' · ',
           'definer=' || (select p.prosecdef from pg_proc p where p.oid = b.oid),
           'anon=' || has_function_privilege('anon', b.oid, 'execute'),
           'auth=' || has_function_privilege('authenticated', b.oid, 'execute'),
           'md5=' || left((select md5(replace(p.prosrc, E'\r', '')) from pg_proc p where p.oid = b.oid), 8),
           'auth.uid=' || ((select p.prosrc from pg_proc p where p.oid = b.oid) ilike '%auth.uid()%'),
           'config=' || coalesce((select array_to_string(p.proconfig, ' ') from pg_proc p where p.oid = b.oid), '(없음)'),
           'acl=' || coalesce((select p.proacl::text from pg_proc p where p.oid = b.oid), '(기본=PUBLIC 실행)'))
         end as detail
    from b
),
irow as (
  select 100 as o,
         'I ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
         case when p.oid = any(array(select b.oid::oid from b where b.oid is not null))
              then 'P0-B 대상' else 'INFO' end as verdict,
         concat_ws(' · ',
           'auth=' || has_function_privilege('authenticated', p.oid, 'execute'),
           'auth.uid=' || (p.prosrc ilike '%auth.uid()%'),
           'writes=' || (p.prosrc ~* '\m(insert\s+into|update\s+[a-z_."]+\s+set|delete\s+from)\M'),
           'config=' || coalesce(array_to_string(p.proconfig, ' '), '(없음)'),
           'returns=' || pg_get_function_result(p.oid)) as detail
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute')
),
crow as (
  select 200 as o, 'C P0-A anon 쓰기 차단(V01 기준)' as item,
         case when exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
              and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE')
                   or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs'))) then 'CHECK' else 'OK' end as verdict,
         'P0-B 는 테이블 권한을 건드리지 않음' as detail
  union all
  select 201, 'C P0-C profiles guard trigger',
         case when exists (select 1 from pg_trigger where tgrelid = to_regclass('public.profiles') and tgname = 'guard_profiles_privileged_columns_trg' and tgenabled <> 'D')
              then 'OK' else 'CHECK' end,
         'P0-B 는 profiles · sync_my_profile 을 건드리지 않음'
  union all
  select 202, 'C P0-B 이전 적용 흔적(security_backup.function_acl_p0b)',
         case when to_regclass('security_backup.function_acl_p0b') is null then 'OK(최초)' else 'INFO(테이블 있음)' end,
         case when to_regclass('security_backup.function_acl_p0b') is null then '없음' else '있음 — 회차 수는 별도 확인' end
)
select item, verdict, detail from (
  select o, item, verdict, detail from brow
  union all select o, item, verdict, detail from irow
  union all select o, item, verdict, detail from crow
) x order by o, item;
