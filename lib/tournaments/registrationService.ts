// 공개 참가신청 제출 — 비로그인.
//
//   · 원본 테이블(hosted_tournament_registrations)에 직접 INSERT 하지 않는다.
//     서버 RPC submit_tournament_registration 만 사용하며, 접수순번·정원(48/60) 판정·중복 차단·
//     접수번호 발급은 전부 서버가 원자적으로 처리한다(클라이언트 count 판정 금지).
//   · ⚠ 브라우저에서 supabase.rpc 로 직접 호출하지 않는다.
//     /api/tournaments/[slug]/register 를 거쳐야 하며, 그 route 가 honeypot + Turnstile 을
//     서버에서 검증한 뒤에만 RPC 를 호출한다. anon 의 submit RPC EXECUTE 권한은 회수되어 있다
//     (supabase/add_hosted_tournament_submit_lockdown.sql).
//   · 마이그레이션 미적용이면 TOURNAMENT_SUBMIT_NOT_READY 를 던진다.
//     이 경우 화면은 "준비 중" 안내만 하고, 제출된 것처럼 보이는 완료 화면으로 넘기지 않는다.
//   · 전화번호는 반드시 정규화(숫자만)된 값을 넘긴다 — lib/tournaments/validation.normalizePhone.

import type { PaymentStatus, RegistrationStatus } from './types';

export const TOURNAMENT_SUBMIT_NOT_READY = 'TOURNAMENT_SUBMIT_NOT_READY';

export interface SubmitTournamentRegistrationInput {
  slug: string;
  player1Name: string;
  /** 숫자만. */
  player1Phone: string;
  /** 선수1 소속 클럽. 필수(없으면 '무소속'). */
  player1ClubName: string;
  player2Name: string;
  player2Phone: string;
  /** 선수2 소속 클럽. 필수(없으면 '무소속'). */
  player2ClubName: string;
  /** legacy 팀 단위 클럽 — 신규 신청에서는 항상 null. 기존 데이터 보존용 필드다. */
  clubName: string | null;
  depositorName: string;
  note: string | null;
  /** 4개 확인/동의 — 서버가 다시 검증하고 각각 시각으로 저장한다. */
  eligibilityConfirmed: boolean;
  regulationsConfirmed: boolean;
  privacyAgreed: boolean;
  mediaNoticeConfirmed: boolean;
  /** Turnstile 위젯이 발급한 1회용 토큰. 서버가 Cloudflare 에 되물어 검증한다. */
  turnstileToken: string;
  /** honeypot — 사람은 비워 둔다. 값이 있으면 서버가 즉시 거절한다. */
  company?: string;
}

/** 입금 안내 — 대회 계좌. 신청자 개인정보가 아니라 주최측 정보다. */
export interface TournamentPaymentInfo {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
}

/** 접수증 — 개인정보 최소. 내부 UUID·연락처·입금자명은 반환하지 않는다. */
export interface TournamentRegistrationReceipt {
  /** 'TO-2026-0031' */
  registrationNo: string;
  registrationStatus: RegistrationStatus;
  paymentStatus: PaymentStatus;
  player1Name: string;
  player2Name: string;
  entryFee: number;
  /**
   * 대기 순번(1..N). 서버가 lock 안에서 계산해 'waitlisted' 응답에만 싣는다. 그 외 null.
   *   ⚠ 접수 시점의 순번이다. 이후 앞 순번 취소 · 승격으로 줄어들 수 있다(원본 접수번호는 불변).
   */
  waitlistPosition: number | null;
  /**
   * 입금 안내. 서버가 'applied'(우선 참가 대상)로 접수된 신청에만 내려준다.
   *   · 공개 Hub RPC(get_public_tournament)에는 계좌가 들어 있지 않다 — 방문자 누구에게나 공개하지 않는다.
   *   · 'waitlisted'(대기 접수)에는 서버가 계좌를 주지 않는다. 대기팀은 운영진의 참가 가능 안내를
   *     받은 뒤 입금하므로, 화면이 입금을 유도할 수 있는 데이터 자체를 갖지 않게 한다.
   */
  payment: TournamentPaymentInfo | null;
}

/** 서버 응답에서 입금 안내를 뽑는다. 3개 값이 모두 있을 때만 유효한 안내로 취급. */
const parsePayment = (d: Record<string, unknown>): TournamentPaymentInfo | null => {
  const bankName = String(d.bankName || '').trim();
  const bankAccount = String(d.bankAccount || '').trim();
  const bankHolder = String(d.bankHolder || '').trim();
  if (!bankName || !bankAccount || !bankHolder) return null;
  return { bankName, bankAccount, bankHolder };
};

/** 서버가 준 대기 순번만 받는다. 1 이상의 정수가 아니면 null(순번을 지어내지 않는다). */
const toPosition = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
};

export async function submitTournamentRegistration(
  v: SubmitTournamentRegistrationInput,
): Promise<TournamentRegistrationReceipt> {
  let res: Response;
  try {
    res = await fetch(`/api/tournaments/${encodeURIComponent(v.slug)}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        player1Name: v.player1Name,
        player1Phone: v.player1Phone,
        player2Name: v.player2Name,
        player2Phone: v.player2Phone,
        player1ClubName: v.player1ClubName,
        player2ClubName: v.player2ClubName,
        clubName: v.clubName,
        depositorName: v.depositorName,
        note: v.note,
        eligibilityConfirmed: v.eligibilityConfirmed,
        regulationsConfirmed: v.regulationsConfirmed,
        privacyAgreed: v.privacyAgreed,
        mediaNoticeConfirmed: v.mediaNoticeConfirmed,
        turnstileToken: v.turnstileToken,
        company: v.company ?? '',
      }),
    });
  } catch {
    // 네트워크 단절 — 제출됐는지 알 수 없으므로 완료 화면으로 넘기지 않는다.
    throw new Error('NETWORK_ERROR');
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!res.ok) {
    const code = String(payload.error || '');
    if (code === TOURNAMENT_SUBMIT_NOT_READY) {
      const e = new Error(TOURNAMENT_SUBMIT_NOT_READY);
      e.name = TOURNAMENT_SUBMIT_NOT_READY;
      throw e;
    }
    // 서버가 RPC 에러 코드를 그대로 내려주므로 기존 문구 매핑이 그대로 동작한다.
    const err = new Error(code || 'SUBMIT_FAILED') as Error & { code?: string };
    if (typeof payload.code === 'string' && payload.code) err.code = payload.code;
    throw err;
  }

  const d = payload;
  if (!d.registrationNo) throw new Error('INVALID_RESPONSE');
  return {
    registrationNo: String(d.registrationNo || ''),
    registrationStatus: (d.registrationStatus as RegistrationStatus) || 'applied',
    paymentStatus: (d.paymentStatus as PaymentStatus) || 'pending',
    player1Name: String(d.player1Name || ''),
    player2Name: String(d.player2Name || ''),
    entryFee: Number(d.entryFee) || 0,
    waitlistPosition: toPosition(d.waitlistPosition),
    payment: parsePayment(d),
  };
}

/**
 * 제출 오류 → 사용자 안내 문구.
 *   다른 신청 팀의 정보를 절대 노출하지 않는다(중복이어도 "누구와 중복"인지 알리지 않음).
 */
export function registrationSubmitMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');

  if (msg.includes('TOURNAMENT_NOT_OPEN')) return '현재 참가 신청을 받고 있지 않습니다.';
  // 정원이 차도 신청은 대기 접수로 받는다 — 접수 마감은 기간 · 대회 상태로만 난다.
  if (msg.includes('REGISTRATION_CLOSED')) return '참가 신청 접수가 마감되었습니다.';
  // 구버전 서버(정책 SQL 적용 전)가 던질 수 있는 코드. 새 정책에서는 발생하지 않는다.
  if (msg.includes('TOURNAMENT_FULL')) {
    return '접수 처리 중 정원 확인에 실패했습니다. 잠시 후 다시 시도하거나 대회 운영본부로 문의해 주세요.';
  }
  if (msg.includes('DUPLICATE_REGISTRATION') || code === '23505') {
    return '이미 접수된 신청이 있습니다. 수정이 필요하면 대회 운영본부로 연락해 주세요.';
  }
  if (msg.includes('TOO_MANY_ATTEMPTS')) return '잠시 후 다시 시도해 주세요.';
  // 봇 방어(honeypot / Turnstile) — 실패 사유를 세분화해 알리지 않는다.
  if (msg.includes('SECURITY_CHECK_FAILED')) return '보안 확인에 실패했습니다. 잠시 후 다시 시도해주세요.';
  if (msg.includes('NETWORK_ERROR')) return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  if (msg.includes('INVALID_REQUEST')) return '입력값을 확인해 주세요.';
  if (msg.includes('SAME_PLAYER_PHONE')) return '두 선수의 휴대폰 번호가 같습니다. 각각 다른 번호를 입력해 주세요.';
  if (msg.includes('INVALID_PHONE')) return '휴대폰 번호 형식을 확인해 주세요.';
  if (msg.includes('CONSENT_REQUIRED')) return '확인 및 동의 항목을 모두 체크해 주세요.';
  if (msg.includes('REQUIRED_FIELD_MISSING')) return '입력값을 확인해 주세요.';
  if (msg.includes('FIELD_TOO_LONG')) return '입력 가능한 길이를 초과했습니다. 내용을 줄여 주세요.';
  return '신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

// ── 접수증 전달(참가신청 → 완료 화면) ─────────────────────────────────────────
//   접수증에는 선수 이름이 들어가므로 URL 쿼리로 넘기지 않는다(주소창·리퍼러·공유 링크 노출 방지).
//   sessionStorage 는 해당 탭에서만 살아 있고 서버로 전송되지 않는다.
//   ⚠️ 저장은 완료 화면 표시 목적뿐이다. 이 값을 신뢰해 권한/상태를 판단하지 않는다(서버가 단일 출처).

const RECEIPT_KEY_PREFIX = 'teyeon:tournament-receipt:';

export function storeRegistrationReceipt(slug: string, receipt: TournamentRegistrationReceipt): void {
  try {
    sessionStorage.setItem(RECEIPT_KEY_PREFIX + slug, JSON.stringify(receipt));
  } catch {
    // 프라이빗 모드 등 저장 불가 — 완료 화면이 접수번호 없이도 동작해야 한다.
  }
}

export function readRegistrationReceipt(slug: string): TournamentRegistrationReceipt | null {
  try {
    const raw = sessionStorage.getItem(RECEIPT_KEY_PREFIX + slug);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<TournamentRegistrationReceipt>;
    if (!d || typeof d.registrationNo !== 'string' || !d.registrationNo) return null;
    return {
      registrationNo: d.registrationNo,
      registrationStatus: (d.registrationStatus as RegistrationStatus) || 'applied',
      paymentStatus: (d.paymentStatus as PaymentStatus) || 'pending',
      player1Name: String(d.player1Name || ''),
      player2Name: String(d.player2Name || ''),
      entryFee: Number(d.entryFee) || 0,
      waitlistPosition: toPosition(d.waitlistPosition),
      payment: d.payment && typeof d.payment === 'object'
        ? parsePayment(d.payment as unknown as Record<string, unknown>)
        : null,
    };
  } catch {
    return null;
  }
}

export function clearRegistrationReceipt(slug: string): void {
  try {
    sessionStorage.removeItem(RECEIPT_KEY_PREFIX + slug);
  } catch {
    // no-op
  }
}
