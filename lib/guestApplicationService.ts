// TEYEON PUBLIC_GUEST — 공개 모집 조회 / 신청 제출 / 운영진 신청 관리.
//   · 공개(anon): get_open_guest_recruitments / submit_guest_application RPC 로만(원본 테이블 직접 접근 없음).
//   · 운영진: guest_applications SELECT(RLS: can_manage) + set_guest_application_status RPC.
//   · 테이블/RPC 미적용(마이그레이션 전) → ready=false / 빈 결과 폴백(화면 무장애 + "준비 중" 안내).
import { supabase } from './supabase';

// ── 공개 모집 ────────────────────────────────────────────────────────────────
//   ⚠ 공개 응답에는 내부 UUID(id/schedule_id/club_id)가 없다 — 공개 식별자 publicToken 만 사용.
export interface OpenRecruitment {
  publicToken: string;
  title: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  maxGuests: number | null;
  applicationDeadline: string | null;
  publicMessage: string | null;
  /** KDK 세션 게스트비(원). null=미설정/미연결. 0=무료(유효). */
  guestFee: number | null;
  canApply: boolean;
}

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === '42P01' || code === 'PGRST202' || code === 'PGRST205' ||
    (/guest_recruitments|guest_applications|get_open_guest_recruitments|submit_guest_application|set_guest_application_status/.test(msg)
      && /does not exist|schema cache|Could not find/.test(msg));
};

/** 공개 모집 목록. ready=false → 아직 준비 중(RPC 미적용). */
export async function fetchOpenRecruitments(): Promise<{ ready: boolean; recruitments: OpenRecruitment[] }> {
  try {
    const { data, error } = await supabase.rpc('get_open_guest_recruitments');
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return { ready: true, recruitments: rows as OpenRecruitment[] };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, recruitments: [] };
    console.warn('[guest] 모집 조회 실패:', err);
    return { ready: true, recruitments: [] }; // 일시 오류는 "모집 없음"으로(준비 중 아님)
  }
}

export interface SubmitGuestApplicationInput {
  publicToken: string;
  name: string;
  phone: string;
  region: string;
  affiliationType: 'club' | 'independent';
  clubName: string;
  tennisExperience: string;
  bestResult?: string;
  note?: string;
  privacyConsent: boolean;
}

export const GUEST_SUBMIT_NOT_READY = 'GUEST_SUBMIT_NOT_READY';

/** 신청 제출. 서버 RPC 가 검증·중복차단. 미적용 시 GUEST_SUBMIT_NOT_READY 던짐(화면은 "준비 중" 안내). */
export async function submitGuestApplication(v: SubmitGuestApplicationInput): Promise<{ success: boolean; message: string }> {
  try {
    const { data, error } = await supabase.rpc('submit_guest_application', {
      p_public_token: v.publicToken,
      p_name: v.name,
      p_phone: v.phone,
      p_region: v.region,
      p_affiliation_type: v.affiliationType,
      p_club_name: v.clubName,
      p_tennis_experience: v.tennisExperience,
      p_best_result: v.bestResult ?? null,
      p_note: v.note ?? null,
      p_privacy_consent: v.privacyConsent,
    });
    if (error) throw error;
    return (data as { success: boolean; message: string }) ?? { success: true, message: '신청이 접수되었습니다.' };
  } catch (err) {
    if (isMissingRelation(err)) { const e = new Error(GUEST_SUBMIT_NOT_READY); e.name = GUEST_SUBMIT_NOT_READY; throw e; }
    throw err;
  }
}

/** 신청 제출 오류 → 사용자 일반 안내(개인정보·다른 신청 정보 미노출). */
export function guestSubmitMessage(err: unknown): string {
  const msg = String((err as { message?: unknown })?.message || '');
  if (msg.includes('DUPLICATE_APPLICATION')) return '이미 신청이 접수되어 있습니다. 운영진 확인을 기다려 주세요.';
  if (msg.includes('RECRUITMENT_NOT_OPEN')) return '현재 신청을 받고 있지 않습니다.';
  if (msg.includes('RECRUITMENT_CLOSED')) return '신청이 마감되었습니다.';
  if (msg.includes('INVALID_PHONE')) return '휴대폰 번호 형식을 확인해 주세요.';
  if (msg.includes('PRIVACY_CONSENT_REQUIRED')) return '개인정보 수집·이용에 동의해 주세요.';
  if (msg.includes('REQUIRED_FIELD_MISSING') || msg.includes('INVALID_AFFILIATION')) return '입력값을 확인해 주세요.';
  return '신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
}

// ── 운영진 신청 관리 ─────────────────────────────────────────────────────────
export type GuestApplicationStatus = 'pending' | 'approved' | 'on_hold' | 'rejected';
export interface GuestApplicationRow {
  id: string;
  recruitmentId: string;
  scheduleId: string;
  name: string;
  phone: string;
  region: string;
  affiliationType: 'club' | 'independent';
  clubName: string;
  tennisExperience: string;
  bestResult: string | null;
  note: string | null;
  status: GuestApplicationStatus;
  operatorNote: string | null;
  sourceType: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const APP_COLS = 'id, recruitment_id, schedule_id, name, phone, region, affiliation_type, club_name, tennis_experience, best_result, note, status, operator_note, source_type, reviewed_by, reviewed_at, created_at';

const mapApp = (r: any): GuestApplicationRow => ({
  id: String(r.id), recruitmentId: String(r.recruitment_id), scheduleId: String(r.schedule_id),
  name: String(r.name || ''), phone: String(r.phone || ''), region: String(r.region || ''),
  affiliationType: r.affiliation_type, clubName: String(r.club_name || ''),
  tennisExperience: String(r.tennis_experience || ''), bestResult: r.best_result ?? null, note: r.note ?? null,
  status: r.status, operatorNote: r.operator_note ?? null, sourceType: String(r.source_type || ''),
  reviewedBy: r.reviewed_by ?? null, reviewedAt: r.reviewed_at ?? null, createdAt: String(r.created_at),
});

/** 운영진 신청 목록(RLS: can_manage 만 결과 반환. MEMBER 는 빈 배열). pending 우선·최신순. */
export async function fetchGuestApplications(): Promise<{ ready: boolean; rows: GuestApplicationRow[] }> {
  try {
    const { data, error } = await supabase
      .from('guest_applications').select(APP_COLS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const rows = (data || []).map(mapApp);
    // pending 우선 정렬(그다음 최신순은 위 order 유지).
    const rank = (s: GuestApplicationStatus) => (s === 'pending' ? 0 : s === 'on_hold' ? 1 : 2);
    rows.sort((a, b) => rank(a.status) - rank(b.status));
    return { ready: true, rows };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    console.warn('[guest] 운영 목록 조회 실패:', err);
    return { ready: true, rows: [] };
  }
}

export async function setGuestApplicationStatus(id: string, status: GuestApplicationStatus, operatorNote: string): Promise<void> {
  const { error } = await supabase.rpc('set_guest_application_status', {
    p_application_id: id, p_status: status, p_operator_note: operatorNote || null,
  });
  if (error) throw error;
}

/** 운영 오류 → 안내 문구. */
export function guestOperatorMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  if (msg.includes('RECRUITMENT_FULL')) return '모집 정원을 초과해 승인할 수 없습니다.';
  if (msg.includes('FORBIDDEN') || code === '42501') return '권한이 없습니다(게스트 담당 운영진 전용).';
  if (msg.includes('APPLICATION_NOT_FOUND')) return '신청을 찾을 수 없습니다.';
  if (msg.includes('INVALID_STATUS')) return '허용되지 않은 상태입니다.';
  return msg || '처리에 실패했습니다.';
}

/** 전화번호 목록 마스킹(가운데 4자리 가림). 상세에서만 원문 표시. */
export function maskPhone(phone: string): string {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  if (digits.length < 7) return phone ? '***' : '';
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

// ── 운영진: 정모별 공개 모집 설정 ─────────────────────────────────────────────
export type RecruitmentStatus = 'draft' | 'open' | 'closed' | 'completed' | 'cancelled';
export interface ScheduleRecruitment {
  scheduleId: string;
  publicToken: string;
  status: RecruitmentStatus;
  maxGuests: number | null;
  applicationDeadline: string | null;
  publicMessage: string | null;
}
const REC_COLS = 'schedule_id, public_token, status, max_guests, application_deadline, public_message';
const mapRec = (r: any): ScheduleRecruitment => ({
  scheduleId: String(r.schedule_id), publicToken: String(r.public_token), status: r.status,
  maxGuests: r.max_guests ?? null, applicationDeadline: r.application_deadline ?? null, publicMessage: r.public_message ?? null,
});

/** 정모의 공개 모집 1건(없으면 null). ready=false → 저장소 미적용. RLS: 운영진만 실효. */
export async function fetchScheduleRecruitment(scheduleId: string): Promise<{ ready: boolean; recruitment: ScheduleRecruitment | null }> {
  try {
    const { data, error } = await supabase.from('guest_recruitments').select(REC_COLS).eq('schedule_id', scheduleId).maybeSingle();
    if (error) throw error;
    return { ready: true, recruitment: data ? mapRec(data) : null };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, recruitment: null };
    console.warn('[guest] 모집 조회 실패:', err);
    return { ready: true, recruitment: null };
  }
}

export interface UpsertRecruitmentInput {
  scheduleId: string;
  status: RecruitmentStatus;
  maxGuests: number | null;
  applicationDeadline: string | null;  // ISO 또는 null
  publicMessage: string | null;
}
export async function upsertGuestRecruitment(v: UpsertRecruitmentInput): Promise<void> {
  const { error } = await supabase.rpc('upsert_guest_recruitment', {
    p_schedule_id: v.scheduleId, p_status: v.status, p_max_guests: v.maxGuests,
    p_application_deadline: v.applicationDeadline, p_public_message: v.publicMessage,
  });
  if (error) throw error;
}

/** 관리 요약(정모명 + 상태 + 정원 + total/pending/approved). RPC(운영진). */
export interface RecruitmentSummary {
  scheduleId: string; publicToken: string; title: string; date: string | null;
  status: RecruitmentStatus; maxGuests: number | null; total: number; pending: number; approved: number;
}
export async function fetchAdminRecruitmentSummaries(): Promise<{ ready: boolean; rows: RecruitmentSummary[] }> {
  try {
    const { data, error } = await supabase.rpc('get_admin_guest_recruitments');
    if (error) throw error;
    return { ready: true, rows: (Array.isArray(data) ? data : []) as RecruitmentSummary[] };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, rows: [] };
    console.warn('[guest] 모집 요약 조회 실패:', err);
    return { ready: true, rows: [] };
  }
}

// ── 승인 게스트 → KDK 후보 DTO (최소 필드) ───────────────────────────────────
export interface KdkGuestCandidate {
  displayName: string;
  sourceType: 'public_application';
  applicationId: string;
  scheduleId: string;
  approved: true;
}
/** 특정 정모(scheduleId)의 승인 신청 → KDK 후보 목록(최소 필드). 자동 등록 아님 — 운영진 선택용. */
export function approvedKdkCandidates(rows: GuestApplicationRow[], scheduleId: string): KdkGuestCandidate[] {
  return rows
    .filter((r) => r.status === 'approved' && r.scheduleId === scheduleId)
    .map((r) => ({ displayName: r.name, sourceType: 'public_application', applicationId: r.id, scheduleId: r.scheduleId, approved: true }));
}
