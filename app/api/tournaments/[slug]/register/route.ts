// 공개 참가신청 제출 엔드포인트 (봇 방어 게이트).
//
//   브라우저 → 이 route → (honeypot · Turnstile 서버검증) → service_role 로 기존 RPC 호출.
//
//   ⚠ 이 route 가 존재하는 이유는 "검증을 서버에서만 한다"는 것 하나다.
//     클라이언트가 통과했다고 말하는 값은 어디서도 신뢰하지 않는다.
//   ⚠ anon 의 submit_tournament_registration EXECUTE 권한은
//     supabase/add_hosted_tournament_submit_lockdown.sql 로 회수한다.
//     그 migration 을 적용해야 이 route 를 우회한 PostgREST 직접 호출이 막힌다.
//     (anon key 는 공개 번들에 들어 있으므로, 권한 회수 없이는 이 게이트가 무력하다.)
//   ⚠ 전 구간 fail-closed. 설정 누락·검증 실패·Cloudflare 장애 → RPC 를 호출하지 않는다.
//   ⚠ 응답에 secret/token/내부 예외 상세를 담지 않는다.
//
//   미들웨어는 matcher 가 '/admin/:path*' 라 이 경로에 관여하지 않는다.

import { NextResponse, type NextRequest } from 'next/server';
import {
  callSubmitRegistrationRpc,
  isSubmitClientConfigured,
  type SubmitRpcArgs,
} from '@/lib/tournaments/server/registrationSubmitClient';
import { verifyTurnstile } from '@/lib/tournaments/server/turnstile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 정상 신청 1건은 1KB 도 되지 않는다. 그 이상은 읽지 않고 버린다. */
const MAX_BODY_BYTES = 4096;

/** 클라이언트가 보낸 값의 상한 — 서버 RPC 가 다시 검증하지만 여기서 먼저 자른다. */
const MAX_NAME = 40;
const MAX_PHONE = 32;
const MAX_CLUB = 80;
const MAX_NOTE = 600;

type Body = Record<string, unknown>;

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.slice(0, max).trim() : '';
const strOrNull = (v: unknown, max: number): string | null => {
  const s = str(v, max);
  return s === '' ? null : s;
};
const bool = (v: unknown): boolean => v === true;

/** 애플리케이션 오류 코드는 본문으로, HTTP status 는 분류용으로 쓴다(둘을 섞지 않는다). */
function fail(status: number, code: string) {
  return NextResponse.json({ error: code }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  // ── 0. slug (Next 15 에서 params 는 Promise 다) ────────────────────────────
  const { slug: rawSlug } = await ctx.params;
  const slug = typeof rawSlug === 'string' ? rawSlug.slice(0, 80).trim() : '';
  if (!slug) return fail(400, 'INVALID_REQUEST');

  // ── 1. 본문 크기 제한 + malformed JSON 안전 처리 ───────────────────────────
  const declared = Number(req.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail(413, 'INVALID_REQUEST');

  let body: Body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return fail(413, 'INVALID_REQUEST');
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'INVALID_REQUEST');
    body = parsed as Body;
  } catch {
    return fail(400, 'INVALID_REQUEST');
  }

  // ── 2. honeypot — 사람에게 보이지 않는 필드. 채워져 있으면 봇이다. ─────────
  //      조용히 거절한다. 왜 막혔는지 알려주지 않는다.
  if (str(body.company, 200) !== '') return fail(400, 'SECURITY_CHECK_FAILED');

  // ── 3~6. Turnstile 서버 검증 (토큰 존재 → siteverify → success/action/hostname) ─
  const remoteIp = req.headers.get('cf-connecting-ip') || null;
  const verdict = await verifyTurnstile(body.turnstileToken, remoteIp);
  if (!verdict.ok) {
    // 실패 사유를 사용자에게 세분화해 알리지 않는다(우회 힌트가 된다).
    //   not_configured 는 서버 구성 문제이므로 500, 나머지는 클라이언트 재시도 대상이라 403.
    return fail(verdict.reason === 'not_configured' ? 500 : 403, 'SECURITY_CHECK_FAILED');
  }

  // ── 7. 검증 통과 — 여기서부터만 기존 RPC 를 호출한다. ──────────────────────
  if (!isSubmitClientConfigured()) return fail(500, 'TOURNAMENT_SUBMIT_NOT_READY');

  const args: SubmitRpcArgs = {
    p_slug: slug,
    p_player1_name: str(body.player1Name, MAX_NAME),
    p_player1_phone: str(body.player1Phone, MAX_PHONE),
    p_player2_name: str(body.player2Name, MAX_NAME),
    p_player2_phone: str(body.player2Phone, MAX_PHONE),
    p_club_name: strOrNull(body.clubName, MAX_CLUB),
    p_depositor_name: str(body.depositorName, MAX_NAME),
    p_note: strOrNull(body.note, MAX_NOTE),
    p_eligibility_confirmed: bool(body.eligibilityConfirmed),
    p_regulations_confirmed: bool(body.regulationsConfirmed),
    p_privacy_agreed: bool(body.privacyAgreed),
    p_media_notice_confirmed: bool(body.mediaNoticeConfirmed),
  };

  const outcome = await callSubmitRegistrationRpc(args);

  if (outcome.ok) {
    return NextResponse.json(outcome.data, { status: 200, headers: { 'cache-control': 'no-store' } });
  }
  if (outcome.kind === 'not_configured') return fail(500, 'TOURNAMENT_SUBMIT_NOT_READY');

  // RPC 가 던진 코드 문자열을 '그대로' 넘긴다 — registrationSubmitMessage 의 기존 매핑
  //   (TOURNAMENT_NOT_OPEN / REGISTRATION_CLOSED / TOURNAMENT_FULL / DUPLICATE_REGISTRATION /
  //    SAME_PLAYER_PHONE / INVALID_PHONE / CONSENT_REQUIRED / REQUIRED_FIELD_MISSING /
  //    FIELD_TOO_LONG)를 그대로 살리기 위함이다.
  const msg = outcome.message;
  const missingRelation =
    outcome.code === '42P01' ||
    outcome.code === 'PGRST202' ||
    outcome.code === 'PGRST205' ||
    (/hosted_tournament|submit_tournament_registration/.test(msg) &&
      /does not exist|schema cache|Could not find/.test(msg));
  if (missingRelation) return fail(503, 'TOURNAMENT_SUBMIT_NOT_READY');

  // 정원 초과·중복 등은 "요청은 정상인데 상태 때문에 거절"이라 409 로 분류한다.
  const conflict = /TOURNAMENT_FULL|DUPLICATE_REGISTRATION/.test(msg) || outcome.code === '23505';
  return NextResponse.json(
    { error: msg || 'SUBMIT_FAILED', code: outcome.code || undefined },
    { status: conflict ? 409 : 400, headers: { 'cache-control': 'no-store' } },
  );
}

/** POST 외 메서드는 받지 않는다. */
export async function GET(): Promise<NextResponse> {
  return fail(405, 'METHOD_NOT_ALLOWED');
}
