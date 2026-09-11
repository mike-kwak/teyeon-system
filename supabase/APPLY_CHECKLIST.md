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
