-- =============================================================================
-- SECURITY P0-A — anon(비로그인) 직접 테이블 쓰기 차단   [초안 · 사용자 승인 전 운영 실행 금지]
--
--   대상: public 스키마에서 "RLS 꺼짐 + anon 쓰기 권한(INSERT/UPDATE/DELETE/TRUNCATE)" 인 테이블.
--   조치: anon 의 INSERT·UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER 회수. SELECT(공개 조회)는 유지.
--         예외 app_logs: 비로그인 방문 기록(lib/logging.ts)이 INSERT 를 쓰므로 INSERT 유지,
--                        대신 anon SELECT 회수(user_email 등 로그 열람 차단 · 관리자 통계는 로그인 상태로 조회).
--   바꾸지 않는 것: authenticated 권한 · RLS · 정책 · 함수 · 데이터 · 컬럼 · Realtime publication.
--
--   안전장치:
--     ① 검토하지 않은 테이블이 대상에 있으면 아무것도 바꾸지 않고 STOP(raise) — 코드 사용처 확인 후 목록에 추가.
--     ② 적용 전 권한 상태를 security_backup.table_grants_p0a 에 저장(rollback 근거, anon 접근 불가 스키마).
--     ③ lock_timeout 3s — 권한 변경은 테이블 잠금이 필요. 진행 중 쓰기가 있으면 실패 후 재실행.
--
--   코드 근거(2026-11-04 조사): 아래 테이블에 대한 앱 쓰기는 모두 로그인 필요 화면(/kdk, /special, /archive,
--     /admin, /notice …)에서 브라우저 client(authenticated 세션)로 수행된다. 비로그인 공개 경로(/club, /guest,
--     /tournaments, /finance/public, /handbook 공개편)는 이 테이블에 직접 쓰지 않는다(RPC 사용). 예외는 app_logs.
--   운영 사전 점검(2026-11-04) 대상 8개: kdk_sessions · matches · matches_archive · notice_comments · notice_likes · notices ·
--     sessions_archive · teyeon_archive_v1 (모두 anon=SIUDTrRTg → 적용 후 S). app_logs · teyeon_special_sessions 는 운영에서 RLS 켜짐 → 대상 아님.
--   rollback: 10_p0a_rollback.sql
-- =============================================================================
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

create schema if not exists security_backup;
revoke all on schema security_backup from public, anon, authenticated;

create table if not exists security_backup.table_grants_p0a (
    captured_at timestamptz not null default now(),
    table_name  text not null,
    grantee     text not null,
    privilege   text not null
);
alter table security_backup.table_grants_p0a add column if not exists restored_at timestamptz;   -- rollback 에 쓰인 회차 표시
revoke all on security_backup.table_grants_p0a from public, anon, authenticated;

do $$
declare
  -- 코드 사용처를 확인한 테이블만(조사 결과에 따라 추가). anon 에 남길 권한: 기본 SELECT.
  reviewed constant text[] := array[
    'matches', 'teyeon_archive_v1', 'teyeon_special_sessions', 'kdk_sessions', 'app_logs',
    'kdk_session_meta', 'lucky_vicky_rounds', 'lucky_vicky_teams',
    'notices', 'notice_comments', 'notice_likes',
    'tournament_events', 'tournament_pairs', 'tournament_partner_requests',
    'ranking_config', 'ranking_snapshots', 'member_achievements', 'app_config'
  ];
  -- 사용자 승인으로만 추가하는 테이블(앱 코드 사용처 없음을 확인한 레거시 등). 기본 비어 있음 — 자동 확대 금지.
  --   예(승인 시): array['matches_archive']
  --   2026-11-04 사용자 승인: matches_archive(레거시 tournament_schema.sql · 앱 코드 사용 없음),
  --                          sessions_archive(레거시 · 2026-04-12 이후 앱 사용 없음 · v5 hard reset SQL 이 anon 에 GRANT ALL).
  --   anon 쓰기만 회수, 읽기 유지. 그 외 미검토 테이블은 개별 판단(STOP 유지).
  approved_extra constant text[] := array['matches_archive', 'sessions_archive'];
  v_targets text[];
  v_unreviewed text;
  t text;
begin
  select array_agg(c.relname::text order by c.relname),
         string_agg(c.relname::text, ', ' order by c.relname) filter (where c.relname <> all(reviewed || approved_extra))
    into v_targets, v_unreviewed
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
     and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
          or has_table_privilege('anon', c.oid, 'TRUNCATE')
          -- app_logs 는 INSERT 를 의도적으로 남긴다 → INSERT 만 남은 app_logs(조회 불가)는 이미 적용된 상태로 본다.
          or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs')
          or (c.relname = 'app_logs' and has_table_privilege('anon', c.oid, 'SELECT')));

  if v_unreviewed is not null then
    raise exception 'STOP P0-A: 사용처를 검토하지 않은 anon 쓰기 테이블이 있습니다: % (아무것도 변경하지 않음)', v_unreviewed;
  end if;
  if v_targets is null then
    raise notice 'P0-A: 대상 테이블 없음(이미 적용됨) — 변경 없음';
    return;
  end if;

  insert into security_backup.table_grants_p0a (table_name, grantee, privilege)
  select c.relname::text, g.r, p.p
    from pg_class c join pg_namespace n on n.oid = c.relnamespace,
         (values ('anon')) g(r),
         (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(p)
   where n.nspname = 'public' and c.relname = any(v_targets)
     and has_table_privilege(g.r, c.oid, p.p);

  foreach t in array v_targets loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t);
    if t = 'app_logs' then
      execute 'grant insert on public.app_logs to anon';          -- 비로그인 방문 기록 유지
      execute 'revoke select on public.app_logs from anon';       -- 로그(user_email) 비로그인 열람 차단
    end if;
    raise notice 'P0-A: % — anon 쓰기 회수', t;
  end loop;
end $$;

commit;

-- 결과(1행): 적용 후 남은 "RLS 꺼짐 + anon 쓰기" 테이블 — '(none)' 이어야 정상
--   (app_logs 가 대상이었다면 의도적으로 남긴 INSERT 는 제외하고 판정 · 운영 2026-11-04: app_logs 는 RLS 켜짐 → 대상 아님)
select coalesce(string_agg(c.relname || ':' || concat_ws('',
         case when has_table_privilege('anon', c.oid, 'INSERT') then 'I' end,
         case when has_table_privilege('anon', c.oid, 'UPDATE') then 'U' end,
         case when has_table_privilege('anon', c.oid, 'DELETE') then 'D' end,
         case when has_table_privilege('anon', c.oid, 'TRUNCATE') then 'Tr' end,
         case when has_table_privilege('anon', c.oid, 'REFERENCES') then 'R' end,
         case when has_table_privilege('anon', c.oid, 'TRIGGER') then 'Tg' end), ', '), '(none)') as remaining_anon_writes,
       (select count(*) from security_backup.table_grants_p0a where restored_at is null) as backed_up_grants
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
   and (has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') or has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('anon', c.oid, 'REFERENCES') or has_table_privilege('anon', c.oid, 'TRIGGER')
        or (has_table_privilege('anon', c.oid, 'INSERT') and c.relname <> 'app_logs'));
