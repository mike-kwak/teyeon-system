// MATCH SPOTLIGHT 생성 오케스트레이터 — 순수 계산(입력 주입, 시계·네트워크 미사용).
//
//   서버(route)가 DB 에서 읽은 값만 넣어 호출한다. 클라이언트가 계산한 값을 받지 않는다.
//   같은 입력이면 항상 같은 결과(결정적) → 저장된 snapshot 을 나중에 재계산해 조작 여부를 검증할 수 있다.
//
//   예측 대상: 현재 세션 경기 중 status='waiting' 인 경기만. 그 외(playing/complete/기타)는 skipped.
//     ⚠ 이 함수의 waiting 판정은 1차 필터일 뿐이다. 최종 판정은 저장 RPC 가 행 잠금 후 DB 에서 다시 한다.

import {
  extractOfficialGames,
  fnv1a,
  guestKey,
  memberKey,
  NO_GUEST_IDENTITY,
  type GuestIdentityPolicy,
  type PlayerKey,
} from './officialGames';
import { buildGameIndex } from './playerForm';
import { MODEL_V1, predictMatch, type MatchPrediction, type PredictionModelConfig } from './predictionModel';
import {
  analyzeSpotlightMatch,
  selectSpotlight,
  SPOTLIGHT_V1,
  type SpotlightCandidate,
  type SpotlightConfig,
  type SpotlightType,
} from './spotlight';
import { buildMemberResolver, type HeadToHeadMemberRef } from '../../ranking/headToHead';
import { clipPlayerName } from './playerName';
import type { KdkArchiveRow } from '../../kdkArchiveStats';

/** LIVE matches 행(필요 컬럼만). */
export interface SessionMatchRow {
  id: string;
  round?: number | null;
  court?: number | null;
  status?: string | null;
  group_name?: string | null;
  player_ids?: readonly string[] | null;
  player_names?: readonly string[] | null;
}

export interface BuildSpotlightInput {
  sessionId: string;
  /** 세션 경기일(KST, YYYY-MM-DD). 이 날짜 "미만" 공식 기록만 사용. */
  sessionDate: string;
  sessionMatches: readonly SessionMatchRow[];
  archiveRows: readonly KdkArchiveRow[];
  /** 전체 회원(탈회 포함) — 과거 기록 해석용. */
  members: readonly HeadToHeadMemberRef[];
  guestPolicy?: GuestIdentityPolicy;
  /** 개인 기록 비공개 회원 id(profile_visibility_level='private' 등). */
  restrictedMemberIds?: readonly string[];
  modelConfig?: PredictionModelConfig;
  spotlightConfig?: SpotlightConfig;
}

export type SkipReason = 'not_waiting' | 'invalid_players';

export interface SpotlightPredictionSnapshot {
  matchId: string;
  matchNo: number;
  round: number;
  court: number | null;
  groupName: string;
  playerIds: [string, string, string, string];
  playerNames: [string, string, string, string];
  /** player_ids 순서 그대로의 서명 — 선수 교체 감지. */
  playersHash: string;
  /** 각 slot 분석 키 공개 여부: restricted 이면 개인 수치 비공개. */
  restrictedSlots: [boolean, boolean, boolean, boolean];
  prediction: MatchPrediction;
  candidates: SpotlightCandidate[];
  mainType: SpotlightType | null;
  score: number;
}

export interface SpotlightBuildResult {
  modelVersion: string;
  selectVersion: string;
  sessionId: string;
  cutoffDate: string;
  source: {
    archiveIds: string[];
    archiveCount: number;
    gameCount: number;
    latestDate: string | null;
    signature: string;
    unidentifiedSlots: number;
    guestSlots: number;
  };
  predictions: SpotlightPredictionSnapshot[];
  skipped: Array<{ matchId: string; matchNo: number; reason: SkipReason }>;
  selection: { matchIds: string[]; qualified: number; shortfall: boolean };
}

export const playersHashOf = (ids: readonly string[]): string => fnv1a(ids.map(String).join('|'));

const cleanName = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);

/** 경기 번호: round → court → id 순 1부터. 상태와 무관하게 전체 경기 기준(번호 안정). */
export function numberSessionMatches(rows: readonly SessionMatchRow[]): Map<string, number> {
  const sorted = rows.slice().sort((a, b) =>
    (Number(a.round) || 0) - (Number(b.round) || 0)
    || (Number(a.court) || 0) - (Number(b.court) || 0)
    || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return new Map(sorted.map((r, i) => [String(r.id), i + 1]));
}

export function buildSpotlight(input: BuildSpotlightInput): SpotlightBuildResult {
  const modelConfig = input.modelConfig || MODEL_V1;
  const spotlightConfig = input.spotlightConfig || SPOTLIGHT_V1;
  const guestPolicy = input.guestPolicy || NO_GUEST_IDENTITY;
  const set = extractOfficialGames(
    input.archiveRows,
    input.members,
    { beforeDate: input.sessionDate, excludeArchiveIds: [input.sessionId] },
    guestPolicy,
  );
  const index = buildGameIndex(set.games);
  const resolver = buildMemberResolver([...input.members]);
  const restrictedIds = new Set((input.restrictedMemberIds || []).map(String));
  const restrictedKeys = new Set<PlayerKey>([...restrictedIds].map(memberKey));
  const numbers = numberSessionMatches(input.sessionMatches);

  const predictions: SpotlightPredictionSnapshot[] = [];
  const skipped: SpotlightBuildResult['skipped'] = [];
  const keysByMatch = new Map<string, PlayerKey[]>();

  for (const row of input.sessionMatches) {
    const matchId = String(row.id);
    const matchNo = numbers.get(matchId) || 0;
    const ids = (row.player_ids || []).map((v) => String(v ?? ''));
    const names = (row.player_names || []).map(cleanName);
    if (String(row.status || '') !== 'waiting') { skipped.push({ matchId, matchNo, reason: 'not_waiting' }); continue; }
    if (ids.length !== 4 || ids.some((v) => !v) || new Set(ids).size !== 4) {
      skipped.push({ matchId, matchNo, reason: 'invalid_players' });
      continue;
    }
    const keys = ids.map((pid, i): PlayerKey | null => {
      const r = resolver.resolveSlot(pid, names[i] || '');
      if (r === 'GUEST') {
        const gid = guestPolicy.resolve(input.sessionId, pid, names[i] || '');
        return gid ? guestKey(gid) : null;
      }
      return r === 'ORPHAN' ? null : memberKey(r);
    });
    const teamA = [keys[0], keys[1]] as const;
    const teamB = [keys[2], keys[3]] as const;
    const prediction = predictMatch(index, teamA, teamB, modelConfig);
    const analysis = analyzeSpotlightMatch(
      index,
      { matchId, matchNo, round: Number(row.round) || 0, teamA, teamB, prediction },
      spotlightConfig,
      restrictedKeys,
    );
    predictions.push({
      matchId,
      matchNo,
      round: Number(row.round) || 0,
      court: row.court == null ? null : Number(row.court),
      groupName: String(row.group_name || ''),
      playerIds: [ids[0], ids[1], ids[2], ids[3]],
      // 표시용 이름(식별에 쓴 names 와 별개) — 긴 게스트 이름에서도 "(G)" 보존.
      playerNames: [0, 1, 2, 3].map((i) => clipPlayerName((row.player_names || [])[i])) as [string, string, string, string],
      playersHash: playersHashOf(ids),
      restrictedSlots: keys.map((k) => !!k && restrictedKeys.has(k)) as [boolean, boolean, boolean, boolean],
      prediction,
      candidates: analysis.candidates,
      mainType: analysis.mainType,
      score: analysis.score,
    });
    keysByMatch.set(matchId, analysis.playerKeys);
  }

  const analyses = predictions.map((p) => ({
    matchId: p.matchId,
    matchNo: p.matchNo,
    round: p.round,
    candidates: p.candidates,
    mainType: p.mainType,
    score: p.score,
    sampleGames: p.prediction.samples.slots.reduce((s, sl) => s + (sl.games ?? 0), 0),
    playerKeys: keysByMatch.get(p.matchId) || [],
  }));
  const selection = selectSpotlight(analyses, spotlightConfig);

  predictions.sort((a, b) => a.matchNo - b.matchNo);
  skipped.sort((a, b) => a.matchNo - b.matchNo);

  return {
    modelVersion: modelConfig.version,
    selectVersion: spotlightConfig.version,
    sessionId: input.sessionId,
    cutoffDate: input.sessionDate,
    source: {
      archiveIds: set.archiveIds,
      archiveCount: set.archiveIds.length,
      gameCount: set.games.length,
      latestDate: set.latestDate,
      signature: set.sourceSignature,
      unidentifiedSlots: set.unidentifiedSlots,
      guestSlots: set.guestSlots,
    },
    predictions,
    skipped,
    selection: {
      matchIds: selection.selected.map((s) => s.matchId),
      qualified: selection.qualified,
      shortfall: selection.shortfall,
    },
  };
}
