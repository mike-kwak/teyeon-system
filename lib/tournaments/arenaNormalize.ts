// 운영 RPC 응답 → Arena 표시용 값 (Batch 4E-0) — **순수 함수만** 둔다.
//
//   ⚠ React · DOM · 서버 의존이 없다. 단독으로 검증할 수 있다.
//   ⚠ 여기서 새로운 사실을 만들지 않는다.
//     · 코트의 '다음 경기'를 고르지 않는다 — 저장된 데이터에 그런 개념이 없다.
//       (call_match 는 코트를 점유하지 않는다 → CALLING 을 NEXT 로 바꿔 읽으면 거짓말이 된다)
//     · 순위를 계산하지 않는다 — 순위 RPC 가 준 값을 그대로 옮긴다(rank 가 null 이면 null 이다).
//     · 본선 승자를 예측하지 않는다 — 저장된 자리와 경기만 옮긴다.

import type { AdminBracket } from './bracketTypes';
import type { MatchBoard, TournamentMatch } from './matchTypes';
import type { PreliminaryStandings } from './standingsTypes';
import type {
  ArenaBracket, ArenaCourt, ArenaCourtMatch, ArenaGroup, ArenaKnockoutMatch, ArenaMode,
  ArenaRound, ArenaSlot, ArenaSnapshot, ArenaStandingRow, ArenaTeam,
} from './arenaTypes';

const text = (v: string | null | undefined): string => (typeof v === 'string' ? v : '');

const team = (
  t: { teamNo?: number | null; player1Name?: string | null; player2Name?: string | null;
       teamStatus?: string | null } | null | undefined,
): ArenaTeam => ({
  teamNo: t && typeof t.teamNo === 'number' ? t.teamNo : null,
  player1Name: text(t?.player1Name),
  player2Name: text(t?.player2Name),
  withdrawn: t?.teamStatus === 'withdrawn',
});

// ── 코트 ────────────────────────────────────────────────────────────────────

const courtMatchOf = (m: TournamentMatch): ArenaCourtMatch => ({
  matchNo: m.matchNo,
  stage: m.stage,
  groupNo: m.groupNo,
  team1: team(m.team1),
  team2: team(m.team2),
});

/**
 * 코트 줄.
 *   NOW = 그 코트에서 status='playing' 인 경기. 서버가 start_match 에서 코트를 붙여 준 값이라
 *   추론이 아니다. 같은 코트에 playing 이 둘 이상이면(있어서는 안 되는 상태) 경기 번호가
 *   작은 쪽을 쓴다 — 임의로 고르지 않도록 순서를 고정해 둔다.
 */
export function normalizeCourts(board: MatchBoard | null): ArenaCourt[] {
  if (!board) return [];
  const playing = board.matches
    .filter((m) => m.status === 'playing' && m.courtNo !== null)
    .sort((a, b) => a.matchNo - b.matchNo);

  return [...board.courts]
    .sort((a, b) => a.courtNo - b.courtNo)
    .map((c) => {
      const now = playing.find((m) => m.courtNo === c.courtNo);
      return {
        courtNo: c.courtNo,
        displayName: c.displayName,
        active: c.status === 'active',
        now: now ? courtMatchOf(now) : null,
      };
    });
}

// ── 예선 ────────────────────────────────────────────────────────────────────

const rowOf = (r: PreliminaryStandings['groups'][number]['standings'][number]): ArenaStandingRow => ({
  teamNo: r.teamNo,
  player1Name: r.player1Name,
  player2Name: r.player2Name,
  withdrawn: r.teamStatus === 'withdrawn',
  played: r.played,
  wins: r.wins,
  losses: r.losses,
  gameDiff: r.gameDiff,
  rank: r.rank,          // ⚠ null 을 0 이나 다른 값으로 바꾸지 않는다
  autoRank: r.autoRank,
  qualificationStatus: r.qualificationStatus,
});

/**
 * 조 순위 벽.
 *   조 번호 오름차순, 조 안에서는 확정 순위 → 잠정 순위 → 팀 번호 순으로만 정렬한다.
 *   ⚠ 정렬은 '보기 좋게 줄 세우는 것'이고 순위를 만드는 것이 아니다. rank 가 null 이면 null 로 남는다.
 */
export function normalizeGroups(standings: PreliminaryStandings | null): ArenaGroup[] {
  if (!standings) return [];
  return [...standings.groups]
    .sort((a, b) => a.groupNo - b.groupNo)
    .map((g) => ({
      groupNo: g.groupNo,
      members: g.members,
      expectedMatches: g.expectedMatches,
      completedMatches: g.completedMatches,
      rankingStatus: g.rankingStatus,
      rows: g.standings.map(rowOf).sort((a, b) => {
        // 확정 순위가 있으면 그것이, 없으면 잠정 순위(autoRank)가 자리를 정한다.
        //   ⚠ 동률이 확정되지 않았다고 해서 그 팀을 아래로 내리면 안 된다 —
        //     1위 동률 팀이 3위 아래에 그려지는 거짓 화면이 된다.
        const ea = a.rank ?? a.autoRank;
        const eb = b.rank ?? b.autoRank;
        if (ea !== eb) return ea - eb;
        if (a.autoRank !== b.autoRank) return a.autoRank - b.autoRank;
        return a.teamNo - b.teamNo;
      }),
    }));
}

// ── 본선 ────────────────────────────────────────────────────────────────────

const slotOf = (s: AdminBracket['slots'][number]): ArenaSlot => ({
  id: s.id,
  roundNo: s.roundNo,
  position: s.position,
  kind: s.slotType,
  team: s.teamNo === null
    ? null
    : team({ teamNo: s.teamNo, player1Name: s.player1Name, player2Name: s.player2Name,
             teamStatus: s.teamStatus }),
  sourceLabel: s.sourceLabel,
  resolved: s.resolvedAt !== null,
  feedsSlotId: s.feedsSlotId,
});

const roundOf = (r: AdminBracket['rounds'][number]): ArenaRound => ({
  roundNo: r.roundNo, name: r.name, isFinalSlot: r.isFinalSlot, slotCount: r.slotCount,
});

const knockoutMatchOf = (m: AdminBracket['matches'][number]): ArenaKnockoutMatch => ({
  matchNo: m.matchNo,
  roundNo: m.roundNo,
  roundName: m.roundName,
  status: m.status,
  courtNo: m.courtNo,
  courtName: m.courtName,
  score1: m.score1,
  score2: m.score2,
  winnerTeamNo: m.winnerTeamNo,
  targetRoundNo: m.targetRoundNo,
  targetPosition: m.targetPosition,
  team1: team(m.team1),
  team2: team(m.team2),
});

/** 본선 대진. 대진 자체가 없으면 null(= '본선 구조가 아직 없다'). */
export function normalizeBracket(admin: AdminBracket | null): ArenaBracket | null {
  if (!admin || !admin.bracket) return null;
  return {
    title: admin.bracket.title,
    status: admin.bracket.status,
    completedAt: admin.bracket.completedAt,
    rounds: [...admin.rounds].sort((a, b) => a.roundNo - b.roundNo).map(roundOf),
    slots: [...admin.slots]
      .sort((a, b) => (a.roundNo - b.roundNo) || (a.position - b.position))
      .map(slotOf),
    matches: [...admin.matches].sort((a, b) => a.matchNo - b.matchNo).map(knockoutMatchOf),
  };
}

// ── 화면 전체 ───────────────────────────────────────────────────────────────

export function normalizeArena(input: {
  slug: string;
  mode: ArenaMode;
  tournamentTitle?: string | null;
  board: MatchBoard | null;
  standings: PreliminaryStandings | null;
  bracket: AdminBracket | null;
}): ArenaSnapshot {
  return {
    slug: input.slug,
    mode: input.mode,
    tournamentTitle: input.tournamentTitle ?? null,
    courts: normalizeCourts(input.board),
    groups: input.mode === 'preliminary' ? normalizeGroups(input.standings) : [],
    qualifyPerGroup: input.mode === 'preliminary' && input.standings
      ? input.standings.qualifyPerGroup
      : null,
    bracket: input.mode === 'knockout' ? normalizeBracket(input.bracket) : null,
  };
}

/**
 * 본선 구조 지문 — **모양에 영향을 주는 값만** 담는다.
 *   같은 지문이면 배치를 다시 계산할 필요가 없다(점수 · 코트 · 상태가 바뀌어도 모양은 그대로다).
 *   ⚠ 성능을 위해 복잡한 해시를 쓰지 않는다. 비교 가능한 문자열이면 충분하고, 눈으로 검증된다.
 *   포함: 라운드(번호 · 우승자리 여부) / 자리(라운드 · 번호 · 다음 자리 · BYE 여부)
 *   제외: 팀 · 이름 · 점수 · 상태 · 코트 · 출처 라벨 · 반영 여부
 *         (BYE 는 칸 높이를 바꿀 수 있어 유일하게 포함한다)
 */
export function topologySignature(bracket: ArenaBracket | null): string {
  if (!bracket) return '';
  const rounds = bracket.rounds
    .map((r) => `${r.roundNo}:${r.isFinalSlot ? 'F' : 'R'}:${r.slotCount}`)
    .join(',');
  const slots = bracket.slots
    .map((s) => `${s.roundNo}.${s.position}>${s.feedsSlotId ?? '-'}${s.kind === 'bye' ? '*' : ''}`)
    .join('|');
  return `${rounds}#${slots}`;
}
