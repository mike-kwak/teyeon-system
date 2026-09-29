// 공개 본선 대진 조회 — 로그인 없이(anon) 호출하는 공개 RPC 하나만 쓴다.
//   ⚠ 원본 테이블을 읽지 않는다. 서버가 공개 조건(대회 공개 · 경로 확정 · 공개 시각)을 판정한다.
//   ⚠ 기능 스위치가 꺼져 있으면(migration 전) 호출하지 않고 '비공개'로 본다.
//   ⚠ 비공개 사유를 화면에 구분해 보여주지 않는다 — 예선 공개 DRAW 와 같은 정책.

import { supabase } from '@/lib/supabase';
import { PUBLIC_KNOCKOUT_ENABLED } from './publicKnockoutFlags';
import type {
  PublicKnockoutBracket, PublicKnockoutMatch, PublicKnockoutRound, PublicKnockoutSlot,
  PublicKnockoutTeam, PublicSlotType, PublicSourceKind,
} from './publicKnockoutTypes';

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const side = (v: unknown): 1 | 2 | null => (v === 1 || v === '1' ? 1 : v === 2 || v === '2' ? 2 : null);

const teamOf = (v: unknown): PublicKnockoutTeam | null => {
  const o = rec(v);
  if (o.teamNo === null || o.teamNo === undefined) return null;
  return {
    publicKey: str(o.publicKey),
    teamNo: num(o.teamNo),
    player1Name: str(o.player1Name),
    player2Name: str(o.player2Name),
    withdrawn: o.withdrawn === true,
  };
};

const emptyTeam = (): PublicKnockoutTeam => ({
  publicKey: '', teamNo: 0, player1Name: '', player2Name: '', withdrawn: false,
});

/**
 * 공개 본선 대진.
 *   bracket = null 이면 '아직 공개되지 않음'(비공개 · 미확정 · 대회 비공개 · 기능 미적용 모두 같은 뜻).
 *   공개 화면에는 그 이유를 구분해 보여주지 않는다.
 */
export async function fetchPublicKnockoutBracket(
  slug: string,
): Promise<{ bracket: PublicKnockoutBracket | null }> {
  if (!PUBLIC_KNOCKOUT_ENABLED || !slug) return { bracket: null };

  const { data, error } = await supabase.rpc('get_public_knockout_bracket', { p_slug: slug });
  if (error || data === null || data === undefined) return { bracket: null };

  const o = rec(data);
  if (o.available !== true) return { bracket: null };

  const pubInfo = rec(o.publication);
  const b = rec(o.bracket);
  const t = rec(o.tournament);
  const status = str(pubInfo.bracketStatus);

  return {
    bracket: {
      slug: str(t.slug) || slug,
      tournamentTitle: str(t.title),
      bracketTitle: strOrNull(b.title),
      bracketStatus: status === 'completed' ? 'completed' : 'locked',
      publishedAt: strOrNull(pubInfo.publishedAt),
      completedAt: strOrNull(b.completedAt),
      rounds: arr(o.rounds).map((v): PublicKnockoutRound => {
        const r = rec(v);
        return {
          publicKey: str(r.publicKey),
          roundNo: num(r.roundNo),
          name: str(r.name),
          isFinalRound: r.isFinalRound === true,
          slotCount: num(r.slotCount),
        };
      }).sort((a, z) => a.roundNo - z.roundNo),
      slots: arr(o.slots).map((v): PublicKnockoutSlot => {
        const s = rec(v);
        return {
          publicKey: str(s.publicKey),
          roundNo: num(s.roundNo),
          position: num(s.position),
          slotType: (str(s.slotType) || 'tbd') as PublicSlotType,
          sourceKind: (strOrNull(s.sourceKind) as PublicSourceKind | null) ?? null,
          sourceLabel: strOrNull(s.sourceLabel),
          resolved: s.resolved === true,
          isFinalSlot: s.isFinalSlot === true,
          feedsSlotPublicKey: strOrNull(s.feedsSlotPublicKey),
          team: teamOf(s.team),
        };
      }).sort((a, z) => (a.roundNo - z.roundNo) || (a.position - z.position)),
      matches: arr(o.matches).map((v): PublicKnockoutMatch => {
        const m = rec(v);
        return {
          publicKey: str(m.publicKey),
          roundNo: num(m.roundNo),
          roundName: strOrNull(m.roundName),
          matchNo: num(m.matchNo),
          status: (str(m.status) || 'waiting') as PublicKnockoutMatch['status'],
          courtNo: numOrNull(m.courtNo),
          courtName: strOrNull(m.courtName),
          score1: numOrNull(m.score1),
          score2: numOrNull(m.score2),
          winnerSide: side(m.winnerSide),
          targetSlotPublicKey: strOrNull(m.targetSlotPublicKey),
          feederSlotPublicKeys: arr(m.feederSlotPublicKeys).map((k) => str(k)).filter(Boolean),
          team1: teamOf(m.team1) ?? emptyTeam(),
          team2: teamOf(m.team2) ?? emptyTeam(),
        };
      }).sort((a, z) => a.matchNo - z.matchNo),
      champion: teamOf(o.champion),
    },
  };
}

/**
 * Hub · DRAW 탭용 — 본선 대진이 공개됐는가.
 *   ⚠ 기능 스위치가 꺼져 있으면 호출하지 않고 false(기존 '준비 중' 그대로).
 */
export async function fetchPublicKnockoutPublished(slug: string): Promise<boolean> {
  if (!PUBLIC_KNOCKOUT_ENABLED || !slug) return false;
  try {
    const r = await fetchPublicKnockoutBracket(slug);
    return r.bracket !== null;
  } catch {
    return false;
  }
}
