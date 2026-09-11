-- =============================================================================
-- ROLLBACK — add_hosted_tournament_player_change.sql 되돌리기
--
--   되돌리는 것:
--     1) RPC   set_tournament_registration_players()
--     2) helper hosted_tournament_mask_phone()
--     3) history.action CHECK 를 원래 4종으로 축소
--
--   ⚠ 3번은 '좁히는' 변경이라 선수 교체 이력이 이미 쌓여 있으면 실패한다.
--     그 경우 이 스크립트는 아무것도 지우지 않고 중단하며(트랜잭션 전체 롤백),
--     함수 drop 도 함께 취소된다 — 즉 이 파일만 돌려서는 기능이 꺼지지 않는다.
--     → 이력을 지우는 것은 감사 기록 삭제이므로 이 파일이 임의로 하지 않는다.
--
--     이력을 보존한 채 '신규 기능만 비활성화'하려면 아래 2줄만 따로 실행한다.
--     (함수가 사라지면 새 이력은 더 이상 생기지 않고, 확장된 action CHECK 는 그대로 남아
--      기존 이력이 계속 유효하다. Admin UI 의 '선수 정보 변경'은 RPC 없음 오류로 막힌다.)
--
--       drop function if exists public.set_tournament_registration_players(
--           uuid, text, text, text, text, text, text, text, boolean);
--       drop function if exists public.hosted_tournament_mask_phone(text);
--
--   ⚠ 데이터(hosted_tournament_registrations)는 건드리지 않는다.
--     이미 교체된 선수 정보는 되돌아가지 않는다 — 원복이 필요하면 운영 화면에서
--     다시 교체하고 사유를 남기는 것이 정상 절차다.
--
--   실행: 아래 전체를 한 번에 실행한다(BEGIN/COMMIT 포함).
-- =============================================================================

begin;

-- ── 1. RPC / helper 제거 ──────────────────────────────────────────────────────
drop function if exists public.set_tournament_registration_players(
    uuid, text, text, text, text, text, text, text, boolean);
drop function if exists public.hosted_tournament_mask_phone(text);


-- ── 2. 선수 교체 이력이 남아 있는지 확인 ──────────────────────────────────────
do $$
declare
    v_cnt bigint;
begin
    select count(*) into v_cnt
      from public.hosted_tournament_registration_history
     where action in ('player1_name', 'player1_phone', 'player2_name', 'player2_phone',
                      'club_name', 'depositor_name');
    if v_cnt > 0 then
        raise exception
            '선수 교체 이력 %건이 남아 있어 action CHECK 를 축소할 수 없습니다. '
            '이력을 보존하려면 이 rollback 을 실행하지 말고 RPC 제거까지만 적용하십시오. '
            '(RPC 가 없으면 새 이력은 더 이상 생기지 않습니다.)', v_cnt;
    end if;
end $$;


-- ── 3. action CHECK 를 원래 4종으로 ───────────────────────────────────────────
do $$
declare
    v_name text;
begin
    select con.conname into v_name
      from pg_constraint con
      join pg_class      c on c.oid = con.conrelid
      join pg_namespace  n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'hosted_tournament_registration_history'
       and con.contype = 'c'
       and con.conkey = array[(select a.attnum
                                 from pg_attribute a
                                where a.attrelid = c.oid and a.attname = 'action')];
    if v_name is not null then
        execute format('alter table public.hosted_tournament_registration_history drop constraint %I', v_name);
    end if;
end $$;

alter table public.hosted_tournament_registration_history
    add constraint hosted_tournament_registration_history_action_check
    check (action in ('submit', 'registration_status', 'payment_status', 'admin_note'));

comment on column public.hosted_tournament_registration_history.action is null;

commit;


-- ── 확인 ──────────────────────────────────────────────────────────────────────
-- 기대: 0행
select p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('set_tournament_registration_players', 'hosted_tournament_mask_phone');

-- 기대: submit, registration_status, payment_status, admin_note 4종만
select pg_get_constraintdef(con.oid) as action_check
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
 where c.relname = 'hosted_tournament_registration_history' and con.contype = 'c';
