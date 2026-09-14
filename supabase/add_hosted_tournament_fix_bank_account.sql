-- =============================================================================
-- 긴급 — 2026 TEYEON OPEN 참가비 입금 계좌번호 정정  (2026-09-14)
--
--   잘못된 계좌: 3333015235337
--   올바른 계좌: 3333256163764   (카카오뱅크 · 곽민섭)
--
--   ⚠ 이 계좌는 '대회 참가비 전용'이다.
--     클럽 월회비 계좌(lib/finance/paymentAccount.ts)와 KDK 벌금 계좌(app/kdk/page.tsx)는
--     공교롭게도 기존 값이 같은 3333015235337 이지만, 이 파일은 그 둘을 건드리지 않는다.
--     대상은 오직 public.hosted_tournaments 의 2026-teyeon-open 한 행이다.
--
--   ⚠ 계좌 값은 앱 코드에 하드코딩되어 있지 않다.
--     submit_tournament_registration RPC 가 hosted_tournaments.bank_* 를 읽어
--     applied 접수자에게만 내려주고, 완료 화면은 그 응답을 그대로 표시한다.
--     따라서 이 UPDATE 하나로 운영 화면 노출이 즉시 정정된다.
--
--   ⚠ 변경 대상은 bank_account 한 컬럼뿐이다.
--     status / 정원 / 마감시각 / 연락처 / bank_name / bank_holder 는 건드리지 않는다.
--     스키마·함수·정책·권한 변경 없음.
--
--   되돌리기: add_hosted_tournament_fix_bank_account_rollback.sql
-- =============================================================================

begin;

-- ── 0. 변경 전 값 확인 (기록용) ───────────────────────────────────────────────
select slug, bank_name, bank_account, bank_holder, status
  from public.hosted_tournaments
 where slug = '2026-teyeon-open';


-- ── 1. 계좌번호만 정정 ────────────────────────────────────────────────────────
--   잘못된 값일 때만 바꾼다(이미 정정됐거나 다른 값이면 건드리지 않는다).
update public.hosted_tournaments
   set bank_account = '3333256163764',
       updated_at   = now()
 where slug = '2026-teyeon-open'
   and bank_account = '3333015235337';


-- ── 2. 결과 확인 ──────────────────────────────────────────────────────────────
--   기대: bank_account = 3333256163764, 나머지 필드 동일, status 는 여전히 draft
select slug,
       bank_name,
       bank_account,
       bank_holder,
       status,
       (bank_account = '3333256163764') as account_fixed,
       target_capacity, max_capacity, entry_fee
  from public.hosted_tournaments
 where slug = '2026-teyeon-open';

commit;


-- =============================================================================
-- 적용 후 확인 (읽기 전용)
-- =============================================================================

-- 잘못된 계좌가 어디에도 남아 있지 않은지 — 기대: 0행
select slug, bank_account
  from public.hosted_tournaments
 where bank_account = '3333015235337';

-- 접수 데이터 무변경 확인 — 이 파일은 hosted_tournaments 한 행의 bank_account 만 바꾼다.
--   ⚠ 이미 접수가 진행 중이므로 '0건'을 기대하지 않는다. 실행 전후 값이 같기만 하면 된다.
select (select count(*) from public.hosted_tournament_registrations)                as registration_rows,
       (select count(*) from public.hosted_tournament_registration_history)         as history_rows,
       (select status from public.hosted_tournaments where slug='2026-teyeon-open') as status;


-- =============================================================================
-- ⚠ 운영 조치 필요 — 잘못된 계좌를 이미 안내받은 팀 확인
--
--   완료 화면의 입금 안내는 submit 응답(그 시점의 bank_account)을 그대로 보여줬다.
--   즉 이 SQL 적용 '이전'에 applied 로 접수된 팀은 옛 계좌(3333015235337)를 안내받았다.
--   계좌를 바꾸는 것만으로는 이미 안내된 팀에게 전달되지 않는다 — 별도 연락이 필요하다.
--
--   ⚠ 옛 계좌는 클럽 월회비·KDK 벌금 계좌와 같은 번호라, 그리로 입금됐어도 돈이 사라지진 않는다.
--     다만 대회 참가비와 회비 입금이 한 통장에 섞이므로 재무 확인이 필요하다.
-- =============================================================================

-- 안내를 이미 받았을 가능성이 있는 팀(입금 안내 대상 = applied/confirmed) — 연락 대상 목록
select sequence_no,
       registration_no,
       registration_status,
       payment_status,
       submitted_at
  from public.hosted_tournament_registrations r
  join public.hosted_tournaments t on t.id = r.tournament_id
 where t.slug = '2026-teyeon-open'
   and r.registration_status in ('applied', 'confirmed')
 order by r.sequence_no;

-- 이미 입금 완료 처리된 건이 있는지(옛 계좌로 들어왔을 수 있음)
select payment_status, count(*) as cnt
  from public.hosted_tournament_registrations r
  join public.hosted_tournaments t on t.id = r.tournament_id
 where t.slug = '2026-teyeon-open'
 group by payment_status
 order by payment_status;
