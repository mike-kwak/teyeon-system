-- =============================================================================
-- ROLLBACK — add_hosted_tournament_player_clubs.sql 되돌리기
--
--   ⚠⚠ 되돌리기 전에 반드시 백업하라.
--     아래 STEP 0 을 먼저 실행해 보정한 선수별 클럽 값을 눈으로 저장해 둘 것.
--     STEP 3(컬럼 DROP)을 실행하면 그 값은 복구할 수 없다.
--
--   ⚠ 앱을 먼저 되돌린 뒤 이 SQL 을 실행한다(적용의 역순).
--     앱이 아직 14인자를 보내는 상태에서 함수를 12인자로 되돌리면 접수가 실패한다.
--
--   ⚠ 되돌려도 club_name(legacy) 은 그대로다. 이 파일은 club_name 을 건드리지 않는다.
--   ⚠ registrations / history 행을 삭제하지 않는다.
-- =============================================================================

-- ── STEP 0. 백업 (읽기 전용) — 결과를 반드시 따로 보관할 것 ───────────────────
select sequence_no, registration_no,
       club_name, player1_club_name, player2_club_name
  from public.hosted_tournament_registrations r
  join public.hosted_tournaments t on t.id = r.tournament_id
 where t.slug = '2026-teyeon-open'
   and (r.player1_club_name is not null or r.player2_club_name is not null)
 order by r.sequence_no;


-- ── STEP 1~3. 되돌리기 ────────────────────────────────────────────────────────
begin;

-- 1) 함수를 이전 인자 수로 되돌린다.
--    ⚠ 이전 본문 전체가 필요하므로, 원본 마이그레이션 파일을 다시 실행하는 편이 안전하다:
--        · submit                → supabase/add_hosted_tournament_registration_mvp.sql 의 해당 함수 블록
--        · set_..._players       → supabase/add_hosted_tournament_player_change.sql 의 해당 함수 블록
--      아래 drop 만 실행하고 위 파일들의 함수 블록을 붙여 재생성한 뒤,
--      lockdown(revoke public/anon/authenticated · grant) 을 반드시 다시 적용할 것.
drop function if exists public.submit_tournament_registration(
    text, text, text, text, text, text, text, text,
    boolean, boolean, boolean, boolean, text, text);
drop function if exists public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean, text, text);

-- 2) history action CHECK 를 선수별 클럽 이전(10종)으로 축소.
--    ⚠ 보정 이력이 남아 있으면 실패한다 — 그 경우 이 rollback 전체가 취소된다(의도된 안전장치).
do $chk$
declare
    v_cnt bigint;
    v_name text;
begin
    select count(*) into v_cnt
      from public.hosted_tournament_registration_history
     where action in ('player1_club_name', 'player2_club_name');
    if v_cnt > 0 then
        raise exception
            '선수별 클럽 보정 이력 %건이 남아 있어 action CHECK 를 축소할 수 없습니다. '
            '이력을 보존하려면 CHECK 축소를 건너뛰고 함수 되돌리기까지만 적용하십시오.', v_cnt;
    end if;

    select con.conname into v_name
      from pg_constraint con
      join pg_class      c on c.oid = con.conrelid
      join pg_namespace  n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'hosted_tournament_registration_history'
       and con.contype = 'c'
       and con.conkey = array[(select a.attnum from pg_attribute a
                                where a.attrelid = c.oid and a.attname = 'action')];
    if v_name is not null then
        execute format('alter table public.hosted_tournament_registration_history drop constraint %I', v_name);
    end if;
end $chk$;

alter table public.hosted_tournament_registration_history
    add constraint hosted_treg_history_action_check
    check (action in ('submit', 'registration_status', 'payment_status', 'admin_note',
                      'player1_name', 'player1_phone', 'player2_name', 'player2_phone',
                      'club_name', 'depositor_name'));

-- 3) 컬럼 제거 — ⚠ 보정 데이터가 영구 삭제된다. STEP 0 백업을 확인한 뒤에만 실행할 것.
alter table public.hosted_tournament_registrations
    drop column if exists player1_club_name,
    drop column if exists player2_club_name;

notify pgrst, 'reload schema';

commit;


-- ── 확인 ──────────────────────────────────────────────────────────────────────
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'hosted_tournament_registrations'
   and column_name like '%club%'
 order by column_name;
-- 기대: club_name 만 남는다.
