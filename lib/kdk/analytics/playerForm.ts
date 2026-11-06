// 선수별 공식 기록 · 최근 흐름 · 쌍(파트너/상대) 기록 — 순수 계산.
//   입력은 extractOfficialGames 결과(기준일 이전 공식 경기, 시간 순)만 받는다.

import type { OfficialGame, PlayerKey } from './officialGames';

export interface PlayerRecord {
  key: PlayerKey;
  games: number;
  wins: number;
  losses: number;
  /** 시간 순 결과(true=승). 최근 흐름·연승 계산용. */
  results: boolean[];
  /** 마지막 공식 경기 이후 연속 기록. 양수=연승, 음수=연패, 0=기록 없음. */
  currentStreak: number;
  lastDate: string | null;
}

export interface PairRecord {
  games: number;
  /** 첫 번째 키(또는 그 팀) 기준 승수. */
  wins: number;
  losses: number;
}

const EMPTY_PAIR: PairRecord = { games: 0, wins: 0, losses: 0 };

export interface GameIndex {
  records: Map<PlayerKey, PlayerRecord>;
  /** 선수별 출전 경기(시간 순) — 쌍 기록 계산 시 짧은 목록만 훑기 위함. */
  byPlayer: Map<PlayerKey, OfficialGame[]>;
}

const sideOf = (g: OfficialGame, k: PlayerKey): 'A' | 'B' | null =>
  g.teamA[0] === k || g.teamA[1] === k ? 'A' : g.teamB[0] === k || g.teamB[1] === k ? 'B' : null;

export function buildGameIndex(games: readonly OfficialGame[]): GameIndex {
  const records = new Map<PlayerKey, PlayerRecord>();
  const byPlayer = new Map<PlayerKey, OfficialGame[]>();
  for (const g of games) {
    const slots: Array<[PlayerKey | null, 'A' | 'B']> = [
      [g.teamA[0], 'A'], [g.teamA[1], 'A'], [g.teamB[0], 'B'], [g.teamB[1], 'B'],
    ];
    for (const [k, side] of slots) {
      if (!k) continue;
      let r = records.get(k);
      if (!r) {
        r = { key: k, games: 0, wins: 0, losses: 0, results: [], currentStreak: 0, lastDate: null };
        records.set(k, r);
        byPlayer.set(k, []);
      }
      const won = g.winner === side;
      r.games += 1;
      if (won) r.wins += 1; else r.losses += 1;
      r.results.push(won);
      r.lastDate = g.date;
      byPlayer.get(k)!.push(g);
    }
  }
  for (const r of records.values()) r.currentStreak = streakOf(r.results);
  return { records, byPlayer };
}

/** 마지막 결과부터 같은 결과가 이어진 길이(승 +, 패 −). */
export function streakOf(results: readonly boolean[]): number {
  if (results.length === 0) return 0;
  const last = results[results.length - 1];
  let n = 0;
  for (let i = results.length - 1; i >= 0 && results[i] === last; i -= 1) n += 1;
  return last ? n : -n;
}

/** 최근 N경기 승/경기. */
export function recentOf(r: PlayerRecord | undefined, window: number): { games: number; wins: number } {
  if (!r) return { games: 0, wins: 0 };
  const slice = r.results.slice(-window);
  return { games: slice.length, wins: slice.filter(Boolean).length };
}

/** a·b 가 같은 팀(partner) 또는 반대 팀(opponent)으로 만난 공식 경기. a 관점 승패. */
export function pairRecord(
  index: GameIndex,
  a: PlayerKey | null,
  b: PlayerKey | null,
  relation: 'partner' | 'opponent',
): PairRecord {
  if (!a || !b || a === b) return { ...EMPTY_PAIR };
  const listA = index.byPlayer.get(a) || [];
  const listB = index.byPlayer.get(b) || [];
  const list = listA.length <= listB.length ? listA : listB;
  let games = 0;
  let wins = 0;
  for (const g of list) {
    const sa = sideOf(g, a);
    const sb = sideOf(g, b);
    if (!sa || !sb) continue;
    if (relation === 'partner' ? sa !== sb : sa === sb) continue;
    games += 1;
    if (g.winner === sa) wins += 1;
  }
  return { games, wins, losses: games - wins };
}

/** 팀 [a1,a2] 이 팀 [b1,b2] 를 상대로 한 교차 맞대결 합계(4쌍, 각 쌍 독립 집계 후 합산). */
export function crossOpponentRecord(
  index: GameIndex,
  teamA: readonly [PlayerKey | null, PlayerKey | null],
  teamB: readonly [PlayerKey | null, PlayerKey | null],
  minPairGames: number,
): { pairs: Array<{ a: 0 | 1; b: 0 | 1; record: PairRecord }>; games: number; wins: number } {
  const pairs: Array<{ a: 0 | 1; b: 0 | 1; record: PairRecord }> = [];
  let games = 0;
  let wins = 0;
  for (const ai of [0, 1] as const) {
    for (const bi of [0, 1] as const) {
      const record = pairRecord(index, teamA[ai], teamB[bi], 'opponent');
      pairs.push({ a: ai, b: bi, record });
      if (record.games >= minPairGames) { games += record.games; wins += record.wins; }
    }
  }
  return { pairs, games, wins };
}
