// TEYEON 회원 상대전적 — 순수 계산(공식 KDK Archive 경기 기준). Supabase 미의존.
//   · 데이터: teyeon_archive_v1(archive_type='kdk', is_official=true) 의 raw_data.snapshot_data(경기 배열).
//     조회는 clubRankingService.loadRankingInputs 재사용(추가 조회/ N+1 없음).
//   · 포함 경기: status='complete' · player_ids 4명 · score1≠score2 · 두 회원이 서로 반대 팀.
//     팀 A = player_ids[0,1](score1), 팀 B = player_ids[2,3](score2). 같은 팀 경기는 제외(파트너 전적 별도).
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

const emptyResult: HeadToHeadResult = {
  totalGames: 0, aWins: 0, bWins: 0, aWinRate: 0, leader: null, matches: [],
  hasUnresolvableRecords: false, excludedUnresolvedMatches: 0,
};

/**
 * 두 회원의 공식 KDK 상대전적. aId 관점(승/패/승률). aId===bId 이면 빈 결과.
 * @param members 전체 회원 명단(id·name) — id exact 우선, 없으면 name exact fallback 에 사용.
 */
export function computeHeadToHead(
  archiveRows: KdkArchiveRow[],
  aId: string,
  bId: string,
  members: HeadToHeadMemberRef[],
): HeadToHeadResult {
  if (!aId || !bId || aId === bId) return { ...emptyResult };

  const memberIds = new Set(members.map((m) => m.id));
  const nameToId = new Map<string, string>();
  for (const m of members) {
    const n = normalizeName(m.name);
    // 동명이인은 name fallback 대상에서 제외(임의 병합 금지) — 중복이면 무효 표시.
    if (!n) continue;
    nameToId.set(n, nameToId.has(n) ? '__DUP__' : m.id);
  }
  const aName = normalizeName(members.find((m) => m.id === aId)?.name);
  const bName = normalizeName(members.find((m) => m.id === bId)?.name);

  // slot → 회원 id | 'GUEST' | 'ORPHAN'. id exact → guest → name exact(중복 아님) → orphan.
  const resolveSlot = (pid: string, name: string): string | 'GUEST' | 'ORPHAN' => {
    if (memberIds.has(pid)) return pid;
    if (isGuestId(pid, name)) return 'GUEST';
    const byName = nameToId.get(normalizeName(name));
    if (byName && byName !== '__DUP__') return byName;
    return 'ORPHAN';
  };

  const matches: HeadToHeadMatchRow[] = [];
  let unresolvedMatches = 0;

  for (const row of archiveRows || []) {
    if (row?.archive_type !== 'kdk' || row?.is_official !== true) continue;
    const raw = row.raw_data || {};
    const snap = Array.isArray(raw.snapshot_data) ? raw.snapshot_data : [];
    const date = getArchiveDate(row);
    const title = String(raw.title || row.id);

    for (const m of snap) {
      const pids = getPids(m);
      const names = getNames(m);
      if (pids.length !== 4) continue;                 // 2:2 구조만
      if (String(m?.status || '') !== 'complete') continue;
      const s1 = Number(m?.score1);
      const s2 = Number(m?.score2);
      if (!Number.isFinite(s1) || !Number.isFinite(s2) || s1 === s2) continue; // 무승부·미완료 제외

      const resolved = pids.map((pid, i) => resolveSlot(pid, names[i]));
      if (resolved.some((r) => r === 'ORPHAN')) unresolvedMatches += 1;

      // aId/bId slot 찾기 — id exact 매칭. legacy 는 resolveSlot 이 name 으로 id 를 채워줌.
      let aIdx = resolved.indexOf(aId);
      let bIdx = resolved.indexOf(bId);
      // id 로 못 찾았고 이름이 있으면 name exact 보조(양쪽 회원 한정, 중복 이름 제외).
      if (aIdx < 0 && aName) aIdx = names.findIndex((nm, i) => resolved[i] !== 'GUEST' && !memberIds.has(pids[i]) && normalizeName(nm) === aName && nameToId.get(aName) === aId);
      if (bIdx < 0 && bName) bIdx = names.findIndex((nm, i) => resolved[i] !== 'GUEST' && !memberIds.has(pids[i]) && normalizeName(nm) === bName && nameToId.get(bName) === bId);
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
