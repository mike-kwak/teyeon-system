-- =============================================================================
-- ROLLBACK — add_hosted_tournament_fix_bank_account.sql 되돌리기
--
--   2026 TEYEON OPEN 참가비 계좌를 이전 값(3333015235337)으로 되돌린다.
--
--   ⚠ 이전 값은 '잘못된 계좌'로 확인된 번호다. 정말 되돌려야 하는 상황
--     (예: 새 계좌번호 자체가 오기였음)에만 실행할 것.
--   ⚠ 이미 접수가 진행된 뒤라면, 되돌리기 전에 안내받은 참가자들에게
--     어느 계좌로 입금해야 하는지 먼저 정리해야 한다.
--
--   ⚠ bank_account 한 컬럼만 되돌린다. 스키마·함수·정책·상태 변경 없음.
-- =============================================================================

begin;

update public.hosted_tournaments
   set bank_account = '3333015235337',
       updated_at   = now()
 where slug = '2026-teyeon-open'
   and bank_account = '3333256163764';

select slug, bank_name, bank_account, bank_holder, status
  from public.hosted_tournaments
 where slug = '2026-teyeon-open';

commit;
