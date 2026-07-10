export type KdkArchiveRow = {
  id: string;
  created_at?: string | null;
  archive_type?: string | null;
  is_official?: boolean | null;
  raw_data?: {
    title?: string;
    date?: string;
    ranking_data?: any[];
    snapshot_data?: any[];
    player_metadata?: Record<string, any>;
  } | null;
};

export type KdkRecentSession = {
  archiveId: string;
  title: string;
  date: string;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  diff: number | null;
  totalPlayers: number;
  groupName?: string;
  ranked: boolean;
};

export type KdkArchiveStats = {
  totalSessions: number;
  totalWins: number;
  totalLosses: number;
  totalDiff: number;
  averageDiff: number;
  firstPlaceCount: number;
  /** 세션 전체 2위 횟수 — 클럽 랭킹 보너스 계산용(가산 필드, 기존 소비자 영향 없음). */
  secondPlaceCount: number;
  /** 세션 전체 3위 횟수 — 클럽 랭킹 보너스 계산용(가산 필드, 기존 소비자 영향 없음). */
  thirdPlaceCount: number;
  top3Count: number;
  latestRank: number | null;
  /**
   * 참가 인원 역산형 순위포인트 합(산식 v2 전용, 가산 필드). 세션마다 (세션 참가 인원 N − 최종 순위 R + 1)을
   * 유효한 ranked 세션에 한해 합산. N 은 해당 세션 최종 순위표(ranking_data)의 stable-id 중복 제거 참가자 수.
   * R < 1 또는 R > N 인 이상치 세션은 0 처리(잘못된 포인트 생성 방지). v1 산식은 이 값을 사용하지 않는다.
   */
  rankPointsSum: number;
  recentSessions: KdkRecentSession[];
  rankedSessionCount: number;
};

const emptyStats: KdkArchiveStats = {
  totalSessions: 0,
  totalWins: 0,
  totalLosses: 0,
  totalDiff: 0,
  averageDiff: 0,
  firstPlaceCount: 0,
  secondPlaceCount: 0,
  thirdPlaceCount: 0,
  top3Count: 0,
  latestRank: null,
  rankPointsSum: 0,
  recentSessions: [],
  rankedSessionCount: 0,
};

const normalizeName = (value?: string | null) =>
  String(value || '')
    .replace(/^manual-guest-/i, '')
    .replace(/\s*\(G\)$/i, '')
    .replace(/\s+g$/i, '')
    .trim()
    .toLowerCase();

const normalizeGroup = (value?: string | null) => {
  const raw = String(value || '').trim().toUpperCase();
  if (raw.includes('B') || raw.includes('BLUE')) return 'B';
  if (raw.includes('A') || raw.includes('GOLD')) return 'A';
  return '';
};

// 클럽 랭킹(시즌 필터)에서도 동일 날짜 기준을 쓰도록 export (로직 복사 방지).
export const getArchiveDate = (row: KdkArchiveRow) =>
  row.raw_data?.date || row.created_at?.slice(0, 10) || '';

const getMatchPlayerIds = (match: any): string[] =>
  match?.player_ids || match?.playerIds || [];

const getMatchPlayerNames = (match: any): string[] =>
  match?.player_names || match?.playerNames || [];

/** ranking_data 한 행의 stable 참가자 키(id 우선 → 이름). 식별 불가면 빈 문자열. */
const participantKey = (player: any): string => {
  const id = String(player?.id ?? '').trim();
  if (id) return `id:${id}`;
  const nm = normalizeName(player?.name);
  return nm ? `nm:${nm}` : '';
};

/**
 * 세션 최종 순위표(ranking_data)의 실제 참가 인원 N — stable id(없으면 이름) 기준 중복 제거.
 * 이름 목록 길이를 그대로 쓰지 않고, 식별 가능한 참가자는 중복 제거, 식별 불가 행만 개별 계수.
 * 정상 데이터에서는 ranking_data.length 와 동일(최종 순위표 = 참가자당 1행).
 */
const countSessionParticipants = (rankingData: any[]): number => {
  const seen = new Set<string>();
  let unidentified = 0;
  for (const player of rankingData) {
    const key = participantKey(player);
    if (key) seen.add(key);
    else unidentified += 1;
  }
  return seen.size + unidentified;
};

const findRankingEntry = (rankingData: any[], memberId: string, memberName?: string | null) => {
  const byIdIndex = rankingData.findIndex(player => String(player?.id || '') === memberId);
  if (byIdIndex >= 0) return { entry: rankingData[byIdIndex], rank: byIdIndex + 1 };

  const normalizedMemberName = normalizeName(memberName);
  if (!normalizedMemberName) return null;

  const byNameIndex = rankingData.findIndex(player => normalizeName(player?.name) === normalizedMemberName);
  if (byNameIndex >= 0) return { entry: rankingData[byNameIndex], rank: byNameIndex + 1 };

  return null;
};

const participatedInSnapshot = (snapshotData: any[], memberId: string, memberName?: string | null) => {
  const normalizedMemberName = normalizeName(memberName);
  return snapshotData.some(match => {
    const ids = getMatchPlayerIds(match);
    if (ids.includes(memberId)) return true;
    if (!normalizedMemberName) return false;
    return getMatchPlayerNames(match).some(name => normalizeName(name) === normalizedMemberName);
  });
};

const getSessionGroupName = (
  snapshotData: any[],
  memberId: string,
  metadata: Record<string, any> = {}
) => {
  const metadataGroup = normalizeGroup(metadata?.[memberId]?.group);
  if (metadataGroup) return metadataGroup;

  const match = snapshotData.find(item => getMatchPlayerIds(item).includes(memberId));
  return normalizeGroup(match?.group_name || match?.groupName || match?.group);
};

export function calculateKdkArchiveStats(
  archiveRows: KdkArchiveRow[],
  member: { id: string; name?: string | null }
): KdkArchiveStats {
  if (!member?.id) return emptyStats;

  const sortedRows = [...(archiveRows || [])]
    .filter(row => row?.archive_type === 'kdk' && row?.is_official === true)
    .sort((a, b) => {
      const aTime = new Date(a.raw_data?.date || a.created_at || 0).getTime();
      const bTime = new Date(b.raw_data?.date || b.created_at || 0).getTime();
      return bTime - aTime;
    });

  let totalWins = 0;
  let totalLosses = 0;
  let totalDiff = 0;
  let firstPlaceCount = 0;
  let secondPlaceCount = 0;
  let thirdPlaceCount = 0;
  let top3Count = 0;
  let rankedSessionCount = 0;
  let rankPointsSum = 0;
  let latestRank: number | null = null;

  const participatedSessions: KdkRecentSession[] = [];

  sortedRows.forEach(row => {
    const raw = row.raw_data || {};
    const rankingData = Array.isArray(raw.ranking_data) ? raw.ranking_data : [];
    const snapshotData = Array.isArray(raw.snapshot_data) ? raw.snapshot_data : [];
    const metadata = raw.player_metadata || {};
    const rankingResult = findRankingEntry(rankingData, member.id, member.name);
    const participated = !!rankingResult || participatedInSnapshot(snapshotData, member.id, member.name);

    if (!participated) return;

    const rank = rankingResult?.rank ?? null;
    const entry = rankingResult?.entry;
    const wins = entry ? Number(entry.wins || 0) : null;
    const losses = entry ? Number(entry.losses || 0) : null;
    const diff = entry ? Number(entry.diff || 0) : null;

    if (entry) {
      rankedSessionCount += 1;
      totalWins += wins || 0;
      totalLosses += losses || 0;
      totalDiff += diff || 0;
      if (rank === 1) firstPlaceCount += 1;
      if (rank === 2) secondPlaceCount += 1;
      if (rank === 3) thirdPlaceCount += 1;
      if (rank && rank <= 3) top3Count += 1;
      if (latestRank === null) latestRank = rank;
      // 산식 v2 순위포인트: N − R + 1. N=세션 참가 인원(중복 제거), R=최종 순위.
      //   R<1 또는 R>N 이상치는 0 처리(임의 보정 없이 잘못된 포인트 방지).
      const n = countSessionParticipants(rankingData);
      if (rank !== null && rank >= 1 && n > 0 && rank <= n) {
        rankPointsSum += n - rank + 1;
      }
    }

    participatedSessions.push({
      archiveId: row.id,
      title: raw.title || row.id,
      date: getArchiveDate(row),
      rank,
      wins,
      losses,
      diff,
      totalPlayers: rankingData.length || new Set(snapshotData.flatMap(getMatchPlayerIds)).size,
      groupName: getSessionGroupName(snapshotData, member.id, metadata),
      ranked: !!entry,
    });
  });

  return {
    totalSessions: participatedSessions.length,
    totalWins,
    totalLosses,
    totalDiff,
    averageDiff: rankedSessionCount > 0 ? totalDiff / rankedSessionCount : 0,
    firstPlaceCount,
    secondPlaceCount,
    thirdPlaceCount,
    top3Count,
    latestRank,
    rankPointsSum,
    recentSessions: participatedSessions.slice(0, 5),
    rankedSessionCount,
  };
}
