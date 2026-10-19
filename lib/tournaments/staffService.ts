// 현장 운영자(외부 비회원 가능) — 권한 요청 · 상태 · 경기판 · 본부 승인/회수 (현장 운영 3단계).
//
//   · 권한은 서버(RPC)가 판정한다. 화면은 서버가 준 상태를 그대로 보여 줄 뿐이다.
//     현장 운영자 권한 = 대회별 허용 목록(승인 + 만료 전). profiles.role 과 무관.
//   · 현장 운영자가 쓰는 쓰기 RPC 는 기존 운영 RPC 그대로다: start_hosted_match_timer · complete_match ·
//     complete_knockout_match(본선 — 승자 진출 포함). 서버가 현장 운영자/본부를 가려 허용한다.
//   · 체크인 · 코트 투입 · 호명 · 취소 · 점수 정정 · 대진 수정은 현장 운영자에게 서버가 거절한다(화면에도 버튼이 없다).

import { supabase } from '@/lib/supabase';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** 현장 운영자 SQL 이 아직 적용되지 않은 서버인가. */
export function isStaffMissing(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return code === 'PGRST202' || code === '42883'
    || (/request_tournament_staff|get_my_tournament_staff|get_staff_match_board|tournament_staff/.test(msg)
        && /does not exist|schema cache|Could not find/.test(msg));
}

function bizError(o: Record<string, unknown>): Error & { reason: string } {
  const err = new Error(str(o.reason) || 'UNKNOWN') as Error & { reason: string };
  err.reason = str(o.reason) || 'UNKNOWN';
  return err;
}

// ── 현장 운영자 본인 ──────────────────────────────────────────────────────────────

export type StaffStatus = 'none' | 'pending' | 'approved' | 'expired' | 'revoked' | 'closed' | 'manager';

export interface MyStaffState {
  slug: string;
  title: string;
  status: StaffStatus;
  displayName: string | null;
  /** 승인 대기 중일 때만 — 본부 승인 화면의 숫자와 같아야 한다(본인 확인용). */
  verifyCode: string | null;
  expiresAt: string | null;
  serverNow: string | null;
}

const STATUSES: StaffStatus[] = ['none', 'pending', 'approved', 'expired', 'revoked', 'closed', 'manager'];

export async function fetchMyStaff(slug: string): Promise<MyStaffState> {
  const { data, error } = await supabase.rpc('get_my_tournament_staff', { p_slug: slug });
  if (error) throw error;
  const o = rec(data);
  if (o.ok !== true) throw bizError(o);
  const s = str(o.status) as StaffStatus;
  return {
    slug: str(o.slug) || slug,
    title: str(o.title),
    status: STATUSES.includes(s) ? s : 'none',
    displayName: strOrNull(o.displayName),
    verifyCode: strOrNull(o.verifyCode),
    expiresAt: strOrNull(o.expiresAt),
    serverNow: strOrNull(o.serverNow),
  };
}

export async function requestStaff(slug: string, displayName: string): Promise<StaffStatus> {
  const { data, error } = await supabase.rpc('request_tournament_staff', {
    p_slug: slug, p_display_name: displayName,
  });
  if (error) throw error;
  const o = rec(data);
  if (o.ok !== true) throw bizError(o);
  const s = str(o.status) as StaffStatus;
  return STATUSES.includes(s) ? s : 'pending';
}

export interface StaffMatchTeam { teamNo: number; player1Name: string; player2Name: string }
export interface StaffMatch {
  matchId: string;
  matchNo: number;
  stage: 'preliminary' | 'knockout';
  groupNo: number | null;
  groupType: string | null;
  status: 'waiting' | 'calling' | 'playing' | 'completed';
  courtNo: number | null;
  version: number;
  score1: number | null;
  score2: number | null;
  startedAt: string | null;
  playStartedAt: string | null;
  completedAt: string | null;
  team1: StaffMatchTeam;
  team2: StaffMatchTeam;
}
export interface StaffCourt { courtNo: number; displayName: string | null; status: string }
export interface StaffBoard {
  slug: string;
  title: string;
  tournamentStatus: string;
  role: 'staff' | 'manager';
  expiresAt: string | null;
  matches: StaffMatch[];
  courts: StaffCourt[];
  serverNow: string | null;
  /** 받은 시각(기기 시계) — 서버 시계 보정용. */
  receivedAt: number;
}

const teamOf = (v: unknown): StaffMatchTeam => {
  const r = rec(v);
  return { teamNo: num(r.teamNo), player1Name: str(r.player1Name), player2Name: str(r.player2Name) };
};

/**
 * 현장 운영자 경기판. 권한이 없으면(미승인 · 만료 · 회수 · 대회 종료) 서버가 null → ready=false.
 *   ⚠ 네트워크 · 서버 오류는 throw — 보던 화면을 지우지 않고 안내만 한다.
 */
export async function fetchStaffBoard(slug: string): Promise<{ ready: boolean; board: StaffBoard | null }> {
  const { data, error } = await supabase.rpc('get_staff_match_board', { p_slug: slug });
  if (error) throw error;
  if (data === null || data === undefined) return { ready: false, board: null };
  const o = rec(data);
  const matches = (Array.isArray(o.matches) ? o.matches : []).map((x): StaffMatch => {
    const r = rec(x);
    const st = str(r.status);
    return {
      matchId: str(r.matchId),
      matchNo: num(r.matchNo),
      stage: str(r.stage) === 'knockout' ? 'knockout' : 'preliminary',
      groupNo: numOrNull(r.groupNo),
      groupType: strOrNull(r.groupType),
      status: (['waiting', 'calling', 'playing', 'completed'].includes(st) ? st : 'waiting') as StaffMatch['status'],
      courtNo: numOrNull(r.courtNo),
      version: num(r.version),
      score1: numOrNull(r.score1),
      score2: numOrNull(r.score2),
      startedAt: strOrNull(r.startedAt),
      playStartedAt: strOrNull(r.playStartedAt),
      completedAt: strOrNull(r.completedAt),
      team1: teamOf(r.team1),
      team2: teamOf(r.team2),
    };
  }).filter((m) => m.matchId !== '');
  const courts = (Array.isArray(o.courts) ? o.courts : []).map((x): StaffCourt => {
    const r = rec(x);
    return { courtNo: num(r.courtNo), displayName: strOrNull(r.displayName), status: str(r.status) };
  });
  return {
    ready: true,
    board: {
      slug: str(o.slug) || slug,
      title: str(o.title),
      tournamentStatus: str(o.tournamentStatus),
      role: str(o.role) === 'manager' ? 'manager' : 'staff',
      expiresAt: strOrNull(o.expiresAt),
      matches, courts,
      serverNow: strOrNull(o.serverNow),
      receivedAt: Date.now(),
    },
  };
}

// ── 본부(CEO/ADMIN) ──────────────────────────────────────────────────────────

export type StaffAdminStatus = 'pending' | 'approved' | 'expired' | 'revoked' | 'closed';
export interface StaffAdminRow {
  userId: string;
  displayName: string;
  nickname: string | null;
  status: StaffAdminStatus;
  requestedAt: string | null;
  approvedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** 지금까지 회수(거절 포함)된 횟수 — 다시 요청한 사람 표시용. */
  revokeCount: number;
  /** 승인 대기 행에만 — 현장 운영자 휴대폰 화면의 숫자와 대조한다. */
  verifyCode: string | null;
}
export interface StaffAdminList {
  slug: string;
  staff: StaffAdminRow[];
  defaultExpiresAt: string | null;
  serverNow: string | null;
}

export async function fetchStaffAdmin(slug: string): Promise<{ ready: boolean; list: StaffAdminList | null }> {
  const { data, error } = await supabase.rpc('get_admin_tournament_staff', { p_slug: slug });
  if (error) throw error;
  if (data === null || data === undefined) return { ready: false, list: null };
  const o = rec(data);
  const staff = (Array.isArray(o.staff) ? o.staff : []).map((x): StaffAdminRow => {
    const r = rec(x);
    const s = str(r.status);
    return {
      userId: str(r.userId),
      displayName: str(r.displayName),
      nickname: strOrNull(r.nickname),
      status: (['pending', 'approved', 'expired', 'revoked', 'closed'].includes(s) ? s : 'pending') as StaffAdminStatus,
      requestedAt: strOrNull(r.requestedAt),
      approvedAt: strOrNull(r.approvedAt),
      expiresAt: strOrNull(r.expiresAt),
      revokedAt: strOrNull(r.revokedAt),
      revokeCount: num(r.revokeCount),
      verifyCode: strOrNull(r.verifyCode),
    };
  }).filter((r) => r.userId !== '');
  return {
    ready: true,
    list: { slug: str(o.slug) || slug, staff, defaultExpiresAt: strOrNull(o.defaultExpiresAt), serverNow: strOrNull(o.serverNow) },
  };
}

/**
 * 승인(또는 만료 연장). expiresAt=null 이면 서버 기본 만료(대회일 다음날 자정 이후).
 *   ⚠ 승인 대기 행은 verifyCode(본부가 현장 운영자 화면과 대조한 숫자)가 서버 값과 같아야 승인된다.
 *     만료된 승인의 연장은 verifyCode=null.
 */
export async function approveStaff(slug: string, userId: string, verifyCode: string | null, expiresAt: string | null = null): Promise<string | null> {
  const { data, error } = await supabase.rpc('approve_tournament_staff', {
    p_slug: slug, p_user_id: userId, p_expires_at: expiresAt, p_verify_code: verifyCode,
  });
  if (error) throw error;
  const o = rec(data);
  if (o.ok !== true) throw bizError(o);
  return strOrNull(o.expiresAt);
}

/** 회수(승인 취소 · 요청 거절) — 즉시 효력. */
export async function revokeStaff(slug: string, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc('revoke_tournament_staff', { p_slug: slug, p_user_id: userId });
  if (error) throw error;
  const o = rec(data);
  if (o.ok !== true) throw bizError(o);
}

// ── 오류 문구 ────────────────────────────────────────────────────────────────

/** 현장 운영자 · 본부 공통 — 서버 사유를 한국어 한 줄로. 내부 상세를 노출하지 않는다. */
export function staffActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  const reason = String(e?.reason || '');
  if (isStaffMissing(err)) return '현장 운영자 기능이 아직 서버에 적용되지 않았습니다.';
  if (code === '42501' || /not authorized/i.test(msg)) return '권한이 없거나 만료되었습니다. 본부에 확인해 주세요.';
  switch (reason) {
    case 'invalid_display_name': return '이름을 1~20자로 입력해 주세요.';
    case 'tournament_not_found': return '대회를 찾을 수 없습니다. 주소를 확인해 주세요.';
    case 'tournament_closed':    return '종료된 대회입니다.';
    case 'too_many_requests':    return '대기 중인 요청이 많습니다. 본부에 직접 알려 주세요.';
    case 'staff_not_found':      return '요청 기록이 없습니다. 현장 운영자가 먼저 권한을 요청해야 합니다.';
    case 'staff_not_pending':    return '회수된 요청입니다. 현장 운영자가 다시 요청하면 새 확인 코드로 승인할 수 있습니다.';
    case 'verify_code_mismatch': return '확인 코드가 바뀌었습니다(현장 운영자가 다시 요청함). 목록을 새로 불러왔으니 현장 운영자 화면의 코드와 다시 대조해 주세요.';
    case 'invalid_expiry':       return '만료 시각은 지금부터 10분 ~ 14일 사이여야 합니다.';
    case 'knockout_requires_bracket_rpc': return '본선 경기입니다. 화면을 새로 불러온 뒤 다시 입력해 주세요.';
    case 'not_knockout_match':   return '예선 경기입니다. 화면을 새로 불러온 뒤 다시 입력해 주세요.';
    case 'bracket_completed':    return '본선이 이미 끝났습니다. 본부에 확인해 주세요.';
    case 'slot_occupied':        return '다음 라운드 자리가 이미 채워져 있습니다. 본부에 확인해 주세요.';
    case 'bracket_link_missing': return '대진 연결 정보가 없습니다. 본부에 확인해 주세요.';
    case 'version_conflict':     return '다른 기기에서 먼저 처리했습니다. 화면을 새로 불러왔습니다.';
    case 'already_changed':      return '이미 다른 기기에서 처리된 경기입니다.';
    case 'not_playing':          return '코트에 투입된 경기만 시작할 수 있습니다.';
    case 'invalid_score':        return '점수는 6:0~6:5 또는 0:6~5:6 만 입력할 수 있습니다.';
    case 'match_not_found':      return '경기를 찾을 수 없습니다. 화면을 새로 불러와 주세요.';
    default: break;
  }
  if (/fetch|network|Failed to fetch|timeout|NetworkError/i.test(msg)) return '연결이 불안정합니다. 잠시 후 다시 시도해 주세요.';
  return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}
