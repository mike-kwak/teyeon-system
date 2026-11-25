# MAINT-002 FINAL REPORT 회원 전용 순위 — 최종 보고

- 판정: **DEPLOYED — FIELD QA PENDING** (실계정 QA 완료 시 CLOSED)
- 앱: `c316858` feat: restrict final report rankings to verified club members — main fast-forward(`89c64d2..c316858`) · Vercel Production success(2026-11-26)
- 운영 SQL: `supabase/maint002_fr_member_ranking.sql` 적용(사용자 SQL Editor, 2026-11-26) · verify FAIL 0 · 등록부 `docs/SECURITY_SQL_REGISTRY.md` §12

## 1. 정책

- 공개 링크(인스타 · 카카오 홍보)는 유지한다. 공개본은 표지 · 세션명 · 날짜 · 참가/경기 수 · 이름 없는 문구 · V4.1 집계 4칸만 보여 준다.
- 개인별 경기 기록과 최종 순위는 TEYEON 회원(정회원 · 준회원 · 운영진, `members.auth_user_id` 연결, 리포트 클럽 일치, 탈회 우선 차단)에게만 보여 준다.
- 안내 문구(1곳): "개인별 경기 기록 및 최종 순위는 TEYEON 회원에게 공개됩니다."
- OG 이미지 · 메타 설명에 우승자 · TOP3 · 이름 없음.

## 2. 배포 순서(실제)

1. 운영 precheck READONLY — P01 6/6 · P02 NEW_INSTALL · P03 OK_ORIGINAL · P08 클럽 불일치 0 · P09 unconfigured 2
2. Production 프런트 `c316858` 배포 → Production QA(SQL 적용 전) 90/0 · 전체 화면 36/0 · 무회귀 6/0
3. precheck 재실행 PASS → migration → verify V01~V10 FAIL 0
4. Production 최종 QA(SQL 적용 후) — §3

## 3. 운영 SQL 적용 후 최종 QA(2026-11-26, 비로그인 · 읽기 전용)

| 항목 | 결과 |
|---|---|
| 공개 RPC 직접 호출(anon) 3건 | 200 · `state=ok` · `access=public` · revision 유지 |
| 공개 RPC 순위 원본 | standings · podium · featured 빈 배열, V4.1 heroes · mentions · rivalry 없음, 참가자 이름 0 |
| officialSessionId | 없음 |
| anon → `get_kdk_final_report_member` | 401 · 42501 permission denied |
| anon → 보조 함수 4개 | 모두 401 · 42501 |
| 회원 API 무인증 · 위조 토큰 | 401 `login_required` · `no-store` · 데이터 0 |
| 공개 리포트 3건 | HTTP 200 · 공개본 · 회원 안내 1곳 |
| SSR HTML · RSC · DOM · 브라우저 네트워크 응답 | 참가자 이름 0 · 순위 키 없음 |
| OG 기존(`?v=N`) · 신규(`&o=2`) | 6건 200 `image/png` · PNG 육안 확인 우승자/TOP3/이름 없음 |
| 메타 설명 | "날짜 · 참가 N명 · N경기 — TEYEON KDK 공식 결과" |
| 360 · 390 · 430 · 1280px | 가로 넘침 0(내부 스크롤 컨테이너 포함) |
| 로그인 버튼 | 카카오 authorize · `redirect_to` = 같은 리포트 |
| 기존 화면 무회귀(비로그인) | `/` · `/kdk` · `/kdk/display` · `/kdk/ranking` · `/archive` · 없는 리포트 — 200 · 페이지 오류 0 |

합계 160/160 PASS: RPC 24/0 + 보조 함수 차단 4/4 + 화면 90/0 + 전체 화면 36/0 + 무회귀 6/0.

## 4. 사용자 실계정 QA(PENDING — 실제 확인 결과 수신 전까지 PASS 처리하지 않음)

| 항목 | 기대 | 결과 |
|---|---|---|
| 정회원 카카오 로그인 | 전체 Final Report(순위 · 기록) 열람 | 대기 |
| 비회원(GUEST 등) 로그인 | 공개본 + "회원에게 공개" 안내(로그인 버튼 없음) | 대기 |
| 비로그인 | 공개본 + 카카오 로그인 버튼 | 자동 QA 통과 · 실기기 대기 |
| 로그아웃 | 회원 전용 데이터 즉시 제거 · 공개본 복귀 | 대기(로컬 지연 응답 시험 통과) |
| 카카오 로그인 후 복귀 | 같은 리포트로 돌아옴 | 대기(authorize 주소까지만 확인) |

## 5. 남은 위험 · 백로그(이번 작업에서 수정하지 않음)

- `get_public_kdk_session` 공개 순위 · `matches` anon SELECT · `teyeon_archive_v1` authenticated SELECT — **TEYEON 전체 순위 접근 차단 완료 아님**.
- 정산 열람 권한(`kdk_can_view_settlement`)이 순위 권한보다 넓다(profiles 역할 · 이메일 매칭). 스냅샷이 live 가 되면 이름 + 순위 기반 벌금으로 간접 노출 가능(현재 unconfigured 2).
- 자유 입력 문구 필터는 이름(띄어쓰기 · 성 뺀 이름 포함) · `(G)` · 점수만 거른다. 별명 · 직함 · 서술형 식별은 못 거른다 — 작성 시 주의.
- 이미 게시된 SNS · 카카오 미리보기 캐시는 그대로다(카카오 공유 디버거에서 초기화 필요).
- 당일 게스트 개인 인증 없음(게스트는 공개본만).
- 프런트를 `c316858` 이전으로 되돌리면 공개 링크가 "리포트 없음"으로 보인다. SQL rollback 은 원본 공개(순위 · TOP3 · officialSessionId)를 되살리므로 실행 금지.

## 6. 기준선 테스트

- 로컬 검증: 신규 SQL 152/0 · 회원 API 25/0 · 화면 310/0 · SQL 미적용 화면 260/0 · tsc 0 · build OK.
- 기존 V4.1 logic 테스트 실패 1건은 `origin/main`(`89c64d2`)에도 있는 **기준선 문제**로, MAINT-002 변경과 무관하며 이번 작업에서 수정하지 않았다.

## 7. 범위

Final Report 자체의 공개 범위 개선이 완료된 것이며, TEYEON 전체 순위 접근 차단이 완료된 것은 아니다(§5 백로그).
