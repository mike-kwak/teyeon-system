// TEYEON 회원 상대전적 / 파트너 전적 — 순수 계산(공식 KDK Archive 경기 기준). Supabase 미의존.
//   · 데이터: teyeon_archive_v1(archive_type='kdk', is_official=true) 의 raw_data.snapshot_data(경기 배열).
//     조회는 clubRankingService.loadRankingInputs 재사용(추가 조회/ N+1 없음).
//   · 세션 포함 기준 공통(isEligibleOfficialKdkArchive): archive_type='kdk' · is_official=true · is_test!==true.
//     (is_test 없음/null 레거시 행은 포함, 명시적 true 만 제외 → 상대·파트너 세션 집합 동일.)
//   · 팀 A = player_ids[0,1](score1), 팀 B = player_ids[2,3](score2).
//     - 상대전적(computeHeadToHead): 두 회원이 서로 "반대 팀"인 경기만.
//     - 파트너 전적(computePartnerRecord): 두 회원이 "같은 팀"인 경기만.
//   · 포함 경기 공통: status='complete' · player_ids 4명 · score1≠score2.
//   · 회원 식별: members.id exact 우선 → id 없는 legacy 만 exact-name fallback → 그 외 제외(부분일치·email·유사도 금지).
//     게스트(manual-guest-/(G))는 회원 아님 → 집계 제외.
import { getArchiveDate, type KdkArchiveRow } from '../kdkArchiveStats';

export interface HeadToHeadMatchRow {
  archiveId: string;
  date: string;
  sessionTitle: string;
  /** 기준 회원 A 팀 표시명(2명) / 상대 B 팀 표시명(2명) — snapshot 당시 player_names. */
  aTeamNames: string[];
  bTeamNames: string[];
  scoreA: number;
  scoreB: number;
  /** A 팀 승리 여부(기준 회원 관점). */
  aWon: boolean;
}

export interface HeadToHeadResult {
  totalGames: number;
  aWins: number;
  bWins: number;
  /** A 회원 기준 승률(0~100, 소수 1자리). 경기 0이면 0. */
  aWinRate: number;
  /** 우세 회원. 동률이면 'tie', 맞대결 없으면 null. */
  leader: 'a' | 'b' | 'tie' | null;
  /** 최근(날짜 내림차순) 맞대결 경기. */
  matches: HeadToHeadMatchRow[];
  /** 공식 데이터에 id/이름으로도 해결되지 않는 참가자 slot(legacy orphan)이 있었는지 — 보조 안내용. */
  hasUnresolvableRecords: boolean;
  /** orphan slot 이 포함된 공식 경기 수(내부/로그용, 화면 수치엔 미노출). */
  excludedUnresolvedMatches: number;
}

export interface HeadToHeadMemberRef {
  id: string;
  name: string;
}

/** 파트너(같은 팀) 경기 1건. */
export interface PartnerMatchResult {
  archiveId: string;
  date: string;
  sessionTitle: string;
  /** 두 회원이 함께 속한 팀 표시명(2명). */
  pairTeamNames: string[];
  /** 상대 팀 표시명(2명). */
  oppTeamNames: string[];
  /** 파트너 팀 점수 / 상대 팀 점수. */
  pairScore: number;
  oppScore: number;
  /** 파트너 팀 승리 여부. */
  won: boolean;
}

/** 파트너 전적 요약(A/B 순서와 무관하게 동일). */
export interface PartnerRecordSummary {
  totalGames: number;
  wins: number;
  losses: number;
  /** 파트너 승률(0~100, 소수 1자리). 경기 0이면 0. */
  winRate: number;
  matches: PartnerMatchResult[];
  hasUnresolvableRecords: boolean;
  excludedUnresolvedMatches: number;
}

// ── 공통 helper ────────────────────────────────────────────────────────────────
const normalizeName = (v?: string | null): string =>
  String(v || '')
    .replace(/^manual-guest-/i, '')
    .replace(/\s*\(G\)\s*$/i, '')
    .replace(/\s+g$/i, '')
    .trim()
    .toLowerCase();

const isGuestId = (pid: string, name?: string | null): boolean =>
  /^manual-guest-/i.test(pid) || /^g-/i.test(pid) || /\(G\)\s*$/i.test(String(name || ''));

const getPids = (m: any): string[] => (m?.player_ids || m?.playerIds || []).map((x: unknown) => String(x ?? ''));
const getNames = (m: any): string[] => (m?.player_names || m?.playerNames || []).map((x: unknown) => String(x ?? ''));

interface ParsedMatch { pids: string[]; names: string[]; s1: number; s2: number; }

/** 2:2 · 완료 · 무승부 아님만 통과. 그 외 null. */
function parseCompleteMatch(m: any): ParsedMatch | null {
  const pids = getPids(m);
  const names = getNames(m);
  if (pids.length !== 4) return null;
  if (String(m?.status || '') !== 'complete') return null;
  const s1 = Number(m?.score1);
  const s2 = Number(m?.score2);
  if (!Number.isFinite(s1) || !Number.isFinite(s2) || s1 === s2) return null;
  return { pids, names, s1, s2 };
}

interface MemberResolver {
  /** slot → 회원 id | 'GUEST' | 'ORPHAN'. id exact → guest → name exact(중복 아님) → orphan. */
  resolveSlot(pid: string, name: string): string | 'GUEST' | 'ORPHAN';
  /** 특정 회원 id 의 slot index(0~3). id exact → legacy exact-name(중복 이름 제외). 없으면 -1. */
  findMemberSlot(id: string, resolved: string[], pids: string[], names: string[]): number;
}

function buildMemberResolver(members: HeadToHeadMemberRef[]): MemberResolver {
  const memberIds = new Set(members.map((m) => m.id));
  const nameToId = new Map<string, string>();
  for (const m of members) {
    const n = normalizeName(m.name);
    // 동명이인은 name fallback 대상에서 제외(임의 병합 금지) — 중복이면 무효 표시.
    if (!n) continue;
    nameToId.set(n, nameToId.has(n) ? '__DUP__' : m.id);
  }
  const idToName = new Map(members.map((m) => [m.id, normalizeName(m.name)]));

  const resolveSlot = (pid: string, name: string): string | 'GUEST' | 'ORPHAN' => {
    if (memberIds.has(pid)) return pid;
    if (isGuestId(pid, name)) return 'GUEST';
    const byName = nameToId.get(normalizeName(name));
    if (byName && byName !== '__DUP__') return byName;
    return 'ORPHAN';
  };

  const findMemberSlot = (id: string, resolved: string[], pids: string[], names: string[]): number => {
    let idx = resolved.indexOf(id);
    if (idx >= 0) return idx;
    // id 로 못 찾았고 이름이 있으면 name exact 보조(중복 이름·게스트·이미 매칭된 slot 제외).
    const nm = idToName.get(id);
    if (nm) idx = names.findIndex((n, i) => resolved[i] !== 'GUEST' && !memberIds.has(pids[i]) && normalizeName(n) === nm && nameToId.get(nm) === id);
    return idx;
  };

  return { resolveSlot, findMemberSlot };
}

const emptyHeadToHead: HeadToHeadResult = {
  totalGames: 0, aWins: 0, bWins: 0, aWinRate: 0, leader: null, matches: [],
  hasUnresolvableRecords: false, excludedUnresolvedMatches: 0,
};
const emptyPartner: PartnerRecordSummary = {
  totalGames: 0, wins: 0, losses: 0, winRate: 0, matches: [],
  hasUnresolvableRecords: false, excludedUnresolvedMatches: 0,
};

/**
 * 상대전적·파트너 전적이 공통으로 사용하는 Archive 세션 포함 기준.
 *   archive_type='kdk' · is_official=true · is_test!==true.
 * is_test 가 없거나 null 인 레거시 행은 포함, 명시적 true 인 행만 제외 → 두 계산의 세션 집합이 완전히 동일.
 */
export const isEligibleOfficialKdkArchive = (row: KdkArchiveRow): boolean =>
  row?.archive_type === 'kdk' && row?.is_official === true && (row as any)?.is_test !== true;

/**
 * 두 회원의 공식 KDK 상대전적(서로 반대 팀). aId 관점(승/패/승률). aId===bId 이면 빈 결과.
 * @param members 전체 회원 명단(id·name) — id exact 우선, 없으면 name exact fallback 에 사용.
 */
export function computeHeadToHead(
  archiveRows: KdkArchiveRow[],
  aId: string,
  bId: string,
  members: HeadToHeadMemberRef[],
): HeadToHeadResult {
  if (!aId || !bId || aId === bId) return { ...emptyHeadToHead };

  const resolver = buildMemberResolver(members);
  const matches: HeadToHeadMatchRow[] = [];
  let unresolvedMatches = 0;

  for (const row of archiveRows || []) {
    if (!isEligibleOfficialKdkArchive(row)) continue;
    const raw = row.raw_data || {};
    const snap = Array.isArray(raw.snapshot_data) ? raw.snapshot_data : [];
    const date = getArchiveDate(row);
    const title = String(raw.title || row.id);

    for (const m of snap) {
      const parsed = parseCompleteMatch(m);
      if (!parsed) continue;
      const { pids, names, s1, s2 } = parsed;

      const resolved = pids.map((pid, i) => resolver.resolveSlot(pid, names[i]));
      if (resolved.some((r) => r === 'ORPHAN')) unresolvedMatches += 1;

      const aIdx = resolver.findMemberSlot(aId, resolved, pids, names);
      const bIdx = resolver.findMemberSlot(bId, resolved, pids, names);
      if (aIdx < 0 || bIdx < 0) continue;

      const aTeam: 'A' | 'B' = aIdx <= 1 ? 'A' : 'B';
      const bTeam: 'A' | 'B' = bIdx <= 1 ? 'A' : 'B';
      if (aTeam === bTeam) continue;                   // 같은 팀 → 상대전적 제외

      const scoreA = aTeam === 'A' ? s1 : s2;
      const scoreB = bTeam === 'A' ? s1 : s2;
      const aTeamNames = (aTeam === 'A' ? [names[0], names[1]] : [names[2], names[3]]).filter(Boolean);
      const bTeamNames = (bTeam === 'A' ? [names[0], names[1]] : [names[2], names[3]]).filter(Boolean);
      matches.push({ archiveId: String(row.id), date, sessionTitle: title, aTeamNames, bTeamNames, scoreA, scoreB, aWon: scoreA > scoreB });
    }
  }

  matches.sort((x, y) => (y.date > x.date ? 1 : y.date < x.date ? -1 : 0)); // 최근 날짜 우선
  const totalGames = matches.length;
  const aWins = matches.filter((m) => m.aWon).length;
  const bWins = totalGames - aWins;
  const aWinRate = totalGames > 0 ? Math.round((aWins / totalGames) * 1000) / 10 : 0;
  const leader: HeadToHeadResult['leader'] = totalGames === 0 ? null : aWins > bWins ? 'a' : bWins > aWins ? 'b' : 'tie';

  return {
    totalGames, aWins, bWins, aWinRate, leader, matches,
    hasUnresolvableRecords: unresolvedMatches > 0,
    excludedUnresolvedMatches: unresolvedMatches,
  };
}

/**
 * 두 회원이 "같은 팀"으로 함께 출전한 공식 KDK 파트너 전적. A/B 순서와 무관하게 동일한 결과.
 * 세션 포함 기준은 상대전적과 완전히 동일하다(isEligibleOfficialKdkArchive).
 */
export function computePartnerRecord(
  archiveRows: KdkArchiveRow[],
  aId: string,
  bId: string,
  members: HeadToHeadMemberRef[],
): PartnerRecordSummary {
  if (!aId || !bId || aId === bId) return { ...emptyPartner };

  const resolver = buildMemberResolver(members);
  const matches: PartnerMatchResult[] = [];
  let unresolvedMatches = 0;

  for (const row of archiveRows || []) {
    if (!isEligibleOfficialKdkArchive(row)) continue;  // 상대전적과 동일 기준(is_test!==true 포함)
    const raw = row.raw_data || {};
    const snap = Array.isArray(raw.snapshot_data) ? raw.snapshot_data : [];
    const date = getArchiveDate(row);
    const title = String(raw.title || row.id);

    for (const m of snap) {
      const parsed = parseCompleteMatch(m);
      if (!parsed) continue;
      const { pids, names, s1, s2 } = parsed;

      const resolved = pids.map((pid, i) => resolver.resolveSlot(pid, names[i]));
      if (resolved.some((r) => r === 'ORPHAN')) unresolvedMatches += 1;

      const aIdx = resolver.findMemberSlot(aId, resolved, pids, names);
      const bIdx = resolver.findMemberSlot(bId, resolved, pids, names);
      if (aIdx < 0 || bIdx < 0) continue;

      const aTeam: 'A' | 'B' = aIdx <= 1 ? 'A' : 'B';
      const bTeam: 'A' | 'B' = bIdx <= 1 ? 'A' : 'B';
      if (aTeam !== bTeam) continue;                    // 반대 팀 → 파트너 전적 제외

      const pairTeam = aTeam;
      const pairScore = pairTeam === 'A' ? s1 : s2;
      const oppScore = pairTeam === 'A' ? s2 : s1;
      const pairTeamNames = (pairTeam === 'A' ? [names[0], names[1]] : [names[2], names[3]]).filter(Boolean);
      const oppTeamNames = (pairTeam === 'A' ? [names[2], names[3]] : [names[0], names[1]]).filter(Boolean);
      matches.push({ archiveId: String(row.id), date, sessionTitle: title, pairTeamNames, oppTeamNames, pairScore, oppScore, won: pairScore > oppScore });
    }
  }

  matches.sort((x, y) => (y.date > x.date ? 1 : y.date < x.date ? -1 : 0));
  const totalGames = matches.length;
  const wins = matches.filter((m) => m.won).length;
  const losses = totalGames - wins;
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0;

  return {
    totalGames, wins, losses, winRate, matches,
    hasUnresolvableRecords: unresolvedMatches > 0,
    excludedUnresolvedMatches: unresolvedMatches,
  };
}
