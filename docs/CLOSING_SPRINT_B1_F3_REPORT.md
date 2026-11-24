# Closing Sprint — B1 · F3 최종 판정 기록(2026-11-24)

> 운영 조회는 모두 **사용자가 Supabase SQL Editor 에서 직접 실행**하고 결과를 전달했다. Claude Code 는 운영 DB 에 접속하지 않았다.
> 이 문서의 SQL 은 전부 조회 전용(READONLY)이며, 운영 데이터 변경 · SQL 적용은 하지 않았다.
> 개인정보 보호: 이름 · 이메일 · 전체 계정 ID 는 기록하지 않는다(id 는 앞 8자만).

## 1. 요약

| 항목 | 최종 상태 | 운영 변경 |
|---|---|---|
| B1 임원 직책 코트 복귀 | **VERIFIED — NOT REQUIRED** | 없음(B1 SQL 미적용) |
| F3 KDK 벌금 정합성 | **CORE VERIFIED — NON-BLOCKING FINANCE EXCEPTION** | 없음 |

## 2. B1 — 임원 직책 코트 복귀 권한

**설계**: `members.role` 직책 토큰(회장 · 부회장 · 총무 · 재무 · 경기 · 섭외, 같은 클럽 · 탈회/GUEST 제외)이 근거.
`profiles.role` 의 OPERATOR · FINANCE_MANAGER 는 직책에서 자동 매핑되지 않는 수동 부여 앱 역할이라 근거로 쓰지 않는다.

**운영 조회 결과(사용자 실행)**
- `B1_kdk_court_return_officers_precheck_READONLY.sql` · `B1_officer_role_mapping_READONLY.sql`
- B1 대상 운영진 6명 — ADMIN 4 · CEO 1 · MEMBER + kdk_managers 1
- 기존 복귀 권한이 없는 운영진 0명 · 계정 연결 이상 0건 · 진행 중 경기 0건 → **B1_NOT_NEEDED**

**판정**: 현재 운영진 전원이 기존 경로(CEO · ADMIN · KDK 관리자)로 코트 복귀 가능 → B1 SQL 을 적용하지 않는다.
앱 코드(`lib/kdk/courtReturnAccess.ts`, `app/kdk/page.tsx`)와 SQL 은 운영진 변경에 대비해 보존한다.
앱은 B1 함수가 없으면 임원 복귀 버튼을 숨기므로(기존 화면) 미적용 상태로 안전하다.

**재사용 시점**: 운영진이 바뀌어 "임원 직책인데 CEO · ADMIN · KDK 관리자가 아닌" 계정이 생기면

1. `B1_kdk_court_return_officers_precheck_READONLY.sql` → G 판정 `B1_NEEDED` 확인
2. (별도 승인) `B1_kdk_court_return_officers.sql` 적용 → precheck 재실행(B 구역 exists) → 임원 새로고침 안내
3. rollback: `B1_kdk_court_return_officers_rollback.sql`(함수 2개만 제거)

**로컬 검증(2026-11-24)**: 운영 동일 구성(RPC 9568938e · trigger 6 + K1 · RLS 꺼짐)에서 역할 18종 · K1 epoch 유지/증가 ·
P1 guard · 동시 복귀 · 복귀↔저장 경합 · rollback 40/40, 브라우저(임원 · 회원 · 전광판 Realtime) 20/20,
기존 PGlite 64/64 · 앱↔SQL 34/34, 매핑 조회 4/4.

## 3. F3 — KDK 벌금 정합성

### 3-1. 판정 기준(Finance 누적 벌금 현황 · V6 이미지와 동일)
- 부과: 공식 · 비테스트 · `archive_type='kdk'` Archive 의 `settlement_data` 중 `penalty_amount < 0`.
- 회원 연결: `player_id = members.id`, 아니면(게스트 제외) 정규화 이름 유일 일치.
- 회원 상태: **실제 납부 기록(취소 제외) 합계**로 계산. 저장 status 는 exempt · not_target 판정에만 쓴다.
- 게스트 상태: `kdk_guest_penalty_payments`(paid).

### 3-2. 운영 조회 결과(`F3_penalty_reconciliation_summary_READONLY.sql`)
| 항목 | 결과 |
|---|---|
| 공식 KDK 세션 · 스냅샷 누락 · 날짜 누락 | 24 · 0 · 0 |
| 회원 완납 | 131건 / 527,000원 |
| 게스트 완납 | 49건 / 205,000원 |
| 청구 대상 합계 · 미납 잔액 · 수납률 | 732,000원 · 0원 · 100% |
| 회원 면제 · 비대상 | 12건 / 48,000원 |
| 미등록 · 연결 오류(회원 · 게스트) | 0 |
| X01 금액 불일치 · X03 중복 청구 · X04 초과 납부 · X07 · X08 · X09 | 모두 0(OK) |
| V01(2026-11-18 이전 전부 수납) | OK — 사용자 확인 사항과 기록 일치 |

### 3-3. 예외 2건 · 정보성 1건
- **X05 — 정산에 없는 벌금 청구 1건 / 3,000원**(청구 8052c916 · 세션 KDK-20261110-AMJ5NESDI)
  저장 · 화면 판정 not_target, 회원 납부 취소 · 게스트 납부 이관, 감사 기록 `KDK_GUEST_MISMATCH_TRANSFER_V1`(2026-11-19 04:49 UTC).
  → `fix_kdk_guest_penalty_mismatch_20261110.sql` 의 **의도된 과거 정정 결과**. 수정 · 삭제 불필요, 감사 이력 보존.
- **X06 — 청구 미연결 회원 벌금 납부 1건 / 5,000원**(납부 b00b811d · 납부일 2026-10-01)
  해당 회원 청구 대상 10,000원 = 연결 유효 납부 10,000원(미납 0), 이 납부의 정정 감사 기록 없음.
  Finance KPI · 누적 벌금 · 공유 이미지 영향 없음(회원 "납부 기록" 목록과 누적 현황 예외 목록에만 표시).
  → 실제 중복 입금인지 별도 목적 납부인지 **재무 담당 확인 백로그**. 삭제 · 취소 · 재연결 · 금액 수정 안 함.
  경로 단서: `/finance/record` 는 월회비 외 종류를 청구 연결 없이 저장한다(`app/finance/record/page.tsx`).
- **X02 — 저장 status 불일치 131건**(저장 미납 / 실제 완납 131 · 반대 0) — 정보성.
  벌금 납부 RPC 는 납부 기록만 추가하고 청구 status 를 갱신하지 않는다. 화면은 모두 납부 기록 기준이라 표시 영향 없음. 일괄 수정하지 않는다.

### 3-4. 원칙(앞으로의 Finance 기능)
- 청구 상태는 **납부 기록(취소 제외) 합계로 계산**한다 — `lib/finance/calculatePaymentStatus.ts summarizeReceivable`.
- `finance_dues_receivables.status` 를 직접 읽어 미납 여부를 판단하지 않는다(exempt · not_target 확인만).
- 외부 내보내기(엑셀 등) · 새 RPC · 리포트도 같은 규칙을 따른다. 어기면 위 131건이 미납으로 보인다.

### 3-5. 조회 SQL 재사용(전부 READONLY · `supabase/closing_sprint/`)
| 파일 | 용도 | 검증 |
|---|---|---|
| `F3_penalty_reconciliation_summary_READONLY.sql` | 구간(A ~11-18 / B 11-19~ / C)별 건수 · 금액, X01~X10, V01 | `scripts/verify_closing_sprint_f3_summary.mts` — 앱 판정과 1563/1563 일치 |
| `F3_x05_x06_trace_READONLY.sql` | X05 · X06 대상별 원인 추적(id 앞 8자 · 메모 앞 40자) | `scripts/verify_closing_sprint_f3_trace.mjs` 38/38 |
| `F3_x05_x06_audit_READONLY.sql` | 정정 감사 · 점수 정정 기록(선택 테이블 있을 때) | 위 스크립트에 포함 |
| `F3_penalty_status_consistency_READONLY.sql`(기존) | 행 단위 상세 | `scripts/verify_closing_sprint_f3_sql.mjs` 11/11 |

정기 점검 권장: 정모 정산 후 요약 SQL 1회 — V01 · X 항목이 OK 인지 확인(B 구간 미납은 실제 미납일 수 있음).

## 4. 잔여 백로그(차단 아님)
1. **X06 5,000원** — 재무 담당이 실제 입금 목적 확인(중복 입금 → 환불/이관 결정, 별도 목적 → 메모 보완). 데이터 변경은 결정 후 별도 승인.
2. `/finance/record` 에서 벌금 종류 납부를 청구 연결 없이 저장할 수 있는 경로 — 개선 검토(이번 범위 아님).
3. X02 저장 status 동기화 여부 — 필요 시 별도 과제(월회비 제외 · 감사 기록 포함).
4. B1 — 운영진 변경 시 precheck 재실행.
5. K1 실기기 QA(휴대폰 2대 · 전광판) — 보류 중.
6. R1 후속: RLS 켜짐 · 정책 0 테이블(T03 25개) 중 화면 직접 조회 테이블 대조 — 미착수(`SECURITY_SQL_REGISTRY.md` §10).
