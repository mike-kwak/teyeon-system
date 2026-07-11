// Supabase Edge Function — PUBLIC_GUEST 신규 신청 이메일 알림 (Deno).
//
//   트리거: Database Webhook (guest_applications INSERT) → 이 함수.
//   흐름:  신청 저장(별도 트랜잭션, 이미 커밋됨) → webhook → [필수 secret 인증]
//          → 원자적 claim(claim_guest_application_notification RPC) → 이메일 발송 → 결과 기록.
//
//   원칙:
//     · 신청 저장과 완전 분리 — 이 함수의 실패는 신청 데이터/응답에 영향 없음(webhook 은 post-commit).
//     · 인증: WEBHOOK_SECRET 필수(fail closed). --no-verify-jwt 배포이므로 이 헤더가 유일한 관문.
//     · INVITED_GUEST 보호: source_type='public_application' 만 처리(그 외는 즉시 skip).
//     · 중복 방지 2중: (1) outbox 원자적 claim(unique + row lock, 최대 3회, stale 5분 복구)
//                      (2) Resend Idempotency-Key(신청·타입별 안정 해시 — 재시도에도 동일).
//     · 개인정보 최소: 이메일에 전화번호·지역·클럽명·성적·메모·운영진메모·내부 UUID 미포함.
//       링크는 인증 필요한 관리자 목록 화면까지만.
//     · 발송 실패해도 webhook 에는 200 반환(무한 재시도 금지). 실패는 outbox failed + 짧은 코드만.
//
//   필수 secret (Edge Function 환경변수 — 클라이언트 미노출, README 참조):
//     RESEND_API_KEY · GUEST_APPLICATION_NOTIFICATION_EMAILS · GUEST_NOTIFICATION_FROM
//     · APP_ORIGIN · WEBHOOK_SECRET   (+ SUPABASE_URL/SERVICE_ROLE_KEY 는 자동 주입)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const NOTIFICATION_TYPE = 'public_guest_application_created';

interface WebhookPayload {
  type?: string;                 // 'INSERT'
  table?: string;                // 'guest_applications'
  record?: Record<string, unknown>;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 타이밍 안전 비교 — 해시 후 고정 길이 XOR(길이 차이·조기 종료로 새는 정보 없음). 별도 라이브러리 불사용.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// KST(UTC+9) 표시용 포맷 — "2026.07.11 14:30"
function formatKst(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// 수신자: 콤마 분리 → trim → 빈 값 제거 → 중복 제거.
function parseRecipients(raw: string | undefined): string[] {
  return Array.from(new Set((raw || '').split(',').map((s) => s.trim()).filter(Boolean)));
}

// APP_ORIGIN 최소 검증 — https 운영 origin 만 링크에 사용. 누락/불량이면 링크 자체를 생략(임의 localhost 금지).
function validOrigin(raw: string | undefined): string | null {
  const v = (raw || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d+)?$/i.test(v) ? v : null;
}

Deno.serve(async (req: Request) => {
  // ── 0. 필수 인증(fail closed) — 다른 어떤 처리보다 먼저. ──────────────────────
  //   secret 미설정 / 헤더 누락 / 불일치 → 401. outbox·조회·발송 일절 진행하지 않는다.
  //   secret 값·요청 헤더는 로그와 응답에 절대 출력하지 않는다.
  const expected = (Deno.env.get('WEBHOOK_SECRET') || '').trim();
  const provided = (req.headers.get('x-webhook-secret') || '').trim();
  if (!expected || !provided || !(await safeEqual(expected, provided))) {
    console.warn('[guest-notify] unauthorized webhook call rejected'); // 원인·값 미출력
    return json(401, { ok: false });
  }

  let payload: WebhookPayload;
  try { payload = await req.json(); } catch { return json(200, { ok: true, skipped: 'bad_payload' }); }

  const rec = payload.record || {};
  const appId = rec.id as string | undefined;
  const sourceType = rec.source_type as string | undefined;

  // ── 1. INVITED_GUEST 등 비공개 이벤트 보호 — public_application INSERT 만 알림. ──
  if (!appId || sourceType !== 'public_application') {
    return json(200, { ok: true, skipped: 'not_public_application' });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ── 2. 원자적 claim — claimed=true 일 때만 발송. ──────────────────────────────
  //   상태 머신은 SQL RPC 가 단일 트랜잭션(row lock)으로 판정: sent/최근 pending/attempts>=3 → skip,
  //   신규/오래된 pending/failed(attempts<3) → claim(attempts 증가).
  const { data: claim, error: claimErr } = await admin.rpc('claim_guest_application_notification', {
    p_application_id: appId,
    p_notification_type: NOTIFICATION_TYPE,
  });
  if (claimErr || !claim) {
    console.warn('[guest-notify] claim error'); // 상세 미출력(민감정보 방지)
    return json(200, { ok: true, skipped: 'claim_error' });
  }
  if (!(claim as { claimed?: boolean }).claimed) {
    return json(200, { ok: true, skipped: (claim as { reason?: string }).reason || 'not_claimed' });
  }
  const notificationId = (claim as { notification_id?: string }).notification_id as string;

  // 결과 기록 helper — attempts 는 claim 시 증가한 값을 유지(여기서 변경 금지).
  const recordResult = async (ok: boolean, errCode: string | null) => {
    await admin
      .from('guest_application_notifications')
      .update({
        status: ok ? 'sent' : 'failed',
        sent_at: ok ? new Date().toISOString() : null,
        last_error: ok ? null : errCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', notificationId);
  };

  // ── 3. 발송 사전 조건(필수 secret) — 누락 시 failed 기록 후 200(신청엔 영향 없음). ──
  const resendKey = (Deno.env.get('RESEND_API_KEY') || '').trim();
  const from = (Deno.env.get('GUEST_NOTIFICATION_FROM') || '').trim();
  const recipients = parseRecipients(Deno.env.get('GUEST_APPLICATION_NOTIFICATION_EMAILS'));
  if (!resendKey) { await recordResult(false, 'missing_provider_key'); return json(200, { ok: true, sent: false }); }
  if (!from) { await recordResult(false, 'missing_from'); return json(200, { ok: true, sent: false }); }
  if (recipients.length === 0) { await recordResult(false, 'no_recipients'); return json(200, { ok: true, sent: false }); }

  // ── 4. 표시용 최소 정보(이름 + 정모명/날짜 + 신청시각)만 조회. ─────────────────
  let scheduleTitle = '', scheduleDate = '';
  const scheduleId = rec.schedule_id as string | undefined;
  if (scheduleId) {
    const { data: sch } = await admin
      .from('club_schedules')
      .select('title, schedule_date')
      .eq('id', scheduleId)
      .maybeSingle();
    scheduleTitle = (sch?.title as string) || '';
    scheduleDate = (sch?.schedule_date as string) || '';
  }
  const applicantName = (rec.name as string) || '(이름 미상)';
  const appliedAt = formatKst(rec.created_at as string);
  const origin = validOrigin(Deno.env.get('APP_ORIGIN'));

  // ── 5. 이메일 — 전화/지역/클럽명/성적/메모/UUID/토큰 미포함. 링크는 관리자 목록까지만. ──
  const subject = '[TEYEON] 새로운 게스트 신청이 접수되었습니다';
  const lines = [
    '새로운 PUBLIC_GUEST 신청이 접수되었습니다.',
    '',
    `신청자: ${applicantName}`,
    `신청 정모: ${[scheduleTitle, scheduleDate].filter(Boolean).join(' · ') || '(정모 정보 확인 필요)'}`,
    `신청 시각: ${appliedAt}`,
    '상태: 검토 대기',
    '',
    '자세한 내용은 TEYEON 관리자 게스트 신청 화면에서 확인해주세요.',
  ];
  if (origin) lines.push(`${origin}/admin/guest-applications`); // origin 불량/누락 시 링크 생략(localhost 금지)
  const text = lines.join('\n');

  // ── 6. Resend Idempotency-Key — 같은 신청·같은 타입이면 모든 재시도에서 동일 키. ──
  //   application UUID 를 provider 로그에 그대로 노출하지 않도록 안정 해시(opaque)로 변환.
  //   랜덤/timestamp 미사용. 본문·제목·클라이언트에 키 미노출.
  const idempotencyKey = `guest-application-notify:${await sha256Hex(`${appId}:${NOTIFICATION_TYPE}`)}`;

  let ok = false, errCode: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ from, to: recipients, subject, text }),
    });
    if (res.ok) {
      ok = true;
    } else {
      errCode = `resend_${res.status}`; // 응답 본문·키·수신자 미저장
    }
  } catch {
    errCode = 'network_error';
  }
  await recordResult(ok, errCode);

  // 로그: 수신자 수만(목록 금지), secret/키/개인정보 미출력.
  console.log(`[guest-notify] status=${ok ? 'sent' : 'failed'} recipients=${recipients.length}${ok ? '' : ` err=${errCode}`}`);
  return json(200, { ok: true, sent: ok });
});
