// 공개 참가신청 제출 — anon.
//
//   · 원본 테이블(hosted_tournament_registrations)에 직접 INSERT 하지 않는다.
//     서버 RPC submit_tournament_registration 만 호출하며, 접수순번·정원(48/60) 판정·중복 차단·
//     접수번호 발급은 전부 서버가 원자적으로 처리한다(클라이언트 count 판정 금지).
//   · 마이그레이션 미적용이면 TOURNAMENT_SUBMIT_NOT_READY 를 던진다.
//     이 경우 화면은 "준비 중" 안내만 하고, 제출된 것처럼 보이는 완료 화면으로 넘기지 않는다.
//   · 전화번호는 반드시 정규화(숫자만)된 값을 넘긴다 — lib/tournaments/validation.normalizePhone.

import { supabase } from '@/lib/supabase';
import type { PaymentStatus, RegistrationStatus } from './types';

export const TOURNAMENT_SUBMIT_NOT_READY = 'TOURNAMENT_SUBMIT_NOT_READY';

export interface SubmitTournamentRegistrationInput {
  slug: string;
  player1Name: string;
  /** 숫자만. */
  player1Phone: string;
  player2Name: string;
  player2Phone: string;
  /** 선택 입력 — 비어 있으면 null. 서버도 빈 문자열을 null 로 저장한다. */
  clubName: string | null;
  depositorName: string;
  note: string | null;
  /** 4개 확인/동의 — 서버가 다시 검증하고 각각 시각으로 저장한다. */
  eligibilityConfirmed: boolean;
  regulationsConfirmed: boolean;
  privacyAgreed: boolean;
  mediaNoticeConfirmed: boolean;
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
   * 입금 안내. 서버가 'applied'(우선 참가 대상)로 접수된 신청에만 내려준다.
   *   · 공개 Hub RPC(get_public_tournament)에는 계좌가 들어 있지 않다 — 방문자 누구에게나 공개하지 않는다.
   *   · 'waitlisted'(대기 접수)에는 서버가 계좌를 주지 않는다. 대기팀 입금 정책이 미확정이므로
   *     화면이 입금을 유도할 수 있는 데이터 자체를 갖지 않게 한다.
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

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournament|submit_tournament_registration/.test(msg) &&
      /does not exist|schema cache|Could not find/.test(msg))
  );
};

export async function submitTournamentRegistration(
  v: SubmitTournamentRegistrationInput,
): Promise<TournamentRegistrationReceipt> {
  try {
    const { data, error } = await supabase.rpc('submit_tournament_registration', {
      p_slug: v.slug,
      p_player1_name: v.player1Name,
      p_player1_phone: v.player1Phone,
      p_player2_name: v.player2Name,
      p_player2_phone: v.player2Phone,
      p_club_name: v.clubName,
      p_depositor_name: v.depositorName,
      p_note: v.note,
      p_eligibility_confirmed: v.eligibilityConfirmed,
      p_regulations_confirmed: v.regulationsConfirmed,
      p_privacy_agreed: v.privacyAgreed,
      p_media_notice_confirmed: v.mediaNoticeConfirmed,
    });
    if (error) throw error;
    if (!data || typeof data !== 'object') throw new Error('INVALID_RESPONSE');
    const d = data as Record<string, unknown>;
    return {
      registrationNo: String(d.registrationNo || ''),
      registrationStatus: (d.registrationStatus as RegistrationStatus) || 'applied',
      paymentStatus: (d.paymentStatus as PaymentStatus) || 'pending',
      player1Name: String(d.player1Name || ''),
      player2Name: String(d.player2Name || ''),
      entryFee: Number(d.entryFee) || 0,
      payment: parsePayment(d),
    };
  } catch (err) {
    if (isMissingRelation(err)) {
      const e = new Error(TOURNAMENT_SUBMIT_NOT_READY);
      e.name = TOURNAMENT_SUBMIT_NOT_READY;
      throw e;
    }
    throw err;
  }
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
  // 마감일 도래와 정원 만석은 원인이 다르므로 문구를 명확히 구분한다(서버 에러 코드는 변경하지 않는다).
  if (msg.includes('REGISTRATION_CLOSED')) return '참가 신청 접수가 마감되었습니다.';
  if (msg.includes('TOURNAMENT_FULL')) {
    return '모집 정원이 모두 찼습니다. 추가 접수 및 참가 관련 문의는 대회 운영본부로 문의해 주세요.';
  }
  if (msg.includes('DUPLICATE_REGISTRATION') || code === '23505') {
    return '이미 접수된 신청이 있습니다. 수정이 필요하면 대회 운영본부로 연락해 주세요.';
  }
  if (msg.includes('TOO_MANY_ATTEMPTS')) return '잠시 후 다시 시도해 주세요.';
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
