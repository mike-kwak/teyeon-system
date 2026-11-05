-- =============================================================================
-- KDK 34 — matches 코트 중복 방지 partial unique index   [초안 · 승인 전 운영 실행 금지]
--   rollback: 34_matches_court_index_rollback.sql   상태: 33_matches_court_index_READONLY.sql
--
--   supabase/add_matches_playing_court_unique_index.sql 의 3) 과 같은 index(이름 · 열 · 조건 동일)를
--   SQL Editor 한 번 실행으로 안전하게 만든다:
--     · 중복(같은 club_id + session_id + court 에 playing 2건 이상)이 있으면 STOP · 무변경 — 데이터는 절대 고치지 않는다.
--     · 같은 효과의 index 가 이미 있으면(이름 무관) 아무것도 하지 않는다(재실행 안전).
--     · lock_timeout 3s — 진행 중 투입/점수 저장과 겹치면 기다리지 않고 실패(재시도). 행 수가 적어 생성은 즉시 끝난다.
--   KDK 로직 · RPC · 권한 · 데이터 무변경. 문장 1개(DO 블록) · 임시 테이블 없음.
-- =============================================================================
do $kdk34$
declare
  v_dup int;
  v_eq  text;
begin
  perform set_config('lock_timeout', '3s', true);
  perform set_config('statement_timeout', '60s', true);
  if to_regclass('public.matches') is null then
    raise exception 'STOP KDK34: public.matches 없음 — 변경 없음';
  end if;

  select string_agg(i.indexrelid::regclass::text, ', ') into v_eq
    from pg_index i
   where i.indrelid = 'public.matches'::regclass and i.indisunique and i.indisvalid
     and (select array_agg(a.attname::text order by a.attname::text) from unnest(i.indkey) k(n)
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.n) = array['club_id', 'court', 'session_id']
     and pg_get_expr(i.indpred, i.indrelid) ~* 'status\)?\s*=\s*''playing''';
  if v_eq is not null then
    raise notice 'KDK34: 같은 효과의 index 가 이미 있음(%) — 변경 없음', v_eq;
    return;
  end if;
  if to_regclass('public.matches_playing_court_uniq') is not null then
    raise exception 'STOP KDK34: matches_playing_court_uniq 이름의 index 가 있으나 정의가 다르거나 무효(invalid) — 변경 없음, 33 I01 로 확인';
  end if;

  -- 중복 검사와 생성 사이에 새 중복이 생기지 않도록 먼저 테이블 쓰기를 잠근다(SHARE — 읽기는 계속 가능, 3초 안에 못 잡으면 실패).
  lock table public.matches in share mode;
  select count(*) into v_dup
    from (select 1 from public.matches m
           where m.status::text = 'playing' and m.court is not null
           group by m.club_id, m.session_id, m.court having count(*) > 1) d;
  if v_dup > 0 then
    raise exception 'STOP KDK34: 같은 코트 playing 중복 % 그룹 — index 를 만들지 않음. 33 의 I04 로 확인 후 앱에서 정리(데이터 임의 수정 금지)', v_dup;
  end if;

  create unique index matches_playing_court_uniq
    on public.matches (club_id, session_id, court)
    where status = 'playing' and court is not null;
  raise notice 'KDK34: matches_playing_court_uniq 생성';
end
$kdk34$;

select 'KDK34' as step,
       to_regclass('public.matches_playing_court_uniq') is not null as index_exists,          -- true
       (select indisvalid from pg_index where indexrelid = to_regclass('public.matches_playing_court_uniq')) as index_valid,  -- true
       (select pg_get_indexdef(to_regclass('public.matches_playing_court_uniq'))) as index_def;
