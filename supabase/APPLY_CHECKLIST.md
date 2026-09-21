# TEYEON Supabase SQL 적용 체크리스트

운영 배포 전에 Supabase SQL Editor에서 아래 순서대로 적용하고, 각 단계의 확인 항목을 체크하세요.

> 주의: SQL Editor에는 **파일 경로가 아니라 파일 내용 전체**를 붙여넣어 실행해야 합니다.

## 0. 적용 전 공통 확인

- [ ] 현재 Supabase 프로젝트가 TEYEON 운영 프로젝트인지 확인
- [ ] SQL Editor에서 실행 전 전체 내용을 한 번 읽어보기
- [ ] 한글이 깨져 보이면 UTF-8로 파일을 다시 열어 복사
- [ ] 기존 데이터 삭제 또는 DROP이 있는지 확인
- [ ] 실행 후 에러 메시지를 캡처해두기

## 1. KDK matches 보정

### 적용 파일

- [ ] `supabase/fix_matches_missing_columns.sql`

### 목적

- 수동 KDK A/B조 분리를 DB에 안정적으로 저장하기 위한 `matches.group_name` 컬럼 추가
- 세션 복원/실시간 동기화에 필요한 matches 보조 컬럼 보정

### 주요 확인 컬럼

Supabase Table Editor에서 `matches` 테이블을 열고 확인:

- [ ] `session_id`
- [ ] `session_title`
- [ ] `mode`
- [ ] `group_name`
- [ ] `player_names`

### 적용 후 기능 확인

- [ ] 새 수동 KDK 세션 생성
- [ ] A조/B조 경기가 DB `group_name`에 각각 저장되는지 확인
- [ ] PC와 실제 모바일에서 LIVE COURT A/B조가 동일하게 분리되는지 확인
- [ ] 기존 세션은 `group_name`이 비어 있을 수 있으므로 새 세션 기준으로 테스트

## 2. Archive 공식 기록 필드

### 적용 파일

- [ ] `supabase/archive_official_fields.sql`

### 목적

- Archive를 공식/비공식/테스트 기록으로 구분
- 프로필 KDK 누적 기록에서 공식 기록만 사용할 수 있게 준비

### 추가 컬럼

`teyeon_archive_v1` 테이블에서 확인:

- [ ] `is_official`
- [ ] `is_test`
- [ ] `confirmed_at`
- [ ] `confirmed_by`
- [ ] `profile_reflected`
- [ ] `archive_type`

### 적용 후 기능 확인

- [ ] `/archive`에서 공식/비공식/테스트 badge 표시 확인
- [ ] CEO/ADMIN 계정에서 공식 기록 확정/해제 버튼 확인
- [ ] 공식 필터에서 `is_official = true` 기록만 보이는지 확인
- [ ] `/profile`에서 공식 Archive만 개인 KDK 기록에 반영되는지 확인

## 3. 대회 캘린더 DB

### 적용 파일

- [ ] `supabase/tournament_calendar_schema.sql`

### 목적

- `/tournament-calendar`에서 더미 데이터 대신 DB 대회 데이터를 사용
- 대회 일정, 출전 페어, 파트너 구함, 성적 관리

### 생성/확인 테이블

- [ ] `tournament_events`
- [ ] `tournament_pairs`
- [ ] `tournament_partner_requests`

### 주요 확인 컬럼

`tournament_events`:

- [ ] `title`
- [ ] `event_date`
- [ ] `venue`
- [ ] `organizer`
- [ ] `division`
- [ ] `grade`
- [ ] `registration_start`
- [ ] `status`
- [ ] `memo`

`tournament_pairs`:

- [ ] `event_id`
- [ ] `player1_name`
- [ ] `player2_name`
- [ ] `result`
- [ ] `sort_order`

`tournament_partner_requests`:

- [ ] `event_id`
- [ ] `name`
- [ ] `memo`

### 적용 후 기능 확인

- [ ] CEO/ADMIN 계정에서 `+ 대회 등록` 버튼이 보이는지 확인
- [ ] 대회 등록/수정/삭제가 정상 동작하는지 확인
- [ ] `대회취소` 상태가 저장되고 캘린더에 표시되는지 확인
- [ ] 일반 MEMBER 계정에서는 등록/수정/삭제 버튼이 보이지 않는지 확인
- [ ] DB 데이터가 없을 때 더미 fallback 안내가 보이는지 확인

## 4. Finance DB

### 적용 파일

- [ ] `supabase/finance_schema.sql`

### 목적

- 카카오뱅크 거래 업로드/붙여넣기 기반 재무 관리
- 거래 원장, 월간 리포트, 미수금, 회원별 납부 현황 구조 준비

### 생성/확인 테이블

- [ ] `finance_transactions`
- [ ] `finance_monthly_reports`
- [ ] `finance_settings`
- [ ] `finance_receivables`
- [ ] `finance_member_payments`

### 주요 확인 컬럼

`finance_transactions`:

- [ ] `transaction_date`
- [ ] `transaction_time`
- [ ] `transaction_type`
- [ ] `amount`
- [ ] `balance_after`
- [ ] `description`
- [ ] `category`
- [ ] `suggested_category`
- [ ] `classification_status`
- [ ] `is_ambiguous`
- [ ] `source_hash`

`finance_monthly_reports`:

- [ ] `year`
- [ ] `month`
- [ ] `income_total`
- [ ] `expense_total`
- [ ] `closing_balance`
- [ ] `status`
- [ ] `income_breakdown`
- [ ] `expense_breakdown`
- [ ] `top_expenses`
- [ ] `confirmed_at`
- [ ] `confirmed_by`

`finance_receivables`:

- [ ] `player_name`
- [ ] `amount`
- [ ] `category`
- [ ] `target_month`
- [ ] `status`
- [ ] `is_public`
- [ ] `is_confirmed`

`finance_member_payments`:

- [ ] `target_month`
- [ ] `member_id`
- [ ] `member_name`
- [ ] `fee_type`
- [ ] `expected_amount`
- [ ] `paid_amount`
- [ ] `payment_status`
- [ ] `is_public`
- [ ] `is_confirmed`

### 적용 후 기능 확인

- [ ] `/finance`에서 거래내역 붙여넣기 분석
- [ ] 미리보기 생성 확인
- [ ] 거래내역 저장 확인
- [ ] 거래 원장에 저장된 거래 표시 확인
- [ ] 월간 리포트 DRAFT 생성 확인
- [ ] CONFIRMED 확정/해제 확인
- [ ] 미수금 등록/수정/납부 완료/면제 확인

## 5. Finance RLS 정책

### 적용 파일

- [ ] `supabase/finance_rls_policies.sql`

### 적용 순서

- [ ] 반드시 `supabase/finance_schema.sql` 적용 후 실행

### 목적

- 재무 원장과 DRAFT 리포트는 CEO/ADMIN만 관리
- MEMBER는 확정된 공개 정보만 조회

### 권한 범위

CEO / ADMIN:

- [ ] `finance_transactions` 전체 SELECT / INSERT / UPDATE / DELETE
- [ ] `finance_monthly_reports` 전체 SELECT / INSERT / UPDATE / DELETE
- [ ] `finance_receivables` 전체 SELECT / INSERT / UPDATE / DELETE
- [ ] `finance_member_payments` 전체 SELECT / INSERT / UPDATE / DELETE
- [ ] `finance_settings` SELECT / INSERT / UPDATE / DELETE

MEMBER:

- [ ] `finance_monthly_reports`: `status = 'CONFIRMED'`만 SELECT
- [ ] `finance_receivables`: `status = 'OPEN'`, `is_public = true`, `is_confirmed = true`만 SELECT
- [ ] `finance_member_payments`: `is_public = true`, `is_confirmed = true`만 SELECT
- [ ] `finance_settings`: SELECT 가능
- [ ] `finance_transactions`: 조회 불가

FINANCE_MANAGER:

- [ ] 현재 실제 앱 role로 확정되지 않아 SQL에서는 TODO로만 남김
- [ ] 나중에 `profiles.role`과 AuthContext가 지원하면 RLS role 목록에 추가

### RLS 적용 후 테스트

CEO/ADMIN 계정:

- [ ] 거래 저장 가능
- [ ] 거래 원장 조회 가능
- [ ] 월간 DRAFT 조회/생성 가능
- [ ] 리포트 CONFIRMED 확정/해제 가능
- [ ] 미수금 등록/수정 가능

MEMBER 계정:

- [ ] 업로드/거래 원장/확인 필요/DRAFT 탭이 보이지 않음
- [ ] CONFIRMED 월간 리포트만 보임
- [ ] 공개 확정 미수금만 보임
- [ ] 거래 원장은 직접 조회되지 않음

## 6. 주최 대회 참가신청 MVP (hosted_*)

### 적용 파일

- [ ] `supabase/add_hosted_tournament_registration_mvp.sql`

검증: `supabase/add_hosted_tournament_registration_mvp_verify.sql`
롤백: `supabase/add_hosted_tournament_registration_mvp_rollback.sql`

### 목적

- `/tournaments/2026-teyeon-open` 공개 Hub 의 접수 현황 + 비로그인 참가신청 저장
- 운영진(CEO/ADMIN) 신청 목록 / 입금·참가 상태 관리

### ⚠ 적용 전 반드시 확인

- [ ] 이 마이그레이션은 `tournament_events` / `tournament_pairs` / `tournament_partner_requests`
      (= `/tournament-calendar` 사용 테이블)를 **건드리지 않는다**. 이름이 비슷하니 혼동 금지.
- [ ] 적용해도 **접수가 열리지 않는다**. 시드 대회는 `status='draft'` 로 들어간다.

### 생성 대상

- [ ] `hosted_tournaments`
- [ ] `hosted_tournament_registrations`
- [ ] `hosted_tournament_registration_history`
- [ ] 공개 RPC: `get_public_tournament`, `get_public_tournament_teams`, `submit_tournament_registration`
- [ ] 운영 RPC: `get_admin_hosted_tournaments`, `get_admin_tournament_registrations`,
      `get_tournament_registration_history`, `set_tournament_registration_status`

### 적용 후 확인

- [ ] verify SQL 의 섹션 G(anon 테이블 권한 0행)가 **0행**인지 — 실패 시 즉시 중단
- [ ] verify SQL 의 섹션 H(RPC 실행 권한) — anon 은 공개 3종만
- [ ] verify SQL 의 섹션 L — `tournament_events` 행 수/정책 무변경
- [ ] `/tournaments/2026-teyeon-open` 이 draft 상태에서 "접수 현황 준비 중" 으로 뜨는지

### 접수를 열 때(별도 단계, 임원진 확인 후)

```sql
update public.hosted_tournaments
   set status = 'registration_open', published_at = now(), updated_at = now()
 where slug = '2026-teyeon-open';
```

- [ ] 연 뒤 `/tournaments/2026-teyeon-open` 에 실제 접수 숫자가 표시되는지
- [ ] 테스트 신청 1건 접수 후 운영 화면에서 확인 → 테스트 데이터 삭제

## 7. 주최 대회 — 운영진 선수(파트너) 교체 [P1]

### 적용 파일

- [ ] `supabase/add_hosted_tournament_player_change.sql`

검증: `supabase/add_hosted_tournament_player_change_verify.sql`
롤백: `supabase/add_hosted_tournament_player_change_rollback.sql`

### 선행 조건

- [ ] 6번(`add_hosted_tournament_registration_mvp.sql`)이 이미 적용되어 있을 것
      (적용 스크립트 첫 블록에서 자동 확인하고, 없으면 즉시 중단한다)

### 목적

부상·개인사정으로 선수가 바뀔 때 **취소 후 재신청 없이** 신원만 교체한다.
재신청 경로는 접수번호·순번이 바뀌고, 만석이면 재진입이 막히며, 입금 상태가 초기화된다.

### 변경 대상

- [ ] `hosted_tournament_registration_history.action` CHECK 확장 (4종 → 10종)
- [ ] 내부 helper `hosted_tournament_mask_phone()` (전 role EXECUTE 회수)
- [ ] 운영 RPC `set_tournament_registration_players()` (CEO/ADMIN 전용)

### ⚠ 하지 않는 것

- [ ] 테이블 **컬럼 추가 없음**
- [ ] 기존 RPC(`submit_tournament_registration`, `set_tournament_registration_status`,
      `get_admin_*`, `get_public_*`) **수정 없음**
- [ ] 정원(48/60)·순번 발급·대기(waitlist) 판정 로직 **변경 없음**
- [ ] 참가자 셀프 수정 기능 **추가하지 않음** (운영진 전용)

### 정책

| 항목 | 값 |
|---|---|
| 변경 가능 | player1/2 이름·연락처, club_name, depositor_name |
| 유지(불변) | id, sequence_no, registration_no, registration_status, payment_status, submitted_at, 동의 4종 timestamp |
| 교체 허용 신청상태 | applied / waitlisted / confirmed (cancelled·rejected 차단) |
| 교체 허용 입금상태 | pending / paid (refund_pending·refunded 차단) |
| 변경 사유 | 필수 |
| 참가자격 재확인 | Admin UI 필수 체크. `eligibility_confirmed_at` 은 **덮어쓰지 않고** 이력 note 에만 기록 |
| 이력 전화번호 | **마스킹만 저장**(`010-****-5678`). 원문은 registration row 에만 |
| 교체 횟수 | 제한 없음 (전부 이력 추적) |

### 적용 후 확인

- [ ] `add_hosted_tournament_player_change_verify.sql` 전 항목 PASS
      (특히 D 섹션 — anon 실행 불가 / mask_phone 은 anon·authenticated 모두 불가)
- [ ] `add_hosted_tournament_registration_mvp_verify_quick.sql` 재실행 → **28/28 PASS**
      (이 마이그레이션 적용 후 기대값이 갱신되어 있다: seq 16 = 9종, seq 17 = 9,
       seq 18 = 12, seq 27·28 신설)
- [ ] Admin 상세에 '선수 정보 변경' 버튼이 보이는지 (CEO/ADMIN 로그인)
- [ ] 취소·거절·환불 상태 신청에서는 '선수 정보 변경 불가' 안내만 뜨는지

### 실제 교체 1건 후 확인 (접수 오픈 이후)

- [ ] 접수번호·순번·신청상태·입금상태가 그대로인지
- [ ] 변경 이력에 사유 + `운영진 참가자격 재확인 완료` 가 남았는지
- [ ] 연락처 이력이 `010-****-0000` 형태인지 (원문 숫자 노출 0건)
- [ ] 공개 TEAMS 화면에 **바뀐 이름만** 보이고 과거 이름이 없는지

## 8. 주최 대회 — 입금 상태 전이 강제 (payment transition) [P1]

### 적용 파일

- [x] `supabase/add_hosted_tournament_payment_transitions.sql`  ← **적용 완료**

롤백: `supabase/add_hosted_tournament_payment_transitions_rollback.sql`
전체 검증: `supabase/add_hosted_tournament_payment_transitions_verify.sql`
빠른 검증: `supabase/add_hosted_tournament_payment_transitions_verify_quick.sql` (12항목)

### 선행 조건

- [x] 6번(`add_hosted_tournament_registration_mvp.sql`) 적용 완료
- [x] 기존 RPC `set_tournament_registration_status(uuid,text,text,text)` 존재
      (적용 스크립트 첫 블록에서 자동 확인하고, 없으면 즉시 중단한다)

### 목적

입금 상태를 아무 값으로나 바꿀 수 있으면 환불 절차와 접수 상태가 뒤섞인다.
서버에서 명시된 흐름만 허용해, 운영 실수와 UI 우회를 모두 막는다.

### 변경 대상

- [x] `set_tournament_registration_status()` 본문에 전이 매트릭스 추가
      (**함수 이름·시그니처 변경 없음** → verify_quick 의 함수 개수 기대값 영향 없음)
- [x] 허용되지 않은 전이는 `INVALID_PAYMENT_TRANSITION` (errcode 22023) 으로 거부

### ⚠ 하지 않는 것

- [x] 테이블 컬럼 추가 없음
- [x] history 스키마 변경 없음
- [x] `registration_status` 와 자동 연동하지 않음 (입금과 신청 상태는 끝까지 별개)
- [x] 정원(48/60)·순번 발급·대기(waitlist) 판정 로직 변경 없음

### 허용 전이 (이 5가지만 통과)

| 현재 | 이동 가능 |
|---|---|
| `pending` | `paid` |
| `paid` | `pending` · `refund_pending` |
| `refund_pending` | `paid` · `refunded` |
| `refunded` | (없음 — terminal) |

### 차단 전이 (`INVALID_PAYMENT_TRANSITION`)

- [x] `pending` → `refund_pending`
- [x] `pending` → `refunded`
- [x] `paid` → `refunded`  (반드시 `refund_pending` 을 거친다)
- [x] `refund_pending` → `pending`
- [x] `refunded` → 그 외 모든 상태

### 추가 규칙

| 항목 | 값 |
|---|---|
| `refunded` | terminal — 어떤 상태로도 이동 불가 |
| 같은 상태로 변경 | no-op. 이력을 남기지 않고 그대로 통과 |
| 차단 방식 | 서버 RPC 에서 `INVALID_PAYMENT_TRANSITION` 예외 |
| anon EXECUTE | **불가** |
| authenticated EXECUTE | 가능 (본문에서 `can_manage_tournaments()` 재검증) |
| 선수 교체 가능 입금 상태 | `pending` · `paid` 만 (7번 정책 그대로 유지) |

### 적용 후 확인

- [x] `add_hosted_tournament_payment_transitions_verify_quick.sql` → **12/12 PASS**
  - [x] RPC 존재
  - [x] `INVALID_PAYMENT_TRANSITION` 포함
  - [x] `pending → paid` 허용
  - [x] `paid → pending / refund_pending` 허용
  - [x] `refund_pending → paid / refunded` 허용
  - [x] `refunded` terminal
  - [x] same-state no-op guard
  - [x] SECURITY DEFINER
  - [x] anon EXECUTE = false
  - [x] authenticated EXECUTE = true
  - [x] history `payment_status` CHECK 유지
  - [x] 선수 교체 `pending`/`paid` 게이트 유지
- [x] Admin 상세에서 현재 입금 상태에 맞는 버튼만 노출되는지
      (`refunded` 는 버튼 없이 '종료 상태' 표기)

### Production 검증 기록

적용·검증 완료. 아래는 적용 직후 read-only 확인 결과다.

| 항목 | 값 |
|---|---|
| slug | `2026-teyeon-open` |
| status | `draft` |
| target_capacity | 48 |
| max_capacity | 60 |
| registration_rows | 0 |
| max_sequence_no | NULL |
| history_rows | 0 |

- [x] Player Change verify 23/23 PASS (7번)
- [x] Hosted Tournament MVP verify_quick 28/28 PASS (6번)
- [x] Payment Transition verify_quick 12/12 PASS (8번)

⚠ 대회는 여전히 `draft` 다. 접수 오픈은 6번의 '접수를 열 때' 절차를 별도로 진행한다.

## 9. 주최 대회 — anon 직접 제출 차단 (봇 방어 게이트) [P1]

### 적용 파일

- [ ] `supabase/add_hosted_tournament_submit_lockdown.sql`

롤백: `supabase/add_hosted_tournament_submit_lockdown_rollback.sql`
검증: `supabase/add_hosted_tournament_submit_lockdown_verify.sql` (13항목)

### 왜 필요한가

`NEXT_PUBLIC_SUPABASE_ANON_KEY` 는 **클라이언트 번들에 그대로 들어 있다**(공개값).
그래서 `anon` 에게 submit RPC EXECUTE 가 남아 있으면 폼·CAPTCHA·서버 route 를 전부 건너뛰고
PostgREST 를 직접 호출할 수 있다. 정원이 60팀뿐이라 스크립트 한 번으로 접수가 고갈된다.
**권한 회수 없이는 어떤 CAPTCHA 를 붙여도 방어가 성립하지 않는다.**

### 변경 대상

- [ ] `submit_tournament_registration` EXECUTE 를 `anon` 에서 회수
- [ ] 같은 권한을 `authenticated` 에서도 회수 (원본은 `to anon, authenticated` 였다)
- [ ] 이후 호출자는 `service_role` 뿐 — 서버 route 가 Turnstile 검증 후에만 호출

### ⚠ 하지 않는 것

- [ ] 함수 본문 변경 없음 (정원 48/60 · 대기 · 중복 · advisory lock · 동의 검증 그대로)
- [ ] 테이블/컬럼/RLS/정책 변경 없음
- [ ] 공개 조회 RPC 2종(`get_public_tournament`, `get_public_tournament_teams`)의 anon 권한 유지

### ⚠⚠ 적용 순서 (역순 금지)

1. [ ] **Vercel 환경변수 3종 등록 + 재배포** — 서버 route 가 먼저 살아 있어야 한다
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (공개)
   - `TURNSTILE_SECRET_KEY` (**서버 전용 — NEXT_PUBLIC_ 금지**)
   - `SUPABASE_SERVICE_ROLE_KEY` (**서버 전용 — NEXT_PUBLIC_ 금지**)
2. [ ] 이 SQL 적용
3. [ ] `..._submit_lockdown_verify.sql` → **13/13 PASS**
4. [ ] `..._registration_mvp_verify_quick.sql` 재실행 → **28/28 PASS**
       (이 lockdown 으로 기대값이 바뀌었다: seq 15 = anon 조회 2종, seq 16 = authenticated 8종)

SQL 을 먼저 적용하면 route/키가 없는 동안 접수 경로가 통째로 막힌다.
단, 대회가 `draft` 인 동안에는 어차피 접수가 닫혀 있어 사용자 영향은 없다.

### 적용 후 확인

- [ ] 브라우저 콘솔에서 anon key 로 submit RPC 직접 호출 → **42501 권한 오류**
      (SQL Editor 는 관리자 권한이라 여기서는 재현되지 않는다)
- [ ] `/tournaments/2026-teyeon-open/register` 에서 Turnstile 위젯이 뜨는지
- [ ] 토큰을 받기 전에는 제출 버튼이 비활성인지
- [ ] 접수 오픈 후 실제 1건 제출이 정상 처리되는지

### 서버 검증 항목 (route 에서 수행)

| 순서 | 검사 |
|---|---|
| 1 | honeypot(`company`) 이 비어 있는가 |
| 2 | Turnstile 토큰이 있는가 (2048자 이하) |
| 3 | Cloudflare siteverify 응답 `success === true` |
| 4 | `action === "tournament_register"` |
| 5 | `hostname` 이 허용 목록에 있는가 |

전부 fail-closed. 하나라도 실패하면 RPC 를 호출하지 않고 `SECURITY_CHECK_FAILED` 만 돌려준다.

## 10. 주최 대회 — Tournament 운영 기반 (Batch 1)

### 적용 파일 (이 순서대로, 파일 하나씩)

1. [ ] `supabase/add_hosted_tournament_events.sql`
2. [ ] `supabase/add_hosted_tournament_teams.sql`
3. [ ] `supabase/add_hosted_tournament_courts.sql`
4. [ ] `supabase/add_hosted_tournament_fixture.sql`

롤백: `supabase/add_hosted_tournament_batch1_rollback.sql` (4종 역순 통합 1개 파일)
검증: `supabase/add_hosted_tournament_batch1_verify.sql` (54항목)

### 왜 필요한가

접수(`hosted_tournament_registrations`)는 개인정보·입금·동의 원장이다.
경기 운영이 이 테이블을 직접 참조하면 (1) 공개 대진/경기 조회에 PII 가 새고
(2) 접수 취소·선수교체가 지난 경기 기록을 소급 변조한다.
그래서 **승격 시점 스냅샷**인 `hosted_tournament_teams` 를 따로 두고 경기 운영은 그쪽만 쓴다.

### 변경 대상

- [ ] `hosted_tournament_events` — 운영 감사 로그(append-only). ⚠ PII 미포함
- [ ] `hosted_tournament_teams` — 경기 운영용 팀 스냅샷. ⚠ 전화·입금·동의·메모 컬럼 없음
- [ ] `hosted_tournament_courts` — 코트 엔티티. LIVE 중계 코트는 대회당 1면(partial unique)
- [ ] fixture 인프라 — 48/50/51/54/57/60팀 QA 대회를 운영 대회와 격리 생성
- [ ] 신규 RPC 11종 (전부 `security definer` + `search_path` 고정 + anon/PUBLIC EXECUTE 회수)

### ⚠ 하지 않는 것

- [ ] 기존 `hosted_tournaments` / `hosted_tournament_registrations` / `_history` 스키마 변경 없음
- [ ] 기존 접수 RPC·RLS·submit lockdown 변경 없음 (신규 테이블만 추가)
- [ ] 세 신규 테이블 모두 anon 접근 미개방 — 공개 조회는 후속 Batch 의 전용 RPC 로만 연다
- [ ] `seed_no` 자동 부여 없음, 자동 조편성·자동 seeding 없음 (경기이사가 결정)

### ⚠⚠ 적용 순서 (역순 금지)

`get_admin_fixture_tournaments()` 는 `language sql` 이라 **생성 시점에 참조 테이블이 해석된다**.
teams/courts 보다 fixture 를 먼저 실행하면 `42P01 relation does not exist` 로 실패한다.

1. [ ] 위 1→2→3→4 순서로 **한 파일씩** 실행 (각각 `Success. No rows returned`)
2. [ ] `..._batch1_verify.sql` → **54/54 ALL PASS**

### 적용 후 확인

- [ ] verify 결과 `SUMMARY PASS=54 / FAIL=0` → `ALL PASS`
- [ ] `select public.hosted_tournament_fixture_guard('2026-teyeon-open');`
      → `{"ok": false, "reason": "not_a_fixture_slug"}`
- [ ] `2026-teyeon-open` 의 Team 0건 / Court 0건 유지, `registration_open` 유지

### 운영 적용 결과 (2026-09-16 완료)

- [x] verify **54 / 54 ALL PASS**
- [x] Security QA **33 / 33 PASS** (anon raw table 차단 · 신규 RPC 11종 anon 차단 · 기존 submit lockdown 유지)
- [x] fixture 6종 생성 — `fixture-open-48 / 50 / 51 / 54 / 57 / 60`, 총 **teams 320 / courts 60**
- [x] Team QA PASS — 팀번호 변경·복구, seed 설정·해제, withdrawn↔active, 중복 team_no 차단, 새로고침 후 상태 유지
- [x] Court QA PASS — LIVE 지정·이동 시 기존 자동 해제·해제, disabled↔active, 삭제·재생성, 새로고침 후 상태 유지
- [x] Events audit 정상 기록
- [x] Production `2026-teyeon-open` 보호 PASS (Team 0 / Court 0 / 접수 데이터·상태 무변경)
- [x] 기존 Registration 기능·보안 회귀 없음

### ⚠ 주의사항

- [ ] **fixture seed 는 SQL Editor 에서 실행하지 않는다.** `seed_fixture_tournament` 가
      `can_manage_tournaments()`(= `auth.uid()`)를 보므로 SQL Editor 에서는 `42501` 이 난다.
      로그인한 CEO/ADMIN 세션에서 Admin FIXTURE 패널로 실행한다.
- [ ] **production confirmed registration 승격은 접수 마감 후 명시적 승인 전까지 실행 금지.**
      `promote_confirmed_registrations` 는 멱등이지만, 승격 시점의 선수명이 스냅샷으로 고정된다.
- [ ] **rollback 은 비상용이다.** 운영 데이터(팀·코트·감사로그)가 쌓인 뒤에는 임의 실행 금지 —
      신규 테이블을 통째로 삭제한다(접수 원장은 영향 없음).

## 11. 주최 대회 — 예선 조편성 (Batch 2A)

### 적용 파일

- [ ] `supabase/add_hosted_tournament_groups.sql`

롤백: `supabase/add_hosted_tournament_batch2_rollback.sql`
검증: `supabase/add_hosted_tournament_batch2_verify.sql` (59항목)

선행: 섹션 10(Batch 1) 4종 적용 완료.

### 왜 필요한가

접수 이후 운영의 첫 단계는 예선 조편성이다.
⚠ **시스템은 조를 자동으로 짜지 않는다.** 경기이사가 모든 배치를 직접 결정하고,
시스템은 그 결과를 담고 구조가 올바른지 검사하고 잠그는 역할만 한다.
조 개수 계산·seed 분배·강팀/클럽 분산·본선 배치는 이 도메인에 없다.

### 변경 대상

- [ ] `hosted_tournament_groups` — 예선 조. `group_type`(preliminary/placement),
      `expected_size`(preliminary=3 / placement=2 를 check 로 고정)
- [ ] `hosted_tournament_group_members` — 팀↔조 배정. `slot_no`
- [ ] `hosted_tournaments` 에 컬럼 4개 추가(전부 default/nullable — 기존 행 무영향)
      `preliminary_draw_status` / `_version` / `_locked_at` / `_locked_by`
- [ ] RPC 14종 (내부 helper 3 + 공개 11)

### ⚠ 하지 않는 것

- [ ] 자동 조편성·자동 seeding 없음 (`create_tournament_groups` 는 teams 를 읽지도 않는다)
- [ ] 기존 Batch 1 / 접수 도메인 변경 없음 (신규 테이블만 추가)
- [ ] 두 테이블 모두 anon 미개방 — 공개 DRAW 는 후속 Batch 범위
- [ ] `tournament.status` 를 조편성 전제조건으로 강제하지 않음
      (접수 마감 전 준비와 fixture(draft) 작업을 막지 않기 위함)

### DB 가 보장하는 것 (RPC 가 아니라 제약으로)

- [ ] `unique (tournament_id, team_id)` — **한 팀은 대회 내 하나의 조에만** (동시 배정 경쟁의 최종 방어선)
- [ ] `unique (group_id, slot_no) DEFERRABLE` — 자리 중복 금지 + 두 팀 교환 허용
- [ ] 복합 FK 2개 — 다른 대회의 조/팀 혼입 차단
- [ ] placement partial unique — 순위결정전 조는 대회당 1개

### 적용 후 확인

- [ ] `..._batch2_verify.sql` → **59/59 ALL PASS**
- [ ] `2026-teyeon-open` 조 0개 / 배정 0건 / `preliminary_draw_status = 'draft'` 유지

### 운영 적용 결과 (2026-09-18 완료)

- [x] verify **59 / 59 ALL PASS**
- [x] 실계정 QA — 직접 수동 조편성 정상 / placement 배정 정상 /
      조편성 검증 정상(“모든 참가팀 배정 완료 · 일반 조 인원 정상 · 순위결정전 인원 정상”) /
      LOCK → unlock(사유 필수) → 수정 → re-lock 흐름 정상
- [x] Production `2026-teyeon-open` 보호 확인 (조 0 / 배정 0 / draft 유지)

### ⚠ 주의사항

- [ ] LOCKED 상태에서는 unlock 외 모든 조편성 write 가 차단된다.
- [ ] unlock 은 **사유(reason) 필수**이며 `hosted_tournament_events` 에 기록된다.
- [ ] 접수가 열려 있는 동안 lock 하면 경고(`registration_still_open`)를 반환한다.
      차단하지는 않지만 **실제 운영에서는 접수 종료 후 최종 lock** 하는 것을 원칙으로 한다.

## 12. 주최 대회 — 조편성 일괄 반영 + 조 번호 보정 (Batch 2B follow-up)

### 적용 파일

- [ ] `supabase/add_hosted_tournament_group_bulk_assignment.sql`

롤백: `supabase/add_hosted_tournament_group_bulk_assignment_rollback.sql`
검증: `supabase/add_hosted_tournament_group_bulk_assignment_verify.sql` (41항목)

선행: 섹션 11(Batch 2A) 적용 완료.

### 왜 필요한가

실제 운영에서 경기이사는 **엑셀에서 조편성을 먼저 완성**한다.
한 팀씩 클릭해 넣는 방식만으로는 60팀 입력이 비현실적이다.
⚠ 다만 이것도 조편성을 '결정'하는 기능이 아니다. 이미 완성된 결과를 빠르게 옮겨 담는 입력 도구다.

또한 Batch 2A 의 `create_tournament_groups` 가 `max(group_no)+1` 로 번호를 매겨,
17조를 지우고 조를 추가하면 18조가 생기는 문제가 실사용에서 발견됐다.

### 변경 대상

- [ ] `hosted_tournament_draw_normalize_order` 추가 (내부 helper)
      preliminary `display_order = group_no`, placement 는 항상 맨 뒤
- [ ] `create_tournament_groups` **교체** — 가장 작은 빈 조 번호를 사용
      (⚠ 이미 저장된 group_no 를 renumber 하지 않는다. 새로 만드는 번호만 바뀐다)
- [ ] `replace_preliminary_group_assignments` 추가 — 원자적 전체 교체

### ⚠⚠ 재생성 함수의 권한 재적용

`create_tournament_groups` 를 `create or replace` 하면 Supabase 의
`ALTER DEFAULT PRIVILEGES` 때문에 anon/authenticated/PUBLIC EXECUTE 가 되살아난다.
그래서 **같은 트랜잭션 안에서 revoke 를 다시 적용**한다. verify 10번이 이 지점을 검사한다.

### ⚠ 하지 않는 것

- [ ] 이미 운영 적용된 `add_hosted_tournament_groups.sql` 을 수정하지 않는다
      (변경이 필요한 함수는 이 follow-up 에서 덮어쓴다)
- [ ] 테이블·컬럼 변경 없음 (함수만 추가/교체)
- [ ] 부분 저장 없음 — 전체가 유효할 때만 반영한다

### 일괄 반영 계약

- [ ] 붙여넣기 → **미리보기 필수** → 반영 (즉시 저장하지 않는다)
- [ ] 매칭: ① `team_no` 완전 일치 ② 선수 2명 이름 완전 일치(순서 무관)
- [ ] **부분일치로 자동 확정하지 않는다.** 후보 2개 이상이면 AMBIGUOUS, 0개면 UNMATCHED
- [ ] 차단 조건(하나라도 있으면 반영 불가): 미매칭 / 애매 / 팀 중복 / 조 인원(3·2) 불일치 /
      순위결정전 2개 / 기권 팀 / 다른 대회 팀 / 알 수 없는 조 표기 / **입력에서 빠진 active 팀**
- [ ] 기존 배정이 있으면 **전체 교체 확인**을 받는다. payload 에 없는 조도 제거된다
- [ ] 서버가 클라이언트 검증을 신뢰하지 않고 동일 조건을 재검증한다

### 적용 후 확인

- [ ] `..._group_bulk_assignment_verify.sql` → **41/41 ALL PASS**
- [ ] 17조 삭제 후 “+1조 추가” → **17조**가 생기는지 (18조가 아니어야 한다)

### 운영 적용 결과 (2026-09-18 완료)

- [x] verify **41 / 41 ALL PASS**
- [x] 실계정 QA — 엑셀/붙여넣기 화면 정상 / `fixture-open-50` 데이터 붙여넣기 정상 /
      Preview 정상 / Bulk 조편성 반영 정상 / LOCK 해제 후 수정 흐름 정상
- [x] 직접 편성(수동 배정·이동·교환·빼기)은 그대로 유지되며 보정용으로 함께 사용 가능

### ⚠ Production registration promotion 미수행

- [ ] **`2026-teyeon-open` 의 confirmed 접수를 Tournament Team 으로 승격하지 않았다.**
      Batch 1·2 의 모든 QA 는 `fixture-*` 대회에서만 수행했다.
      실제 승격은 **참가접수 마감 후 별도 승인**이 있을 때만 실행한다.

## 13. 주최 대회 — 예선 경기 엔진 (Batch 3A)

### 적용 파일

- [ ] `supabase/add_hosted_tournament_matches.sql`

롤백: `supabase/add_hosted_tournament_matches_rollback.sql`
검증: `supabase/add_hosted_tournament_matches_verify.sql` (70항목)

선행: 섹션 11(Batch 2A) + 섹션 12(follow-up) 적용 완료.

### 변경 대상

- [ ] `hosted_tournament_matches` 테이블 (21컬럼 / 복합 FK 4 / unique 3 / check 8)
- [ ] `hosted_tournaments.preliminary_matches_fingerprint` 컬럼
- [ ] 내부 helper 2 — `hosted_tournament_membership_fingerprint` / `hosted_tournament_match_begin`
- [ ] 경기 RPC 8 — `generate_group_matches` / `call_match` / `uncall_match` / `start_match` /
      `complete_match` / `amend_completed_match_score` / `cancel_match` / `get_admin_match_board`
- [ ] `unlock_preliminary_draw` **교체** — 진행/완료 경기가 있으면 차단, CALLING 은 WAITING 으로 복귀

### ⚠ 경기 결과 모델

- [ ] 기권 · 노쇼에 별도 상태를 두지 않는다. **상대팀 6:0 COMPLETED** 로 입력한다
- [ ] `CANCELLED` 는 '공식 결과 없이 취소' 하나의 뜻만 갖는다(기권 용도 아님)
- [ ] 완료된 경기는 취소할 수 없다. 결과를 고치려면 `amend_completed_match_score`

### 운영 적용 결과 (2026-09-18 완료)

- [x] verify **70 / 70 ALL PASS**

## 14. 주최 대회 — 예선 순위 / 합산연령 동률 확정 (Batch 3B)

### 적용 파일

- [ ] `supabase/add_hosted_tournament_standings.sql`

롤백: `supabase/add_hosted_tournament_standings_rollback.sql`
검증: `supabase/add_hosted_tournament_standings_verify.sql` (구조·권한·정책 81항목, 100% 읽기 전용)
실동작: `supabase/verify_hosted_tournament_standings_fixture.sql` (알고리즘 60항목)

선행: 섹션 13(Batch 3A) 적용 완료.

### 왜 필요한가

예선 3팀 라운드로빈에서는 세 팀이 1승 1패로 끝나는 경우가 흔하다.
승률과 게임 득실로도 갈리지 않으면 요강상 **합산연령**으로 순위를 정하는데,
그 값은 개인정보라 저장하지 않는다. 그래서 시스템은 '동률이 남았다'는 사실만 알려주고,
운영진이 현장에서 확인한 **최종 순서**만 받아 기록한다.

### ⚠⚠ 개인정보

- [ ] DOB · 생년 · 나이 · 합산연령 값을 **저장하지 않는다.** 컬럼 자체가 없다
- [ ] 순위 RPC 는 접수 원장(`hosted_tournament_registrations`)을 참조하지 않는다
- [ ] 감사 로그에도 팀 번호만 남기고 선수명·나이를 남기지 않는다

### 변경 대상

- [ ] `hosted_tournament_group_tie_resolutions` 테이블 (12컬럼, 유효 확정 partial unique 2)
- [ ] 내부 helper — `hosted_tournament_group_results_fingerprint`
- [ ] `get_preliminary_standings` 추가 (조회 전용, STABLE, lock 없음)
- [ ] `resolve_group_age_tie` 추가
- [ ] `amend_completed_match_score` **교체** — 같은 조 동률 확정을 원자적으로 무효화

### ⚠⚠ 재생성 함수의 권한 재적용

`amend_completed_match_score` 를 `create or replace` 하면 Supabase 의
`ALTER DEFAULT PRIVILEGES` 때문에 anon/authenticated/PUBLIC EXECUTE 가 되살아난다.
그래서 **같은 트랜잭션 안에서 revoke 를 다시 적용**한다. verify 36·37 번이 이 지점을 검사한다.

### 순위 계약

- [ ] 정렬 키는 **승률 → 게임 득실 두 단계에서 끝난다.** 3차 tie-breaker 를 두지 않는다
- [ ] 갈리지 않으면 시스템이 순위를 만들어내지 않는다 → `rank = null`,
      `rankingStatus = AGE_CHECK_REQUIRED`
- [ ] 순위 스냅샷 테이블이 없다. 항상 경기 결과에서 계산한다
- [ ] `resolved_order` 는 서버가 계산한다(동률 묶음 시작 순위 + 입력 순서).
      1,2,2 → 1,2,3 / 1,1,3 → 1,2,3 / 1,1,1 → 1,2,3
- [ ] 진출 판정은 동률 묶음 전체가 진출권 안쪽이면 QUALIFIED, 밖이면 NOT_QUALIFIED,
      경계에 걸치면 PENDING. 조가 끝나지 않았으면 전부 PENDING
- [ ] `CANCELLED` 는 집계에서 완전히 제외되고, 하나라도 남으면 그 조는 FINAL 이 되지 않는다
      (`policyRequired = cancelled_matches_present`). **0:0 / 6:0 으로 자동 변환하지 않는다**
- [ ] 결과 수정(amend) 이 일어나면 그 조의 유효한 확정을 **전부** 무효화한다(행 삭제 없음)

### ⚠ 하지 않는 것

- [ ] 이미 운영 적용된 `add_hosted_tournament_matches.sql` 을 수정하지 않는다
      (교체가 필요한 `amend_completed_match_score` 는 3B 파일에서 덮어쓴다)
- [ ] `CANCELLED → WAITING` 복구 RPC 를 추가하지 않는다 (3C-2 후보)
- [ ] Admin / Public 순위 화면을 만들지 않는다 (후속 Batch)
- [ ] 본선(knockout) · bracket slot 을 만들지 않는다

### 적용 후 확인

- [ ] `add_hosted_tournament_standings_verify.sql` → **81/81 ALL PASS**
- [ ] `verify_hosted_tournament_standings_fixture.sql` → **PASS=60 FAIL=0 ALL PASS**
      ⚠ 이 스크립트는 **항상 ERROR 로 끝난다**(의도된 롤백). ERROR 본문이 결과표다

### ⚠ 검증 스크립트를 고칠 때 알아야 할 것

세 번 걸렸던 자리라 남겨 둔다.

- `pg_get_function_identity_arguments` 는 타입뿐 아니라 **인자 이름까지** 출력한다.
  그래서 타입 문자열과 비교하거나 `ilike '%order%'` 로 금지어를 찾으면
  정상 인자 `p_ordered_team_ids` 때문에 오탐한다.
  → verify 17·71 은 `pg_proc.proargnames` 를 **토큰 단위 완전일치**로 본다.
- PL/pgSQL 의 `CALL` 인자에는 **subquery 를 쓸 수 없다**(`0A000`).
  → fixture 의 60개 검사는 전부 `select ( … ) into v_ok;` 로 먼저 계산한 뒤 넘긴다.
- DECLARE 변수와 SQL table alias 이름이 겹치면, 한정 참조(`r.col`)를
  plpgsql 이 **레코드 필드로 먼저 해석**해 `55000 record not assigned` 가 난다.
  → fixture 의 DECLARE 변수는 전부 `v_` 접두로 통일한다.

### 운영 적용 결과 (2026-09-18 완료)

- [x] `add_hosted_tournament_standings.sql` 운영 적용 완료
- [x] catalog verify **81 / 81 ALL PASS**
- [x] functional fixture **PASS=60 / FAIL=0 / TOTAL=60 ALL PASS**
      (마지막 `ERROR P0001` 은 self-test 데이터 전량 롤백을 위한 의도된 예외다)
- [x] fixture 는 임시 대회(`zz-fixture-standings-selftest`)에서만 돌고 전량 롤백됐다.
      운영 데이터 무변경
- [x] verify 100~105 로 `2026-teyeon-open` 무영향 확인 —
      경기 0건 / 동률 확정 0건 / 조편성 draft / status registration_open /
      승격된 접수 0건 / self-test 잔재 0건

### ⚠ Production registration promotion 미수행

- [ ] **`2026-teyeon-open` 의 confirmed 접수를 Tournament Team 으로 승격하지 않았다.**
      Batch 3 의 모든 검증은 fixture 와 self-test 대회에서만 수행했다.
      실제 승격은 **참가접수 마감 후 별도 승인**이 있을 때만 실행한다.

## 15. 주최 대회 — 취소 경기 복구 (Batch 3C-2)

### 적용 파일

- [ ] `supabase/add_hosted_tournament_match_cancel_restore.sql`

롤백: `supabase/add_hosted_tournament_match_cancel_restore_rollback.sql`
검증: `supabase/add_hosted_tournament_match_cancel_restore_verify.sql` (구조·권한 45항목, 100% 읽기 전용)
실동작: `supabase/verify_hosted_tournament_match_cancel_restore_fixture.sql` (상태 전이 28항목)

선행: 섹션 13(Batch 3A) + 섹션 14(Batch 3B) 적용 완료.

### 왜 필요한가

운영진이 실수로 취소했거나 재경기를 해야 할 때 CANCELLED 경기를 되살릴 경로가 없었다.
3A 는 '조용한 되돌리기'를 막기 위해 의도적으로 넣지 않았고 3B 에서도 미뤘다.
여기서 **CANCELLED → WAITING 하나만** 연다.

### 변경 대상

- [ ] `restore_cancelled_match(uuid, text, integer)` 추가 — **함수 1개뿐**
- [ ] 테이블 · 컬럼 · 인덱스 · RLS · 기존 RPC 변경 **없음**

### 상태 전이 계약

- [ ] 허용되는 전이는 `CANCELLED → WAITING` **하나뿐**이다.
      WAITING · CALLING · PLAYING · COMPLETED 는 `match_not_cancelled` 로 거부한다
- [ ] 완료된 경기의 결과를 고치는 경로는 여전히 `amend_completed_match_score` 뿐이다
- [ ] 기권 · 노쇼는 이 기능의 대상이 아니다. 처음부터 상대팀 **6:0 COMPLETED**
- [ ] 복구하면 코트 · 호명/시작/완료 시각 · 점수 · 승자를 **전부 비운다**
- [ ] `version + 1`, `cancelled_at = null`, 사유 필수(2자 이상), audit `match_cancel_restored`
- [ ] 권한 · advisory lock · version 대조는 `hosted_tournament_match_begin` 한 곳에서 처리한다
      (락 네임스페이스가 `hosted-tournament-matches:` 하나로 유지된다)

### 복구와 순위의 관계

- [ ] 복구로 CANCELLED 가 사라지면 그 조의 `policyRequired` 도 사라진다
- [ ] 다만 경기가 아직 안 끝났으므로 `rankingStatus` 는 **PROVISIONAL 로 남는다**
- [ ] 이것은 3B `get_preliminary_standings` 가 매번 다시 계산한 결과지,
      복구 RPC 가 따로 보정하는 값이 **아니다**

### ⚠ 하지 않는 것

- [ ] 이미 운영 적용된 `add_hosted_tournament_matches.sql` 을 수정하지 않는다
- [ ] Public 순위 화면을 만들지 않는다
- [ ] 본선(knockout) · bracket · Realtime · Arena · 알림 발송을 만들지 않는다

### 적용 후 확인

- [ ] `..._match_cancel_restore_verify.sql` → **45/45 ALL PASS**
- [ ] `verify_hosted_tournament_match_cancel_restore_fixture.sql` → **PASS=28 FAIL=0 ALL PASS**
      ⚠ 이 스크립트도 **항상 ERROR 로 끝난다**(의도된 롤백). ERROR 본문이 결과표다

### 운영 적용 결과 (2026-09-21 완료)

- [x] `add_hosted_tournament_match_cancel_restore.sql` 운영 적용 완료
- [x] catalog verify **45 / 45 ALL PASS**
- [x] functional fixture **PASS=28 / FAIL=0 / TOTAL=28 ALL PASS**
      (마지막 `ERROR` 는 self-test 데이터 전량 롤백을 위한 의도된 예외다)
- [x] fixture 는 임시 대회(`zz-fixture-restore-selftest`)에서만 돌고 전량 롤백됐다.
      운영 데이터 무변경
- [x] Admin UI QA — 320 / 360 / 390 / 430 / 768 폭에서 **135 / 135 PASS · BLOCKER 0**
      (가로 overflow · 텍스트 잘림 · 배지 겹침 · 다이얼로그 수납 · ↑↓ 버튼 ·
       토스트 BottomNav 침범 · 마지막 콘텐츠 접근성)
- [x] Production `2026-teyeon-open` 데이터 무변경 — QA 중 경기 생성 · 점수 입력 ·
      취소 · 복구 · 순위 확정 · 팀 승격 · 조편성 변경 **0건**

### 함께 확인된 선행 배치 (2026-09-21)

- [x] Batch 3B catalog verify **81 / 81 ALL PASS**
- [x] Batch 3B functional fixture **60 / 60 ALL PASS**

## 16. 공개 예선 DRAW — 공개 계약 + 순위 계산 코어 분리 (Batch 3D)

> 2026-09-22 운영 DB 적용 · 검증 완료(아래 "운영 적용 결과"). **DRAW 는 아직 어떤 대회도 공개하지 않았다.**
> 공개 계약 · 코어 분리 · unlock 자동 비공개 · 3B verify 재지정은 2026-09-21 승인.
> 공개 순위 숫자는 서버 `gameDiff`(득실)만 쓴다 — 승점(points) 개념 없음.

### 적용 파일

- [x] `supabase/add_hosted_tournament_public_draw.sql`

롤백: `supabase/add_hosted_tournament_public_draw_rollback.sql`
(get_preliminary_standings · unlock_preliminary_draw 를 **기존 적용 본문 그대로** 복원 → 새 함수 5개 삭제 → 컬럼 삭제)

선행: 섹션 13(3A) · 14(3B) · 15(3C-2) 적용 완료.

### 무엇이 바뀌나

- [x] `hosted_tournaments.preliminary_draw_published_at timestamptz null` 추가 — NULL = 비공개
      ⚠ `preliminary_draw_status = locked`(운영 잠금)와 **다른 개념**. LOCK 이 자동 공개가 아니다
- [x] 순위 계산 코어 분리 — `hosted_tournament_preliminary_standings_core(uuid)`
      3B `get_preliminary_standings` 계산식을 **글자 그대로** 옮김(생성 스크립트로 원문 대조, 11,564자 일치).
      `get_preliminary_standings` 는 권한 확인 + 코어 호출 래퍼(반환 모양 동일)
- [x] `publish_preliminary_draw(slug, expected_version)` — locked 에서만 · 조편성 재검증 · version +1 · audit
- [x] `unpublish_preliminary_draw(slug, reason, expected_version)` — 사유 필수 · version +1 · audit
- [x] `unlock_preliminary_draw` 재생성 — 공개 중이면 **같은 트랜잭션에서 자동 비공개** + audit(`cause = draw_unlocked`).
      가산적 변경만(3A/Batch2 verify 가 보는 문자열 유지). 자동 재공개 없음
- [x] `get_admin_preliminary_draw_publication(slug)` — 운영 화면 공개 상태 조회
- [x] `get_public_preliminary_draw(slug)` — anon 실행 가능. 대회 공개 · 조편성 locked · 공개 시각 **셋 다** 만족할 때만 반환.
      uuid · 결과 지문 · 동률 상세 · 확정 사유 · 버전 · 접수 개인정보 · 나이 계열 미반환
- [x] 원본 테이블 권한 / RLS **변경 없음**

### 3B 카탈로그 verify 재실행 방법

- 원본 `add_hosted_tournament_standings_verify.sql` 의 13개 항목(50 · 52 · 54~64)은
  `get_preliminary_standings` **본문 문자열**을 검사한다. 코어 분리 후 원본 그대로 실행하면
  이 13개가 **의도적으로 FAIL** 한다(계산식이 코어로 옮겨졌으므로).
- 대응(2026-09-21 승인): `add_hosted_tournament_standings_verify_core.sql` — 같은 항목 번호 · 이름 · 기대값으로
  검사 대상만 코어로 재지정(14 · 41 · 81 은 래퍼와 코어 **둘 다** 검사 — 약화 없음)
  + 코어 구조 검사 93~97 + **98: 코어 계산 SQL 토큰이 3B 원문과 동일(주석/공백/줄바꿈 제외)**. 총 87항목.
  98 은 주석 제거 + 공백 정규화 후 토큰 문자열 md5(`b225df53…`)를 비교한다 — 줄바꿈 · 들여쓰기 ·
  주석 차이는 무시하고, 키워드 · 식별자 · 연산자 · 리터럴 · 식 · ORDER BY 가 한 글자라도 바뀌면 FAIL.
  (처음의 raw byte md5 방식은 SQL Editor 가 LF → CRLF 로 저장해 FAIL 했다 — 아래 운영 적용 결과 참고.)
- 3B 기능 fixture `verify_hosted_tournament_standings_fixture.sql` 은 **수정 없이** 재실행한다(60/60 기대).

### 적용 후 확인 (순서)

- [x] `add_hosted_tournament_public_draw_verify.sql` → 44 / 44 ALL PASS
- [x] `add_hosted_tournament_standings_verify_core.sql` → 87 / 87 ALL PASS (3B 81항목 재지정 + 코어 구조 5 + 토큰 동일성 1)
- [x] `verify_hosted_tournament_standings_fixture.sql` → PASS=60 FAIL=0 (3B 회귀 없음 · 원본 파일 수정 없음)
- [x] `verify_hosted_tournament_public_draw_fixture.sql` → PASS=46 FAIL=0 (항상 ERROR 로 끝남 — 의도된 롤백)
- [ ] 3A · 3C-2 catalog verify 재실행 → 기존 결과 유지
- [ ] 위가 모두 PASS 한 뒤에만 배포 환경 변수 `NEXT_PUBLIC_PUBLIC_DRAW_ENABLED=1` 로 화면 기능을 켠다
      (꺼져 있으면 새 RPC 를 호출하지 않는다 — 공개 DRAW 는 '준비 중', Admin 공개 패널 없음)

### 운영 적용 결과 (2026-09-22)

- [x] migration 적용 성공
- [x] catalog verify **44 / 44 ALL PASS**
- [x] 3B core verify **87 / 87 ALL PASS**
      첫 실행은 86/87(98 단독 FAIL). 읽기 전용 `diagnose_standings_core_md5.sql` 로 진단한 결과
      저장된 코어가 **CRLF 줄바꿈만** 다르고(CR 제거 후 md5 = 원문 `5dc86cfc…`), 토큰 md5 는 원문과 동일(`b225df53…`) —
      계산식 차이 없음. 코어 재배포 · migration 재실행 없이 98 만 토큰 비교로 바꿔 재실행했다.
- [x] 3B functional fixture **PASS=60 / FAIL=0** (원본 수정 없이 재실행 — 코어 분리 전후 계산 결과 동일)
- [x] public DRAW functional fixture **PASS=46 / FAIL=0**
      첫 실행은 1번 검사 전에 `0A000 cannot use subquery in CALL argument` 로 중단(fixture 문법 문제 ·
      단일 DO 블록이라 전량 롤백). 46개 검사를 번호 · 이름 · 식 그대로 v_ok 대입 후 CALL 하도록 고쳐 재실행했다.
- [x] self-test 데이터는 전부 롤백 — 운영 대회 데이터 변경 없음
- [ ] 2026-teyeon-open DRAW 공개(`publish_preliminary_draw`) — **하지 않음**
- [ ] 배포 환경 변수 `NEXT_PUBLIC_PUBLIC_DRAW_ENABLED=1` — **아직 켜지 않음**

### ⚠ 하지 않는 것

- [ ] 본선(knockout) · bracket · Realtime · Arena · 알림
- [ ] 2026-teyeon-open 공개 · 조편성 · 경기 · 점수 · 동률 · 순위결정전 상태 변경

## 흔한 실패 원인

- [ ] SQL Editor에 파일 경로만 붙여넣음
- [ ] SQL 파일 일부만 복사함
- [ ] schema SQL을 적용하지 않고 RLS SQL부터 실행함
- [ ] 한글 카테고리 값이 깨진 상태로 SQL을 실행함
- [ ] `profiles.id`와 `auth.uid()`가 일치하지 않아 관리자 RLS가 막힘
- [ ] `profiles.role`이 `CEO` 또는 `ADMIN`이 아님
- [ ] `matches.group_name`이 없어 모바일에서 A/B조가 전부 A조 fallback으로 보임
- [ ] Archive 공식 필드가 없어 `/archive` 공식 확정 버튼이 실패함
- [ ] Finance 테이블은 있는데 RLS를 적용하지 않아 MEMBER 공개 범위가 불명확함
- [ ] Finance RLS는 적용했지만 `finance_member_payments` 정책이 빠져 납부 현황 조회가 막힘

## 운영 전 최종 체크리스트

KDK:

- [ ] 새 수동 KDK 생성
- [ ] DB `matches.group_name` 저장 확인
- [ ] 모바일 LIVE COURT A/B 분리 확인
- [ ] 점수 입력/완료/랭킹 반영 확인
- [ ] Archive 저장 확인

Archive/Profile:

- [ ] Archive 공식 기록 확정
- [ ] 공식 필터 확인
- [ ] `/profile`에서 공식 KDK 기록 반영 확인

Tournament Calendar:

- [ ] DB 대회 등록
- [ ] 대회 수정
- [ ] 대회취소 상태 확인
- [ ] MEMBER 등록/수정 버튼 숨김 확인

Finance:

- [ ] 거래 붙여넣기 분석
- [ ] 거래 저장
- [ ] 거래 원장 조회
- [ ] 월간 DRAFT 생성
- [ ] CONFIRMED 확정
- [ ] MEMBER 공개 리포트 확인
- [ ] 미수금 공개 조건 확인

권한:

- [ ] CEO 계정 테스트
- [ ] ADMIN 계정 테스트
- [ ] MEMBER 계정 테스트

배포 전:

- [ ] `npx.cmd tsc --noEmit`
- [ ] `npm.cmd run build`
- [ ] 실제 모바일에서 `/kdk`, `/archive`, `/finance`, `/tournament-calendar` 하단 가림 확인
