// MATCH SPOTLIGHT 공개 직전 재검증 — 순수 계산.
//
//   저장된 snapshot(시작 전 확정본)은 다시 계산하지 않는다. 공개 시점에 바뀔 수 있는 것만 반영한다.
//     1) 선수 구성: 현재 matches.player_ids ≠ snapshot.playerIds → invalidated(공개 제외). 행이 없으면(세션 종료 등) 유지.
//     2) 공개 범위: 지금 private/partial 인 회원 → 개인 수치 숨김. 그 회원이 메인 근거(RIVAL·HOT_STREAK·POWER)인
//        주목 경기는 SPOTLIGHT 에서 제외(빈자리를 다른 경기로 채우지 않는다 — 억지 채움 금지).
//   선정 순서는 생성 때와 같은 비교자(compareSpotlight)로 복원한다.

import type { SpotlightBuildResult, SpotlightPredictionSnapshot } from './spotlightEngine';
import { compareSpotlight, type SpotlightAnalysis } from './spotlight';
import { buildPublicSpotlightPayload, type PublicSpotlightPayload } from './publicSpotlight';

export interface StoredPredictionForPublish {
  matchId: string;
  status: string;
  selected: boolean;
  snapshot: SpotlightPredictionSnapshot;
  /** 현재 LIVE matches.player_ids. 행이 없으면 null(비교 생략). */
  currentPlayerIds: readonly string[] | null;
}

export interface PreparePublishInput {
  modelVersion: string;
  selectVersion: string;
  sessionId: string;
  cutoffDate: string;
  title: string;
  date: string;
  predictions: readonly StoredPredictionForPublish[];
  restrictedMemberIds: readonly string[];
}

export interface PreparePublishResult {
  payload: PublicSpotlightPayload;
  invalidateMatchIds: string[];
  droppedForPrivacy: string[];
  /** 공개 대상 snapshot(무효 제외 · 현재 공개 범위 반영). 운영진 PICK 검증용 — 계산 결과는 바꾸지 않는다. */
  eligible: SpotlightPredictionSnapshot[];
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => String(v) === String(b[i]));

/** 메인 근거가 비공개 slot 을 쓰는가. (운영진 PICK 도 같은 규칙으로 막는다) */
export function mainFactUsesRestricted(p: SpotlightPredictionSnapshot): boolean {
  const main = p.candidates.find((c) => c.type === p.mainType);
  if (!main) return false;
  const f = main.fact;
  if (f.type === 'RIVAL') return p.restrictedSlots[f.aSlot] || p.restrictedSlots[f.bSlot];
  if (f.type === 'HOT_STREAK') return p.restrictedSlots[f.slot];
  if (f.type === 'POWER') return p.restrictedSlots.some(Boolean);
  return false;
}

export function preparePublish(input: PreparePublishInput): PreparePublishResult {
  const restricted = new Set(input.restrictedMemberIds.map(String));
  const invalidateMatchIds: string[] = [];
  const droppedForPrivacy: string[] = [];
  const valid: Array<{ snap: SpotlightPredictionSnapshot; selected: boolean }> = [];

  for (const p of input.predictions) {
    if (p.status !== 'active') continue;
    if (p.currentPlayerIds && !sameIds(p.currentPlayerIds, p.snapshot.playerIds)) {
      invalidateMatchIds.push(p.matchId);
      continue;
    }
    const restrictedSlots = p.snapshot.playerIds.map(
      (pid, i) => p.snapshot.restrictedSlots[i] || restricted.has(String(pid)),
    ) as [boolean, boolean, boolean, boolean];
    valid.push({ snap: { ...p.snapshot, restrictedSlots }, selected: p.selected });
  }

  const asAnalysis = (s: SpotlightPredictionSnapshot): SpotlightAnalysis => ({
    matchId: s.matchId,
    matchNo: s.matchNo,
    round: s.round,
    candidates: s.candidates,
    mainType: s.mainType,
    score: s.score,
    sampleGames: s.prediction.samples.slots.reduce((sum, sl) => sum + (sl.games ?? 0), 0),
    playerKeys: [],
  });
  const selected = valid
    .filter((v) => v.selected)
    .map((v) => v.snap)
    .filter((s) => {
      if (mainFactUsesRestricted(s)) { droppedForPrivacy.push(s.matchId); return false; }
      return true;
    })
    .sort((a, b) => compareSpotlight(asAnalysis(a), asAnalysis(b)));

  const result: SpotlightBuildResult = {
    modelVersion: input.modelVersion,
    selectVersion: input.selectVersion,
    sessionId: input.sessionId,
    cutoffDate: input.cutoffDate,
    source: { archiveIds: [], archiveCount: 0, gameCount: 0, latestDate: null, signature: '', unidentifiedSlots: 0, guestSlots: 0 },
    predictions: valid.map((v) => v.snap).sort((a, b) => a.matchNo - b.matchNo),
    skipped: [],
    selection: { matchIds: selected.map((s) => s.matchId), qualified: selected.length, shortfall: selected.length < 3 },
  };
  return {
    payload: buildPublicSpotlightPayload(result, { title: input.title, date: input.date }),
    invalidateMatchIds,
    droppedForPrivacy,
    eligible: valid.map((v) => v.snap),
  };
}
