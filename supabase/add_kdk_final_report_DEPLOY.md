# KDK FINAL REPORT — 운영 적용 절차 (P1~P4)

> 승인 전에는 아무 단계도 실행하지 않는다. 각 단계는 사용자 승인 후 진행한다.
> 브랜치 `feat/kdk-final-report`(기준 origin/main `0e64039`). SQL 은 P3 이후 바뀌지 않았다(P4 는 화면 · 공유 · OG 만).

## 0. 사전 점검 (완료 · 2026-11-11)
- P01 `kdk_spotlight_is_admin(uuid)` 있음 · FINAL REPORT 표/함수 없음(이름 충돌 없음)
- P02 `kdk_spotlight_is_admin` anon · authenticated 실행 불가 · SECURITY DEFINER
- P03 공식 KDK Archive 24건: 선수 · 경기 id 누락/중복 0, 경기 선수 4명, 점수 정상, 경기 ↔ 순위표 연결 정상

## 1. 운영 SQL 적용 (Supabase SQL Editor) — 적용 완료 · 2026-11-11 (V01~V07 19항목 PASS · 공개 키 확인 PASS)
1. `supabase/add_kdk_final_report.sql` **파일 전체를 한 번에** 붙여 넣고 실행한다.
   - SQL Editor 는 한 요청을 하나의 트랜잭션으로 실행한다 → 중간 실패 시 전체 무변경(PGlite 로 확인).
   - `psql -f` 처럼 문장 단위로 실행하지 않는다(문장마다 커밋되어 원자성이 깨짐).
   - 선행 함수가 없으면 `STOP FR00` 으로 아무것도 만들지 않고 멈춘다.
2. 결과에 오류가 없는지 확인한다. 오류가 나면 아무것도 바뀌지 않았으므로 그대로 멈추고 오류 문구를 공유한다.

변경 범위: 신규 표 `kdk_final_reports`(RLS 켜짐 · anon/authenticated 권한 회수) + 신규 함수 10개.
기존 Archive · Ranking · Finance · SPOTLIGHT 표/함수/권한은 바꾸지 않는다(`kdk_spotlight_is_admin` 은 호출만).

## 2. 적용 확인 (읽기 전용)
`supabase/add_kdk_final_report_verify_READONLY.sql` — SQL Editor 는 마지막 문장 결과만 보여 주므로 V01~V07 을 **한 문장씩** 실행한다.

| 항목 | 기대값 |
|---|---|
| V01 RLS | `rls_on = true` |
| V02 표 권한 | anon/authenticated SELECT · INSERT 모두 `false` |
| V03 운영 함수 | anon/authenticated `false`, service_role `true` |
| V04 공개 함수 | `get_public_kdk_final_report` · `get_public_kdk_final_report_link` anon `true`, 지문 함수 anon `false` |
| V05 | FINAL REPORT 함수 10개 · `prosecdef = true` 는 **6개**(조회 · 저장 · 발행 · 비공개 · 공개 2) · 보조 4개(`kdk_fr_int` · `kdk_fr_group` · `kdk_fr_key` · `kdk_final_report_signature`)는 `false`(service_role 전용 실행) · 10개 모두 `proconfig` 에 `search_path=public, pg_temp` |
| V06 | Archive anon 읽기 `false`(기존 보안 유지) |
| V07 | 0행(적용 직후) |

추가(읽기 전용 · 공개 키): 공개 함수 2개가 "없음"을 정상 반환하는지 확인(`get_public_kdk_final_report('zzzzzzzzzzzz')` → `not_found`).

## 3. 코드 배포 순서
1. 위 1~2 완료 후에만 push / Preview. (SQL 없이 코드만 배포하면 관리자 편집기에 "DB 설정 미적용", 공개 링크는 조회 실패 화면)
2. **Preview 도 운영 Supabase 를 쓴다** → Preview 에서 초안 저장 · 발행을 누르면 운영 DB 쓰기다.
   Preview 에서는 화면 표시 · 권한 거부 · 공개 링크(없음 상태)만 보고, 실제 발행 시험은 별도 승인 후 한 세션으로 한정한다.
3. Production 배포 → 운영진 실계정으로 다음 날 아침 흐름(아래 5) 1회 리허설.

## 4. Rollback
- 조건: 적용 직후 V01~V07 불일치, 공개 함수 오류, 편집 · 발행 장애가 운영에 영향.
- 코드: 이전 Production 배포로 되돌린다(Vercel Instant Rollback). Archive 진입 버튼만 사라지고 기존 기능은 그대로.
- SQL: `supabase/add_kdk_final_report_rollback.sql` — FINAL REPORT 신규 표 1개 · 함수 10개만 삭제(기존 객체 무영향).
  ⚠ 작성한 문구와 발행본도 함께 삭제되고 공개 링크는 모두 "없음"이 된다. 필요하면 먼저 `kdk_final_reports` 를 백업한다.
- 순서: 코드를 먼저 되돌린 뒤 SQL rollback(반대 순서면 배포 코드가 "DB 설정 미적용" 상태가 됨).

## 5. 운영 흐름 (다음 날 오전 수동 발행)
1. DAY 1 밤: 경기 종료 → 점수 · 공식 순위 확인 → Archive 공식 확정(기존 흐름). 리포트 발행은 강제하지 않는다.
2. DAY 2 오전: (재무는 Finance 에서 별도 확인 — 리포트 발행 조건 아님 · 리포트에 벌금/납부 정보 없음)
3. 운영진이 Archive 상세 → FINAL REPORT 작성 → 공식 기록 확인 → (선택) TOP3 스토리 · 경기 리뷰 → 미리보기 → 확인 체크 → 발행.
4. 발행 카드의 "공유하기"(모바일 공유 시트) 또는 "링크 복사" → 카카오톡 단체방에 붙여 넣기.
5. 공식 기록을 정정하면 공개 화면은 자동으로 정정 안내가 된다 → 편집기에서 재확인 후 재발행 → 새 링크(`?v=판`)를 다시 공유.

## 6. 카카오톡 미리보기 · 캐시
- 공유 URL: `https://teyeon-system.vercel.app/club/report/<slug>?v=<판>`. `v` 는 캐시 구분용이고 페이지는 항상 현재 발행본을 조회 · 검증한다(쿼리로 내용 선택 · 권한 우회 불가).
- OG 이미지: `/club/report/<slug>/og?v=<판>`(1200×630, 서버 생성). 정정 · 비공개 · 없음 → 중립 이미지. CDN 캐시 60초.
- 재발행하면 판 번호가 바뀌어 새 URL 이 되므로 카카오가 새로 읽어 갈 가능성이 높다. 다만 카카오 쪽 캐시 동작은 보장할 수 없다.
- 이미 보낸 카카오톡 메시지의 미리보기는 회수할 수 없다(비공개 전환 후에도 말풍선의 제목 · 이미지는 남을 수 있음 · 링크를 열면 "공개된 리포트가 없습니다").
- 같은 판 URL 의 미리보기가 갱신되지 않으면 Kakao Developers 의 공유 디버거에서 캐시 초기화를 요청할 수 있다(운영 계정 필요).

## 7. Production 전 필수 실기기 QA (로컬에서 검증 불가)
- [ ] 카카오톡 단체방에 공유 URL 붙여 넣기 → 미리보기 제목 · 설명 · OG 이미지(1200×630) 표시
- [ ] 재발행 후 새 `?v=` 링크 미리보기 갱신 여부
- [ ] 카카오톡 인앱 브라우저에서 리포트 열기 · "공유하기"/"링크 복사" 동작(인앱은 공유 API 미지원일 수 있음 → 복사로 대체되는지)
- [ ] iOS Safari · Android Chrome · Samsung Internet 공유 시트 열기/취소
- [ ] iPhone 하단 safe-area(마지막 로고 · 버튼 가림 없음) · 편집기 키보드 노출 시 입력창 · 하단 버튼
- [ ] Vercel(Linux)에서 OG 이미지 생성(로컬 Windows 는 `@vercel/og` 경로 문제로 QA 용 우회 필요 — 운영 코드는 그대로)
