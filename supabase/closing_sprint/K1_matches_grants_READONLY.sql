-- =============================================================================
-- [K1 · public.matches 권한 · 보안 구조 확인 · 조회 전용]  SELECT 1문장 · 쓰기/DDL/권한 변경 없음 · 개인정보 없음
--   목적: RLS 꺼짐 상태에서 실제 보호 수단(GRANT · trigger · RPC 권한)을 확인하고 K1 열/trigger 추가와의 충돌 여부를 판단한다.
--   저장소 기준 기대값(security_testenv/00_local_prodlike_state.sql · security_p1/20 · 30):
--     G01 anon/authenticated = SELECT·INSERT·UPDATE·DELETE 테이블 권한(RLS 없음) · authenticated TRUNCATE 회수(P1)
--     G03 열 단위 권한 0 (있으면 새 열 play_epoch 가 SELECT * 에서 빠지거나 오류 → K1 전 검토 필요)
--     G05 kdk_p1_score_guard_trg = BEFORE INSERT/UPDATE/DELETE · kdk_p1_block_truncate_trg = BEFORE TRUNCATE
--     G08 matches 쓰기 경로 함수 중 status 를 playing 으로 바꾸는 것 = start_kdk_match 만
-- =============================================================================
select 'G01' k, '테이블 권한(역할: 권한 목록)' item,
       (select string_agg(r || ': ' || coalesce((select string_agg(p, ',' order by p)
                 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                where has_table_privilege(r, 'public.matches'::regclass, p)), '없음'), ' | ' order by r)
          from unnest(array['anon','authenticated','service_role']) r
         where exists (select 1 from pg_roles where rolname = r)) result
union all select 'G02', 'GRANT 원문(relacl) · 소유자',
       (select coalesce(relacl::text, '기본값') || ' · owner=' || pg_get_userbyid(relowner) from pg_class where oid = 'public.matches'::regclass)
union all select 'G03', '열 단위 권한이 있는 열 수(attacl)',
       (select count(*)::text || coalesce(' (' || string_agg(attname, ',') || ')', '')
          from pg_attribute where attrelid = 'public.matches'::regclass and attnum > 0 and not attisdropped and attacl is not null)
union all select 'G04', 'RLS 활성 / 강제 / 정책 수',
       (select relrowsecurity::text || ' / ' || relforcerowsecurity::text || ' / '
               || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'matches')::text
          from pg_class where oid = 'public.matches'::regclass)
union all select 'G05', 'trigger(시점:이벤트:이름:함수:켜짐)',
       (select string_agg(case when t.tgtype & 2 = 2 then 'B' when t.tgtype & 64 = 64 then 'I' else 'A' end || ':'
                 || concat_ws('/', case when t.tgtype & 4 = 4 then 'INS' end, case when t.tgtype & 16 = 16 then 'UPD' end,
                                   case when t.tgtype & 8 = 8 then 'DEL' end, case when t.tgtype & 32 = 32 then 'TRUNC' end) || ':'
                 || t.tgname || ':' || p.proname || ':' || t.tgenabled::text, ', '
                 order by (t.tgtype & 2 = 2) desc, t.tgname)
          from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.matches'::regclass and not t.tgisinternal)
union all select 'G06', 'trigger 함수 DEFINER 여부 · anon/authenticated 직접 실행 가능',
       (select string_agg(distinct p.proname || '=' || case when p.prosecdef then 'DEFINER' else 'INVOKER' end
                 || '/' || has_function_privilege('anon', p.oid, 'execute')::text
                 || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text, ', ')
          from pg_trigger t join pg_proc p on p.oid = t.tgfoid
         where t.tgrelid = 'public.matches'::regclass and not t.tgisinternal)
union all select 'G07', 'KDK RPC 실행 권한(anon/authenticated)',
       (select string_agg(s || '=' || coalesce(has_function_privilege('anon', to_regprocedure(s), 'execute')::text, '없음')
                 || '/' || coalesce(has_function_privilege('authenticated', to_regprocedure(s), 'execute')::text, '없음'), ', ')
          from unnest(array['public.start_kdk_match(text,text)', 'public.start_kdk_match_timer(text,text)',
                            'public.delete_kdk_live_session(text,text)']) s
         where to_regprocedure(s) is not null)
union all select 'G08', 'matches 를 쓰고 playing 을 언급하는 public 함수(이름:DEFINER)',
       (select coalesce(string_agg(proname || ':' || prosecdef::text, ', ' order by proname), '없음')
          from pg_proc where pronamespace = 'public'::regnamespace
           and prosrc ilike '%public.matches%' and prosrc ilike '%''playing''%'
           and (prosrc ilike '%update public.matches%' or prosrc ilike '%insert into public.matches%'))
union all select 'G09', 'Realtime publication 포함 · 열 목록(null=전체 열) · replica identity',
       (select coalesce(string_agg(pubname || '(' || coalesce(array_to_string(attnames, ','), '전체') || ')', ', '), '미포함')
          from pg_publication_tables where schemaname = 'public' and tablename = 'matches')
       || ' · ' || (select relreplident::text from pg_class where oid = 'public.matches'::regclass)
union all select 'G10', '코트 중복 unique index(matches_playing_court_uniq) 존재 · 유효',
       coalesce((select i.indisvalid::text from pg_index i where i.indexrelid = to_regclass('public.matches_playing_court_uniq')), '없음')
union all select 'G11', 'K1 대상 열 이름 충돌(play_epoch 이미 존재?)',
       coalesce((select data_type || ',' || is_nullable from information_schema.columns
                  where table_schema = 'public' and table_name = 'matches' and column_name = 'play_epoch'), '없음(정상)');
