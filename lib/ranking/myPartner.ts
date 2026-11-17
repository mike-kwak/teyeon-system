// TEYEON MY PARTNER — 나의 BEST · WORST 파트너(순수 계산, Supabase 미의존).
//
//   · 승패 · 득실은 기존 파트너 전적 computePartnerRecord 를 "그대로" 호출해 얻는다(별도 산식 없음).
//     → 상대전적 화면의 '파트너 전적'(/ranking/head-to-head?view=partner)과 수치가 구조적으로 항상 같다.
//     세션 기준(isEligibleOfficialKdkArchive: kdk · is_official · is_test!==true), 경기 기준(완료 · 4인 · 무승부 아님),
//     회원 식별(id exact → legacy 이름 exact, 게스트 · 식별 불가 제외) 모두 파트너 전적과 동일.
//   · 후보: 기준 회원과 "같은 팀"으로 뛴 적이 있는 현재 회원(탈회 · 게스트 제외).
//     탈회 회원은 resolver 명단(members)에는 남겨 과거 기록 해석은 파트너 전적과 같게 유지하되 결과 후보에서만 뺀다.
//   · 순위 왜곡 방지
//     - 함께 출전 PARTNER_MIN_GAMES(3) 경기 이상만 분석 대상(적격).
//     - 정렬은 보정 승률 (승 + 2) / (경기 + 4) — 정렬에만 쓰고 화면에는 실제 승률 · 승패 · 경기 수 · 득실을 표시한다.
//       비교는 정수 교차곱(부동소수점 없음).
//   · 적격 인원별 표시(두 목록 중복 없음 · 빈 카드 없음)
//     - 4명 이상 : BEST 2 · WORST 2                      mode 'full'
//     - 3명      : BEST 2 · WORST 1                      mode 'partial'
//     - 2명      : BEST 1 · WORST 1                      mode 'partial'
//     - 1명      : BEST/WORST 로 나누지 않고 analyzable 1명 mode 'single'
//     - 0명      : 데이터 부족 안내                       mode 'none'
//     WORST 는 함께한 경기 결과 기준일 뿐 선수 실력 평가가 아니다(화면 안내).

import { computePartnerRecord, buildMemberResolver, isEligibleOfficialKdkArchive, parseCompleteMatch, type HeadToHeadMemberRef, type PartnerMatchResult } from './headToHead';
import type { KdkArchiveRow } from '../kdkArchiveStats';

export const PARTNER_MIN_GAMES = 3;
export const PARTNER_LIST_SIZE = 2;
/** 보정 승률 (승 + PRIOR_WINS) / (경기 + PRIOR_GAMES) — 정렬 전용. */
export const PRIOR_WINS = 2;
export const PRIOR_GAMES = 4;

export interface PartnerStat {
  partnerId: string;
  partnerName: string;
  totalGames: number;
  wins: number;
  losses: number;
  /** 실제 승률(0~100, 소수 1자리) — computePartnerRecord.winRate 그대로. */
  winRate: number;
  /** 우리 팀 득점 합 / 실점 합 / 득실(득 − 실). */
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  /** 가장 최근 함께 뛴 경기(파트너 전적 상세 첫 행과 동일). */
  latest: PartnerMatchResult | null;
  /** 최근 함께 뛴 최대 5경기(최근 → 과거), true = 승. */
  recentForm: boolean[];
}

export type PartnerMode = 'full' | 'partial' | 'single' | 'none';

export interface MyPartnerResult {
  /** 표시 모드 — 적격 파트너 수로 결정(위 주석 표). */
  mode: PartnerMode;
  best: PartnerStat[];
  worst: PartnerStat[];
  /** mode 'single' 일 때만 1명 — BEST/WORST 로 분류하지 않는 분석 가능 파트너. */
  analyzable: PartnerStat[];
  /** 같은 팀으로 1경기 이상 뛴 현재 회원 수. */
  partnersMet: number;
  /** 최소 경기(PARTNER_MIN_GAMES) 이상 함께 뛴 파트너 수. */
  qualified: number;
  /** 최소 경기 미만이라 순위에서 빠진 파트너 중 가장 많이 함께 뛴 경기 수(안내용). */
  maxGamesBelowMin: number;
  hasUnresolvableRecords: boolean;
}

/** 보정 승률 비교 — x 가 높으면 음수(내림차순 정렬용). (xw+2)/(xg+4) vs (yw+2)/(yg+4) 를 교차곱으로. */
export function compareAdjustedDesc(x: Pick<PartnerStat, 'wins' | 'totalGames'>, y: Pick<PartnerStat, 'wins' | 'totalGames'>): number {
  const left = (x.wins + PRIOR_WINS) * (y.totalGames + PRIOR_GAMES);
  const right = (y.wins + PRIOR_WINS) * (x.totalGames + PRIOR_GAMES);
  return right - left;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const latestDate = (p: PartnerStat) => p.latest?.date ?? '';

/** BEST 정렬: 보정 승률 높은 순 → 함께 뛴 경기 많은 순 → 득실 큰 순 → 최근 경기 최신 순 → 이름 → id. */
export function compareBest(x: PartnerStat, y: PartnerStat): number {
  const a = compareAdjustedDesc(x, y);
  if (a !== 0) return a;
  if (x.totalGames !== y.totalGames) return y.totalGames - x.totalGames;
  if (x.pointDiff !== y.pointDiff) return y.pointDiff - x.pointDiff;
  const d = cmpStr(latestDate(y), latestDate(x));
  if (d !== 0) return d;
  return cmpStr(x.partnerName, y.partnerName) || cmpStr(x.partnerId, y.partnerId);
}

/** WORST 정렬: 보정 승률 낮은 순 → 함께 뛴 경기 많은 순(근거가 많은 쪽 먼저) → 득실 작은 순 → 최근 경기 최신 순 → 이름 → id. */
export function compareWorst(x: PartnerStat, y: PartnerStat): number {
  const a = compareAdjustedDesc(y, x);
  if (a !== 0) return a;
  if (x.totalGames !== y.totalGames) return y.totalGames - x.totalGames;
  if (x.pointDiff !== y.pointDiff) return x.pointDiff - y.pointDiff;
  const d = cmpStr(latestDate(y), latestDate(x));
  if (d !== 0) return d;
  return cmpStr(x.partnerName, y.partnerName) || cmpStr(x.partnerId, y.partnerId);
}

/**
 * 기준 회원(meId)과 같은 팀으로 뛴 회원 id 집합 — 후보 추리기 전용(수치는 computePartnerRecord 가 산출).
 *   파트너 전적과 같은 resolver · 세션 · 경기 기준을 사용한다.
 */
export function collectPartnerIds(archiveRows: readonly KdkArchiveRow[], meId: string, members: readonly HeadToHeadMemberRef[]): Set<string> {
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
      const r = resolved[meIdx <= 1 ? 1 - meIdx : 5 - meIdx]; // 같은 팀의 다른 자리(0↔1, 2↔3)
      if (r !== 'GUEST' && r !== 'ORPHAN' && r !== meId) out.add(r);
    }
  }
  return out;
}

/**
 * MY PARTNER 계산.
 * @param members         전체 회원(탈회 포함) — 파트너 전적 resolver 와 동일 명단(과거 기록 해석용).
 * @param activeMemberIds 현재 회원 id — 결과 후보는 이 집합만(탈회 제외).
 */
export function computeMyPartners(
  archiveRows: readonly KdkArchiveRow[],
  meId: string,
  members: readonly HeadToHeadMemberRef[],
  activeMemberIds: ReadonlySet<string>,
): MyPartnerResult {
  const empty: MyPartnerResult = { mode: 'none', best: [], worst: [], analyzable: [], partnersMet: 0, qualified: 0, maxGamesBelowMin: 0, hasUnresolvableRecords: false };
  if (!meId) return empty;
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const rows = [...(archiveRows || [])];
  const memberList = [...members];
  const qualified: PartnerStat[] = [];
  let partnersMet = 0;
  let maxGamesBelowMin = 0;
  let unresolved = false;

  for (const pid of collectPartnerIds(rows, meId, memberList)) {
    if (!activeMemberIds.has(pid)) continue;
    const rec = computePartnerRecord(rows, meId, pid, memberList);
    if (rec.hasUnresolvableRecords) unresolved = true;
    if (rec.totalGames === 0) continue;
    partnersMet += 1;
    if (rec.totalGames < PARTNER_MIN_GAMES) { maxGamesBelowMin = Math.max(maxGamesBelowMin, rec.totalGames); continue; }
    const pointsFor = rec.matches.reduce((s, m) => s + m.pairScore, 0);
    const pointsAgainst = rec.matches.reduce((s, m) => s + m.oppScore, 0);
    qualified.push({
      partnerId: pid,
      partnerName: nameById.get(pid) || '',
      totalGames: rec.totalGames,
      wins: rec.wins,
      losses: rec.losses,
      winRate: rec.winRate,
      pointsFor,
      pointsAgainst,
      pointDiff: pointsFor - pointsAgainst,
      latest: rec.matches[0] ?? null,
      recentForm: rec.matches.slice(0, 5).map((m) => m.won),
    });
  }

  const n = qualified.length;
  const base = { partnersMet, qualified: n, maxGamesBelowMin, hasUnresolvableRecords: unresolved };
  if (n === 0) return { ...base, mode: 'none', best: [], worst: [], analyzable: [] };
  if (n === 1) return { ...base, mode: 'single', best: [], worst: [], analyzable: qualified };
  // BEST 인원: 4명 이상 2 · 3명 2 · 2명 1  →  min(2, ceil(n/2)). WORST 는 나머지에서 min(2, n − BEST).
  const bestCount = Math.min(PARTNER_LIST_SIZE, Math.ceil(n / 2));
  const best = [...qualified].sort(compareBest).slice(0, bestCount);
  const bestIds = new Set(best.map((p) => p.partnerId));
  const worst = qualified.filter((p) => !bestIds.has(p.partnerId)).sort(compareWorst).slice(0, Math.min(PARTNER_LIST_SIZE, n - bestCount));
  return { ...base, mode: n >= PARTNER_LIST_SIZE * 2 ? 'full' : 'partial', best, worst, analyzable: [] };
}
