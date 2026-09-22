// 주최 대회 운영(Admin) — 신청 목록 / 상태 변경 / 이력.
//
//   · 원본 테이블을 클라이언트가 직접 SELECT 하지 않는다. 전부 운영 RPC 경유.
//     RPC 내부에서 can_manage_tournaments()(CEO/ADMIN)를 다시 검증하므로
//     UI 가 뚫려도 데이터가 나가지 않는다.
//   · 마이그레이션 미적용/권한 없음은 ready=false 로 흡수해 화면이 깨지지 않게 한다.

import { supabase } from '@/lib/supabase';
import type { PaymentStatus, RegistrationStatus } from './types';

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournament|get_admin_|set_tournament_registration_(status|players)|get_tournament_registration_history/.test(msg) &&
      /does not exist|schema cache|Could not find/.test(msg))
  );
};

// ── 대회 목록 ────────────────────────────────────────────────────────────────
export interface AdminHostedTournament {
  id: string;
  slug: string;
  title: string;
  status: string;
  eventDate: string;
  registrationCloseAt: string | null;
  entryFee: number;
  targetCapacity: number;
  maxCapacity: number;
  activeCount: number;
  /** 정상 참가 슬롯 점유(applied + confirmed). 정책 SQL 적용 전 서버에는 없어 활성 − 대기로 대신한다. */
  normalCount: number;
  waitlistedCount: number;
  confirmedCount: number;
  paidCount: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function fetchAdminTournaments(): Promise<{
  ready: boolean;
  rows: AdminHostedTournament[];
}> {
  try {
    const { data, error } = await supabase.rpc('get_admin_hosted_tournaments');
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return {
      ready: true,
      rows: rows.map((r) => ({
        id: String(r.id || ''),
        slug: String(r.slug || ''),
        title: String(r.title || ''),
        status: String(r.status || ''),
        eventDate: String(r.eventDate || ''),
        registrationCloseAt: (r.registrationCloseAt as string) ?? null,
        entryFee: num(r.entryFee),
        targetCapacity: num(r.targetCapacity),
        maxCapacity: num(r.maxCapacity),
        activeCount: num(r.activeCount),
        normalCount: r.normalCount === undefined
          ? Math.max(num(r.activeCount) - num(r.waitlistedCount), 0)
          : num(r.normalCount),
        waitlistedCount: num(r.waitlistedCount),
        confirmedCount: num(r.confirmedCount),
        paidCount: num(r.paidCount),
      })),
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    console.warn('[tournaments/admin] 대회 목록 조회 실패:', err);
    return { ready: true, rows: [] };
  }
}

// ── 신청 목록 ────────────────────────────────────────────────────────────────
export interface AdminRegistrationRow {
  id: string;
  sequenceNo: number;
  registrationNo: string;
  player1Name: string;
  player1Phone: string;
  player2Name: string;
  player2Phone: string;
  clubName: string | null;
  /** 선수별 클럽. 미보정 기존 건은 null. */
  player1ClubName: string | null;
  player2ClubName: string | null;
  depositorName: string;
  note: string | null;
  registrationStatus: RegistrationStatus;
  paymentStatus: PaymentStatus;
  /**
   * 대기 순번(1..N) — 서버가 waitlisted 를 sequence_no 순으로 세어 계산한다. waitlisted 가 아니면 null.
   *   ⚠ 표시 전용. 원본 sequence_no / registration_no 는 바뀌지 않는다.
   */
  waitlistPosition: number | null;
  eligibilityConfirmedAt: string | null;
  regulationsConfirmedAt: string | null;
  privacyAgreedAt: string | null;
  mediaNoticeConfirmedAt: string | null;
  submittedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  adminNote: string | null;
}

const mapRow = (r: Record<string, unknown>): AdminRegistrationRow => ({
  id: String(r.id || ''),
  sequenceNo: num(r.sequenceNo),
  registrationNo: String(r.registrationNo || ''),
  player1Name: String(r.player1Name || ''),
  player1Phone: String(r.player1Phone || ''),
  player2Name: String(r.player2Name || ''),
  player2Phone: String(r.player2Phone || ''),
  clubName: (r.clubName as string) ?? null,
  player1ClubName: (r.player1ClubName as string) ?? null,
  player2ClubName: (r.player2ClubName as string) ?? null,
  depositorName: String(r.depositorName || ''),
  note: (r.note as string) ?? null,
  registrationStatus: (r.registrationStatus as RegistrationStatus) || 'applied',
  paymentStatus: (r.paymentStatus as PaymentStatus) || 'pending',
  waitlistPosition: Number.isInteger(Number(r.waitlistPosition)) && Number(r.waitlistPosition) >= 1
    ? Number(r.waitlistPosition) : null,
  eligibilityConfirmedAt: (r.eligibilityConfirmedAt as string) ?? null,
  regulationsConfirmedAt: (r.regulationsConfirmedAt as string) ?? null,
  privacyAgreedAt: (r.privacyAgreedAt as string) ?? null,
  mediaNoticeConfirmedAt: (r.mediaNoticeConfirmedAt as string) ?? null,
  submittedAt: String(r.submittedAt || ''),
  confirmedAt: (r.confirmedAt as string) ?? null,
  cancelledAt: (r.cancelledAt as string) ?? null,
  adminNote: (r.adminNote as string) ?? null,
});

export async function fetchAdminRegistrations(
  slug: string,
): Promise<{ ready: boolean; rows: AdminRegistrationRow[] }> {
  try {
    const { data, error } = await supabase.rpc('get_admin_tournament_registrations', { p_slug: slug });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    return { ready: true, rows: rows.map(mapRow) };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    console.warn('[tournaments/admin] 신청 목록 조회 실패:', err);
    return { ready: true, rows: [] };
  }
}

// ── 상태 변경 이력 ───────────────────────────────────────────────────────────
export interface RegistrationHistoryRow {
  action: string;
  fromValue: string | null;
  toValue: string | null;
  actorType: string;
  note: string | null;
  createdAt: string;
}

export async function fetchRegistrationHistory(
  registrationId: string,
): Promise<RegistrationHistoryRow[]> {
  try {
    const { data, error } = await supabase.rpc('get_tournament_registration_history', {
      p_registration_id: registrationId,
    });
    if (error) throw error;
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    // actorUserId 는 응답에 있지만 화면에 쓰지 않는다(내부 식별자 비노출).
    return rows.map((h) => ({
      action: String(h.action || ''),
      fromValue: (h.fromValue as string) ?? null,
      toValue: (h.toValue as string) ?? null,
      actorType: String(h.actorType || ''),
      note: (h.note as string) ?? null,
      createdAt: String(h.createdAt || ''),
    }));
  } catch (err) {
    if (!isMissingRelation(err)) console.warn('[tournaments/admin] 이력 조회 실패:', err);
    return [];
  }
}

// ── 상태 변경 ────────────────────────────────────────────────────────────────
export interface SetRegistrationStatusInput {
  registrationId: string;
  /** null = 변경 없음. */
  registrationStatus?: RegistrationStatus | null;
  paymentStatus?: PaymentStatus | null;
  /** null = 변경 없음, '' = 지우기. */
  adminNote?: string | null;
}

export async function setRegistrationStatus(v: SetRegistrationStatusInput): Promise<void> {
  const { error } = await supabase.rpc('set_tournament_registration_status', {
    p_registration_id: v.registrationId,
    p_registration_status: v.registrationStatus ?? null,
    p_payment_status: v.paymentStatus ?? null,
    p_admin_note: v.adminNote ?? null,
  });
  if (error) throw error;
}

// ── 대기팀 승격 ──────────────────────────────────────────────────────────────
//   waitlisted → applied. 이 승격이 '입금 요청 대상이 됨'이다(payment_status 는 pending 그대로).
//   ⚠ 서버가 lock 안에서 정상 슬롯(< max)을 다시 확인하고, 대기 1번이 아니면 사유를 요구한다.
//      화면의 경고 · 사유 입력은 1차 안내일 뿐이다.
export interface PromoteWaitlistedResult {
  registrationNo: string;
  previousWaitlistPosition: number;
  exceptional: boolean;
  normalCount: number;
  waitlistedCount: number;
}

export async function promoteWaitlistedRegistration(
  registrationId: string,
  reason: string | null,
): Promise<PromoteWaitlistedResult> {
  const { data, error } = await supabase.rpc('promote_waitlisted_tournament_registration', {
    p_registration_id: registrationId,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });
  if (error) throw error;
  const d = (data || {}) as Record<string, unknown>;
  return {
    registrationNo: String(d.registrationNo || ''),
    previousWaitlistPosition: num(d.previousWaitlistPosition),
    exceptional: d.exceptional === true,
    normalCount: num(d.normalCount),
    waitlistedCount: num(d.waitlistedCount),
  };
}

// ── 선수(파트너) 교체 ────────────────────────────────────────────────────────
//   ⚠ 이 함수는 신원만 바꾼다. 접수번호·순번·신청상태·입금상태는 서버가 유지한다.
//      허용 여부(취소/거절/환불 상태 차단)도 서버 RPC 가 최종 판정한다 —
//      아래 canEditPlayers 는 버튼을 미리 잠그기 위한 UI 1차 방어선일 뿐이다.
export interface SetRegistrationPlayersInput {
  registrationId: string;
  /** null/undefined = 변경 없음. */
  player1Name?: string | null;
  /** 하이픈 포함 표시값을 그대로 보내도 서버가 정규화한다. */
  player1Phone?: string | null;
  player2Name?: string | null;
  player2Phone?: string | null;
  /** null = 변경 없음, '' = 클럽 지우기(NULL). */
  clubName?: string | null;
  /** 선수별 클럽. null = 변경 없음, '' = 지우기. 기존 건 보정에 쓴다. */
  player1ClubName?: string | null;
  player2ClubName?: string | null;
  depositorName?: string | null;
  /** 필수. 빈 값이면 서버가 REASON_REQUIRED 로 거부한다. */
  reason: string;
  /** 필수 true. 운영진이 변경된 선수의 참가자격을 재확인했다는 선언. */
  eligibilityRechecked: boolean;
}

export async function setRegistrationPlayers(v: SetRegistrationPlayersInput): Promise<void> {
  const { error } = await supabase.rpc('set_tournament_registration_players', {
    p_registration_id: v.registrationId,
    p_player1_name: v.player1Name ?? null,
    p_player1_phone: v.player1Phone ?? null,
    p_player2_name: v.player2Name ?? null,
    p_player2_phone: v.player2Phone ?? null,
    p_club_name: v.clubName ?? null,
    p_player1_club_name: v.player1ClubName ?? null,
    p_player2_club_name: v.player2ClubName ?? null,
    p_depositor_name: v.depositorName ?? null,
    p_reason: v.reason,
    p_eligibility_rechecked: v.eligibilityRechecked,
  });
  if (error) throw error;
}

/** 교체 가능 여부(UI 선차단). 서버 게이트와 같은 기준을 쓴다. */
export function canEditPlayers(row: {
  registrationStatus: RegistrationStatus;
  paymentStatus: PaymentStatus;
}): { ok: boolean; reason: string | null } {
  if (!['applied', 'waitlisted', 'confirmed'].includes(row.registrationStatus)) {
    return { ok: false, reason: '취소·거절된 신청은 선수를 변경할 수 없습니다.' };
  }
  if (!['pending', 'paid'].includes(row.paymentStatus)) {
    return { ok: false, reason: '환불 절차 중이거나 환불 완료된 신청은 선수를 변경할 수 없습니다.' };
  }
  return { ok: true, reason: null };
}

export function adminActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  if (msg.includes('FORBIDDEN') || code === '42501') return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (msg.includes('REGISTRATION_NOT_FOUND')) return '신청을 찾을 수 없습니다.';
  if (msg.includes('INVALID_PAYMENT_TRANSITION')) return '현재 입금 상태에서는 선택할 수 없는 처리입니다.';
  if (msg.includes('INVALID_STATUS')) return '허용되지 않은 상태입니다.';
  if (msg.includes('NORMAL_CAPACITY_FULL')) return '정상 참가 슬롯이 가득 찼습니다. 정상 참가 팀의 취소 등으로 빈자리가 생긴 뒤 다시 시도해 주세요.';
  if (msg.includes('PROMOTION_REASON_REQUIRED')) return '대기 1번이 아닌 팀을 승격하려면 사유를 입력해 주세요.';
  if (msg.includes('NOT_WAITLISTED')) return '대기 상태인 신청만 승격할 수 있습니다. 목록을 새로고침해 주세요.';
  // 구버전 서버(정책 SQL 적용 전) 코드
  if (msg.includes('TOURNAMENT_FULL')) return '최대 접수 인원을 초과해 활성 상태로 되돌릴 수 없습니다.';
  if (msg.includes('DUPLICATE_REGISTRATION')) return '같은 팀의 다른 신청이 이미 활성 상태입니다.';
  // 선수 교체 전용
  if (msg.includes('REASON_REQUIRED')) return '변경 사유를 입력해 주세요.';
  if (msg.includes('ELIGIBILITY_RECHECK_REQUIRED')) return '참가자격 재확인에 체크해 주세요.';
  if (msg.includes('REGISTRATION_NOT_EDITABLE')) return '취소·거절된 신청은 선수를 변경할 수 없습니다.';
  if (msg.includes('PAYMENT_NOT_EDITABLE')) return '환불 절차 중이거나 환불 완료된 신청은 선수를 변경할 수 없습니다.';
  if (msg.includes('SAME_PLAYER_PHONE')) return '선수 2명의 연락처가 같습니다.';
  if (msg.includes('INVALID_PHONE')) return '연락처 형식이 올바르지 않습니다. (01x-0000-0000)';
  if (msg.includes('REQUIRED_FIELD_MISSING')) return '이름과 입금자명은 비울 수 없습니다.';
  if (msg.includes('FIELD_TOO_LONG')) return '입력이 너무 깁니다.';
  if (msg.includes('NO_CHANGES')) return '변경된 내용이 없습니다.';
  return msg || '처리에 실패했습니다.';
}

// ── 표시 helper ──────────────────────────────────────────────────────────────
/** 목록에서는 가운데를 가린다. 원문은 상세에서만 노출. */
export function maskPhone(phone: string): string {
  const d = (phone || '').replace(/[^0-9]/g, '');
  if (d.length < 7) return phone ? '***' : '';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

/** 숫자만 저장된 번호를 보기 좋게. */
export function formatPhone(phone: string): string {
  const d = (phone || '').replace(/[^0-9]/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  applied: '접수',
  waitlisted: '대기',
  confirmed: '참가확정',
  cancelled: '취소',
  rejected: '거절',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: '미입금',
  paid: '입금완료',
  refund_pending: '환불대기',
  refunded: '환불완료',
};

export const HISTORY_ACTION_LABEL: Record<string, string> = {
  submit: '신청 접수',
  registration_status: '신청 상태 변경',
  payment_status: '입금 상태 변경',
  admin_note: '운영 메모 변경',
  // 선수 교체 — player*_phone 의 값은 서버가 마스킹해 저장한다(원문 없음).
  player1_name: '선수1 이름 변경',
  player1_phone: '선수1 연락처 변경',
  player2_name: '선수2 이름 변경',
  player2_phone: '선수2 연락처 변경',
  club_name: '클럽명 변경(팀)',
  player1_club_name: '선수1 클럽 변경',
  player2_club_name: '선수2 클럽 변경',
  depositor_name: '입금자명 변경',
};
