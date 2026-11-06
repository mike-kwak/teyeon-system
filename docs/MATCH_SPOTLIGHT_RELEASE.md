# MATCH SPOTLIGHT Phase 1 — 운영 적용 안내(v2.2)

- 작성: 2026-11-06 · 기준 `origin/main = ef7e16e` + SPOTLIGHT(브랜치 `feat/match-spotlight-phase1` 7b59edf 내용) + v2.2 권한 확장
- 상태: **운영 SQL v2.2 적용 완료(2026-11-06 · verify A1~A12 · B1 true)** · 코드는 이 문서와 같은 커밋으로 배포

## 1. 기능 범위

| 구분 | 내용 |
|---|---|
| 진입 | `/kdk` LIVE 화면 상단 — 대진 생성 후, 경기 시작 전 |
| 공개 배너 | 공개(published) 상태일 때만 누구에게나 `TODAY'S SPOTLIGHT` |
| 관리(생성 · 미리보기 · 공개 · 비공개 · 공유 문구/링크) | **CEO · ADMIN · KDK 전용 관리자**(관리자 모드) |
| 공개 페이지 | `/club/spotlight/[slug]` — 비로그인 · allow-list DTO(숫자 확률 · 선수 id · 연락처 · 이메일 없음) |
| 데이터 | 공식 KDK Archive(공식 · 비테스트) 중 세션 날짜 이전 기록만 · 대기(waiting) 경기만 예측 · 시작된 경기는 DB 가 거부 |

## 2. 관리 권한 정책(v2.2)

기존 KDK 관리자 체계(SQL 30 `can_manage_kdk()` · `kdk_managers`)를 그대로 재사용한다. 규칙을 새로 만들지 않는다.

| 계정 | 관리 시트 | 서버 API(`/api/kdk/spotlight`) | DB(`kdk_spotlight_is_admin` · `get_kdk_spotlight_admin`) |
|---|---|---|---|
| CEO · ADMIN | 표시 | 허용 | 허용 |
| KDK 전용 관리자(앱 권한 MEMBER 유지 · 등재) | 표시 | 허용(사용자 토큰으로 `can_manage_kdk` = true) | 허용(`can_manage_kdk()` 를 그 사용자로 평가) |
| MEMBER · GUEST | 숨김 | 403 | 거부(42501 / forbidden) |
| 탈회 처리된 등재자 | 숨김 | 403 | 거부 |
| 비로그인(anon) | 숨김 | 401 | 실행 권한 없음 |
| SQL 30 없는 DB | CEO · ADMIN 만(예전 규칙) | 〃 | 〃 |

- 쓰기 RPC(save · publish · unpublish · get_for_publish)는 `service_role` 전용 — 화면이 직접 부를 수 없고 서버 route 가 권한을 다시 확인한 뒤 부른다.
- KDK 코트 배정 · 타이머 · 점수 입력 · 공식 Archive 권한은 바꾸지 않는다.

## 3. SQL 파일(저장소 ↔ 바탕화면 `TEYEON_SPOTLIGHT_SQL_v2.2`)

| 순서 | 저장소 | 바탕화면 사본 | md5(LF) | 종류 |
|---|---|---|---|---|
| 0 | `supabase/add_kdk_match_spotlight_precheck_READONLY.sql` | `0_precheck_READONLY.sql` | 22f364ba | READONLY — STOP 0 이어야 적용 · P21 = KDK 관리자 체계 |
| 1 | `supabase/add_kdk_match_spotlight_backup.sql` | `1_backup.sql` | df77a8a7 | `matches` 스냅샷(spotlight_backup 스키마 · anon 접근 불가) |
| 2 | `supabase/add_kdk_match_spotlight.sql` | `2_apply_add_kdk_match_spotlight_v2.2.sql` | bcd7e5ab | APPLY(v2.2) |
| 3 | `supabase/add_kdk_match_spotlight_verify_single_READONLY.sql` | `3_verify_single_READONLY.sql` | 84fed136 | READONLY — A1~A9 · A12 true |
| 9 | `supabase/add_kdk_match_spotlight_rollback.sql` | `9_rollback_add_kdk_match_spotlight.sql` | 3b1e19be | ROLLBACK(문제 시에만) |
| — | `supabase/add_kdk_match_spotlight_verify.sql` | — | — | READONLY(여러 문장판 · A12 포함) |
| — | `supabase/spotlight_testenv/*` | — | — | 로컬/테스트 프로젝트 전용 |

- 이전 패키지 `바탕화면/TEYEON_SPOTLIGHT_SQL`(v2.1)은 **사용하지 않는다** — precheck(P21 없음) · apply(관리 권한 CEO · ADMIN 만) · verify(A12 없음)가 다르다. backup · rollback 은 동일.
- `1_backup` 의 백업 표 이름은 `spotlight_backup.matches_20261104`(작성일 표기) — 이미 있으면 오류로 중단하므로 덮어쓰지 않는다.

## 4. 운영 적용 순서(승인 후)

1. 진행 중인 KDK · Special Match 가 없는 시간에 시작(설치 · rollback 잠금 대기 3초).
2. `0_precheck_READONLY` → STOP 0 · P21 OK 확인.
3. `1_backup` → 백업 행 수 = 원본 행 수 · `anon_can_read=false`.
4. `2_apply_add_kdk_match_spotlight_v2.2` → "canceling statement due to lock timeout" 이면 아무것도 바뀌지 않은 것 — 1~2분 뒤 다시.
5. `3_verify_single_READONLY` → A1~A9 · A12 true.
6. 코드 배포(SQL 적용 뒤 — SQL 이 없으면 배너는 숨김 · 관리 시트는 "SQL 미적용" 안내만).
7. Vercel 환경 변수 `SUPABASE_SERVICE_ROLE_KEY` 확인(서버 route 전용 · 없으면 생성 시 "서버 설정 없음" 503).
8. 실계정 확인: 김영호(KDK 관리자) 관리 시트 · 생성 → 미리보기 → 공개 → 공개 페이지 → 비공개 / 일반 회원 · 게스트는 배너만.

## 5. 검증(로컬)

| 시험 | 결과 |
|---|---|
| 계산 fixture(`verify_match_spotlight.mts`) | 210/210 |
| 서버 API 보안(`verify_match_spotlight_api.mts`, KDK 관리자 · SQL 30 미적용 경로 포함) | 90/90 |
| SQL(PGlite) | 88/88 |
| 실 PostgreSQL 다중 연결 동시성 | 62/62 |
| 운영 동일 상태(uuid · P0 · P1 · P1-b · 34 · 30 · 31 · 36 · 38) + 운영 적용 순서 0→1→2→3 + 역할 행렬 + 전체 흐름 + rollback | 62/62 |
