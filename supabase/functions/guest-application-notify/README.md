# guest-application-notify — PUBLIC_GUEST 신규 신청 이메일 알림

신청 저장과 **분리된** 서버측 알림. `guest_applications` INSERT → Database Webhook → 이 Edge Function → 이메일(Resend).

- **인증(필수):** `--no-verify-jwt` 배포이므로 `x-webhook-secret` 헤더가 유일한 관문. `WEBHOOK_SECRET` 미설정/헤더 누락/불일치 → **401, fail closed**(outbox 생성·신청 조회·발송 일절 없음). secret 값·헤더는 로그/응답에 출력하지 않음.
- **대상:** `source_type = 'public_application'` INSERT 만. INVITED_GUEST(Guest Pass 전달/활성화/토큰 재발급), KDK 게스트 수동 추가, 게스트비·벌금, 승인/보류/거절 상태 변경, preview/mock — 전부 미발송.
- **중복 방지 2중:** ① outbox 원자적 claim RPC(`claim_guest_application_notification` — unique + row lock, 최대 **3회**, stale pending **5분** 복구) ② Resend `Idempotency-Key`(신청·타입별 SHA-256 안정 해시 — 모든 재시도 동일, UUID 원문 미노출).
- **개인정보 최소:** 이메일에 이름·정모명/날짜·신청시각·상태·관리자 목록 링크만. 전화/지역/클럽명/성적/메모/운영진메모/각종 UUID/토큰 미포함.
- **실패 격리:** 발송 실패는 outbox `failed` + 짧은 코드(`resend_500`/`network_error` 등)만 기록하고 **HTTP 200** 반환(webhook 무한 재시도 금지). 신청 저장/완료 화면에는 영향 없음.

> ⚠️ 아래 운영 적용 절차는 **사용자 승인 후** 수동으로 실행합니다(SQL·secret·배포·webhook 모두).

## 필수 secrets (Edge Function 환경변수 — 클라이언트 미노출, `NEXT_PUBLIC_` 금지)

| 이름 | 필수 | 예시 | 비고 |
|---|---|---|---|
| `RESEND_API_KEY` | ✅ | `re_...` | 이메일 provider |
| `GUEST_APPLICATION_NOTIFICATION_EMAILS` | ✅ | `admin1@example.com,admin2@example.com` | 수신자(콤마구분·trim·중복 제거). 0명이면 발송 안 함(failed) |
| `GUEST_NOTIFICATION_FROM` | ✅ | `TEYEON Guest <guest@notify.example.com>` | **Resend 에서 인증된 도메인의 발신 주소만** 사용. 누락 시 발송 안 함(failed). 소스 하드코딩 금지 |
| `APP_ORIGIN` | ✅ | `https://teyeon-system.vercel.app` | https 운영 origin 만 유효. 불량/누락 시 이메일에서 링크 생략(임의 localhost 금지) |
| `WEBHOOK_SECRET` | ✅ | (충분히 긴 난수) | webhook 인증 — **선택 아님**. 미설정 시 함수가 모든 요청 401 |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 자동 | — | Supabase 기본 주입(outbox claim/기록) |

```bash
supabase secrets set \
  RESEND_API_KEY=... \
  GUEST_APPLICATION_NOTIFICATION_EMAILS="admin1@example.com,admin2@example.com" \
  GUEST_NOTIFICATION_FROM="TEYEON Guest <guest@notify.example.com>" \
  APP_ORIGIN="https://teyeon-system.vercel.app" \
  WEBHOOK_SECRET="$(openssl rand -hex 24)"
```
(실제 값은 README/소스/로그에 기록하지 않는다.)

## 운영 적용 순서

1. `supabase/add_guest_application_notifications.sql` 실행 (count RPC + outbox + claim RPC)
2. `supabase/add_guest_application_notifications_verify.sql` 확인 — A부 구조 점검 + **B부 BEGIN…ROLLBACK 상태 머신 6/6 PASS**
3. Resend 발신 **도메인 인증** 확인(`GUEST_NOTIFICATION_FROM` 도메인)
4. 필수 secrets 등록(위 5종)
5. Edge Function 배포: `supabase functions deploy guest-application-notify --no-verify-jwt`
6. Database Webhook 생성(Dashboard → Database → Webhooks)
   - table: `public.guest_applications` · event: **INSERT** 만 · method: POST
   - target: Supabase Edge Function → `guest-application-notify`
7. Webhook HTTP Header 에 `x-webhook-secret: <WEBHOOK_SECRET>` 설정(필수)
8. 테스트 PUBLIC_GUEST 신청 1건 제출(`/guest`)
9. outbox `status='sent'` 확인(`guest_application_notifications`)
10. 수신 이메일에 개인정보(전화/메모/UUID) 미포함 확인
11. Admin pending 배지(사이드바/모바일 메뉴/대시보드/신청 화면) 확인
12. 같은 webhook payload 재호출(또는 Webhook 재전송) → 이메일 **1통 유지** 확인(`skipped: already_sent`)

## 롤백 순서

1. Database Webhook 삭제(Dashboard)
2. `supabase functions delete guest-application-notify`
3. `supabase secrets unset RESEND_API_KEY GUEST_APPLICATION_NOTIFICATION_EMAILS GUEST_NOTIFICATION_FROM APP_ORIGIN WEBHOOK_SECRET`
4. `supabase/add_guest_application_notifications_rollback.sql` 실행

## Deno 문법·타입 검증 (Next tsc 와 분리 — tsconfig `exclude: supabase/functions`)

```bash
deno check supabase/functions/guest-application-notify/index.ts   # 타입/문법
deno lint  supabase/functions/guest-application-notify/           # 선택
```

## 로컬/mock 검증 (운영 발송 없이)

```bash
supabase functions serve guest-application-notify --no-verify-jwt \
  --env-file supabase/functions/.env.local   # WEBHOOK_SECRET 등 로컬 값

BASE=localhost:54321/functions/v1/guest-application-notify

# 인증: 헤더 누락 → 401 / 불일치 → 401 / 일치 → 진행
curl -si $BASE -H 'Content-Type: application/json' -d '{}' | head -1                        # 401
curl -si $BASE -H 'x-webhook-secret: wrong' -H 'Content-Type: application/json' -d '{}' | head -1  # 401

# INVITED skip
curl -s $BASE -H "x-webhook-secret: $SECRET" -H 'Content-Type: application/json' \
  -d '{"record":{"id":"<uuid>","source_type":"member_invitation"}}'
# → {"ok":true,"skipped":"not_public_application"}

# public 신청: 1회차 claim+발송 시도 / 같은 payload 재호출 → recently_claimed 또는 already_sent
curl -s $BASE -H "x-webhook-secret: $SECRET" -H 'Content-Type: application/json' \
  -d '{"record":{"id":"<uuid>","source_type":"public_application","schedule_id":"<uuid>","name":"테스트","created_at":"2026-07-11T05:30:00Z"}}'
```
> 운영 이메일 실발송·운영 신청 생성은 승인된 운영 QA 단계에서만.
