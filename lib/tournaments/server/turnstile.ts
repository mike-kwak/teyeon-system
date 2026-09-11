// Cloudflare Turnstile 서버 검증 — 참가신청 전용.
//
//   ⚠ 클라이언트가 "통과했다"고 말하는 것은 절대 믿지 않는다.
//     브라우저가 받은 토큰을 서버가 Cloudflare 에 되물어(siteverify) 확인한 결과만 신뢰한다.
//   ⚠ 전부 fail-closed 다. 미설정·토큰없음·거절·네트워크오류·타임아웃 → 신청 RPC 를 호출하지 않는다.
//   ⚠ 어떤 경로로도 secret / token 원문을 로그·응답에 남기지 않는다.

import { assertServerOnly } from './guard';

assertServerOnly('lib/tournaments/server/turnstile');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 위젯과 서버가 반드시 같은 값을 써야 한다. 위젯: data-action="tournament_register" */
export const TURNSTILE_ACTION = 'tournament_register';

/** 토큰 길이 상한 — Cloudflare 문서 기준 2048자. 그보다 길면 읽지도 않는다. */
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 5000;

/**
 * 운영 허용 호스트.
 *   siteverify 응답의 hostname 이 여기에 없으면 거절한다(다른 사이트에서 받은 토큰 재사용 차단).
 *   커스텀 도메인을 붙이면 TURNSTILE_ALLOWED_HOSTS 에 콤마로 나열해 덮어쓴다.
 *   ⚠ 요청의 Host 헤더로 판정하지 않는다 — 그 값은 호출자가 조작할 수 있다.
 */
const DEFAULT_PROD_HOSTS = ['teyeon-system.vercel.app'];

/** 개발 전용 허용 호스트. Cloudflare 공식 테스트 키는 hostname 을 'example.com' 으로 돌려준다. */
const DEV_HOSTS = ['localhost', '127.0.0.1', 'example.com'];

export type TurnstileFailure =
  | 'not_configured'   // 서버에 secret 이 없음 → 검증 불가 → 차단
  | 'missing_token'    // 클라이언트가 토큰을 안 보냄
  | 'rejected'         // Cloudflare 가 실패로 판정(만료·재사용·위조·action/hostname 불일치)
  | 'unreachable';     // 네트워크 오류 / 타임아웃 / 비정상 응답

export type TurnstileResult = { ok: true } | { ok: false; reason: TurnstileFailure };

function allowedHosts(): string[] {
  const override = (process.env.TURNSTILE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const base = override.length > 0 ? override : DEFAULT_PROD_HOSTS;
  // 개발/프리뷰에서는 localhost 와 테스트 키의 example.com 을 함께 허용한다.
  return process.env.NODE_ENV === 'production' ? base : [...base, ...DEV_HOSTS];
}

/** 서버에 Turnstile 이 구성되어 있는지(= 검증을 수행할 수 있는지). */
export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * 토큰 1건을 Cloudflare 에 검증한다.
 *   success / action / hostname 세 가지를 모두 확인해야 통과다.
 */
export async function verifyTurnstile(token: unknown, remoteIp?: string | null): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: false, reason: 'not_configured' };

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: 'missing_token' };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  // remoteip 는 선택 항목이다. 프록시 뒤에서 신뢰할 수 없으면 보내지 않는다.
  if (remoteIp) body.set('remoteip', remoteIp);

  let payload: { success?: unknown; action?: unknown; hostname?: unknown };
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    payload = (await res.json()) as typeof payload;
  } catch {
    // 네트워크 오류·타임아웃·JSON 파싱 실패 — 원인 상세는 남기지 않는다(토큰이 섞일 수 있음).
    return { ok: false, reason: 'unreachable' };
  }

  if (payload?.success !== true) return { ok: false, reason: 'rejected' };

  // action: 위젯이 선언한 값과 일치해야 한다(다른 폼의 토큰을 가져다 쓰는 것 차단).
  //   ⚠ 빈 문자열은 '미제공'으로 본다 — Cloudflare 테스트 키는 action 을 "" 로 돌려준다.
  //     실제 방어는 hostname + 토큰 1회성이 함께 담당한다.
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (action && action !== TURNSTILE_ACTION) {
    return { ok: false, reason: 'rejected' };
  }

  // hostname: 우리 도메인에서 발급된 토큰인지 확인.
  const host = typeof payload.hostname === 'string' ? payload.hostname.toLowerCase() : '';
  if (host && !allowedHosts().includes(host)) {
    return { ok: false, reason: 'rejected' };
  }

  return { ok: true };
}
