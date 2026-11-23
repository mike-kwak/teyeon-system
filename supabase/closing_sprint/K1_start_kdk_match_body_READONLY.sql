-- =============================================================================
-- [K1 · start_kdk_match 운영 본문 확인 · 조회 전용]  SELECT 1문장 · 쓰기/DDL/설정 변경 없음 · 개인정보 없음
--   목적: 운영 md5(9568938e)의 실제 본문을 확보하고 K1 play_epoch trigger 와의 호환 여부를 판단한다.
--   저장소 기준 md5 후보(prosrc, CR 제거 후 md5 앞 8자리):
--     9568938e = 99012c3 판(조별 코트) + KDK30 권한 확장([KDKM])      ← 운영 예상값
--     9ad744bd = 2106e5b 판(23505 → court_conflict 처리) + KDK30 확장  ← 현재 저장소 · 로컬 K1 시험 기준
--     8b6c074d = 99012c3 판(KDK30 이전) · 81257f29 = 2106e5b 판(KDK30 이전)
--   R01~R12 는 판정용 요약, R13 은 함수 정의 원문(pg_get_functiondef) — 결과 셀을 복사해 공유.
-- =============================================================================
with f as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.provolatile, p.proacl,
         pg_get_userbyid(p.proowner) as owner, l.lanname,
         left(md5(replace(p.prosrc, E'\r', '')), 8) as h8,
         lower(replace(p.prosrc, E'\r', '')) as src
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = to_regprocedure('public.start_kdk_match(text,text)')
)
select 'R01' k, '함수 존재 · 개수(오버로드 포함)' item,
       (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'start_kdk_match')
       || ' / (text,text)=' || (to_regprocedure('public.start_kdk_match(text,text)') is not null)::text result
union all select 'R02', 'md5 앞 8자리 · 판별',
       coalesce((select h8 || ' → ' || case h8
                   when '9568938e' then '99012c3+KDKM(23505 처리 없음)'
                   when '9ad744bd' then '2106e5b+KDKM(저장소 최신)'
                   when '8b6c074d' then '99012c3(KDKM 없음)'
                   when '81257f29' then '2106e5b(KDKM 없음)'
                   else '저장소에 없는 본문 — R13 원문 확인 필요' end from f), '없음')
union all select 'R03', 'SECURITY DEFINER · 언어 · 휘발성',
       (select prosecdef::text || ' · ' || lanname || ' · ' || provolatile::text from f)
union all select 'R04', 'search_path 고정(proconfig)',
       (select coalesce(array_to_string(proconfig, ' | '), '없음') from f)
union all select 'R05', '소유자(DEFINER 실행 주체 = trigger 의 current_user)',
       (select owner from f)
union all select 'R06', '실행 권한(ACL)',
       (select coalesce(proacl::text, '기본값(PUBLIC 실행 가능)') from f)
union all select 'R07', 'anon · authenticated 실행 가능',
       (select has_function_privilege('anon', oid, 'execute')::text || ' · ' || has_function_privilege('authenticated', oid, 'execute')::text from f)
union all select 'R08', '권한 판정: [KDKM] 확장 · CEO/ADMIN 검사 · auth.uid()',
       (select (src like '%[kdkm]%')::text || ' · ' || (src like '%''ceo''%' and src like '%''admin''%')::text || ' · ' || (src like '%auth.uid()%')::text from f)
union all select 'R09', 'matches 쓰기 종류: UPDATE · INSERT · ON CONFLICT(upsert) · DELETE 언급 수',
       (select ((length(src) - length(replace(src, 'update public.matches', ''))) / length('update public.matches'))::text
               || ' · ' || ((length(src) - length(replace(src, 'insert into public.matches', ''))) / length('insert into public.matches'))::text
               || ' · ' || (src like '%on conflict%')::text
               || ' · ' || (src like '%delete from public.matches%')::text from f)
union all select 'R10', '상태 전이: set status=''playing'' · where status=''waiting'' · row_count 확인',
       (select (src ~ 'set\s+status\s*=\s*''playing''')::text || ' · ' || (src ~ 'status\s*=\s*''waiting''')::text
               || ' · ' || (src like '%row_count%')::text from f)
union all select 'R11', '동시성: advisory xact lock · FOR UPDATE · 23505(unique_violation) 처리',
       (select (src like '%pg_advisory_xact_lock%')::text || ' · ' || (src like '%for update%')::text
               || ' · ' || (src like '%unique_violation%' or src like '%23505%')::text from f)
union all select 'R12', 'play_epoch 직접 언급(있으면 K1 과 충돌 검토 필요)',
       (select (src like '%play_epoch%')::text from f)
union all select 'R13', '함수 정의 원문(pg_get_functiondef)',
       (select pg_get_functiondef(oid) from f);
