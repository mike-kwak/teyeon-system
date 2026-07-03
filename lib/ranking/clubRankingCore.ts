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

export type ClubRankingSeason = number | 'all';

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
  /** 총 랭킹 포인트 = participationPoints + winPoints + bonusPoints */
  points: number;
  participationPoints: number;
  winPoints: number;
  bonusPoints: number;
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
} | null;

export type ClubRankingAwards = {
  mostParticipation: ClubRankingAwardWinner;
  bestWinRate: ClubRankingAwardWinner;
  mostWins: ClubRankingAwardWinner;
  mostChampionships: ClubRankingAwardWinner;
  mostTop3: ClubRankingAwardWinner;
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
  mostParticipation: null,
  bestWinRate: null,
  mostWins: null,
  mostChampionships: null,
  mostTop3: null,
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

/** 자격자 중 최댓값 보유자 1명 선정(공동이면 compareEntries 상위). 최댓값 0이면 시상 없음(null). */
function pickAward(
  pool: ClubRankingEntry[],
  value: (e: ClubRankingEntry) => number,
): ClubRankingAwardWinner {
  let best: ClubRankingEntry | null = null;
  for (const e of pool) {
    if (value(e) <= 0) continue;
    if (!best || value(e) > value(best) || (value(e) === value(best) && compareEntries(e, best) < 0)) {
      best = e;
    }
  }
  return best ? { memberId: best.memberId, name: best.name, value: value(best) } : null;
}

export function computeClubRanking(
  archiveRows: KdkArchiveRow[],
  members: ClubRankingMemberInput[],
  season: ClubRankingSeason = 'all',
): ClubRankingResult {
  // 시즌 필터 — 공식/kdk 필터는 calculateKdkArchiveStats 가 내부에서 재적용하므로(공통 기준)
  //   여기서는 날짜(연도)만 자른다. 날짜 기준은 동일 helper(getArchiveDate)를 재사용.
  const officialRows = (archiveRows || []).filter(
    (row) => row?.archive_type === 'kdk' && row?.is_official === true,
  );
  const seasonRows =
    season === 'all'
      ? officialRows
      : officialRows.filter((row) => getArchiveDate(row).slice(0, 4) === String(season));

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
    const participationPoints = stats.totalSessions * RANKING_POINTS.participation;
    const winPoints = stats.totalWins * RANKING_POINTS.win;
    const bonusPoints =
      stats.firstPlaceCount * RANKING_POINTS.bonusFirst +
      stats.secondPlaceCount * RANKING_POINTS.bonusSecond +
      stats.thirdPlaceCount * RANKING_POINTS.bonusThird;

    entries.push({
      rank: 0, // 정렬 후 부여
      memberId: member.id,
      name: member.name || '',
      avatarUrl: member.avatarUrl ?? null,
      points: participationPoints + winPoints + bonusPoints,
      participationPoints,
      winPoints,
      bonusPoints,
      sessions: stats.totalSessions,
      wins: stats.totalWins,
      losses: stats.totalLosses,
      games,
      winRate,
      pointDiff: stats.totalDiff,
      championCount: stats.firstPlaceCount,
      top3Count: stats.top3Count,
      latestRank: stats.latestRank,
      eligible: stats.totalSessions >= RANKING_MIN_SESSIONS,
    });
  }

  entries.sort(compareEntries);
  entries.forEach((e, i) => { e.rank = i + 1; });

  // 자동 시상 — 정식 자격자만 대상. 최고 승률상은 추가로 공식 6경기 이상.
  const eligiblePool = entries.filter((e) => e.eligible);
  const awards: ClubRankingAwards = entries.length === 0 ? emptyAwards : {
    mostParticipation: pickAward(eligiblePool, (e) => e.sessions),
    bestWinRate: pickAward(eligiblePool.filter((e) => e.games >= BEST_WINRATE_MIN_GAMES), (e) => e.winRate),
    mostWins: pickAward(eligiblePool, (e) => e.wins),
    mostChampionships: pickAward(eligiblePool, (e) => e.championCount),
    mostTop3: pickAward(eligiblePool, (e) => e.top3Count),
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
