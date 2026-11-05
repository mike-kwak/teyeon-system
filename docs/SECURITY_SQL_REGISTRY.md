# TEYEON 보안 SQL 등록부 (Security SQL Registry)

- 갱신: 2026-11-06(SQL 38 운영 적용 반영) · 기준 코드 `b751b8e`
- 목적: 운영 DB 에 적용된 보안 SQL 의 **적용 순서 · 의존성 · 재실행 위험 · rollback/verify 짝 · 운영 상태**를 저장소에 남긴다(ISS-016).
- 폴더
  - `supabase/security_p0/` — P0(anon 쓰기 · RPC · 역할 상승) 적용 · 확인 · 진단
  - `supabase/security_p1/` — P1 이후(점수 · Archive · KDK 관리자 · 코트 index · 등록 · Archive 공개 범위)
  - `supabase/security_testenv/` — **로컬 하네스 전용. Supabase(운영 · 테스트) 실행 절대 금지**
- 해시: 줄바꿈을 LF 로 맞춘 md5 앞 8자리. 바탕화면 사본(`TEYEON_P1_SQL` · `TEYEON_KDK_MGR_SQL`) 22개와 1:1 일치 확인.
- 민감정보 검사(이메일 · UUID · JWT · 비밀번호/키 패턴): **48개 파일 0건**. 계정 지정은 지문(UID md5 앞 12자리) 입력 방식(36).
- "운영 상태"는 사용자의 SQL Editor 보고 기준이다 — 2026-11-06: S00 `APPLIED_30_31` · 확장 4/4 · 1/1 · P1 trigger 3 · P1-b trigger 2 · 코트 index · 관리자 1명, **SQL 38 적용 · 사후 READONLY 확인 PASS**(A01~A03 CLOSED · 로그인 조회 유지 · 공개 RPC SECURITY DEFINER 정상 · anon INVOKER 의존 없음 · anon 우회 뷰 없음 · 권한 백업 3건). 저장소만으로는 운영 상태를 증명할 수 없으므로 §7 READONLY 세트로 재확인한다.

## 1. 종류 · 상태 표기

| 종류 | 의미 |
|---|---|
| APPLY | 운영 DB 를 바꾸는 적용 SQL(문장 1개 DO 블록 · 사전 검사 실패 시 STOP · 재실행 안전) |
| ROLLBACK | 짝이 되는 되돌리기(백업한 원본 정의 · 권한 복원) |
| READONLY | 조회만(언제든 실행 가능 · 이메일/UUID 출력 없음) |
| QA(rollback 전용) | 운영에서 시험 후 의도적 예외로 전체 취소 — 잔여물 없음 |
| LOCAL ONLY | 로컬 PostgreSQL 하네스 전용. 운영 실행 금지 |

## 2. 파일 목록(48개)

| 파일 | 종류 | 운영 상태 | md5(LF) |
|---|---|---|---|
| `security_p0/04_security_audit_READONLY.sql` | READONLY | 실행 가능(무변경) | b1cd9b09 |
| `security_p0/05_security_detail_READONLY.sql` | READONLY | 실행 가능(무변경) | e5802708 |
| `security_p0/07_p0_p1_summary_READONLY.sql` | READONLY | 실행 가능(무변경) | 8b3720ce |
| `security_p0/08_followup_READONLY.sql` | READONLY | 실행 가능(무변경) | 1fc4b3a9 |
| `security_p0/09_rpc_profiles_check_READONLY.sql` | READONLY | 실행 가능(무변경) | 631b8f54 |
| `security_p0/10_p0a_precheck_READONLY.sql` | READONLY | 실행 가능(무변경) | 0ddaef8e |
| `security_p0/10_p0a_revoke_anon_table_writes.sql` | APPLY | APPLIED | 6577902a |
| `security_p0/10_p0a_rollback.sql` | ROLLBACK | **운영 실행 금지**(P0 취약 상태 복귀) | 0877524d |
| `security_p0/10_p0a_verify_READONLY.sql` | READONLY | 실행 가능(무변경) | 745c70a4 |
| `security_p0/11_p0b_rollback.sql` | ROLLBACK | **운영 실행 금지**(P0 취약 상태 복귀) | 95d8aa0c |
| `security_p0/11_p0b_rpc_revoke_anon.sql` | APPLY | APPLIED | de508acf |
| `security_p0/12_p0c_backup_roles.sql` | APPLY(백업 단계) | APPLIED | e4658a89 |
| `security_p0/12_p0c_precheck_READONLY.sql` | READONLY | 실행 가능(무변경) | 27b4f084 |
| `security_p0/12_p0c_profiles_role_guard.sql` | APPLY | APPLIED | f486cc28 |
| `security_p0/12_p0c_rollback.sql` | ROLLBACK | **운영 실행 금지**(P0 취약 상태 복귀) | 70c58625 |
| `security_p0/12_p0c_verify_READONLY.sql` | READONLY | 실행 가능(무변경) | c634dff4 |
| `security_p0/13_function_body_review_READONLY.sql` | READONLY | 실행 가능(무변경) | 407fa3d5 |
| `security_p0/14_rpc_anon_probe_READONLY.sql` | READONLY | 실행 가능(무변경) | 4e266f01 |
| `security_p0/15_email_admin_check_READONLY.sql` | READONLY | 실행 가능(무변경) | 2fe7a679 |
| `security_p0/16_kdk_members_diag_READONLY.sql` | READONLY | 실행 가능(무변경) | ec80a64a |
| `security_p0/17_p0b_precheck_READONLY.sql` | READONLY | 실행 가능(무변경) | c6cfe821 |
| `security_p1/06_p1_premise_READONLY.sql` | READONLY | 실행 가능(무변경) | 95d50dac |
| `security_p1/20_p1_kdk_score_guard.sql` | APPLY | APPLIED · **재실행 금지(§5)** | ed256979 |
| `security_p1/20_p1_rollback.sql` | ROLLBACK | 미실행(필요 시) | 7edaeedf |
| `security_p1/21_p1_state_READONLY.sql` | READONLY | 실행 가능(무변경) | 57d8db22 |
| `security_p1/22_p1_qa_rollback_only.sql` | QA(rollback 전용) | 실행 가능(무변경) | f4127460 |
| `security_p1/23_p1_qa_leftover_check_READONLY.sql` | READONLY | 실행 가능(무변경) | 7e9fbf3a |
| `security_p1/24_p1b_archive_audit_READONLY.sql` | READONLY | 실행 가능(무변경) | 0bbe1809 |
| `security_p1/25_p1b_archive_guard.sql` | APPLY | APPLIED · **재실행 금지(§5)** | ab612e7c |
| `security_p1/25_p1b_rollback.sql` | ROLLBACK | 미실행(필요 시) | 101af781 |
| `security_p1/26_p1b_state_READONLY.sql` | READONLY | 실행 가능(무변경) | 54989fa9 |
| `security_p1/27_p1b_qa_rollback_only.sql` | QA(rollback 전용) | 실행 가능(무변경) | a568c807 |
| `security_p1/30_kdk_managers_court_ops.sql` | APPLY | APPLIED | 0c875737 |
| `security_p1/30_kdk_managers_rollback.sql` | ROLLBACK | 미실행(31 rollback 뒤에만) | ebf07c24 |
| `security_p1/31_kdk_official_save.sql` | APPLY | APPLIED | 0e1f3814 |
| `security_p1/31_kdk_official_save_rollback.sql` | ROLLBACK | 미실행(30 rollback 보다 먼저) | 52231711 |
| `security_p1/32_kdk_mgr_state_READONLY.sql` | READONLY | 실행 가능(무변경) | d85bed38 |
| `security_p1/33_matches_court_index_READONLY.sql` | READONLY | 실행 가능(무변경) | 20a999ff |
| `security_p1/34_matches_court_index_apply.sql` | APPLY | APPLIED | 82801b94 |
| `security_p1/34_matches_court_index_rollback.sql` | ROLLBACK | 미실행(필요 시) | 9c62e1e6 |
| `security_p1/35_kdk_manager_target_READONLY.sql` | READONLY | 실행 가능(무변경) | 7c67360b |
| `security_p1/36_kdk_manager_register.sql` | APPLY(지문 입력) | APPLIED(1명) | 041e37c1 |
| `security_p1/36_kdk_manager_register_rollback.sql` | ROLLBACK(지문 입력) | 미실행(필요 시) | a8cf4501 |
| `security_p1/37_kdk_manager_verify_READONLY.sql` | READONLY | 실행 가능(무변경) | db41eb57 |
| `security_p1/38_archive_anon_read_READONLY.sql` | READONLY | 실행 가능(무변경) · 2026-11-06 사후 확인 PASS | 2c48296a |
| `security_p1/38_archive_anon_read_revoke.sql` | APPLY | **APPLIED(2026-11-06)** · 재실행하지 않음 | c9906b03 |
| `security_p1/38_archive_anon_read_rollback.sql` | ROLLBACK | 미실행(필요 시 — 실행하면 비로그인 Archive 조회가 다시 열림) | c17f5e06 |
| `security_testenv/00_local_prodlike_state.sql` | **LOCAL ONLY(운영 실행 금지)** | — | 0361fcd2 |

## 3. 운영 적용 순서(실제)

| 순서 | 단계 | 적용 파일 | 사전 확인 | 사후 확인 · QA | rollback | 운영 |
|---|---|---|---|---|---|---|
| 1 | P0-C 역할 상승 차단 | `12_p0c_backup_roles` → `12_p0c_profiles_role_guard` | `12_p0c_precheck` | `12_p0c_verify` | `12_p0c_rollback` | APPLIED(11-04) |
| 2 | P0-A anon 쓰기 회수 | `10_p0a_revoke_anon_table_writes` | `10_p0a_precheck` | `10_p0a_verify` | `10_p0a_rollback` | APPLIED(11-04 13:18) |
| 3 | P0-B KDK RPC anon 회수 | `11_p0b_rpc_revoke_anon` | `17_p0b_precheck` | `14_rpc_anon_probe` | `11_p0b_rollback` | APPLIED(11-04) |
| 4 | P1 점수 최초/정정 분리 | `20_p1_kdk_score_guard` | `06_p1_premise` | `21` · `22` · `23` | `20_p1_rollback` | APPLIED |
| 5 | P1-b Archive 쓰기 운영진 한정 | `25_p1b_archive_guard` | `24_p1b_archive_audit` | `26` · `27` | `25_p1b_rollback` | APPLIED |
| 6 | 코트 중복 방지 index | `34_matches_court_index_apply` | `33`(I02 · I03) | `33` 재실행 | `34_…_rollback` | APPLIED |
| 7 | 회원 코트 운영 · KDK 관리자 · meta 정책 | `30_kdk_managers_court_ops` | `32`(NOT_APPLIED · F ORIGINAL) | `32`(APPLIED_30) | `30_…_rollback` | APPLIED |
| 8 | 관리자 당일 공식 저장 RPC | `31_kdk_official_save` | `32`(APPLIED_30 · P1-b trigger 2) | `32`(APPLIED_30_31) | `31_…_rollback` | APPLIED |
| 9 | 부회장 KDK 관리자 등록(1명) | `36_kdk_manager_register`(지문) | `35`(T05 READY) | `37` | `36_…_rollback`(같은 지문) | APPLIED |
| 10 | ISS-005 Archive anon 직접 조회 차단(3개 표 anon SELECT 회수만 · 데이터 무변경) | `38_archive_anon_read_revoke` | `38_…_READONLY`(A04 OK · A05 OK · A07 OK) | `38_…_READONLY`(A01~A03 CLOSED) — PASS | `38_…_rollback` | **APPLIED(2026-11-06)** |

## 4. 의존성

```
P0-C(12) ─┐
P0-A(10) ─┼─ 서로 독립
P0-B(11) ─┘
P1(20) ─────────┬─ 30 이 필요(kdk_p1_* 함수 · trigger · 함수 본문 md5 허용 목록)
P0-B(11) ───────┤  (30 은 start_kdk_match 본문 md5 를 11 과 같은 허용 목록으로 확인)
                └─ 30 ──┬─ 31(+ P1-b(25) trigger 필수)
                        └─ 36(kdk_managers · can_manage_kdk)
34(index) ──── 독립(30 보다 먼저: 회원 투입 · 관리자 직접 수정 전 최종 방어선)
38 ────────── 독립. 공개 RPC 가 SECURITY DEFINER 여야 함(A04) · anon 실행 INVOKER 함수가 대상 표를 읽으면 STOP(A05)
```

## 5. 재실행 · rollback 위험(필독)

> **⚠ `20_p1_kdk_score_guard.sql` · `25_p1b_archive_guard.sql` 원본은 다시 실행하지 않는다.** 두 파일은 `create or replace` 로 함수를 P1/P1-b 원본으로 덮어써 30 · 31 의 확장(`[KDKM]`)을 지운다.

| 실행 | 결과 | 영향 | 대응 |
|---|---|---|---|
| **20 재실행** | `kdk_p1_score_guard` · `kdk_p1_can_generate` 원본 복귀 | KDK 관리자 대진 생성 · 정정이 DB 에서 거부(화면엔 버튼이 보임). `32` → PARTIAL | 아래 "안전한 재설치 절차" |
| **25 재실행** | `p1b_archive_guard` 원본 복귀 | 관리자 당일 저장 RPC 실패(`archive: 공식 기록 쓰기는 운영진만`). `32` → PARTIAL | 〃 |
| 20 의 임시 테이블 | 백업 여부를 `_p1_first_install` 임시 테이블로 판단 | SQL Editor 가 문장을 세션별로 나누면 **42P01** 로 중단(11-05 운영에서 실제 발생) | 재설치가 필요하면 임시 테이블을 쓰지 않는 판으로 교체(함수 본문 md5 82f7e3a7 · 74e6681b 동일) — 원본은 수정하지 않음 |
| 11(P0-B) 재실행 | `start_kdk_match` 가 30 으로 확장돼 md5 허용 목록과 다름 → STOP | 없음(안전 정지) | — |
| 30 rollback 을 31 rollback 보다 먼저 | 30 rollback STOP | 없음 | 31 → 30 |
| 20 rollback(30 적용 상태) | `kdk_p1_*` 삭제 | 30 helper 는 P1 과 독립이라 투입 · 타이머 유지, 관리자 정정 분기는 사라짐 | 계획된 경우만 |
| **P0 rollback(`10` · `11` · `12` `_rollback`)** | anon 쓰기 · KDK RPC anon 실행 · 역할 변경을 되살림 | **P0 취약 상태로 회귀** | **운영 실행 금지**(보안 사고 대응으로 대체 수단이 없을 때만, 별도 승인) |
| 30 · 31 · 34 · 36 · 38 재실행 | 이미 적용된 경우 변경 없음(백업 회차 유지) | 없음 | 로컬 검증 완료 — 단, **38 은 이미 적용됐으므로 재실행하지 않는다** |
| 38 rollback | 3개 표 anon SELECT 복원 | 비로그인 Archive 원본(운영진 이메일 포함) 조회가 다시 열림(ISS-005 재발) | 장애 원인일 때만 |
| `security_testenv/00_local_prodlike_state.sql` | anon 전체 권한 · RLS 해제 등 **취약 상태 재현** | 운영에서 문장이 나뉘어 실행되면 첫 가드가 뒤 문장을 못 막음 | **운영 실행 금지**(파일 최상단 경고 추가) |

### 안전한 재설치 절차(20 · 25 를 다시 깔아야 할 때)

1. `32` 실행 → 현재 상태 기록(S00 · F 행).
2. `31_kdk_official_save_rollback` → `30_kdk_managers_rollback` (백업한 원본 정의로 복원 · 관리자 표 · 감사 기록은 보존).
3. `20_p1_rollback` / `25_p1b_rollback` → 필요한 원본 재적용(20 은 임시 테이블 없는 판 권장).
4. `32` 로 F 행 `ORIGINAL` 확인 → `30` → `31` 재적용(원본 md5 확인 후 다시 확장) → `32` 로 `APPLIED_30_31` 확인.
5. 관리자 등록(36)은 표가 보존되므로 다시 실행할 필요 없음(`37` 로 확인).

장기 전략: 다음 보안 변경부터는 "현재 최종 본문"을 한 파일에 담고 적용 전 운영 본문 md5 를 허용 목록으로 확인하는 **누적형 마이그레이션**(30 · 31 방식)으로 통일하고, 원본 파일 상단에 "재실행 금지 · 대체 파일" 안내를 두는 방식을 권장한다(이번에는 원본을 고치지 않음).

## 6. 운영 DB 와 저장소의 차이

| 구분 | 내용 | 근거 |
|---|---|---|
| 일치 | P1 · P1-b · 투입 · 타이머 함수 본문 = 저장소 원본(30 적용 전 `32` F 행 5개 ORIGINAL), 30 · 31 적용 후 = 저장소 `[KDKM]` 판(S00 APPLIED_30_31) | 사용자 보고 |
| 일치 | 바탕화면에서 실행한 사본 22개 = 저장소 파일(내용 해시) | 해시 대조 |
| 일치 | 38 적용 SQL = 저장소 `38_archive_anon_read_revoke.sql`(c9906b03 · 바탕화면 사본과 동일). 파일 머리 주석의 "[초안 · 승인 전 운영 실행 금지]" 문구는 작성 당시 표기 — **운영 실행본과 같은 내용을 유지하려고 본문을 고치지 않았다**(상태는 이 등록부가 기준) | 해시 대조 |
| 저장소에만 있음 | 진단 READONLY · QA · rollback 파일(운영에 흔적 없음) | — |
| 확인 불가 | 20 을 어느 판으로 적용했는지(원본은 분할 실행 시 42P01) — 함수 결과는 같음 | — |
| 범위 밖(별도 관리) | LIVE 중계 SQL(`supabase/add_hosted_tournament_live_match*.sql`, 운영 적용 보고 · 미추적) · SPOTLIGHT SQL(바탕화면 `TEYEON_SPOTLIGHT_SQL`, 로컬 main 미커밋 작업) | git status · 메모 |
| 재확인 필요 | 이 등록부 작성 이후의 운영 상태 | §7 READONLY 세트 |

## 7. 운영 상태 확인 기본 세트(READONLY)

1. `security_p1/32_kdk_mgr_state_READONLY.sql` — S00 `APPLIED_30_31` · F 5행 KDKM · meta 정책 OK
2. `security_p1/33_matches_court_index_READONLY.sql` — I02 OK · I03 OK
3. `security_p1/37_kdk_manager_verify_READONLY.sql` — 관리자 1명 · 앱 권한 분포
4. `security_p1/26_p1b_state_READONLY.sql` · `security_p1/21_p1_state_READONLY.sql` — P1-b · P1 · P0 Z 행
5. `security_p1/38_archive_anon_read_READONLY.sql` — **현재 기대값**: A01~A03 CLOSED · A04 OK · A05 OK · A07 OK

## 8. 38 적용(2026-11-06)으로 바뀐 기대값 — 현재 운영 기준

| 파일 | 항목 | 38 적용 전 | **현재(38 적용 후)** |
|---|---|---|---|
| `26_p1b_state_READONLY` | S 행(teyeon_archive_v1 · matches_archive · sessions_archive) | OK/INFO(anon SELECT 유지) | **CHECK**(의도된 변화) — 판정식 갱신 필요 |
| `27_p1b_qa_rollback_only` | 항목 A "비로그인 Archive 조회" | PASS | **FAIL**(의도된 변화, 나머지 통과) — 기대값 "차단"으로 갱신 필요 |
| `10_p0a_verify_READONLY` | V03 "대상 테이블 anon SELECT 유지" | OK | **CHECK**(3개 표) |
| 앱 메인 `/`(비로그인) | 통계 "KDK 횟수" | 숫자 | `—` — 기존 공개 RPC `get_public_kdk_sessions` 는 최대 30건으로 잘려 총 횟수용 재사용 불가 → 임시 허용 |

## 9. 커밋 계획(승인 후)

| 커밋 | 내용 | 배포 영향 |
|---|---|---|
| **A** `chore(security): register applied security SQL` | `supabase/security_p0/` 21 · `supabase/security_p1/` 26(06 · 20~27 · 30~38) · `supabase/security_testenv/` 1 · `docs/SECURITY_SQL_REGISTRY.md` | 없음(앱 코드 무변경) |
| **B** `fix(archive): hide confirmer identity` | `app/archive/page.tsx` — 상세 확정자 표시 `운영진 확인` · 신규 확정 `confirmed_by` = 로그인 계정 id | Archive 상세 문구 · 신규 확정 저장값 |
