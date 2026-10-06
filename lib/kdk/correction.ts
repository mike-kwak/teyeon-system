// TEYEON KDK 공식 기록 정정 — 순수 계산.
//
//   목적: Archive(teyeon_archive_v1.raw_data)에 저장된 경기 1건의 점수를 고쳤을 때
//         무엇이 어떻게 바뀌는지 계산하고, 저장할 next raw_data 를 만든다.
//
//   ⚠ 새 규칙을 만들지 않는다. 전부 기존 SSoT 를 **조합**할 뿐이다.
//       · 집계(승/패·득점·실점·득실) → lib/kdk/aggregate.ts
//       · 공식 순위                   → lib/kdk/officialRanking.ts (comparator 그대로)
//       · 정산(벌금·상금·게스트비)    → lib/kdk/settlement.ts
//     순위 규칙·정산 규칙을 이 파일에서 다시 쓰면 안 된다(2026-07-07 동률 오확정 재발 방지).
//
//   ⚠ 공식 순위는 항상 sortOfficialKdkRanking 하나로 정한다 —
//       ① 승수 ↓ ② 득실 ↓ ③ 연장자(출생연도 작은 값) ↑ ④ 이름 ↑ ⑤ stable id ↑.
//     Archive 에 저장돼 있던 배열 순서를 tie-break 규칙으로 쓰지 않는다.
//
//   ⚠ 출생연도가 없어 ①②가 같은 동률을 가릴 수 없으면 **정정을 차단**한다
//     (findUnresolvedTieBirthYears — 공식 확정 화면과 같은 가드). 임의 순서를 만들지 않는다.
//
//   ⚠ 바꾸는 것은 대상 경기의 score1/score2 와 그로부터 파생되는 ranking_data ·
//     settlement_data 뿐이다. title · date · player_metadata · settlement_meta ·
//     total_matches · total_rounds · 다른 경기는 전부 그대로 둔다.

import { aggregateKdkPlayerStats, EMPTY_KDK_PLAYER_STATS } from './aggregate';
import {
  findUnresolvedTieBirthYears, normalizeBirthYear, sortOfficialKdkRanking,
  type BirthYearStatus, type OfficialRankingEntry,
} from './officialRanking';
import {
  computeSettlement, isAssociateGuestFeeMember, isGuestRankedPlayer,
  type SettlementPrizes, type SettlementSnapshotEntry,
} from './settlement';

// ── Archive raw_data 모양(이 계산이 실제로 읽는 범위만) ──────────────────────

export interface ArchiveRankingEntry {
  id?: string | null;
  name?: string | null;
  wins?: number | null;
  losses?: number | null;
  diff?: number | null;
  avatar?: string | null;
  [k: string]: unknown;
}

export interface ArchiveSnapshotMatch {
  id?: string | null;
  status?: string | null;
  score1?: number | null;
  score2?: number | null;
  round?: number | null;
  court?: number | null;
  group?: string | null;
  group_name?: string | null;
  groupName?: string | null;
  player_ids?: (string | null)[] | null;
  playerIds?: (string | null)[] | null;
  player_names?: (string | null)[] | null;
  playerNames?: (string | null)[] | null;
  [k: string]: unknown;
}

export interface ArchiveRawData {
  title?: string | null;
  date?: string | null;
  ranking_data?: ArchiveRankingEntry[] | null;
  snapshot_data?: ArchiveSnapshotMatch[] | null;
  settlement_data?: SettlementSnapshotEntry[] | null;
  settlement_meta?: {
    guest_fee?: number | null;
    prizes?: { first?: number | null; l1?: number | null; l2?: number | null } | null;
    [k: string]: unknown;
  } | null;
  player_metadata?: Record<string, {
    group?: string | null;
    birthYear?: number | string | null;
    age?: number | string | null;
    birthYearStatus?: string | null;
    [k: string]: unknown;
  }> | null;
  [k: string]: unknown;
}

/** 회원 출생연도 공급원. 운영자 세션의 admin_get_member_birth_years 결과를 넘긴다. */
export type BirthYearSource = ReadonlyMap<string, number | string | null | undefined>;

// ── 결과 모양 ────────────────────────────────────────────────────────────────

export interface CorrectionPlayerRow {
  playerId: string;
  name: string;
  isGuest: boolean;
  owesGuestFee: boolean;
  /** 전체 순위(1부터). */
  rank: number;
  /** 조별 순위(1부터). 조가 없으면 null. */
  groupRank: number | null;
  group: string | null;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  birthYear: number | null;
  penaltyLevel: 'L1' | 'L2' | null;
  penaltyAmount: number;
  prizeAmount: number;
  guestFeeAmount: number;
  finalAmount: number;
}

export interface CorrectionChange<T> {
  playerId: string;
  name: string;
  before: T;
  after: T;
}

export interface CorrectionMoneyChange {
  playerId: string;
  name: string;
  before: Pick<CorrectionPlayerRow, 'penaltyLevel' | 'penaltyAmount' | 'prizeAmount' | 'guestFeeAmount' | 'finalAmount'>;
  after: Pick<CorrectionPlayerRow, 'penaltyLevel' | 'penaltyAmount' | 'prizeAmount' | 'guestFeeAmount' | 'finalAmount'>;
}

export interface CorrectionMatchSummary {
  matchId: string;
  group: string | null;
  round: number | null;
  court: number | null;
  team1Names: string[];
  team2Names: string[];
  beforeScore1: number;
  beforeScore2: number;
  afterScore1: number;
  afterScore2: number;
  /** 승자 표시용(팀 번호 아님). 서버가 점수에서 다시 파생하므로 저장되지 않는다. */
  beforeWinner: 'team1' | 'team2' | null;
  afterWinner: 'team1' | 'team2' | null;
  winnerChanged: boolean;
}

export type CorrectionBlockReason =
  | 'archive_empty'
  | 'match_not_found'
  | 'match_not_complete'
  | 'invalid_score'
  | 'no_change'
  | 'unresolved_tie_birth_years';

export interface CorrectionImpact {
  /** 정정을 확정할 수 있는가. false 면 blocked 에 이유가 있다. */
  ok: boolean;
  blocked: CorrectionBlockReason | null;
  match: CorrectionMatchSummary | null;
  before: CorrectionPlayerRow[];
  after: CorrectionPlayerRow[];
  rankChanges: CorrectionChange<number>[];
  groupRankChanges: CorrectionChange<number | null>[];
  diffChanges: CorrectionChange<number>[];
  pointsForChanges: CorrectionChange<number>[];
  pointsAgainstChanges: CorrectionChange<number>[];
  winLossChanges: CorrectionChange<string>[];
  moneyChanges: CorrectionMoneyChange[];
  /** ①②가 같은데 출생연도가 확인되지 않아 순위를 확정할 수 없는 참가자. */
  unresolvedTieBirthYears: Array<{ playerId: string; name: string }>;
  /** 저장할 next raw_data. 확정 불가(ok=false)면 null. */
  nextRawData: ArchiveRawData | null;
  /** 참가 인원(= ranking_data 길이). 정산 tier 분모. */
  totalPlayers: number;
}

// ── 내부 helper ──────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

const matchPlayerIds = (m: ArchiveSnapshotMatch): string[] =>
  ((m?.player_ids ?? m?.playerIds ?? []) as (string | null)[]).map(x => str(x));
const matchPlayerNames = (m: ArchiveSnapshotMatch): string[] =>
  ((m?.player_names ?? m?.playerNames ?? []) as (string | null)[]).map(x => str(x));
const matchGroup = (m: ArchiveSnapshotMatch): string | null => {
  const g = str(m?.group_name ?? m?.groupName ?? m?.group).trim();
  return g === '' ? null : g;
};

/** 정산 prizes — settlement_meta 그대로 쓴다(여기서 기본값을 만들지 않는다). */
function prizesOf(raw: ArchiveRawData): SettlementPrizes {
  const p = raw?.settlement_meta?.prizes || {};
  return { first: num(p.first), l1: num(p.l1), l2: num(p.l2) };
}

/**
 * 참가자별 출생연도 — 확정 당시와 **같은 우선순위**로 찾는다.
 *   ① player_metadata.birthYear (게스트 입력 / 세션 snapshot)
 *   ② player_metadata.age (레거시 — 4자리 연도일 때만)
 *   ③ birthYearSource (회원: members."나이" — admin_get_member_birth_years)
 * (hooks/useRanking.ts 와 같은 사다리. 저장 위치만 Archive/운영 RPC 로 바뀐다.)
 */
function birthYearOf(
  playerId: string,
  raw: ArchiveRawData,
  source: BirthYearSource | null | undefined,
): { birthYear: number | null; birthYearStatus: BirthYearStatus | undefined } {
  const meta = raw?.player_metadata?.[playerId] || {};
  const fromMeta = normalizeBirthYear(meta.birthYear) ?? normalizeBirthYear(meta.age);
  const fromSource = source ? normalizeBirthYear(source.get(playerId)) : null;
  const birthYear = fromMeta ?? fromSource;
  const birthYearStatus: BirthYearStatus | undefined =
    birthYear !== null ? 'provided'
      : meta.birthYearStatus === 'declined' ? 'declined'
        : undefined;
  return { birthYear, birthYearStatus };
}

type Entry = OfficialRankingEntry & {
  isGuest: boolean;
  owesGuestFee: boolean;
  group: string | null;
  games: number;
  /** ranking_data 원본 항목 — 저장 시 avatar 등 기타 필드를 보존한다. */
  rankingSource: ArchiveRankingEntry;
  settlementSource: SettlementSnapshotEntry | null;
};

/** 참가자 명단 + 집계값으로 공식 순위 entry 를 만든다. */
function buildEntries(
  raw: ArchiveRawData,
  matches: ArchiveSnapshotMatch[],
  source: BirthYearSource | null | undefined,
): Entry[] {
  const { stats } = aggregateKdkPlayerStats(matches);
  const settlementByPid = new Map<string, SettlementSnapshotEntry>();
  (raw.settlement_data || []).forEach(e => {
    settlementByPid.set(str(e.player_id), e);
  });

  // 조 — player_metadata 우선, 없으면 그 선수가 뛴 첫 경기의 group_name.
  const groupByPid = new Map<string, string | null>();
  matches.forEach(m => {
    const g = matchGroup(m);
    matchPlayerIds(m).forEach(pid => {
      if (pid && g && !groupByPid.has(pid)) groupByPid.set(pid, g);
    });
  });

  return (raw.ranking_data || []).map(p => {
    const playerId = str(p.id);
    const name = str(p.name);
    const s = stats[playerId] || EMPTY_KDK_PLAYER_STATS;
    const { birthYear, birthYearStatus } = birthYearOf(playerId, raw, source);
    const settlementSource = settlementByPid.get(playerId) || null;
    // 게스트 판정은 저장된 settlement 값을 우선 신뢰한다(점수와 무관하게 불변).
    const isGuest = settlementSource
      ? settlementSource.is_guest === true
      : isGuestRankedPlayer({ id: playerId, name });
    const assoc = settlementSource
      ? settlementSource.is_associate_guest_fee_member === true
      : isAssociateGuestFeeMember({ name });
    const metaGroup = str(raw?.player_metadata?.[playerId]?.group).trim();
    return {
      playerId,
      name,
      wins: s.wins,
      losses: s.losses,
      pointsFor: s.pf,
      pointsAgainst: s.pa,
      diff: s.diff,
      birthYear,
      birthYearStatus,
      isGuest,
      owesGuestFee: isGuest || assoc,
      group: metaGroup !== '' ? metaGroup : (groupByPid.get(playerId) ?? null),
      games: s.games,
      rankingSource: p,
      settlementSource,
    } satisfies Entry;
  });
}

/** 공식 순위 + 조별 순위 + 정산까지 붙인 표 1장. */
function buildRows(entries: Entry[], prizes: SettlementPrizes, guestFee: number): {
  rows: CorrectionPlayerRow[];
  sorted: Array<Entry & { rank: number }>;
} {
  // ⚠ 공식 comparator 그대로. 정렬 규칙을 여기서 바꾸지 않는다.
  const sorted = sortOfficialKdkRanking(entries);
  const total = sorted.length;

  const groupSeen = new Map<string, number>();
  const rows = sorted.map((e, idx) => {
    // ⚠ 금액은 전부 computeSettlement(SSoT)가 정한다 — 여기서 다시 더하거나 보정하지 않는다.
    //   게스트 판정(is_guest)·준회원 게스트비(이름 whitelist)도 그 안에서 결정된다.
    const s = computeSettlement(
      { id: e.playerId, name: e.name, is_guest: e.isGuest },
      idx, total, prizes, guestFee,
    );
    let groupRank: number | null = null;
    if (e.group) {
      const n = (groupSeen.get(e.group) || 0) + 1;
      groupSeen.set(e.group, n);
      groupRank = n;
    }
    return {
      playerId: e.playerId,
      name: e.name,
      isGuest: s.isGuest,
      owesGuestFee: s.owesGuestFee,
      rank: idx + 1,
      groupRank,
      group: e.group,
      wins: e.wins,
      losses: e.losses ?? 0,
      pointsFor: e.pointsFor ?? 0,
      pointsAgainst: e.pointsAgainst ?? 0,
      diff: e.diff,
      birthYear: e.birthYear ?? null,
      penaltyLevel: s.penaltyLevel,
      penaltyAmount: s.penaltyAmount,
      prizeAmount: s.prizeAmount,
      guestFeeAmount: s.guestFeeAmount,
      finalAmount: s.finalAmount,
    } satisfies CorrectionPlayerRow;
  });

  return { rows, sorted };
}

const sameMoney = (a: CorrectionPlayerRow, b: CorrectionPlayerRow) =>
  a.penaltyLevel === b.penaltyLevel
  && a.penaltyAmount === b.penaltyAmount
  && a.prizeAmount === b.prizeAmount
  && a.guestFeeAmount === b.guestFeeAmount
  && a.finalAmount === b.finalAmount;

const empty = (blocked: CorrectionBlockReason, match: CorrectionMatchSummary | null = null): CorrectionImpact => ({
  ok: false, blocked, match,
  before: [], after: [],
  rankChanges: [], groupRankChanges: [], diffChanges: [],
  pointsForChanges: [], pointsAgainstChanges: [], winLossChanges: [], moneyChanges: [],
  unresolvedTieBirthYears: [], nextRawData: null, totalPlayers: 0,
});

// ── 본체 ─────────────────────────────────────────────────────────────────────

/**
 * 점수 1건 정정의 영향 + 저장할 next raw_data.
 *
 *   ⚠ 순수 함수다. 네트워크·DOM·Supabase 의존이 없다.
 *   ⚠ 입력 rawData 를 변형하지 않는다(깊은 복사 후 수정).
 */
export function computeCorrectionImpact(
  rawData: ArchiveRawData,
  matchId: string,
  nextScore1: number,
  nextScore2: number,
  birthYearSource?: BirthYearSource | null,
): CorrectionImpact {
  const snapshot = Array.isArray(rawData?.snapshot_data) ? rawData.snapshot_data : [];
  const ranking = Array.isArray(rawData?.ranking_data) ? rawData.ranking_data : [];
  if (snapshot.length === 0 || ranking.length === 0) return empty('archive_empty');

  const targetIdx = snapshot.findIndex(m => str(m?.id) === matchId);
  if (targetIdx < 0) return empty('match_not_found');
  const target = snapshot[targetIdx];

  const beforeScore1 = num(target.score1);
  const beforeScore2 = num(target.score2);
  const names = matchPlayerNames(target);
  const summary: CorrectionMatchSummary = {
    matchId,
    group: matchGroup(target),
    round: target.round == null ? null : num(target.round),
    court: target.court == null ? null : num(target.court),
    team1Names: names.slice(0, 2),
    team2Names: names.slice(2, 4),
    beforeScore1, beforeScore2,
    afterScore1: nextScore1, afterScore2: nextScore2,
    beforeWinner: beforeScore1 === beforeScore2 ? null : (beforeScore1 > beforeScore2 ? 'team1' : 'team2'),
    afterWinner: nextScore1 === nextScore2 ? null : (nextScore1 > nextScore2 ? 'team1' : 'team2'),
    winnerChanged: false,
  };
  summary.winnerChanged = summary.beforeWinner !== summary.afterWinner;

  if (str(target.status) !== 'complete') return empty('match_not_complete', summary);
  if (!Number.isInteger(nextScore1) || !Number.isInteger(nextScore2)
    || nextScore1 < 0 || nextScore2 < 0 || nextScore1 === nextScore2) {
    return empty('invalid_score', summary);
  }
  if (nextScore1 === beforeScore1 && nextScore2 === beforeScore2) return empty('no_change', summary);

  const prizes = prizesOf(rawData);
  const guestFee = num(rawData?.settlement_meta?.guest_fee);

  // BEFORE / AFTER 모두 **같은 경로**로 계산한다(저장된 배열 순서를 신뢰하지 않는다).
  const beforeEntries = buildEntries(rawData, snapshot, birthYearSource);
  const patchedSnapshot = snapshot.map((m, i) => (
    i === targetIdx ? { ...m, score1: nextScore1, score2: nextScore2 } : m
  ));
  const afterEntries = buildEntries(rawData, patchedSnapshot, birthYearSource);

  const beforeBuilt = buildRows(beforeEntries, prizes, guestFee);
  const afterBuilt = buildRows(afterEntries, prizes, guestFee);
  const before = beforeBuilt.rows;
  const after = afterBuilt.rows;

  // ⚠ 출생연도 미확인 동률 — 공식 확정 화면과 같은 가드. 임의 순서를 만들지 않는다.
  const unresolved = findUnresolvedTieBirthYears(afterBuilt.sorted)
    .map(e => ({ playerId: e.playerId, name: e.name }));

  const afterByPid = new Map(after.map(r => [r.playerId, r]));
  const pick = <T,>(sel: (r: CorrectionPlayerRow) => T): CorrectionChange<T>[] =>
    before.flatMap(b => {
      const a = afterByPid.get(b.playerId);
      if (!a) return [];
      const bv = sel(b); const av = sel(a);
      return bv === av ? [] : [{ playerId: b.playerId, name: b.name, before: bv, after: av }];
    });

  const moneyChanges: CorrectionMoneyChange[] = before.flatMap(b => {
    const a = afterByPid.get(b.playerId);
    if (!a || sameMoney(b, a)) return [];
    const take = (r: CorrectionPlayerRow) => ({
      penaltyLevel: r.penaltyLevel, penaltyAmount: r.penaltyAmount,
      prizeAmount: r.prizeAmount, guestFeeAmount: r.guestFeeAmount, finalAmount: r.finalAmount,
    });
    return [{ playerId: b.playerId, name: b.name, before: take(b), after: take(a) }];
  });

  const impact: CorrectionImpact = {
    ok: unresolved.length === 0,
    blocked: unresolved.length === 0 ? null : 'unresolved_tie_birth_years',
    match: summary,
    before, after,
    rankChanges: pick(r => r.rank),
    groupRankChanges: pick(r => r.groupRank),
    diffChanges: pick(r => r.diff),
    pointsForChanges: pick(r => r.pointsFor),
    pointsAgainstChanges: pick(r => r.pointsAgainst),
    winLossChanges: pick(r => `${r.wins}-${r.losses}`),
    moneyChanges,
    unresolvedTieBirthYears: unresolved,
    nextRawData: null,
    totalPlayers: after.length,
  };
  if (!impact.ok) return impact;

  impact.nextRawData = buildNextRawData(rawData, targetIdx, nextScore1, nextScore2, afterBuilt.sorted, after);
  return impact;
}

/**
 * 저장할 next raw_data.
 *   ⚠ 바꾸는 것: 대상 경기의 score1/score2 · ranking_data · settlement_data. 그 외 전부 그대로.
 *   ⚠ 기존 항목의 추가 필드(avatar 등)를 잃지 않도록 원본을 펼친 뒤 계산값만 덮는다.
 */
function buildNextRawData(
  rawData: ArchiveRawData,
  targetIdx: number,
  nextScore1: number,
  nextScore2: number,
  sorted: Array<Entry & { rank: number }>,
  rows: CorrectionPlayerRow[],
): ArchiveRawData {
  const next: ArchiveRawData = { ...rawData };

  next.snapshot_data = (rawData.snapshot_data || []).map((m, i) => (
    i === targetIdx ? { ...m, score1: nextScore1, score2: nextScore2 } : m
  ));

  const rowByPid = new Map(rows.map(r => [r.playerId, r]));

  next.ranking_data = sorted.map(e => {
    const r = rowByPid.get(e.playerId)!;
    return { ...e.rankingSource, wins: r.wins, losses: r.losses, diff: r.diff };
  });

  next.settlement_data = sorted.map(e => {
    const r = rowByPid.get(e.playerId)!;
    const base = e.settlementSource ?? ({
      player_id: e.playerId,
      player_name: e.name,
      is_guest: r.isGuest,
      is_associate_guest_fee_member: r.owesGuestFee && !r.isGuest,
    } as unknown as SettlementSnapshotEntry);
    return {
      ...base,
      rank: r.rank,
      wins: r.wins,
      losses: r.losses,
      points_for: r.pointsFor,
      points_against: r.pointsAgainst,
      diff: r.diff,
      penalty_level: r.penaltyLevel,
      penalty_amount: r.penaltyAmount,
      guest_fee_amount: r.guestFeeAmount,
      prize_amount: r.prizeAmount,
      final_amount: r.finalAmount,
    } satisfies SettlementSnapshotEntry;
  });

  return next;
}

/** 경기 선택 목록용 요약(모달에서 쓴다). 완료 경기만 정정 대상이다. */
export interface CorrectionMatchOption {
  matchId: string;
  group: string | null;
  round: number | null;
  court: number | null;
  team1Names: string[];
  team2Names: string[];
  score1: number;
  score2: number;
  /** snapshot_data 안의 위치(1부터) — 화면 번호 표시용. */
  displayNo: number;
}

export function listCorrectableMatches(rawData: ArchiveRawData): CorrectionMatchOption[] {
  return (rawData?.snapshot_data || []).flatMap((m, i) => {
    if (str(m?.status) !== 'complete') return [];
    const id = str(m?.id);
    if (!id) return [];
    const names = matchPlayerNames(m);
    return [{
      matchId: id,
      group: matchGroup(m),
      round: m.round == null ? null : num(m.round),
      court: m.court == null ? null : num(m.court),
      team1Names: names.slice(0, 2),
      team2Names: names.slice(2, 4),
      score1: num(m.score1),
      score2: num(m.score2),
      displayNo: i + 1,
    }];
  });
}

/** 정정 계산에 필요한 회원 id — ranking_data 중 게스트가 아닌 참가자. */
export function memberIdsForBirthYear(rawData: ArchiveRawData): string[] {
  const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  return (rawData?.ranking_data || [])
    .map(p => str(p.id))
    .filter(id => id !== '' && isUuid(id));
}
