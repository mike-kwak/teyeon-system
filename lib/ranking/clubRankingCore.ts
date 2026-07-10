// TEYEON 클럽 랭킹 MVP — 순수 계산 코어 (supabase 미의존, 단독 검증/테스트 가능).
//   · 데이터 소스: 공식 KDK Archive(teyeon_archive_v1) row 배열 — 조회는 clubRankingService 가 담당.
//   · 매칭·집계 정합: Profile 과 동일한 공통 기준 calculateKdkArchiveStats 를 회원별로 호출한다
//     (동일 계산 로직을 복사 구현하지 않는다 — Profile/Ranking 수치 불일치 원천 차단).
//   · 게스트: members 명단 기준 루프이므로 메인 회원 랭킹에서 자연 제외
//     (Archive 원본의 게스트 기록은 그대로 유지 — 이 코어는 읽기 전용 입력만 받는다).
//   · 랭킹 성격: 단순 실력 순위가 아니라 "공식 KDK 참여 + 경기 승리 + 세션 최종 순위 성과"를
//     함께 반영한 종합 포인트다(화면 Ranking Rule 에 명시할 것).

import {
  calculateKdkArchiveStats,
  getArchiveDate,
  type KdkArchiveRow,
} from '../kdkArchiveStats';

// ── 확정 산식 (2026-07 사용자 승인 A안) ──────────────────────────────────────
//   승률·득실은 포인트에 가산하지 않고 동률 처리에만 사용한다.
export const RANKING_POINTS = {
  /** 공식 KDK 참가 1회 */
  participation: 10,
  /** 공식 경기 승리 1회 */
  win: 5,
  /** 세션 전체 1위 */
  bonusFirst: 20,
  /** 세션 전체 2위 */
  bonusSecond: 12,
  /** 세션 전체 3위 */
  bonusThird: 8,
} as const;

/** 정식 랭킹 자격: 공식 KDK 2회 이상. 1회는 목록 표시 + '집계 예정 1/2회', 0회는 미표시. */
export const RANKING_MIN_SESSIONS = 2;
/** 최고 승률상 자격: 공식 6경기 이상(미달자는 후보 제외 — 목록의 승률 표시는 무관). */
export const BEST_WINRATE_MIN_GAMES = 6;

/**
 * 랭킹 산식 값(가중치 + 최소 조건). Ranking Manager 가 버전으로 관리한다(ranking_config).
 * core 는 이 값만 받아 계산하며, 미전달 시 DEFAULT_RANKING_CONFIG(= 위 상수)로 동작한다
 * → config 미존재/조회 실패 시에도 현재 확정 산식과 100% 동일한 결과를 낸다(backward compatible).
 */
export interface RankingConfigValues {
  participation: number;
  win: number;
  bonusFirst: number;
  bonusSecond: number;
  bonusThird: number;
  minSessions: number;
  bestWinrateMinGames: number;
  /**
   * 산식 버전. 1 = 기존(고정 TOP3 보너스), 2 = 참가 인원 역산형 순위포인트(bonus* 무시).
   * 미지정/1 이면 기존 산식과 100% 동일. config 미존재·레거시 snapshot 은 1 로 취급.
   */
  formulaVersion: 1 | 2;
}

/** 현재 확정 산식(위 상수에서 파생 — 단일 출처). config 조회 실패 시 폴백 기본값. formulaVersion=1(현행). */
export const DEFAULT_RANKING_CONFIG: RankingConfigValues = {
  participation: RANKING_POINTS.participation,
  win: RANKING_POINTS.win,
  bonusFirst: RANKING_POINTS.bonusFirst,
  bonusSecond: RANKING_POINTS.bonusSecond,
  bonusThird: RANKING_POINTS.bonusThird,
  minSessions: RANKING_MIN_SESSIONS,
  bestWinrateMinGames: BEST_WINRATE_MIN_GAMES,
  formulaVersion: 1,
};

/**
 * 집계 기간.
 *   number         → 연도(시즌) 필터 (예: 2026)
 *   'all'          → 누적(전체 공식 기록)
 *   { year, month }→ 월간 필터 — 해당 연·월의 공식 세션만.
 * 날짜 기준은 기존과 동일하게 getArchiveDate(공식 세션 경기일 raw_data.date 우선, 폴백 created_at).
 * YYYY-MM-DD 문자열 접두 비교라 타임존 변환이 없어 UTC 밀림 문제가 원천적으로 발생하지 않는다
 * (= 선택 월 1일 00:00 이상 ~ 다음 달 1일 미만과 동치).
 */
export type ClubRankingSeason = number | 'all' | { year: number; month: number };

export type ClubRankingMemberInput = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export type ClubRankingEntry = {
  rank: number;
  memberId: string;
  name: string;
  avatarUrl: string | null;
  /** 총 랭킹 포인트 = participationPoints + winPoints + bonusPoints + rankPoints. (버전별로 bonusPoints 또는 rankPoints 중 하나만 > 0) */
  points: number;
  participationPoints: number;
  winPoints: number;
  /** v1 고정 TOP3 보너스 점수(1·2·3위). v2 에서는 0. */
  bonusPoints: number;
  /** v2 참가 인원 역산형 순위포인트 합(세션별 N−R+1). v1 에서는 0. */
  rankPoints: number;
  sessions: number;
  wins: number;
  losses: number;
  games: number;
  /** 0~100, 소수 1자리(경기 0이면 0) — Profile winRate 와 동일 반올림. */
  winRate: number;
  pointDiff: number;
  championCount: number;
  top3Count: number;
  latestRank: number | null;
  /** 공식 KDK RANKING_MIN_SESSIONS 회 이상 여부. false = '집계 예정 n/2회' 표시 대상. */
  eligible: boolean;
};

export type ClubRankingAwardWinner = {
  memberId: string;
  name: string;
  value: number;
  /** Ranking 에서 이미 해석된 아바타(members.avatar_url → profiles exact → null). 추가 조회 없음. */
  avatarUrl: string | null;
};

/**
 * 자동 시상 — 항목별 '공동 수상자 배열'. 동일 최고값이면 전원 포함(누락 없음).
 * 수상 대상이 없거나 최고값이 0 이하이면 빈 배열. (기존 단일 winner|null 구조에서 배열로 확장.)
 */
export type ClubRankingAwards = {
  mostParticipation: ClubRankingAwardWinner[];
  bestWinRate: ClubRankingAwardWinner[];
  mostWins: ClubRankingAwardWinner[];
  mostChampionships: ClubRankingAwardWinner[];
  mostTop3: ClubRankingAwardWinner[];
};

export type ClubRankingResult = {
  season: ClubRankingSeason;
  /** 시즌 필터 후 공식 세션 수(참가 여부 무관 — Hero '집계 대상' 표기용). */
  totalOfficialSessions: number;
  /** 목록 인원(공식 1회 이상 참가 회원 수). */
  aggregatedMembers: number;
  /** 가장 최근 공식 세션 날짜(YYYY-MM-DD, 없으면 null) — '마지막 업데이트' 표기용. */
  latestSessionDate: string | null;
  entries: ClubRankingEntry[];
  awards: ClubRankingAwards;
};

const emptyAwards: ClubRankingAwards = {
  mostParticipation: [],
  bestWinRate: [],
  mostWins: [],
  mostChampionships: [],
  mostTop3: [],
};

/** 확정 동률 규칙: 포인트 → 우승 → TOP3 → 승률 → 득실 → 최근 공식 순위(작을수록 우선, 없으면 최하) → 참가 횟수. */
function compareEntries(a: ClubRankingEntry, b: ClubRankingEntry): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.championCount !== a.championCount) return b.championCount - a.championCount;
  if (b.top3Count !== a.top3Count) return b.top3Count - a.top3Count;
  if (b.winRate !== a.winRate) return b.winRate - a.winRate;
  if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
  const aLatest = a.latestRank ?? Number.MAX_SAFE_INTEGER;
  const bLatest = b.latestRank ?? Number.MAX_SAFE_INTEGER;
  if (aLatest !== bLatest) return aLatest - bLatest;
  return b.sessions - a.sessions;
}

/**
 * 자격자 중 최댓값을 기록한 회원 '전원'을 공동 수상자로 반환.
 *   · 최댓값이 0 이하이거나 대상자가 없으면 빈 배열.
 *   · 공동 수상 판정 기준 = 해당 지표 값의 동일 여부(전체 Ranking 동률 comparator 미사용).
 *   · 반환 순서는 pool(= 랭킹 정렬) 순서를 따른다(대표 표시는 첫 번째부터).
 */
function pickAwards(
  pool: ClubRankingEntry[],
  value: (e: ClubRankingEntry) => number,
): ClubRankingAwardWinner[] {
  let max = 0;
  for (const e of pool) {
    const v = value(e);
    if (v > max) max = v;
  }
  if (max <= 0) return [];
  return pool
    .filter((e) => value(e) === max)
    .map((e) => ({ memberId: e.memberId, name: e.name, value: max, avatarUrl: e.avatarUrl ?? null }));
}

/**
 * v2 순위포인트 산정 시 잘못된 포인트를 만들 수 있는 세션 이상치 수(관리자 Preview 표시용).
 *   · 공식 세션인데 최종 순위표(ranking_data)가 비어 있음(경기는 있으나 순위 미확정)
 *   · ranking_data 에 stable-id/이름 중복 참가자 존재
 * 이 세션들은 rankPointsSum 계산에서 방어적으로 제외되므로 점수를 왜곡하지 않는다(정보 표시용).
 */
export function countRankingDataAnomalies(
  archiveRows: KdkArchiveRow[],
  season: ClubRankingSeason = 'all',
): number {
  const officialRows = (archiveRows || []).filter(
    (row) => row?.archive_type === 'kdk' && row?.is_official === true,
  );
  const seasonRows =
    season === 'all'
      ? officialRows
      : typeof season === 'number'
        ? officialRows.filter((row) => getArchiveDate(row).slice(0, 4) === String(season))
        : officialRows.filter(
            (row) =>
              getArchiveDate(row).slice(0, 7) ===
              `${season.year}-${String(season.month).padStart(2, '0')}`,
          );
  let anomalies = 0;
  for (const row of seasonRows) {
    const raw = row.raw_data || {};
    const rd = Array.isArray(raw.ranking_data) ? raw.ranking_data : [];
    const snap = Array.isArray(raw.snapshot_data) ? raw.snapshot_data : [];
    const hasPlayers = rd.length > 0 || snap.length > 0;
    if (hasPlayers && rd.length === 0) { anomalies += 1; continue; } // 순위표 없음
    const keys = new Set<string>();
    let dup = false;
    for (const p of rd) {
      const id = String(p?.id ?? '').trim();
      const key = id ? `id:${id}` : String(p?.name ?? '').trim().toLowerCase();
      if (!key) continue;
      if (keys.has(key)) { dup = true; break; }
      keys.add(key);
    }
    if (dup) anomalies += 1;
  }
  return anomalies;
}

export function computeClubRanking(
  archiveRows: KdkArchiveRow[],
  members: ClubRankingMemberInput[],
  season: ClubRankingSeason = 'all',
  config: RankingConfigValues = DEFAULT_RANKING_CONFIG,
): ClubRankingResult {
  // 시즌 필터 — 공식/kdk 필터는 calculateKdkArchiveStats 가 내부에서 재적용하므로(공통 기준)
  //   여기서는 날짜(연도)만 자른다. 날짜 기준은 동일 helper(getArchiveDate)를 재사용.
  const officialRows = (archiveRows || []).filter(
    (row) => row?.archive_type === 'kdk' && row?.is_official === true,
  );
  const seasonRows =
    season === 'all'
      ? officialRows
      : typeof season === 'number'
        ? officialRows.filter((row) => getArchiveDate(row).slice(0, 4) === String(season))
        : officialRows.filter(
            (row) =>
              getArchiveDate(row).slice(0, 7) ===
              `${season.year}-${String(season.month).padStart(2, '0')}`,
          );

  const latestSessionDate = seasonRows.reduce<string | null>((acc, row) => {
    const d = getArchiveDate(row);
    return d && (!acc || d > acc) ? d : acc;
  }, null);

  const entries: ClubRankingEntry[] = [];
  for (const member of members || []) {
    if (!member?.id) continue;
    const stats = calculateKdkArchiveStats(seasonRows, { id: member.id, name: member.name });
    if (stats.totalSessions === 0) continue; // 정책: 공식 0회 참가 회원은 목록 미표시.

    const games = stats.totalWins + stats.totalLosses;
    const winRate = games > 0 ? Math.round((stats.totalWins / games) * 1000) / 10 : 0;
    const participationPoints = stats.totalSessions * config.participation;
    const winPoints = stats.totalWins * config.win;
    // v2(참가 인원 역산형): 순위포인트만 사용, 고정 TOP3 보너스 미적용.
    // v1(기존): 고정 TOP3 보너스만 사용, 순위포인트 미적용.
    const isV2 = config.formulaVersion === 2;
    const bonusPoints = isV2
      ? 0
      : stats.firstPlaceCount * config.bonusFirst +
        stats.secondPlaceCount * config.bonusSecond +
        stats.thirdPlaceCount * config.bonusThird;
    const rankPoints = isV2 ? stats.rankPointsSum : 0;

    entries.push({
      rank: 0, // 정렬 후 부여
      memberId: member.id,
      name: member.name || '',
      avatarUrl: member.avatarUrl ?? null,
      points: participationPoints + winPoints + bonusPoints + rankPoints,
      participationPoints,
      winPoints,
      bonusPoints,
      rankPoints,
      sessions: stats.totalSessions,
      wins: stats.totalWins,
      losses: stats.totalLosses,
      games,
      winRate,
      pointDiff: stats.totalDiff,
      championCount: stats.firstPlaceCount,
      top3Count: stats.top3Count,
      latestRank: stats.latestRank,
      eligible: stats.totalSessions >= config.minSessions,
    });
  }

  entries.sort(compareEntries);
  entries.forEach((e, i) => { e.rank = i + 1; });

  // 자동 시상 — 정식 자격자만 대상. 최고 승률상은 추가로 공식 6경기 이상.
  const eligiblePool = entries.filter((e) => e.eligible);
  const awards: ClubRankingAwards = entries.length === 0 ? emptyAwards : {
    mostParticipation: pickAwards(eligiblePool, (e) => e.sessions),
    bestWinRate: pickAwards(eligiblePool.filter((e) => e.games >= config.bestWinrateMinGames), (e) => e.winRate),
    mostWins: pickAwards(eligiblePool, (e) => e.wins),
    mostChampionships: pickAwards(eligiblePool, (e) => e.championCount),
    mostTop3: pickAwards(eligiblePool, (e) => e.top3Count),
  };

  return {
    season,
    totalOfficialSessions: seasonRows.length,
    aggregatedMembers: entries.length,
    latestSessionDate,
    entries,
    awards,
  };
}
