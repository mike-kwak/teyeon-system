-- =============================================================================
-- KDK 33 — matches 코트 중복 방지 index 상태 확인 — 읽기 전용(쓰기 없음 · SELECT 1문장)
--   I01  matches 의 모든 UNIQUE index · 제약(이름 · 정의)
--   I02  matches_playing_court_uniq 와 "같은 효과"의 index 가 다른 이름으로 있는가(정의 비교)
--   I03  지금 index 를 만들면 실패할 중복(같은 클럽 · 세션 · 코트에 playing 2건 이상) 그룹 수
--   I04  중복 상세(세션 · 코트 · 경기 id 앞 8자리) — I03 이 0 이면 행 없음
--   I05  playing 인데 court 또는 club_id 가 비어 있는 경기(index 보호 밖)
--   I06  matches 상태별 행 수 · 진행 중 세션 수
--   I07  start_kdk_match 운영 본문(md5) · 23505(unique_violation) 처리 여부
-- =============================================================================
with
uq as (
  select i.indexrelid::regclass::text as name, pg_get_indexdef(i.indexrelid) as def, i.indisprimary as pk, i.indisvalid as valid,
         pg_get_expr(i.indpred, i.indrelid) as pred,
         array(select a.attname::text from unnest(i.indkey) with ordinality k(n, o) join pg_attribute a
                 on a.attrelid = i.indrelid and a.attnum = k.n order by k.o) as cols
    from pg_index i
   where i.indrelid = 'public.matches'::regclass and i.indisunique
),
eq as (
  -- 같은 효과: unique · 열 = {club_id, session_id, court}(순서 무관) · 조건이 status='playing' 을 포함(court 조건은 있든 없든)
  select * from uq
   where (select array_agg(c order by c) from unnest(cols) c) = array['club_id', 'court', 'session_id']
     and pred is not null and pred ~* 'status\)?\s*=\s*''playing''' and valid
),
dup as (
  select m.club_id::text as club, m.session_id::text as sid, m.court, count(*) as n,
         string_agg(left(m.id::text, 8), ',' order by m.id::text) as ids
    from public.matches m
   where m.status::text = 'playing' and m.court is not null
   group by 1, 2, 3 having count(*) > 1
)
select 1 as o, 'I01 UNIQUE index · 제약' as item,
       'INFO' as verdict,
       coalesce((select string_agg(name || case when pk then '(PK)' else '' end || ' = ' || def, ' | ' order by pk desc, name) from uq), '(없음)') as detail
union all
select 2, 'I02 코트 중복 방지 index(이름 무관)',
       case when exists (select 1 from eq) then 'OK' else 'MISSING' end,
       coalesce((select string_agg(name || ' = ' || def, ' | ') from eq), '없음 — 34_matches_court_index_apply.sql 로 생성 필요')
union all
select 3, 'I03 현재 중복(index 생성 전 0 이어야 함)',
       case when (select count(*) from dup) = 0 then 'OK' else 'BLOCK' end,
       (select count(*) from dup)::text || '그룹 · 경기 ' || coalesce((select sum(n) from dup), 0)::text || '건'
union all
select 10 + row_number() over (order by sid, court), 'I04 중복 상세', 'BLOCK',
       '세션 ' || sid || ' · 코트 ' || court || ' · ' || n || '건 · 경기 ' || ids
  from dup
union all
select 30, 'I05 playing 인데 court/club 비어 있음',
       case when (select count(*) from public.matches where status::text = 'playing' and (court is null or club_id is null)) = 0 then 'OK' else 'CHECK' end,
       (select count(*) from public.matches where status::text = 'playing' and court is null)::text || '건(court 없음) · '
       || (select count(*) from public.matches where status::text = 'playing' and club_id is null)::text || '건(club 없음) — index 보호 밖'
union all
select 31, 'I06 matches 상태별', 'INFO',
       coalesce((select string_agg(coalesce(status::text, '(null)') || '=' || c, ' · ' order by 1)
                   from (select status, count(*) c from public.matches group by status) s), '(행 없음)')
       || ' · playing 세션 ' || (select count(distinct session_id) from public.matches where status::text = 'playing')::text || '개'
union all
select 32, 'I07 start_kdk_match 본문',
       case when to_regprocedure('public.start_kdk_match(text,text)') is null then 'CHECK' else 'INFO' end,
       coalesce((select 'md5 ' || left(md5(replace(prosrc, E'\r', '')), 8)
                        || ' · 세션 잠금=' || (prosrc like '%pg_advisory_xact_lock%')
                        || ' · 23505 처리=' || (prosrc ~* 'unique_violation')
                        || ' · [KDKM]=' || (prosrc like '%[KDKM]%')
                   from pg_proc where oid = to_regprocedure('public.start_kdk_match(text,text)')), '함수 없음')
order by 1;
