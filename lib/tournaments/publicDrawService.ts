// 공개 예선 DRAW 조회 — 로그인 없이(anon) 호출하는 공개 RPC 하나만 쓴다.
//   ⚠ 원본 테이블을 읽지 않는다. 서버가 공개 조건(대회 공개 · 조편성 locked · DRAW 공개)을 판정한다.
//   ⚠ 기능 스위치가 꺼져 있으면(migration 전) 호출하지 않고 '비공개'로 본다.

import { supabase } from '@/lib/supabase';
import { PUBLIC_DRAW_ENABLED } from './publicDrawFlags';
import type {
  PublicDrawGroup, PublicDrawMatch, PublicDrawTeam, PublicPlacement, PublicPreliminaryDraw,
  PublicStandingRow,
} from './publicDrawTypes';
import type { GroupRankingStatus, QualificationStatus } from './standingsTypes';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const side = (v: unknown): 1 | 2 | null => (v === 1 || v === '1' ? 1 : v === 2 || v === '2' ? 2 : null);

const teamOf = (v: unknown): PublicDrawTeam => {
  const r = rec(v);
  return { teamNo: num(r.teamNo), player1Name: str(r.player1Name), player2Name: str(r.player2Name) };
};

const rowOf = (v: unknown): PublicStandingRow => {
  const r = rec(v);
  return {
    ...teamOf(r),
    withdrawn: r.withdrawn === true,
    played: num(r.played),
    wins: num(r.wins),
    losses: num(r.losses),
    gamesFor: num(r.gamesFor),
    gamesAgainst: num(r.gamesAgainst),
    gameDiff: num(r.gameDiff),
    rank: numOrNull(r.rank),
    qualificationStatus: (str(r.qualificationStatus) || 'PENDING') as QualificationStatus,
  };
};

const matchOf = (v: unknown): PublicDrawMatch => {
  const r = rec(v);
  return {
    sequenceNo: num(r.sequenceNo),
    matchNo: num(r.matchNo),
    status: str(r.status) || 'waiting',
    courtNo: numOrNull(r.courtNo),
    courtName: str(r.courtName) || null,
    score1: numOrNull(r.score1),
    score2: numOrNull(r.score2),
    winnerSide: side(r.winnerSide),
    team1: teamOf(r.team1),
    team2: teamOf(r.team2),
  };
};

const groupOf = (v: unknown): PublicDrawGroup => {
  const r = rec(v);
  return {
    groupNo: num(r.groupNo),
    members: num(r.members),
    expectedMatches: num(r.expectedMatches),
    generatedMatches: num(r.generatedMatches),
    completedMatches: num(r.completedMatches),
    cancelledMatches: num(r.cancelledMatches),
    rankingStatus: (str(r.rankingStatus) || 'PROVISIONAL') as GroupRankingStatus,
    standings: arr(r.standings).map(rowOf),
    matches: arr(r.matches).map(matchOf).sort((a, b) => a.sequenceNo - b.sequenceNo),
  };
};

const placementOf = (v: unknown): PublicPlacement => {
  const r = rec(v);
  return {
    groupNo: num(r.groupNo),
    matchNo: num(r.matchNo),
    status: str(r.status) || 'waiting',
    score1: numOrNull(r.score1),
    score2: numOrNull(r.score2),
    winnerSide: side(r.winnerSide),
    teams: arr(r.teams).map(teamOf),
  };
};

/**
 * 공개 예선 DRAW.
 *   draw = null 이면 '아직 공개되지 않음'(비공개 · 조편성 미확정 · 대회 비공개 · 기능 미적용 모두 같은 뜻).
 *   공개 화면에는 그 이유를 구분해 보여주지 않는다.
 */
export async function fetchPublicPreliminaryDraw(
  slug: string,
): Promise<{ draw: PublicPreliminaryDraw | null }> {
  if (!PUBLIC_DRAW_ENABLED || !slug) return { draw: null };
  const { data, error } = await supabase.rpc('get_public_preliminary_draw', { p_slug: slug });
  if (error || data === null || data === undefined) return { draw: null };
  const o = rec(data);
  if (o.published !== true) return { draw: null };
  return {
    draw: {
      slug: str(o.slug),
      qualifyPerGroup: num(o.qualifyPerGroup),
      groups: arr(o.groups).map(groupOf).sort((a, b) => a.groupNo - b.groupNo),
      placement: arr(o.placement).map(placementOf),
    },
  };
}
