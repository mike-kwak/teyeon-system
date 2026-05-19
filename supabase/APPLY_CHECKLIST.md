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
