-- =============================================================================
-- ROLLBACK — add_hosted_tournament_public_bank_info.sql 되돌리기
--   공개 RPC 에서 계좌 3개 키를 다시 제거한다.
--   ⚠ 앱은 계좌가 없으면 "완료 화면에서 확인" 안내로 폴백하므로 화면이 깨지지 않는다.
--   ⚠ 원본 정의는 add_hosted_tournament_registration_mvp.sql 의 get_public_tournament 블록이다.
--     아래 안내대로 그 블록을 다시 실행하면 된다(본문을 여기에 중복 보관하지 않는다).
-- =============================================================================

-- 1) supabase/add_hosted_tournament_registration_mvp.sql 을 열어
--    'create or replace function public.get_public_tournament(p_slug text)' 부터
--    해당 함수의 '$$;' 까지 블록을 복사해 실행한다(계좌 키가 없는 원본).
-- 2) 이어서 아래 권한 재적용 + 스키마 리로드를 실행한다.

revoke execute on function public.get_public_tournament(text) from public;
grant  execute on function public.get_public_tournament(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- 확인 — 기대: bankAccount 키 없음(null)
select public.get_public_tournament('2026-teyeon-open') -> 'bankAccount' as bank_account_should_be_null;
