// MATCH SPOTLIGHT — 주목 경기 자동 선정(순수 계산).
//
//   전체 경기를 분석한 뒤 유형별 점수를 매기고, 기준 점수 이상인 경기만 최대 maxItems 개 선정한다.
//   부족하면 억지로 채우지 않는다(selected.length < minItems 이면 shortfall=true 로 알린다).
//
//   유형(1경기가 여러 유형이면 가장 높은 점수의 유형이 메인 배지 — 동점이면 TYPE_PRIORITY 순):
//     RIVAL      : 교차 상대 쌍 중 공식 맞대결 ≥ rivalMinGames
//                  · fated   = ≥ fatedMinGames 이고 승률 40~60%(숙명의 라이벌)
//                  · nemesis = 한쪽 승률 ≥ 2/3(천적 관계 — 설욕전)
//     HOT_STREAK : 출전 선수 중 기준일 직전까지 공식 연승 ≥ streakMin(라운드 순서 기준)
//     CLOSE      : 예측 tier model/reference 이고 |p − 0.5| ≤ closeMax
//     POWER      : 4명 모두 공식 ≥ powerMinGames 이고 4명 평균 평활 승률 ≥ powerMinRate
//
//   점수(0~100 근사, 결정적):
//     RIVAL      = 58 + min(games,12)·1.5 + (fated 8 | nemesis 6 | 0)
//     HOT_STREAK = 56 + min(streak,8)·3
//     CLOSE      = 55 + (closeMax − |p−0.5|)/closeMax·15 + (tier=model 5 | 0)
//     POWER      = 54 + min((avgRate−0.5)·100, 16) + min(minGames,60)/10
//     경기 점수   = 메인 유형 점수 + 2·(추가 해당 유형 수)
//   선정: 경기 점수 ≥ threshold → 정렬(점수↓ · 근거 경기 수↓ · round↑ · matchNo↑ · matchId↑)
//         → 탐욕 선택(같은 메인 배지 ≤ maxPerType, 같은 선수 등장 ≤ maxPerPlayer).

import type { PlayerKey } from './officialGames';
import type { GameIndex } from './playerForm';
import { pairRecord } from './playerForm';
import type { MatchPrediction } from './predictionModel';

export type SpotlightType = 'RIVAL' | 'CLOSE' | 'HOT_STREAK' | 'POWER';
export const TYPE_PRIORITY: readonly SpotlightType[] = ['RIVAL', 'HOT_STREAK', 'CLOSE', 'POWER'];

export interface SpotlightConfig {
  version: string;
  rivalMinGames: number;
  fatedMinGames: number;
  streakMin: number;
  closeMax: number;
  powerMinGames: number;
  powerMinRate: number;
  priorGames: number;
  threshold: number;
  minItems: number;
  maxItems: number;
  maxPerType: number;
  maxPerPlayer: number;
}

export const SPOTLIGHT_V1: SpotlightConfig = Object.freeze({
  version: 'spotlight-select-v1',
  rivalMinGames: 3,
  fatedMinGames: 5,
  streakMin: 3,
  closeMax: 0.04,
  powerMinGames: 20,
  powerMinRate: 0.52,
  priorGames: 10,
  threshold: 60,
  minItems: 3,
  maxItems: 5,
  maxPerType: 3,
  maxPerPlayer: 2,
}) as SpotlightConfig;

export type RivalKind = 'fated' | 'nemesis' | 'rival';

/** 유형별 근거 사실 — 화면 문구는 이 사실로만 만든다(추정·과장 금지). */
export type SpotlightFact =
  | { type: 'RIVAL'; kind: RivalKind; aSlot: 0 | 1; bSlot: 2 | 3; aWins: number; bWins: number; games: number }
  | { type: 'HOT_STREAK'; slot: 0 | 1 | 2 | 3; streak: number }
  | { type: 'CLOSE'; probA: number; tier: 'model' | 'reference' }
  | { type: 'POWER'; minGames: number; avgRate: number };

export interface SpotlightCandidate {
  type: SpotlightType;
  score: number;
  fact: SpotlightFact;
}

export interface SpotlightMatchInput {
  matchId: string;
  matchNo: number;
  round: number;
  teamA: readonly [PlayerKey | null, PlayerKey | null];
  teamB: readonly [PlayerKey | null, PlayerKey | null];
  prediction: MatchPrediction;
}

export interface SpotlightAnalysis {
  matchId: string;
  matchNo: number;
  round: number;
  candidates: SpotlightCandidate[];
  mainType: SpotlightType | null;
  score: number;
  /** 정렬 보조: 4명 근거 경기 수 합. */
  sampleGames: number;
  playerKeys: PlayerKey[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const smooth = (wins: number, games: number, prior: number): number => (wins + prior * 0.5) / (games + prior);

/**
 * 한 경기의 주목 유형 후보.
 * @param restricted 개인 기록을 공개하지 않을 선수 키(private/partial 프로필) — RIVAL·HOT_STREAK·POWER 근거에서 제외.
 */
export function analyzeSpotlightMatch(
  index: GameIndex,
  match: SpotlightMatchInput,
  config: SpotlightConfig = SPOTLIGHT_V1,
  restricted: ReadonlySet<PlayerKey> = new Set(),
): SpotlightAnalysis {
  const keys = [match.teamA[0], match.teamA[1], match.teamB[0], match.teamB[1]] as const;
  const open = (k: PlayerKey | null): k is PlayerKey => !!k && !restricted.has(k);
  const candidates: SpotlightCandidate[] = [];

  // RIVAL — 교차 상대 4쌍 중 가장 강한 관계 1개.
  let bestRival: SpotlightCandidate | null = null;
  for (const aSlot of [0, 1] as const) {
    for (const bSlot of [2, 3] as const) {
      const a = keys[aSlot];
      const b = keys[bSlot];
      if (!open(a) || !open(b)) continue;
      const rec = pairRecord(index, a, b, 'opponent');
      if (rec.games < config.rivalMinGames) continue;
      const rate = rec.wins / rec.games;
      const kind: RivalKind = rec.games >= config.fatedMinGames && rate >= 0.4 && rate <= 0.6
        ? 'fated'
        : rate >= 2 / 3 || rate <= 1 / 3 ? 'nemesis' : 'rival';
      const score = r2(58 + Math.min(rec.games, 12) * 1.5 + (kind === 'fated' ? 8 : kind === 'nemesis' ? 6 : 0));
      const cand: SpotlightCandidate = {
        type: 'RIVAL', score,
        fact: { type: 'RIVAL', kind, aSlot, bSlot, aWins: rec.wins, bWins: rec.losses, games: rec.games },
      };
      if (!bestRival || cand.score > bestRival.score) bestRival = cand;
    }
  }
  if (bestRival) candidates.push(bestRival);

  // HOT_STREAK — 가장 긴 연승 1명(동률이면 앞 slot).
  let bestStreak: { slot: 0 | 1 | 2 | 3; streak: number } | null = null;
  keys.forEach((k, i) => {
    if (!open(k)) return;
    const s = index.records.get(k)?.currentStreak ?? 0;
    if (s >= config.streakMin && (!bestStreak || s > bestStreak.streak)) bestStreak = { slot: i as 0 | 1 | 2 | 3, streak: s };
  });
  if (bestStreak) {
    const bs = bestStreak as { slot: 0 | 1 | 2 | 3; streak: number };
    candidates.push({ type: 'HOT_STREAK', score: r2(56 + Math.min(bs.streak, 8) * 3), fact: { type: 'HOT_STREAK', slot: bs.slot, streak: bs.streak } });
  }

  // CLOSE
  const p = match.prediction;
  if (p.probA !== null && p.tier !== 'insufficient') {
    const d = Math.abs(p.probA - 0.5);
    if (d <= config.closeMax) {
      const score = r2(55 + ((config.closeMax - d) / config.closeMax) * 15 + (p.tier === 'model' ? 5 : 0));
      candidates.push({ type: 'CLOSE', score, fact: { type: 'CLOSE', probA: p.probA, tier: p.tier } });
    }
  }

  // POWER
  const recs = keys.map((k) => (k ? index.records.get(k) : undefined));
  // POWER 문구는 4명 전원의 표본을 암시하므로 비공개 회원이 1명이라도 있으면 제외.
  if (keys.every((k) => open(k)) && recs.every((r) => r && r.games >= config.powerMinGames)) {
    const avgRate = recs.reduce((s, r) => s + smooth(r!.wins, r!.games, config.priorGames), 0) / 4;
    const minGames = Math.min(...recs.map((r) => r!.games));
    if (avgRate >= config.powerMinRate) {
      const score = r2(54 + Math.min((avgRate - 0.5) * 100, 16) + Math.min(minGames, 60) / 10);
      candidates.push({ type: 'POWER', score, fact: { type: 'POWER', minGames, avgRate: r2(avgRate) } });
    }
  }

  candidates.sort((x, y) => y.score - x.score || TYPE_PRIORITY.indexOf(x.type) - TYPE_PRIORITY.indexOf(y.type));
  const main = candidates[0] || null;
  const sampleGames = p.samples.slots.reduce((s, sl) => s + (sl.games ?? 0), 0);
  return {
    matchId: match.matchId,
    matchNo: match.matchNo,
    round: match.round,
    candidates,
    mainType: main ? main.type : null,
    score: main ? r2(main.score + 2 * (candidates.length - 1)) : 0,
    sampleGames,
    playerKeys: keys.filter((k): k is PlayerKey => !!k),
  };
}

export function compareSpotlight(a: SpotlightAnalysis, b: SpotlightAnalysis): number {
  return b.score - a.score
    || b.sampleGames - a.sampleGames
    || a.round - b.round
    || a.matchNo - b.matchNo
    || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0);
}

export interface SpotlightSelection {
  configVersion: string;
  selected: SpotlightAnalysis[];
  /** 기준 점수 이상 후보 수(선정 전). */
  qualified: number;
  /** minItems 미만으로 선정됨(억지로 채우지 않음). */
  shortfall: boolean;
}

export function selectSpotlight(
  analyses: readonly SpotlightAnalysis[],
  config: SpotlightConfig = SPOTLIGHT_V1,
): SpotlightSelection {
  const pool = analyses.filter((a) => a.mainType && a.score >= config.threshold).slice().sort(compareSpotlight);
  const selected: SpotlightAnalysis[] = [];
  const perType = new Map<SpotlightType, number>();
  const perPlayer = new Map<PlayerKey, number>();
  for (const a of pool) {
    if (selected.length >= config.maxItems) break;
    const t = a.mainType!;
    if ((perType.get(t) || 0) >= config.maxPerType) continue;
    if (a.playerKeys.some((k) => (perPlayer.get(k) || 0) >= config.maxPerPlayer)) continue;
    selected.push(a);
    perType.set(t, (perType.get(t) || 0) + 1);
    for (const k of a.playerKeys) perPlayer.set(k, (perPlayer.get(k) || 0) + 1);
  }
  return { configVersion: config.version, selected, qualified: pool.length, shortfall: selected.length < config.minItems };
}
