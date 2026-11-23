-- =============================================================================
-- [K1 · RLS 결과 불일치 · 조회 대상 동일성 · Realtime 열 목록 확인 · 조회 전용]
--   SELECT 1문장 · 쓰기/DDL/SET/권한 변경 없음 · 개인정보 없음(행 내용 미조회, 건수·카탈로그만)
--   목적
--     ① S03(relrowsecurity=false) 과 G04(true) 가 같은 프로젝트 · 같은 테이블을 본 것인지 확인
--        → S03 · G04 를 실행했던 탭/프로젝트에서 이 파일을 각각 실행해 I01~I04 를 비교한다.
--     ② 지금 이 순간의 RLS 상태와 RLS 를 바꿀 수 있는 자동 장치(event trigger) 유무
--     ③ supabase_realtime 의 matches 열 목록이 "명시 지정"인지 "전체 열(지정 없음)"인지
--        (G09 의 attnames 는 지정이 없어도 현재 전체 열을 나열하므로 둘을 구분하지 못한다)
-- =============================================================================
select 'I01' k, '조회 시각 · DB · 접속 역할' item,
       now()::text || ' · ' || current_database() || ' · ' || current_user || '/' || session_user result
union all select 'I02', '서버 식별(시작 시각 · 버전)',
       pg_postmaster_start_time()::text || ' · ' || split_part(version(), ' ', 2)
union all select 'I03', 'matches 식별(oid · relfilenode · 종류 · 상속/파티션)',
       (select c.oid::text || ' · ' || c.relfilenode::text || ' · ' || c.relkind::text || ' · 부모='
               || coalesce((select string_agg(inhparent::regclass::text, ',') from pg_inherits where inhrelid = c.oid), '없음')
               || ' · 자식=' || (select count(*) from pg_inherits where inhparent = c.oid)::text
          from pg_class c where c.oid = 'public.matches'::regclass)
union all select 'I04', '이름이 matches 인 테이블(스키마별)',
       (select string_agg(n.nspname || '.' || c.relname || '(' || c.relkind::text || ',rls=' || c.relrowsecurity::text || ')', ', ' order by n.nspname)
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relname = 'matches' and c.relkind in ('r', 'p', 'v', 'm', 'f'))
union all select 'I05', '현재 RLS 활성 / 강제 / 정책 수(S03 · G04 와 같은 식)',
       (select relrowsecurity::text || ' / ' || relforcerowsecurity::text || ' / '
               || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'matches')::text
          from pg_class where oid = 'public.matches'::regclass)
union all select 'I06', 'matches 정책 상세(이름:명령:역할:허용형)',
       (select coalesce(string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '|') || ':' || permissive, ', ' order by policyname), '없음')
          from pg_policies where schemaname = 'public' and tablename = 'matches')
union all select 'I07', 'event trigger(DDL 시 자동 실행 — RLS 자동 활성 장치 여부)',
       (select coalesce(string_agg(e.evtname || ':' || e.evtevent || ':' || e.evtenabled::text || ':' || p.proname
                 || coalesce(':' || array_to_string(e.evttags, '|'), ''), ', ' order by e.evtname), '없음')
          from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid)
union all select 'I08', 'event trigger 함수 중 row level security 를 다루는 것',
       (select coalesce(string_agg(distinct p.proname, ', '), '없음')
          from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid
         where p.prosrc ilike '%row level security%' or p.prosrc ilike '%rowsecurity%')
union all select 'I09', 'RLS 우회 역할(rolbypassrls)',
       (select string_agg(rolname || '=' || rolbypassrls::text, ', ' order by rolname) from pg_roles
         where rolname in ('postgres', 'anon', 'authenticated', 'service_role', 'authenticator', 'supabase_admin', 'supabase_realtime_admin'))
union all select 'I10', 'matches 를 담은 publication: 열 목록 명시 여부 · 명시 열',
       (select coalesce(string_agg(p.pubname || '(' || case when pr.prattrs is null then '지정 없음=전체 열'
                 else '명시: ' || (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
                                    where a.attrelid = pr.prrelid and a.attnum = any (pr.prattrs::int2[])) end || ')', ', '), '없음')
          from pg_publication_rel pr join pg_publication p on p.oid = pr.prpubid
         where pr.prrelid = 'public.matches'::regclass)
union all select 'I11', 'FOR ALL TABLES publication · 이벤트(ins/upd/del)',
       (select coalesce(string_agg(pubname || ':' || puballtables::text || ':' || pubinsert::text || '/' || pubupdate::text || '/' || pubdelete::text, ', '), '없음')
          from pg_publication where pubname = 'supabase_realtime' or puballtables)
union all select 'I12', 'replica identity · 최근 쓰기 통계(건수만)',
       (select c.relreplident::text || ' · ins=' || s.n_tup_ins || ' upd=' || s.n_tup_upd || ' del=' || s.n_tup_del || ' live=' || s.n_live_tup
          from pg_class c join pg_stat_user_tables s on s.relid = c.oid where c.oid = 'public.matches'::regclass);
