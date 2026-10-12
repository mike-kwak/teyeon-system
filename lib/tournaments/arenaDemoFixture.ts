// Arena TV Demo — 가명 선수 · 가상 경기 데이터 (순수 모듈).
//
//   실제 TV 에서 예선 · 본선 전광판의 디자인과 가독성을 점검하기 위한 **정적 데이터**다.
//   ⚠ 서버 · Supabase · 실제 대회 데이터와 연결되지 않는다. 이 파일은 아무 것도 import 하지 않는다
//     (타입만 가져온다). 그래서 Demo 화면에서 운영 RPC 가 불릴 길이 없다.
//   ⚠ 선수 이름은 전부 지어낸 가명이다. 실제 참가자 명단에서 가져오지 않는다.
//   ⚠ 운영 Arena 와 같은 ArenaSnapshot 모양을 그대로 만든다 — 화면은 운영 컴포넌트가 그린다.
//   ⚠ 같은 장면은 언제 열어도 같은 값이다(무작위 없음). 새로고침해도 화면이 바뀌지 않는다.

import type {
  ArenaBracket, ArenaCourt, ArenaCourtMatch, ArenaGroup, ArenaKnockoutMatch, ArenaMode,
  ArenaRound, ArenaSlot, ArenaSnapshot, ArenaStandingRow, ArenaTeam,
} from './arenaTypes';
import type { MatchStatus } from './matchTypes';

export const ARENA_DEMO_TITLE = '2026 TEYEON OPEN · DEMO';

/** 예선 장면: 진행 중(상태 혼합) / 전 조 완료. */
export type ArenaDemoPrelimScene = 'mid' | 'done';
/** 본선 장면: 초반 라운드 진행 / 4강 / 결승 진행 / 우승 확정. */
export type ArenaDemoKnockoutScene = 'early' | 'semi' | 'final' | 'champion';
export type ArenaDemoScene = ArenaDemoPrelimScene | ArenaDemoKnockoutScene;

export const ARENA_DEMO_SCENES: Record<ArenaMode, { id: ArenaDemoScene; label: string }[]> = {
  preliminary: [
    { id: 'mid', label: '예선 진행 중' },
    { id: 'done', label: '예선 완료' },
  ],
  knockout: [
    { id: 'early', label: '초반 라운드' },
    { id: 'semi', label: '4강' },
    { id: 'final', label: '결승 진행' },
    { id: 'champion', label: '우승 확정' },
  ],
};

/** 주소 값 → 장면. 모르는 값이면 그 모드의 첫 장면. */
export function arenaDemoSceneOf(mode: ArenaMode, value: string | null): ArenaDemoScene {
  const list = ARENA_DEMO_SCENES[mode];
  return list.find((s) => s.id === value)?.id ?? list[0].id;
}

// ── 가명 팀 ─────────────────────────────────────────────────────────────────

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN = ['하늘', '바다', '나래', '솔빛', '다온', '라온', '시온', '도담', '가람', '누리',
  '보람', '새봄', '한결', '이솔', '하람', '나린', '온새', '루다', '아라', '별하', '은솔', '해든'];

/** 가독성 점검용 긴 이름 — 일부 팀에 일부러 넣는다(TV 에서 잘리는지 본다). */
const LONG_NAMES: Record<number, [string, string]> = {
  1: ['남궁하늘빛바다', '제갈솔빛누리'],
  4: ['Alexander Maximilian', '선우다온라온'],
  9: ['황보새봄하람', 'Christopher Lee'],
  14: ['독고은솔해든', '사공별하아라'],
  22: ['서문가람도담', 'Jonathan Kim'],
  31: ['남궁하람나린', '제갈한결이솔'],
  38: ['동방라온시온', '황보누리보람'],
  47: ['Isabella Park', '선우바다하늘'],
};

const nameOf = (seed: number): string =>
  `${SURNAMES[(seed * 7) % SURNAMES.length]}${GIVEN[(seed * 5 + 3) % GIVEN.length]}`;

/** 팀 번호 → 가명 팀. 같은 번호는 언제나 같은 이름이다. */
export function arenaDemoTeam(teamNo: number, withdrawn = false): ArenaTeam {
  const long = LONG_NAMES[teamNo];
  return {
    teamNo,
    player1Name: long ? long[0] : nameOf(teamNo * 2),
    player2Name: long ? long[1] : nameOf(teamNo * 2 + 1),
    withdrawn,
  };
}

/** 6게임 1세트 점수 — 승자 6, 패자 0~5(팀 번호로 고정). */
const loserGames = (a: number, b: number): number => (a * 3 + b * 5) % 6;

// ── 코트 ────────────────────────────────────────────────────────────────────

const COURT_COUNT = 10;
/** 쉬는 코트(운영 중지) — 비활성 표시를 점검한다. */
const DISABLED_COURT = 10;

/** 진행 중 경기를 1번 코트부터 채운다. 남는 코트는 비어 있다(EMPTY). */
function buildCourts(playing: ArenaCourtMatch[]): ArenaCourt[] {
  const usable = Array.from({ length: COURT_COUNT }, (_, i) => i + 1).filter((n) => n !== DISABLED_COURT);
  const byCourt = new Map<number, ArenaCourtMatch>();
  playing.slice(0, usable.length).forEach((m, i) => byCourt.set(usable[i], m));
  return Array.from({ length: COURT_COUNT }, (_, i) => {
    const courtNo = i + 1;
    return {
      courtNo,
      displayName: courtNo === 1 ? '센터코트' : null,
      active: courtNo !== DISABLED_COURT,
      now: byCourt.get(courtNo) ?? null,
    };
  });
}

// ── 예선 ────────────────────────────────────────────────────────────────────

const GROUP_COUNT = 20;
const GROUP_SIZE = 3;
const QUALIFY_PER_GROUP = 2;

type GroupKind = 'final' | 'in_progress' | 'age_check' | 'not_started' | 'withdrawn';

const groupTeams = (groupNo: number): number[] =>
  Array.from({ length: GROUP_SIZE }, (_, i) => (groupNo - 1) * GROUP_SIZE + i + 1);

function row(
  teamNo: number,
  v: Partial<Omit<ArenaStandingRow, 'teamNo' | 'player1Name' | 'player2Name'>>,
): ArenaStandingRow {
  const t = arenaDemoTeam(teamNo, v.withdrawn ?? false);
  return {
    teamNo,
    player1Name: t.player1Name,
    player2Name: t.player2Name,
    withdrawn: t.withdrawn,
    played: v.played ?? 0,
    wins: v.wins ?? 0,
    losses: v.losses ?? 0,
    gameDiff: v.gameDiff ?? 0,
    rank: v.rank ?? null,
    autoRank: v.autoRank ?? 1,
    qualificationStatus: v.qualificationStatus ?? 'PENDING',
  };
}

function buildGroup(groupNo: number, kind: GroupKind): ArenaGroup {
  const [a, b, c] = groupTeams(groupNo);
  const base = { groupNo, members: GROUP_SIZE, expectedMatches: 3, cancelledMatches: 0 };
  switch (kind) {
    case 'final':
      return {
        ...base, completedMatches: 3, rankingStatus: 'FINAL',
        rows: [
          row(a, { played: 2, wins: 2, losses: 0, gameDiff: 7, rank: 1, autoRank: 1, qualificationStatus: 'QUALIFIED' }),
          row(b, { played: 2, wins: 1, losses: 1, gameDiff: 1, rank: 2, autoRank: 2, qualificationStatus: 'QUALIFIED' }),
          row(c, { played: 2, wins: 0, losses: 2, gameDiff: -8, rank: 3, autoRank: 3, qualificationStatus: 'NOT_QUALIFIED' }),
        ],
      };
    case 'age_check':
      // 조는 끝났지만 세 팀이 1승 1패 동률 — 순위는 비워 둔다(임의 숫자를 만들지 않는다).
      return {
        ...base, completedMatches: 3, rankingStatus: 'AGE_CHECK_REQUIRED',
        rows: [
          row(a, { played: 2, wins: 1, losses: 1, gameDiff: 0, rank: null, autoRank: 1 }),
          row(b, { played: 2, wins: 1, losses: 1, gameDiff: 0, rank: null, autoRank: 1 }),
          row(c, { played: 2, wins: 1, losses: 1, gameDiff: 0, rank: null, autoRank: 1 }),
        ],
      };
    case 'withdrawn':
      // 한 팀 기권 — 남은 두 팀만 경기한다.
      return {
        ...base, completedMatches: 1, rankingStatus: 'PROVISIONAL',
        rows: [
          row(a, { played: 1, wins: 1, losses: 0, gameDiff: 3, rank: 1, autoRank: 1, qualificationStatus: 'QUALIFIED' }),
          row(b, { played: 1, wins: 0, losses: 1, gameDiff: -3, rank: 2, autoRank: 2, qualificationStatus: 'QUALIFIED' }),
          row(c, { withdrawn: true, rank: null, autoRank: 3, qualificationStatus: 'NOT_QUALIFIED' }),
        ],
      };
    case 'not_started':
      return {
        ...base, completedMatches: 0, rankingStatus: 'PROVISIONAL',
        rows: [row(a, {}), row(b, {}), row(c, {})],
      };
    case 'in_progress':
    default:
      return {
        ...base, completedMatches: 1, rankingStatus: 'PROVISIONAL',
        rows: [
          row(a, { played: 1, wins: 1, losses: 0, gameDiff: 4, rank: 1, autoRank: 1 }),
          row(b, { played: 1, wins: 0, losses: 1, gameDiff: -4, rank: 2, autoRank: 2 }),
          row(c, { played: 0, rank: null, autoRank: 3 }),
        ],
      };
  }
}

/** 진행 중 장면의 조 상태 배치 — 한 화면에서 모든 상태를 볼 수 있게 섞는다. */
const MID_KINDS: Record<number, GroupKind> = {
  1: 'final', 2: 'final', 3: 'final', 4: 'final', 5: 'age_check', 6: 'final',
  7: 'in_progress', 8: 'in_progress', 9: 'withdrawn', 10: 'in_progress',
  11: 'in_progress', 12: 'in_progress', 13: 'in_progress', 14: 'in_progress',
  15: 'in_progress', 16: 'not_started', 17: 'not_started', 18: 'not_started',
  19: 'not_started', 20: 'not_started',
};

function buildPrelim(scene: ArenaDemoPrelimScene): { groups: ArenaGroup[]; courts: ArenaCourt[] } {
  const groups = Array.from({ length: GROUP_COUNT }, (_, i) => {
    const g = i + 1;
    return buildGroup(g, scene === 'done' ? 'final' : MID_KINDS[g]);
  });
  // 진행 중인 조에서 아직 안 한 경기(2번 팀 vs 3번 팀)를 코트에 올린다.
  const playing: ArenaCourtMatch[] = scene === 'done' ? [] : groups
    .filter((g) => MID_KINDS[g.groupNo] === 'in_progress')
    .slice(0, 8)
    .map((g, i) => {
      const [, b, c] = groupTeams(g.groupNo);
      return {
        matchNo: 100 + i, stage: 'preliminary', groupNo: g.groupNo,
        team1: arenaDemoTeam(b), team2: arenaDemoTeam(c),
      };
    });
  return { groups, courts: buildCourts(playing) };
}

// ── 본선 ────────────────────────────────────────────────────────────────────

const ROUND_NAMES = ['64강', '32강', '16강', '8강', '4강', '결승', '우승'];
const ROUND_SLOTS = [64, 32, 16, 8, 4, 2, 1];

/**
 * 1라운드 64자리 — 진출 40팀 + 부전승 24.
 *   네 쌍마다 한 쌍만 실제 경기(8경기), 나머지 24쌍은 한쪽이 부전승이다.
 *   진출팀은 조 1위 · 2위를 엇갈려 놓는다(같은 조가 첫 판에서 만나지 않게).
 */
function firstRound(): { kind: 'team' | 'bye'; teamNo: number | null; label: string | null }[] {
  const qualifiers: { teamNo: number; label: string }[] = [];
  for (let k = 1; k <= GROUP_COUNT; k += 1) {
    const g1 = k;
    const g2 = GROUP_COUNT + 1 - k;
    qualifiers.push({ teamNo: groupTeams(g1)[0], label: `${g1}조 1위` });
    qualifiers.push({ teamNo: groupTeams(g2)[1], label: `${g2}조 2위` });
  }
  const out: { kind: 'team' | 'bye'; teamNo: number | null; label: string | null }[] = [];
  let q = 0;
  for (let pair = 1; pair <= 32; pair += 1) {
    const bothTeams = pair % 4 === 0;
    for (let side = 0; side < 2; side += 1) {
      if (side === 1 && !bothTeams) { out.push({ kind: 'bye', teamNo: null, label: null }); continue; }
      const t = qualifiers[q]; q += 1;
      out.push({ kind: 'team', teamNo: t.teamNo, label: t.label });
    }
  }
  return out;
}

/** 장면별 경기 상태. 경기가 성립하지 않는 칸(상대 미정)은 애초에 경기가 없다. */
function statusFor(scene: ArenaDemoKnockoutScene, round: number, index: number): MatchStatus {
  if (scene === 'champion') return 'completed';
  if (scene === 'final') return round <= 5 ? 'completed' : 'playing';
  if (scene === 'semi') {
    if (round <= 4) return 'completed';
    return index === 0 ? 'completed' : 'playing';
  }
  // early — 64강 대부분 끝, 32강 일부 진행 · 일부 완료.
  if (round === 1) return index < 5 ? 'completed' : index < 7 ? 'playing' : 'waiting';
  if (round === 2) return index < 4 ? 'completed' : index < 10 ? 'playing' : 'waiting';
  return 'waiting';
}

const slotId = (round: number, position: number) => `demo-s${round}-${position}`;

function buildKnockout(scene: ArenaDemoKnockoutScene): { bracket: ArenaBracket; courts: ArenaCourt[] } {
  const rounds: ArenaRound[] = ROUND_NAMES.map((name, i) => ({
    roundNo: i + 1, name, isFinalSlot: i === ROUND_NAMES.length - 1, slotCount: ROUND_SLOTS[i],
  }));

  // 자리 상태(라운드별). 1라운드는 배치, 그 위는 결과로만 채운다.
  type Cell = { kind: 'team' | 'bye' | 'tbd'; teamNo: number | null; label: string | null };
  const cells: Cell[][] = [firstRound()];
  for (let r = 2; r <= ROUND_SLOTS.length; r += 1) {
    cells.push(Array.from({ length: ROUND_SLOTS[r - 1] }, () => ({ kind: 'tbd', teamNo: null, label: null })));
  }

  const matches: ArenaKnockoutMatch[] = [];
  const playingCourt: ArenaCourtMatch[] = [];
  let matchNo = 0;

  for (let r = 1; r < ROUND_SLOTS.length; r += 1) {
    let index = 0;
    for (let p = 1; p <= ROUND_SLOTS[r - 1]; p += 2) {
      const a = cells[r - 1][p - 1];
      const b = cells[r - 1][p];
      const up = cells[r][Math.ceil(p / 2) - 1];
      // 부전승 — 경기 없이 올라간다.
      if (a.kind === 'team' && b.kind === 'bye') { Object.assign(up, { kind: 'team', teamNo: a.teamNo, label: null }); continue; }
      if (b.kind === 'team' && a.kind === 'bye') { Object.assign(up, { kind: 'team', teamNo: b.teamNo, label: null }); continue; }
      if (a.kind !== 'team' || b.kind !== 'team' || a.teamNo === null || b.teamNo === null) continue;

      let status = statusFor(scene, r, index);
      index += 1;
      matchNo += 1;
      // 코트는 9면(1~9)뿐이다 — 넘치면 대기로 둔다(경기를 지어내지 않는다).
      if (status === 'playing' && playingCourt.length >= COURT_COUNT - 1) status = 'waiting';

      // 번호가 작은 팀이 이긴다(고정 규칙 — 장면이 늘 같게).
      const aWins = a.teamNo < b.teamNo;
      const lose = loserGames(a.teamNo, b.teamNo);
      const done = status === 'completed';
      const courtNo = status === 'playing' ? playingCourt.length + 1 : null;

      matches.push({
        matchNo,
        roundNo: r,
        roundName: ROUND_NAMES[r - 1],
        status,
        courtNo,
        courtName: courtNo === 1 ? '센터코트' : null,
        score1: done ? (aWins ? 6 : lose) : null,
        score2: done ? (aWins ? lose : 6) : null,
        winnerTeamNo: done ? (aWins ? a.teamNo : b.teamNo) : null,
        targetRoundNo: r + 1,
        targetPosition: Math.ceil(p / 2),
        team1: arenaDemoTeam(a.teamNo),
        team2: arenaDemoTeam(b.teamNo),
      });
      if (status === 'playing') {
        playingCourt.push({
          matchNo, stage: 'knockout', groupNo: null,
          team1: arenaDemoTeam(a.teamNo), team2: arenaDemoTeam(b.teamNo),
        });
      }
      if (done) Object.assign(up, { kind: 'team', teamNo: aWins ? a.teamNo : b.teamNo, label: null });
    }
  }

  const slots: ArenaSlot[] = [];
  cells.forEach((list, ri) => {
    const r = ri + 1;
    list.forEach((c, pi) => {
      const p = pi + 1;
      slots.push({
        id: slotId(r, p),
        roundNo: r,
        position: p,
        kind: c.kind,
        team: c.kind === 'team' && c.teamNo !== null ? arenaDemoTeam(c.teamNo) : null,
        sourceLabel: c.label,
        resolved: c.label !== null,
        feedsSlotId: r < ROUND_SLOTS.length ? slotId(r + 1, Math.ceil(p / 2)) : null,
      });
    });
  });

  return {
    bracket: {
      title: '본선 토너먼트 (DEMO)',
      status: scene === 'champion' ? 'completed' : 'locked',
      completedAt: scene === 'champion' ? '2026-10-31T17:00:00+09:00' : null,
      rounds,
      slots,
      matches,
    },
    // 코트 줄은 진행 중 본선 경기를 1번 코트부터 놓는다 — 위에서 매긴 경기의 courtNo 와 같은 순서다.
    courts: buildCourts(playingCourt),
  };
}

// ── 화면 전체 ───────────────────────────────────────────────────────────────

/** Demo 스냅샷. 운영 Arena 가 RPC 결과를 정규화해 만드는 것과 같은 모양이다. */
export function buildArenaDemoSnapshot(mode: ArenaMode, scene: ArenaDemoScene): ArenaSnapshot {
  if (mode === 'preliminary') {
    const s: ArenaDemoPrelimScene = scene === 'done' ? 'done' : 'mid';
    const { groups, courts } = buildPrelim(s);
    return {
      slug: 'arena-demo', mode, tournamentTitle: ARENA_DEMO_TITLE,
      courts, groups, qualifyPerGroup: QUALIFY_PER_GROUP, bracket: null,
    };
  }
  const k: ArenaDemoKnockoutScene =
    scene === 'semi' || scene === 'final' || scene === 'champion' ? scene : 'early';
  const { bracket, courts } = buildKnockout(k);
  return {
    slug: 'arena-demo', mode, tournamentTitle: ARENA_DEMO_TITLE,
    courts, groups: [], qualifyPerGroup: null, bracket,
  };
}
