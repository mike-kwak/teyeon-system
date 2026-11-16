// TEYEON MY RIVAL — 나의 천적 / 숙명의 라이벌(순수 계산, Supabase 미의존).
//
//   · 승패 산출은 기존 상대전적 computeHeadToHead 를 "그대로" 호출한다(별도 산식 없음).
//     → 상대전적 상세 화면(/ranking/head-to-head)과 수치가 구조적으로 항상 같다.
//     세션 기준(isEligibleOfficialKdkArchive: kdk · is_official · is_test!==true), 경기 기준(완료 · 4인 · 무승부 아님),
//     회원 식별(id exact → legacy 이름 exact, 게스트 · 식별 불가 제외), 같은 팀(파트너) 제외 모두 상대전적과 동일.
//   · 후보 상대: 기준 회원과 "반대 팀"으로 만난 적이 있는 현재 회원(탈회 제외)만.
//     탈회 회원은 resolver 명단(members)에는 남겨 과거 기록 해석은 상대전적과 같게 유지하되 결과 후보에서만 뺀다.
//   · 경계 비교는 모두 정수 교차곱(부동소수점 없음): 1승 2패(상대 2/3)는 천적에 정확히 포함된다.
//
//   분류
//     천적(nemesis): 맞대결 ≥ 3 · 상대 승 × 3 ≥ 맞대결 × 2 (상대 승률 2/3 이상)
//     라이벌(rival) : 맞대결 ≥ 5 · 4 × 맞대결 ≤ 나의 승 × 10 ≤ 6 × 맞대결 (나의 승률 40~60%)
//     두 조건은 동시에 성립할 수 없다(천적 = 나의 승률 ≤ 33.3%, 라이벌 = ≥ 40%). 그래도 천적 우선으로 한 번만 분류한다.

import { computeHeadToHead, buildMemberResolver, isEligibleOfficialKdkArchive, parseCompleteMatch, type HeadToHeadMemberRef, type HeadToHeadMatchRow } from './headToHead';
import type { KdkArchiveRow } from '../kdkArchiveStats';

export const NEMESIS_MIN_GAMES = 3;
export const RIVAL_MIN_GAMES = 5;

export interface RivalOpponent {
  opponentId: string;
  opponentName: string;
  totalGames: number;
  myWins: number;
  myLosses: number;
  /** 나의 승률(0~100, 소수 1자리) — computeHeadToHead.aWinRate 그대로. */
  myWinRate: number;
  /** 상대 승률(0~100, 소수 1자리). */
  oppWinRate: number;
  /** 가장 최근 맞대결(상대전적 상세 첫 행과 동일). */
  latest: HeadToHeadMatchRow | null;
  /** 최근 맞대결 최대 5경기 결과(최근 → 과거), true = 나의 승. */
  recentForm: boolean[];
}

export interface MyRivalResult {
  nemeses: RivalOpponent[];
  rivals: RivalOpponent[];
  /** 반대 팀으로 1경기 이상 만난 현재 회원 수(빈 상태 설명용). */
  opponentsMet: number;
  /** 기준 회원의 식별 불가 경기 포함 여부(상대전적과 같은 보조 안내). */
  hasUnresolvableRecords: boolean;
}

/** 천적 조건 — 정수 비교. */
export function isNemesis(games: number, myWins: number): boolean {
  const oppWins = games - myWins;
  return games >= NEMESIS_MIN_GAMES && oppWins * 3 >= games * 2;
}

/** 라이벌 조건 — 정수 비교(40% 이상 60% 이하, 양끝 포함). */
export function isRival(games: number, myWins: number): boolean {
  return games >= RIVAL_MIN_GAMES && myWins * 10 >= games * 4 && myWins * 10 <= games * 6;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const latestDate = (o: RivalOpponent) => o.latest?.date ?? '';

/** 천적 정렬: 많이 진 순 → 상대 승률 높은 순 → 맞대결 많은 순 → 최근 맞대결 최신 순 → 이름 → id. */
export function compareNemesis(x: RivalOpponent, y: RivalOpponent): number {
  if (x.myLosses !== y.myLosses) return y.myLosses - x.myLosses;
  // 상대 승률 비교: x.l/x.g vs y.l/y.g → 교차곱
  const r = y.myLosses * x.totalGames - x.myLosses * y.totalGames;
  if (r !== 0) return r;
  if (x.totalGames !== y.totalGames) return y.totalGames - x.totalGames;
  const d = cmpStr(latestDate(y), latestDate(x));
  if (d !== 0) return d;
  return cmpStr(x.opponentName, y.opponentName) || cmpStr(x.opponentId, y.opponentId);
}

/** 라이벌 정렬: 승패 차 비율 작은 순(가장 팽팽) → 맞대결 많은 순 → 최근 맞대결 최신 순 → 이름 → id. */
export function compareRival(x: RivalOpponent, y: RivalOpponent): number {
  const gx = Math.abs(x.myWins - x.myLosses) * y.totalGames;
  const gy = Math.abs(y.myWins - y.myLosses) * x.totalGames;
  if (gx !== gy) return gx - gy;
  if (x.totalGames !== y.totalGames) return y.totalGames - x.totalGames;
  const d = cmpStr(latestDate(y), latestDate(x));
  if (d !== 0) return d;
  return cmpStr(x.opponentName, y.opponentName) || cmpStr(x.opponentId, y.opponentId);
}

/**
 * 기준 회원(meId)과 반대 팀으로 만난 회원 id 집합 — 후보 추리기 전용(수치는 computeHeadToHead 가 산출).
 *   상대전적과 같은 resolver · 세션 · 경기 기준을 사용한다.
 */
export function collectOpponentIds(archiveRows: readonly KdkArchiveRow[], meId: string, members: readonly HeadToHeadMemberRef[]): Set<string> {
  const out = new Set<string>();
  if (!meId) return out;
  const resolver = buildMemberResolver([...members]);
  for (const row of archiveRows || []) {
    if (!isEligibleOfficialKdkArchive(row)) continue;
    const snap = Array.isArray(row.raw_data?.snapshot_data) ? row.raw_data!.snapshot_data! : [];
    for (const m of snap) {
      const parsed = parseCompleteMatch(m);
      if (!parsed) continue;
      const { pids, names } = parsed;
      const resolved = pids.map((pid, i) => resolver.resolveSlot(pid, names[i]));
      const meIdx = resolver.findMemberSlot(meId, resolved, pids, names);
      if (meIdx < 0) continue;
      const oppSlots = meIdx <= 1 ? [2, 3] : [0, 1];
      for (const i of oppSlots) {
        const r = resolved[i];
        if (r !== 'GUEST' && r !== 'ORPHAN' && r !== meId) out.add(r);
      }
    }
  }
  return out;
}

/**
 * MY RIVAL 계산.
 * @param members       전체 회원(탈회 포함) — 상대전적 resolver 와 동일 명단(과거 기록 해석용).
 * @param activeMemberIds 현재 회원 id — 결과 후보는 이 집합만(탈회 제외).
 */
export function computeMyRivals(
  archiveRows: readonly KdkArchiveRow[],
  meId: string,
  members: readonly HeadToHeadMemberRef[],
  activeMemberIds: ReadonlySet<string>,
): MyRivalResult {
  const empty: MyRivalResult = { nemeses: [], rivals: [], opponentsMet: 0, hasUnresolvableRecords: false };
  if (!meId) return empty;
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const rows = [...(archiveRows || [])];
  const memberList = [...members];
  const nemeses: RivalOpponent[] = [];
  const rivals: RivalOpponent[] = [];
  let opponentsMet = 0;
  let unresolved = false;

  for (const oppId of collectOpponentIds(rows, meId, memberList)) {
    if (!activeMemberIds.has(oppId)) continue;
    const h = computeHeadToHead(rows, meId, oppId, memberList);
    if (h.hasUnresolvableRecords) unresolved = true;
    if (h.totalGames === 0) continue;
    opponentsMet += 1;
    const o: RivalOpponent = {
      opponentId: oppId,
      opponentName: nameById.get(oppId) || '',
      totalGames: h.totalGames,
      myWins: h.aWins,
      myLosses: h.bWins,
      myWinRate: h.aWinRate,
      oppWinRate: Math.round((h.bWins / h.totalGames) * 1000) / 10,
      latest: h.matches[0] ?? null,
      recentForm: h.matches.slice(0, 5).map((m) => m.aWon),
    };
    if (isNemesis(o.totalGames, o.myWins)) nemeses.push(o);
    else if (isRival(o.totalGames, o.myWins)) rivals.push(o);
  }

  nemeses.sort(compareNemesis);
  rivals.sort(compareRival);
  return { nemeses, rivals, opponentsMet, hasUnresolvableRecords: unresolved };
}
