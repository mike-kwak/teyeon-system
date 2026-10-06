// KDK 공식 기록 정정 — Supabase RPC 래퍼.
//
//   ⚠ 계산을 하지 않는다. lib/kdk/correction.ts(순수)가 계산하고, 이 파일은 통신만 한다.
//   ⚠ 업무 실패는 예외가 아니라 { ok:false, reason } jsonb 다(기존 운영 RPC 계약과 동일).
//   ⚠ migration 미적용 환경을 정상 상태로 취급한다 — ready=false 로 알리고 화면이 버튼을 끈다.
//   ⚠ 회원 출생연도는 기존 운영 RPC(admin_get_member_birth_years)를 재사용한다.
//     새 조회 경로를 만들지 않는다(members."나이" 는 컬럼 privilege 로 차단돼 있다).

import { supabase } from '../supabase';
import type { ArchiveRawData, CorrectionImpact } from './correction';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** RPC/테이블이 아직 적용되지 않은 환경인가(기능 준비 전 — 오류가 아니다). */
export function isCorrectionMigrationMissing(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = str(e?.code);
  const msg = str(e?.message);
  return code === 'PGRST202' || code === '42883' || code === '42P01' || code === 'PGRST205'
    || (/correct_kdk_archive_match_score|get_kdk_archive_correction_context|kdk_archive_corrections/.test(msg)
      && /does not exist|schema cache|Could not find/.test(msg));
}

// ── 정정 컨텍스트 ────────────────────────────────────────────────────────────

export interface CorrectionContext {
  archiveId: string;
  rawData: ArchiveRawData;
  /** Postgres md5(raw_data::text). 확정 시 그대로 되돌려 보낸다(낙관적 동시성). */
  fingerprint: string;
  isOfficial: boolean;
  isTest: boolean;
  confirmedAt: string | null;
  correctionCount: number;
}

export type CorrectionContextResult =
  | { ready: true; ok: true; context: CorrectionContext }
  | { ready: true; ok: false; reason: string }
  /** migration 미적용 — 기능 준비 전. */
  | { ready: false; ok: false; reason: 'migration_missing' };

/**
 * 정정용 raw_data + fingerprint 조회.
 *   ⚠ 화면이 들고 있던 평탄화 상태를 쓰지 않고 **항상 서버에서 다시 읽는다** —
 *     next raw_data 는 원본과 구조가 완전히 같아야 하고, fingerprint 도 같은 시점이어야 한다.
 */
export async function fetchCorrectionContext(archiveId: string): Promise<CorrectionContextResult> {
  try {
    const { data, error } = await supabase.rpc('get_kdk_archive_correction_context', {
      p_archive_id: archiveId,
    });
    if (error) throw error;
    const o = rec(data);
    if (o.ok !== true) {
      return { ready: true, ok: false, reason: str(o.reason) || 'unknown' };
    }
    return {
      ready: true,
      ok: true,
      context: {
        archiveId: str(o.archiveId),
        rawData: (o.rawData || {}) as ArchiveRawData,
        fingerprint: str(o.fingerprint),
        isOfficial: o.isOfficial === true,
        isTest: o.isTest === true,
        confirmedAt: o.confirmedAt ? str(o.confirmedAt) : null,
        correctionCount: num(o.correctionCount),
      },
    };
  } catch (err) {
    if (isCorrectionMigrationMissing(err)) {
      return { ready: false, ok: false, reason: 'migration_missing' };
    }
    throw err;
  }
}

// ── 회원 출생연도 ────────────────────────────────────────────────────────────

/**
 * 회원 출생연도(members."나이") — 운영진 전용 RPC.
 *   ⚠ 이 값이 없으면 ①②가 같은 동률에서 공식 순위를 확정할 수 없다(정정 차단).
 *   ⚠ RPC 미적용 환경에서는 빈 Map 을 돌려준다 — 화면이 '출생연도 확인 필요'로 막는다.
 *     (임의 추정·임의 순서 생성 금지.)
 */
export async function fetchMemberBirthYears(
  memberIds: readonly string[],
): Promise<{ ready: boolean; birthYears: Map<string, string> }> {
  const ids = Array.from(new Set(memberIds.filter(id => id && id.trim() !== '')));
  if (ids.length === 0) return { ready: true, birthYears: new Map() };
  try {
    const { data, error } = await supabase.rpc('admin_get_member_birth_years', { p_member_ids: ids });
    if (error) throw error;
    const map = new Map<string, string>();
    (Array.isArray(data) ? data : []).forEach(row => {
      const r = rec(row);
      const id = str(r.member_id);
      const birth = str(r.birth_text);
      if (id && birth.trim() !== '') map.set(id, birth);
    });
    return { ready: true, birthYears: map };
  } catch {
    // 생년 취득 실패는 '확인 불가' 로 다룬다 — 추정하지 않고 화면이 차단한다.
    return { ready: false, birthYears: new Map() };
  }
}

// ── 정정 실행 ────────────────────────────────────────────────────────────────

export interface CorrectionResult {
  correctionId: string;
  archiveId: string;
  matchId: string;
  beforeScore1: number;
  beforeScore2: number;
  afterScore1: number;
  afterScore2: number;
  wasOfficial: boolean;
  fingerprint: string;
}

/** 미리보기 결과에서 감사 로그에 남길 요약만 뽑는다(전체 표를 저장하지 않는다). */
export function buildCorrectionImpactSummary(impact: CorrectionImpact): Record<string, unknown> {
  return {
    totalPlayers: impact.totalPlayers,
    winnerChanged: impact.match?.winnerChanged ?? null,
    rankChanges: impact.rankChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
    groupRankChanges: impact.groupRankChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
    diffChanges: impact.diffChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
    pointsForChanges: impact.pointsForChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
    pointsAgainstChanges: impact.pointsAgainstChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
    winLossChanges: impact.winLossChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
    moneyChanges: impact.moneyChanges.map(c => ({ name: c.name, before: c.before, after: c.after })),
  };
}

/**
 * 정정 실행 — RPC 1회 = 1 트랜잭션.
 *   ⚠ 성공·실패와 무관하게 호출부는 반드시 서버에서 다시 읽는다(optimistic 금지).
 */
export async function correctKdkArchiveMatchScore(args: {
  archiveId: string;
  matchId: string;
  score1: number;
  score2: number;
  reason: string;
  expectedFingerprint: string;
  nextRawData: ArchiveRawData;
  impact: CorrectionImpact;
}): Promise<CorrectionResult> {
  const { data, error } = await supabase.rpc('correct_kdk_archive_match_score', {
    p_archive_id: args.archiveId,
    p_match_id: args.matchId,
    p_score1: args.score1,
    p_score2: args.score2,
    p_reason: args.reason,
    p_expected_fingerprint: args.expectedFingerprint,
    p_next_raw_data: args.nextRawData,
    p_impact: buildCorrectionImpactSummary(args.impact),
  });
  if (error) throw error;
  const o = rec(data);
  if (o.ok !== true) {
    const err = new Error(str(o.reason) || 'UNKNOWN') as Error & {
      reason?: string; payload?: Record<string, unknown>;
    };
    err.reason = str(o.reason);
    err.payload = o;
    throw err;
  }
  return {
    correctionId: str(o.correctionId),
    archiveId: str(o.archiveId),
    matchId: str(o.matchId),
    beforeScore1: num(o.beforeScore1),
    beforeScore2: num(o.beforeScore2),
    afterScore1: num(o.afterScore1),
    afterScore2: num(o.afterScore2),
    wasOfficial: o.wasOfficial === true,
    fingerprint: str(o.fingerprint),
  };
}

// ── 오류 문구 ────────────────────────────────────────────────────────────────

/** RPC reason → 운영자용 한국어 한 줄. 내부 상세를 노출하지 않는다. */
export function correctionActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = str(e?.code);
  const msg = str(e?.message);
  const key = str(e?.reason) || msg;

  if (isCorrectionMigrationMissing(err)) return '정정 기능이 아직 적용되지 않았습니다. (migration 대기)';
  if (code === '42501' || /not authorized|permission denied/i.test(msg)) {
    return '권한이 없습니다. (CEO · ADMIN 전용)';
  }

  switch (key) {
    case 'auth_required':        return '로그인이 필요합니다.';
    case 'forbidden':            return '권한이 없습니다. (CEO · ADMIN 전용)';
    case 'archive_not_found':    return '기록을 찾을 수 없습니다. 목록을 새로고침해 주세요.';
    case 'not_kdk_archive':      return 'KDK 기록만 정정할 수 있습니다.';
    case 'match_not_found':      return '해당 경기를 찾을 수 없습니다. 최신 내용을 다시 불러와 주세요.';
    case 'match_not_complete':   return '완료된 경기만 정정할 수 있습니다.';
    case 'invalid_score':        return '점수를 다시 확인해 주세요. 0 이상이어야 하고 동점은 저장할 수 없습니다.';
    case 'no_change':            return '점수가 기존과 같습니다.';
    case 'reason_required':      return '정정 사유를 4자 이상 입력해 주세요.';
    case 'reason_too_long':      return '정정 사유가 너무 깁니다. 300자 이내로 줄여 주세요.';
    case 'invalid_payload':      return '정정 내용을 다시 계산해 주세요.';
    case 'version_conflict':
      return '다른 관리자가 먼저 이 기록을 변경했습니다. 최신 내용을 다시 불러온 뒤 시도해 주세요.';
    case 'structure_mismatch':
      return '정정 내용이 원본 구조와 맞지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.';
    case 'aggregate_mismatch':
      return '재계산 결과가 서버 검증과 어긋났습니다. 저장하지 않았습니다. 운영진에게 알려 주세요.';
    case 'order_not_monotonic':
      return '순위 재계산 결과가 공식 기준과 어긋났습니다. 저장하지 않았습니다.';
    case 'settlement_order_mismatch':
    case 'settlement_mismatch':
      return '정산 재계산 결과가 서버 검증과 어긋났습니다. 저장하지 않았습니다.';
    case 'settlement_identity_changed':
      return '참가자 구성이 바뀌었습니다. 최신 내용을 다시 불러와 주세요.';
    default:                     return '정정에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

/** 미리보기 단계의 차단 사유 → 한국어. */
export function correctionBlockMessage(blocked: CorrectionImpact['blocked']): string {
  switch (blocked) {
    case 'archive_empty':      return '이 기록에는 재계산할 경기·순위 데이터가 없습니다.';
    case 'match_not_found':    return '경기를 찾을 수 없습니다.';
    case 'match_not_complete': return '완료된 경기만 정정할 수 있습니다.';
    case 'invalid_score':      return '점수는 0 이상의 정수여야 하고, 동점은 저장할 수 없습니다.';
    case 'no_change':          return '기존 점수와 같습니다.';
    case 'unresolved_tie_birth_years':
      return '동률 참가자의 출생연도가 확인되지 않아 공식 순위를 확정할 수 없습니다.';
    default:                   return '';
  }
}
