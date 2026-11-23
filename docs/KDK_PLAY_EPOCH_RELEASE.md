# KDK play_epoch (K1) — 배포 순서 · 롤백 절차

- 상태: **운영 DB 적용 완료(2026-11-24) · 화면 배포 대상** — 적용 기록은 §8
- 기준: Production `afa598e`(P1 점수 충돌 방지) 위에 쌓는 변경
- 목적: 복귀 → 재투입 뒤, 복귀 전에 열어 둔 점수 창의 저장이 새 투입 주기의 결과로 들어가는 것을 막는다.

## 1. 구성

| 구분 | 파일 | 내용 |
|---|---|---|
| 적용 SQL | `supabase/closing_sprint/K1_kdk_play_epoch.sql` | `matches.play_epoch` 열 + BEFORE INSERT/UPDATE trigger `kdk_play_epoch_trg` |
| 롤백 SQL | `supabase/closing_sprint/K1_kdk_play_epoch_rollback.sql` | trigger · 함수 · 열 제거 |
| 사전 점검 | `supabase/closing_sprint/K1_kdk_play_epoch_precheck_READONLY.sql` | 조회 전용 P01~P07 |
| 사후 확인 | `supabase/closing_sprint/K1_kdk_play_epoch_verify_READONLY.sql` | 조회 전용 V01~V08 |
| 화면 | `app/kdk/page.tsx`, `lib/tournament_types.ts` | 점수 창을 열 때 `play_epoch` 기억 → 저장 조건에 추가 |
| 시험 | `scripts/verify_kdk_play_epoch_concurrency.mjs` | 빈 로컬 테스트 DB 전용 실DB 동시성 시험 |

## 2. 증가 규칙

- `play_epoch integer NOT NULL DEFAULT 0` — 기존 행은 0, NULL 없음.
- status 가 playing 이 아닌 값 → playing 으로 바뀌는 UPDATE 마다 +1(최초 투입 0→1, 복귀 후 재투입 1→2).
  `start_kdk_match` RPC · 직접 UPDATE · upsert 모두 같은 trigger.
- 점수 저장 · 정정 · 타이머 · 완료 · 복귀 · 되돌리기 · 기타 수정: 유지.
- INSERT: playing 이면 1, 아니면 0.
- 직접 API(anon/authenticated)가 값을 바꾸거나 지정하면 42501. 소유자 · DEFINER 경로는 규칙값으로 덮어쓴다.
- K1 적용 시점에 진행 중이던 경기는 0 으로 남는다(데이터 UPDATE 없음). 그 경기를 복귀 후 재투입하면 1.

## 3. 화면 결합(P1 + K1)

점수 창을 열 때 `status · score1 · score2 · play_epoch` 를 기억하고 하나의 조건부 UPDATE 로 저장한다.

- 최초 저장: `status = 'playing'` + (`play_epoch = 연 시점 값`)
- 완료 경기 정정: `status = 'complete'` + `score1/score2 = 연 시점 값` + (`play_epoch = 연 시점 값`)
- 0행 → 저장하지 않음 · 점수 창 닫기 · 임시 점수 삭제 · 최신 상태 재조회 · "다른 운영자가 먼저 경기 결과를 변경했습니다" 안내.
- 행에 `play_epoch` 가 없으면(K1 미적용) 조건을 생략 → P1 동작 그대로.
- `play_epoch` 열 없음 오류(K1 롤백 직후 열려 있던 창) → epoch 조건만 빼고 1회 재시도(P1 조건 유지).

## 4. 혼합 버전

| 화면 \ DB | K1 미적용 | K1 적용 |
|---|---|---|
| afa598e(현재 운영) | 현재와 동일 | 정상 동작 · **epoch 보호 없음**(이 화면의 이전 창 저장은 여전히 반영) |
| K1 화면 | 정상 동작 · P1 보호만 | 전체 보호 |

→ 어느 순서로 배포해도 오류는 없다. 보호가 완전해지는 시점은 "K1 SQL + K1 화면 + 운영진 새로고침"이 모두 끝난 뒤.

## 5. 배포 순서(승인 후)

1. **경기 없는 시간**에 진행(정모 · 진행 중 세션 없음).
2. 사전 점검: `K1_..._precheck_READONLY.sql` — P01 OK · P02 ABSENT · P03 OK(0) · P05 0 · P07 0 확인. STOP 이 있으면 중단.
3. SQL 적용: `K1_kdk_play_epoch.sql`. 마지막 SELECT 가 `column_ok=true · trigger_on=true · null_rows=0`.
   - `lock_timeout`(55P03)으로 실패하면 아무것도 바뀌지 않은 것 — 잠시 후 다시 실행.
4. 사후 확인: `K1_..._verify_READONLY.sql` — V01~V07 OK.
5. 화면 배포(main fast-forward → Vercel Production 확인).
6. 운영진 KDK 화면 새로고침 안내.
7. 승인된 테스트 환경에서 휴대폰 2대 QA: 점수 창 열기 → 다른 기기에서 복귀 · 재투입 → 이전 창 저장이 안내와 함께 차단되는지.

## 6. 롤백

- 화면만 이상: Vercel 이전 배포(afa598e)로 되돌림. K1 SQL 은 그대로 둬도 된다(옛 화면은 열을 쓰지 않음).
- SQL 까지 되돌림: 경기 없는 시간에 `K1_kdk_play_epoch_rollback.sql` → 운영진 새로고침. 화면을 먼저 되돌릴 필요는 없다.
- 롤백으로 사라지는 것: "복귀 → 재투입 뒤 이전 점수 창 저장" 차단, 완료 → 되돌리기 → 재완료 뒤 이전 주기 정정 창 차단.
  남는 것: P1(점수 창을 연 시점 상태 · 점수 조건부 UPDATE)과 기존 투입 · 코트 · 선수 · 권한 보호 전부.
- 열을 지우면 투입 주기 값은 복구되지 않는다(다시 적용하면 전 행 0 에서 시작 — 기능상 문제 없음).

## 7. 운영 적용 위험

- 잠금: `ALTER TABLE` 이 matches 에 ACCESS EXCLUSIVE 잠금을 잠깐 잡는다. 상수 DEFAULT 라 테이블 재작성은 없고 즉시 끝나지만,
  진행 중 트랜잭션이 있으면 기다린다 → `lock_timeout 3s` 로 실패 · 무변경(대기열이 길게 막히지 않음). 로컬 시험: 3.0초 후 55P03, 열 미생성.
- 기존 데이터: UPDATE 0건. 점수 · 상태 · 승패 · 행 xmin 불변(로컬 시험) → SPOTLIGHT xmin 인증 유지.
- trigger: BEFORE trigger 중 마지막(이름순)이어야 한다 — 적용 SQL 이 확인 후 아니면 STOP.
- Realtime: 행에 열이 하나 늘 뿐. 화면 · 전광판은 모르는 열을 무시.
- 확인 불가(저장소 기준 판단): 운영 matches 의 실제 RLS 정책 · 추가 trigger 유무 — precheck P03 · 적용 SQL 의 STOP 이 trigger 순서를 확인한다.

## 8. 운영 적용 기록(2026-11-24)

> 운영 SQL 은 **사용자가 Supabase SQL Editor 에서 직접 실행**하고 결과를 전달했다. Claude Code 는 운영 DB 에 접속 · 조회 · 적용하지 않았다.

| 순서 | 단계 | 파일 | 결과 |
|---|---|---|---|
| 1 | R1 matches RLS 복구(선행 조건) | `supabase/closing_sprint/R1_matches_rls_restore_DRAFT.sql` | rls=false · force_rls=false · policies=0 · guard_on=true · anon_write=false · anon_select=true · auth_siud=true — PASS. 직후 `K1_rls_identity_publication_READONLY.sql` I01~I12 정상 |
| 2 | K1 사전 점검 | `K1_kdk_play_epoch_precheck_READONLY.sql` | P01 OK · P02 ABSENT(첫 적용) · P03 OK(0) · P04 OK · P05 0 · P06 0 · P07 0 |
| 3 | K1 Migration | `K1_kdk_play_epoch.sql` | column_ok=true · trigger_on=true · null_rows=0 |
| 4 | K1 사후 검증 | `K1_kdk_play_epoch_verify_READONLY.sql` | V01~V07 OK · V08 분포 0/0/0(경기 0건) |

- 유지 확인: P0-A(anon 쓰기 회수) · P1 score guard · truncate 차단 · ledger · SPOTLIGHT trigger(V07).
- 운영 `start_kdk_match` 본문 md5 = **9568938e**(저장소 최신 9ad744bd 와 다름 — 23505 → `court_conflict` 변환 처리 없음). K1 은 이 본문 기준 prodlike 시험 36/36 PASS.
- R1 배경(원인 조사 · 자동 RLS 추정)은 `docs/SECURITY_SQL_REGISTRY.md` §10.

### 재실행 · rollback 원칙
- 위 SQL 은 **다시 실행하지 않는다.** 재실행 · rollback(`K1_kdk_play_epoch_rollback.sql`, `R1_matches_rls_restore_rollback_DRAFT.sql`)은 필요 시 **별도 승인 후** 경기 없는 시간에만.
- R1 rollback 은 RLS 켜짐 · 정책 0(대진 생성 42501 · 저장 0행) 장애 상태로 되돌리므로 정책 방안 준비 없이 실행하지 않는다.

### 화면 배포 전후 호환성
- K1 DB + 이전 화면(afa598e): 정상 동작 · epoch 보호 없음(P1 보호만).
- K1 DB + K1 화면: 전체 보호. 배포 후 운영진 · 전광판 **새로고침** 필요.

### 보호 한계
- 배포 전에 열어 둔 탭(새로고침 전), 직접 API 호출은 epoch 조건 없이 저장할 수 있다 — DB 는 epoch **위조**(42501)는 막지만 조건 포함을 강제하지 않는다.
- P1 조건도 같은 성격(화면 협조형)이다. 회원 정정 · 상태/코트/선수 변경 · anon 쓰기는 DB trigger · 권한이 강제한다.
