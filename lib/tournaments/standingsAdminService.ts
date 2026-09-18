// 예선 순위 / 합산연령 동률 확정(Admin) — Batch 3B.
//
//   · 원본 테이블을 클라이언트가 직접 SELECT 하지 않는다. 전부 운영 RPC 경유.
//     RPC 내부에서 can_manage_tournaments()(CEO/ADMIN)를 다시 검증한다.
//   · 업무 실패는 예외가 아니라 { ok:false, reason } jsonb 다. 권한 실패(42501)만 예외.
//
//   ⚠⚠ 나이 값을 보내지 않는다.
//     운영진이 현장에서 합산연령을 확인하고, 여기로는 **팀 순서만** 간다.
//   ⚠ resolved_order 를 클라이언트가 계산해서 보내지 않는다.
//     서버가 동률 묶음의 시작 순위와 배열 순서로 직접 정한다.
//   ⚠ 순위는 저장하지 않는다(standings 스냅샷 테이블 없음). 항상 경기 결과에서 계산한다.

import { supabase } from '@/lib/supabase';
import type {
  GroupPolicyRequired, GroupRankingStatus, GroupStandings, PlacementSummary,
  PreliminaryStandings, QualificationStatus, StandingRow, TieGroup,
} from './standingsTypes';

const isMissingRelation = (err: unknown): boolean => {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = String(e?.code || '');
  const msg = String(e?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST202' ||
    code === 'PGRST205' ||
    (/hosted_tournament_group_tie_resolutions|get_preliminary_standings|resolve_group_age_tie/.test(
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
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

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

// ── 조회 ─────────────────────────────────────────────────────────────────────

const rowOf = (v: unknown): StandingRow => {
  const r = rec(v);
  return {
    teamId: str(r.teamId),
    teamNo: num(r.teamNo),
    player1Name: str(r.player1Name),
    player2Name: str(r.player2Name),
    teamStatus: (str(r.teamStatus) || 'active') as StandingRow['teamStatus'],
    played: num(r.played),
    wins: num(r.wins),
    losses: num(r.losses),
    gamesFor: num(r.gamesFor),
    gamesAgainst: num(r.gamesAgainst),
    gameDiff: num(r.gameDiff),
    winRate: numOrNull(r.winRate),
    autoRank: num(r.autoRank),
    // ⚠ null 을 0 이나 autoRank 로 메우지 않는다. '순위 미정'은 그대로 전달한다.
    rank: numOrNull(r.rank),
    tieGroupRank: numOrNull(r.tieGroupRank),
    tieGroupSize: numOrNull(r.tieGroupSize),
    resolvedOrder: numOrNull(r.resolvedOrder),
    resolvedAt: strOrNull(r.resolvedAt),
    resolvedReason: strOrNull(r.resolvedReason),
    qualificationStatus: (str(r.qualificationStatus) || 'PENDING') as QualificationStatus,
  };
};

const tieOf = (v: unknown): TieGroup => {
  const r = rec(v);
  return {
    rank: num(r.rank),
    size: num(r.size),
    teamIds: arr(r.teamIds).map(str).filter((s) => s !== ''),
    resolved: r.resolved === true,
  };
};

const groupOf = (v: unknown): GroupStandings => {
  const r = rec(v);
  return {
    groupId: str(r.groupId),
    groupNo: num(r.groupNo),
    groupType: 'preliminary',
    expectedSize: num(r.expectedSize),
    members: num(r.members),
    expectedMatches: num(r.expectedMatches),
    generatedMatches: num(r.generatedMatches),
    completedMatches: num(r.completedMatches),
    cancelledMatches: num(r.cancelledMatches),
    groupComplete: r.groupComplete === true,
    rankingStatus: (str(r.rankingStatus) || 'PROVISIONAL') as GroupRankingStatus,
    policyRequired: (strOrNull(r.policyRequired) as GroupPolicyRequired | null) ?? null,
    resultsFingerprint: str(r.resultsFingerprint),
    tieGroups: arr(r.tieGroups).map(tieOf),
    standings: arr(r.standings).map(rowOf),
  };
};

const placementOf = (v: unknown): PlacementSummary => {
  const r = rec(v);
  return {
    groupId: str(r.groupId),
    groupNo: num(r.groupNo),
    matchId: str(r.matchId),
    matchNo: num(r.matchNo),
    status: str(r.status) || 'waiting',
    score1: numOrNull(r.score1),
    score2: numOrNull(r.score2),
    winnerTeamId: strOrNull(r.winnerTeamId),
    loserTeamId: strOrNull(r.loserTeamId),
    teams: arr(r.teams).map((t) => {
      const x = rec(t);
      return {
        teamId: str(x.teamId),
        teamNo: num(x.teamNo),
        player1Name: str(x.player1Name),
        player2Name: str(x.player2Name),
      };
    }),
  };
};

/**
 * 예선 순위 조회.
 *   권한이 없거나 대회를 못 찾으면 RPC 가 null 을 준다 → ready=false 로 구분한다
 *   ('조 0개'와 '조회 불가'는 다른 상태다).
 */
export async function fetchPreliminaryStandings(
  slug: string,
): Promise<{ ready: boolean; standings: PreliminaryStandings | null }> {
  try {
    const { data, error } = await supabase.rpc('get_preliminary_standings', { p_slug: slug });
    if (error) throw error;
    if (data === null || data === undefined) return { ready: false, standings: null };
    const o = rec(data);
    return {
      ready: true,
      standings: {
        slug: str(o.slug),
        // 요강값은 서버가 알려준다. 화면이 2 를 가정하지 않는다.
        qualifyPerGroup: num(o.qualifyPerGroup),
        groups: arr(o.groups).map(groupOf),
        placement: arr(o.placement).map(placementOf),
      },
    };
  } catch (err) {
    if (isMissingRelation(err)) return { ready: false, standings: null };
    throw err;
  }
}

// ── 동률 확정 ────────────────────────────────────────────────────────────────

export interface ResolveTieResult {
  groupNo: number;
  /** 확정한 동률 묶음의 시작 순위와 크기(서버 판정값). */
  tieRank: number;
  tieSize: number;
  /** 재확정이었다면 무효화된 기존 확정 건수. 처음이면 0. */
  replacedResolutions: number;
  fingerprint: string;
}

/**
 * 합산연령 확인 결과를 순서로 확정한다.
 *
 *   @param orderedTeamIds 동률 묶음 팀들을 **최종 순서대로** 담은 배열.
 *     ⚠ 나이를 보내지 않는다. 순서만 보낸다.
 *     ⚠ 순위 숫자를 보내지 않는다 — 서버가 묶음 시작 순위에서 계산한다.
 *   @param expectedFingerprint `GroupStandings.resultsFingerprint` 를 그대로.
 *     운영자가 본 결과가 그 사이 바뀌었으면 서버가 거부한다.
 */
export async function resolveGroupAgeTie(
  slug: string,
  groupNo: number,
  orderedTeamIds: string[],
  reason: string,
  expectedFingerprint: string,
): Promise<ResolveTieResult> {
  const { data, error } = await supabase.rpc('resolve_group_age_tie', {
    p_slug: slug,
    p_group_no: groupNo,
    p_ordered_team_ids: orderedTeamIds,
    p_reason: reason,
    p_expected_fingerprint: expectedFingerprint,
  });
  if (error) throw error;
  const o = unwrap(data);
  return {
    groupNo: num(o.groupNo),
    tieRank: num(o.tieRank),
    tieSize: num(o.tieSize),
    replacedResolutions: num(o.replacedResolutions),
    fingerprint: str(o.fingerprint),
  };
}

// ── 오류 문구 ────────────────────────────────────────────────────────────────

/** RPC reason / SQLSTATE 를 운영자용 한국어 한 줄로. 내부 상세를 노출하지 않는다. */
export function standingsActionMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; reason?: unknown } | null;
  const code = String(e?.code || '');
  const reason = String(e?.reason || '');
  const msg = String(e?.message || '');
  const key = reason || msg;

  if (code === '42501' || /not authorized/i.test(msg)) return '권한이 없습니다. (CEO·ADMIN 전용)';
  if (isMissingRelation(err)) return '순위 기능이 아직 적용되지 않았습니다. (migration 대기)';

  switch (key) {
    case 'tournament_not_found':    return '대회를 찾을 수 없습니다.';
    case 'group_not_found':         return '조를 찾을 수 없습니다.';
    case 'placement_not_rankable':  return '순위결정전 조는 순위를 매기지 않습니다. (두 팀 모두 본선 진출)';
    case 'group_not_complete':      return '조의 모든 경기가 완료되어야 순위를 확정할 수 있습니다. (취소된 경기가 남아 있어도 확정할 수 없습니다)';
    case 'standings_changed':       return '그 사이 경기 결과가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.';
    case 'tie_set_mismatch':        return '선택한 팀 구성이 현재 동률 묶음과 다릅니다. 새로고침 후 다시 확인해 주세요.';
    case 'empty_team_list':         return '순서를 정할 팀을 선택해 주세요.';
    case 'duplicate_team_in_list':  return '같은 팀이 두 번 선택됐습니다.';
    case 'reason_required':         return '확인 사유를 입력해 주세요.';

    default:                        return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
