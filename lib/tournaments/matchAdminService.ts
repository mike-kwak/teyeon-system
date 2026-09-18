// 예선 경기 운영(Admin) — Batch 3A.
//
//   · 원본 테이블을 클라이언트가 직접 SELECT 하지 않는다. 전부 운영 RPC 경유.
//     RPC 내부에서 can_manage_tournaments()(CEO/ADMIN)를 다시 검증한다.
//   · 업무 실패는 예외가 아니라 { ok:false, reason } jsonb 다. 권한 실패(42501)만 예외.
//
//   ⚠ winner 를 클라이언트가 보내지 않는다. 서버가 score 에서 파생한다.
//   ⚠ expected_version 은 '경기 1건'의 version 이다(조편성 version 과 다른 개념).
//     예외: generateMatches 만 조편성 version 을 넘긴다.
//   ⚠ 기권·노쇼는 6:0 으로 complete 에 그대로 넣는다. 별도 경로가 없다.

import { supabase } from '@/lib/supabase';
import type {
  MatchBoard, MatchCourtSlot, MatchStage, MatchStatus, MatchTeam, TournamentMatch,
} from './matchTypes';

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournament_matches|generate_group_matches|(call|uncall|start|complete|cancel)_match|amend_completed_match_score|get_admin_match_board/.test(
      msg,
    ) &&
      /does not exist|schema cache|Could not find/.test(msg))
  );
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : num(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/** RPC 가 돌려준 { ok, reason } 을 확인한다. ok=false 면 reason 을 담아 throw. */
function unwrap(data: unknown): Record<string, unknown> {
  const o = rec(data);
  if (o.ok === false) {
    const err = new Error(str(o.reason) || 'UNKNOWN') as Error & {
      reason?: string;
      payload?: Record<string, unknown>;
    };
    err.reason = str(o.reason);
    err.payload = o;
    throw err;
  }
  return o;
}

const teamOf = (v: unknown): MatchTeam => {
  const r = rec(v);
  return {
    teamId: str(r.teamId),
    teamNo: num(r.teamNo),
    player1Name: str(r.player1Name),
    player2Name: str(r.player2Name),
    teamStatus: (str(r.teamStatus) || 'active') as MatchTeam['teamStatus'],
  };
};

// ── 조회 ─────────────────────────────────────────────────────────────────────

/**
 * 경기 보드 조회.
 *   권한이 없거나 대회를 못 찾으면 RPC 가 null 을 준다 → ready=false 로 구분한다
 *   ('경기 0건'과 '조회 불가'는 다른 상태다).
 */
export async function fetchMatchBoard(
  slug: string,
): Promise<{ ready: boolean; board: MatchBoard | null }> {
  try {
    const { data, error } = await supabase.rpc('get_admin_match_board', { p_slug: slug });
    if (error) throw error;
    if (data === null || data === undefined) return { ready: false, board: null };
    const o = rec(data);
    return {
      ready: true,
      board: {
        slug: str(o.slug),
        tournamentStatus: str(o.tournamentStatus),
        drawStatus: (str(o.drawStatus) || 'draft') as MatchBoard['drawStatus'],
        drawVersion: num(o.drawVersion),
        matchesGenerated: o.matchesGenerated === true,
        matchesStale: o.matchesStale === true,
        matches: (Array.isArray(o.matches) ? o.matches : []).map((m) => {
          const r = rec(m);
          return {
            matchId: str(r.matchId),
            matchNo: num(r.matchNo),
            stage: (str(r.stage) || 'preliminary') as MatchStage,
            groupNo: numOrNull(r.groupNo),
            groupType: (strOrNull(r.groupType) as TournamentMatch['groupType']) ?? null,
            sequenceNo: num(r.sequenceNo),
            status: (str(r.status) || 'waiting') as MatchStatus,
            courtNo: numOrNull(r.courtNo),
            score1: numOrNull(r.score1),
            score2: numOrNull(r.score2),
            winnerTeamId: strOrNull(r.winnerTeamId),
            version: num(r.version),
            team1: teamOf(r.team1),
            team2: teamOf(r.team2),
          } satisfies TournamentMatch;
        }),
        courts: (Array.isArray(o.courts) ? o.courts : []).map((c) => {
          const r = rec(c);
          return {
            courtNo: num(r.courtNo),
            displayName: strOrNull(r.displayName),
            status: (str(r.status) || 'active') as MatchCourtSlot['status'],
            busy: r.busy === true,
          } satisfies MatchCourtSlot;
        }),
      },
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, board: null };
    throw err;
  }
}

// ── 생성 ─────────────────────────────────────────────────────────────────────

export interface GenerateMatchesResult {
  preliminaryMatches: number;
  placementMatches: number;
  totalMatches: number;
  version: number;
}

/**
 * 경기 생성. **조편성 LOCK 을 전제**로 한다.
 *   ⚠ expectedVersion 은 조편성 version(`MatchBoard.drawVersion`)이다.
 *   ⚠ 이미 경기가 있으면 서버가 거부한다(조용한 재생성 없음).
 */
export async function generateMatches(
  slug: string,
  expectedDrawVersion: number,
): Promise<GenerateMatchesResult> {
  const { data, error } = await supabase.rpc('generate_group_matches', {
    p_slug: slug,
    p_expected_version: expectedDrawVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    preliminaryMatches: num(o.preliminaryMatches),
    placementMatches: num(o.placementMatches),
    totalMatches: num(o.totalMatches),
    version: num(o.version),
  };
}

// ── lifecycle ────────────────────────────────────────────────────────────────

export interface MatchWriteResult {
  version: number;
}

async function matchWrite(fn: string, args: Record<string, unknown>): Promise<MatchWriteResult> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const o = unwrap(data);
  return { version: num(o.version) };
}

/** 호명. ⚠ 코트를 점유하지 않는다. */
export async function callMatch(
  matchId: string, expectedVersion?: number | null,
): Promise<MatchWriteResult> {
  return matchWrite('call_match', {
    p_match_id: matchId, p_expected_version: expectedVersion ?? null,
  });
}

export async function uncallMatch(
  matchId: string, expectedVersion?: number | null,
): Promise<MatchWriteResult> {
  return matchWrite('uncall_match', {
    p_match_id: matchId, p_expected_version: expectedVersion ?? null,
  });
}

/** 경기 시작. 코트는 번호로 넘기고 서버가 active 여부까지 판정한다. */
export async function startMatch(
  matchId: string, courtNo: number, expectedVersion?: number | null,
): Promise<MatchWriteResult & { courtNo: number }> {
  const { data, error } = await supabase.rpc('start_match', {
    p_match_id: matchId, p_court_no: courtNo, p_expected_version: expectedVersion ?? null,
  });
  if (error) throw error;
  const o = unwrap(data);
  return { version: num(o.version), courtNo: num(o.courtNo) };
}

export interface CompleteMatchResult extends MatchWriteResult {
  winnerTeamId: string | null;
}

/**
 * 경기 완료.
 *   ⚠ 6:0~6:5 / 0:6~5:6 만 유효하다. 기권·노쇼도 6:0 으로 여기에 넣는다.
 *   ⚠ winner 를 보내지 않는다 — 서버가 score 에서 파생한다.
 */
export async function completeMatch(
  matchId: string, score1: number, score2: number, expectedVersion: number,
): Promise<CompleteMatchResult> {
  const { data, error } = await supabase.rpc('complete_match', {
    p_match_id: matchId, p_score1: score1, p_score2: score2,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return { version: num(o.version), winnerTeamId: strOrNull(o.winnerTeamId) };
}

export interface AmendMatchResult extends CompleteMatchResult {
  /**
   * 이 수정으로 함께 무효화된 '합산연령 동률 확정' 건수 (Batch 3B).
   *
   *   ⚠ 서버가 점수 수정과 **같은 트랜잭션**에서 처리한다. 화면이 뒤따라
   *     호출해야 하는 후처리가 아니다. 운영자에게 알리는 용도로만 쓴다.
   *   ⚠ 3B 이전 서버(무효화 없음)에서는 필드가 없어 0 이 된다.
   */
  invalidatedResolutions: number;
}

/**
 * 완료 결과 수정. ⚠ 사유 필수. 일반 입력과 구분되어 감사에 남는다.
 *
 *   ⚠ 점수가 바뀌면 그 조의 순위 근거가 바뀌므로, 서버가 같은 조의 유효한
 *     동률 확정을 전부 무효화한다(보수적). 동률 구조가 그대로였더라도 다시 확정해야 한다.
 */
export async function amendMatchScore(
  matchId: string, score1: number, score2: number, reason: string, expectedVersion: number,
): Promise<AmendMatchResult> {
  const { data, error } = await supabase.rpc('amend_completed_match_score', {
    p_match_id: matchId, p_score1: score1, p_score2: score2,
    p_reason: reason, p_expected_version: expectedVersion,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    version: num(o.version),
    winnerTeamId: strOrNull(o.winnerTeamId),
    invalidatedResolutions: num(o.invalidatedResolutions),
  };
}

/** 경기 취소 — '공식 결과 없이 취소'. ⚠ 기권 처리 용도가 아니다(기권은 6:0). */
export async function cancelMatch(
  matchId: string, reason: string, expectedVersion: number,
): Promise<MatchWriteResult> {
  return matchWrite('cancel_match', {
    p_match_id: matchId, p_reason: reason, p_expected_version: expectedVersion,
  });
}

// ── 오류 문구 ────────────────────────────────────────────────────────────────

/** RPC reason / SQLSTATE 를 운영자용 한국어 한 줄로. 내부 상세를 노출하지 않는다. */
export function matchActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = String(e?.code || '');
  const reason = String(e?.reason || '');
  const msg = String(e?.message || '');
  const key = reason || msg;

  if (code === '42501' || /not authorized/i.test(msg)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isMissingRelation(err)) return '경기 테이블이 아직 적용되지 않았습니다. (migration 대기)';

  switch (key) {
    case 'tournament_not_found':    return '대회를 찾을 수 없습니다.';
    case 'match_not_found':         return '경기를 찾을 수 없습니다.';
    case 'version_required':        return '경기 버전이 필요합니다. 새로고침 후 다시 시도해 주세요.';
    case 'version_conflict':        return '다른 곳에서 먼저 변경됐습니다. 새로고침 후 다시 시도해 주세요.';
    case 'already_changed':         return '경기 상태가 이미 바뀌었습니다. 새로고침 후 확인해 주세요.';

    case 'draw_not_locked':         return '조편성을 먼저 확정(잠금)해야 경기를 만들 수 있습니다.';
    case 'draw_invalid':            return '조편성 검증을 통과하지 못했습니다. 조편성 화면에서 확인해 주세요.';
    case 'already_generated':       return '이미 경기가 생성되어 있습니다.';

    case 'court_not_found':         return '코트를 찾을 수 없습니다.';
    case 'court_disabled':          return '사용 중지된 코트에서는 경기를 시작할 수 없습니다.';
    case 'court_conflict':          return '해당 코트에서 이미 다른 경기가 진행 중입니다.';
    case 'team_busy':               return '두 팀 중 한 팀이 다른 경기를 진행 중입니다.';

    case 'invalid_score':           return '점수는 6:0~6:5 또는 0:6~5:6 만 입력할 수 있습니다.';
    case 'reason_required':         return '사유를 입력해 주세요.';
    case 'match_not_completed':     return '완료된 경기만 결과를 수정할 수 있습니다.';
    case 'match_already_completed': return '완료된 경기는 취소할 수 없습니다. 결과를 고치려면 수정 기능을 쓰세요.';

    default:                        return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
