// MATCH SPOTLIGHT 예측 모델 v1 — 결정적 순수 계산.
//
//   ⚠ 결과는 "공식 KDK 기록 기반 참고용 모델 수치"다. 통계적으로 검증된 실제 승리 확률이 아니다.
//   ⚠ 데이터가 부족하면 확률을 만들지 않는다(probA=null). 가짜 확률 금지.
//
//   구성(모두 logit 공간에서 합산):
//     base    : 팀 평균 평활 승률 (wins + priorGames·0.5) / (games + priorGames) 의 logit 차
//     form    : 최근 N경기 평활 승률 − 전체 평활 승률 (logit 차) 의 팀 평균 차 (v1 가중 0 — 기록만 보존)
//     partner : 같은 팀 두 선수의 파트너 전적(≥pairMinGames) 평활 승률 logit, 팀 간 차
//     h2h     : 교차 상대 4쌍 중 ≥pairMinGames 쌍의 평활 승률 logit 평균
//   p = sigmoid(Σ weight·factor), [clampMin, clampMax] 로 제한.
//
//   등급(tier):
//     model        : 4명 모두 분석 가능 + 각자 ≥ minPercentGames → 참고용 % 표시
//     reference    : 4명 모두 분석 가능(각자 ≥ minAnalyzableGames) → 우세/박빙 라벨만
//     insufficient : 분석 불가 선수 포함 → 데이터 부족(확률 없음). 가능한 선수 표본은 보존.

import type { PlayerKey } from './officialGames';
import { crossOpponentRecord, pairRecord, recentOf, type GameIndex } from './playerForm';

export interface PredictionModelConfig {
  version: string;
  minAnalyzableGames: number;
  minPercentGames: number;
  priorGames: number;
  recentWindow: number;
  recentMinGames: number;
  pairMinGames: number;
  weights: { base: number; form: number; partner: number; h2h: number };
  clampMin: number;
  clampMax: number;
  /** |p − 0.5| 가 이 값 미만이면 박빙. */
  closeMargin: number;
}

export const MODEL_V1: PredictionModelConfig = Object.freeze({
  version: 'spotlight-v1',
  minAnalyzableGames: 3,
  minPercentGames: 8,
  priorGames: 10,
  recentWindow: 10,
  recentMinGames: 5,
  pairMinGames: 3,
  // 2026-11-03 백테스트(공식 22세션 · 각 세션을 그 이전 기록만으로 예측, model 등급 103경기):
  //   form 가중 0.5 → Brier 0.2390 / form 0 → 0.2371 (기준선 0.25). 최근 흐름은 예측력 근거가 없어 0.
  //   최근 흐름은 HOT STREAK 근거로만 사용한다. 표본이 작아(103경기) 가중치는 재검증 대상.
  weights: Object.freeze({ base: 1.0, form: 0, partner: 0.5, h2h: 0.5 }),
  clampMin: 0.2,
  clampMax: 0.8,
  closeMargin: 0.08,
}) as PredictionModelConfig;

export type PredictionTier = 'model' | 'reference' | 'insufficient';
export type PredictionLabel = 'favoredA' | 'favoredB' | 'close' | 'insufficient';

export interface SlotSample {
  /** 0,1 = 팀A, 2,3 = 팀B. */
  slot: 0 | 1 | 2 | 3;
  identified: boolean;
  /** 기준일 이전 공식 경기 수(식별 불가면 null). */
  games: number | null;
  wins: number | null;
  analyzable: boolean;
}

export interface MatchPrediction {
  modelVersion: string;
  tier: PredictionTier;
  /** 팀A 승리 모델 수치(0~1). tier='insufficient' 면 null. */
  probA: number | null;
  label: PredictionLabel;
  factors: { base: number; form: number; partner: number; h2h: number } | null;
  samples: {
    slots: SlotSample[];
    minGames: number | null;
    partnerGames: [number, number];
    /** ≥pairMinGames 교차 상대 쌍의 경기 합(쌍별 중복 포함). */
    h2hPairGames: number;
  };
}

const logit = (p: number): number => Math.log(p / (1 - p));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const smooth = (wins: number, games: number, prior: number): number => (wins + prior * 0.5) / (games + prior);
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

export function predictMatch(
  index: GameIndex,
  teamA: readonly [PlayerKey | null, PlayerKey | null],
  teamB: readonly [PlayerKey | null, PlayerKey | null],
  config: PredictionModelConfig = MODEL_V1,
): MatchPrediction {
  const keys = [teamA[0], teamA[1], teamB[0], teamB[1]] as const;
  const slots: SlotSample[] = keys.map((k, i) => {
    const r = k ? index.records.get(k) : undefined;
    const games = k ? (r?.games ?? 0) : null;
    return {
      slot: i as 0 | 1 | 2 | 3,
      identified: !!k,
      games,
      wins: k ? (r?.wins ?? 0) : null,
      analyzable: games !== null && games >= config.minAnalyzableGames,
    };
  });
  const partnerA = pairRecord(index, teamA[0], teamA[1], 'partner');
  const partnerB = pairRecord(index, teamB[0], teamB[1], 'partner');
  const cross = crossOpponentRecord(index, teamA, teamB, config.pairMinGames);
  const knownGames = slots.map((s) => s.games).filter((g): g is number => g !== null);
  const samples = {
    slots,
    minGames: knownGames.length ? Math.min(...knownGames) : null,
    partnerGames: [partnerA.games, partnerB.games] as [number, number],
    h2hPairGames: cross.games,
  };

  if (!slots.every((s) => s.analyzable)) {
    return { modelVersion: config.version, tier: 'insufficient', probA: null, label: 'insufficient', factors: null, samples };
  }

  const strength = (k: PlayerKey): { overall: number; form: number } => {
    const r = index.records.get(k)!;
    const overall = smooth(r.wins, r.games, config.priorGames);
    const recent = recentOf(r, config.recentWindow);
    const form = recent.games >= config.recentMinGames
      ? logit(smooth(recent.wins, recent.games, config.priorGames)) - logit(overall)
      : 0;
    return { overall, form };
  };
  const [a0, a1, b0, b1] = keys.map((k) => strength(k!));
  const base = logit((a0.overall + a1.overall) / 2) - logit((b0.overall + b1.overall) / 2);
  const form = (a0.form + a1.form) / 2 - (b0.form + b1.form) / 2;
  const partnerLogit = (p: { games: number; wins: number }) =>
    p.games >= config.pairMinGames ? logit(smooth(p.wins, p.games, config.priorGames)) : 0;
  const partner = partnerLogit(partnerA) - partnerLogit(partnerB);
  const h2hPairs = cross.pairs.filter((p) => p.record.games >= config.pairMinGames);
  const h2h = h2hPairs.length
    ? h2hPairs.reduce((s, p) => s + logit(smooth(p.record.wins, p.record.games, config.priorGames)), 0) / h2hPairs.length
    : 0;

  const w = config.weights;
  const z = w.base * base + w.form * form + w.partner * partner + w.h2h * h2h;
  const probA = round4(Math.min(config.clampMax, Math.max(config.clampMin, sigmoid(z))));
  const minGames = samples.minGames ?? 0;
  const tier: PredictionTier = minGames >= config.minPercentGames ? 'model' : 'reference';
  const label: PredictionLabel = Math.abs(probA - 0.5) < config.closeMargin ? 'close' : probA > 0.5 ? 'favoredA' : 'favoredB';

  return {
    modelVersion: config.version,
    tier,
    probA,
    label,
    factors: { base: round4(base), form: round4(form), partner: round4(partner), h2h: round4(h2h) },
    samples,
  };
}
