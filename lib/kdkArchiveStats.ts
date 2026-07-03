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
    recentSessions: participatedSessions.slice(0, 5),
    rankedSessionCount,
  };
}
