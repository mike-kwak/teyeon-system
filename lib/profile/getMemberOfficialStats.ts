import { supabase } from '@/lib/supabase';
import {
    calculateKdkArchiveStats,
    type KdkArchiveRow,
    type KdkArchiveStats,
    type KdkRecentSession,
} from '@/lib/kdkArchiveStats';

/**
 * Aggregated KDK summary for a single member, built only from the OFFICIAL
 * archive rows in teyeon_archive_v1 (`archive_type='kdk'` + `is_official=true`).
 * Test / pending sessions are filtered out at the query and aggregation layers.
 */
export type ProfileKdkSummary = {
    /** 해당 멤버가 참가한 공식 KDK 세션 수 */
    officialSessionCount: number;
    /** 클럽 전체의 공식 KDK 세션 수 (멤버 참가 여부 무관) */
    totalOfficialSessionCount: number;
    totalMatches: number;
    wins: number;
    losses: number;
    winRate: number;        // 0–100, one decimal place
    pointDiff: number;
    bestRank: number | null;
    latestRank: number | null;
    top3Count: number;
    championCount: number;
};

export type RecentOfficialRecord = {
    sessionId: string;
    sessionDate: string;
    sessionTitle: string;
    finalRank: number | null;
    wins: number;
    losses: number;
    pointDiff: number;
};

/** 4-cell stat strip on the player card surface. */
export type PlayerCardStats = {
    /** 가장 최근 공식 KDK 세션의 최종 순위 (bestRank 폴백 없음) */
    latestRank: number | null;
    winRate: number | null;
    /** 개인 참가 횟수 */
    attend: number;
    /** 클럽 전체 공식 KDK 세션 수 — ATTEND 셀의 분모로 사용 (`{attend} / {totalAttend}`) */
    totalAttend: number;
    record: string | null;
};

export type MemberOfficialStatsResult = {
    summary: ProfileKdkSummary;
    recentRecords: RecentOfficialRecord[];
    playerCardStats: PlayerCardStats;
    rawStats: KdkArchiveStats;
};

export const emptyProfileSummary: ProfileKdkSummary = {
    officialSessionCount: 0,
    totalOfficialSessionCount: 0,
    totalMatches: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    pointDiff: 0,
    bestRank: null,
    latestRank: null,
    top3Count: 0,
    championCount: 0,
};

const computeBestRank = (sessions: KdkRecentSession[]): number | null => {
    let best: number | null = null;
    for (const s of sessions) {
        if (typeof s.rank === 'number') {
            if (best === null || s.rank < best) best = s.rank;
        }
    }
    return best;
};

export function toProfileKdkSummary(
    stats: KdkArchiveStats | null,
    totalOfficialSessionCount = 0,
): ProfileKdkSummary {
    if (!stats) return { ...emptyProfileSummary, totalOfficialSessionCount };
    const totalMatches = stats.totalWins + stats.totalLosses;
    const winRate = totalMatches > 0
        ? Math.round((stats.totalWins / totalMatches) * 1000) / 10
        : 0;
    return {
        officialSessionCount: stats.totalSessions,
        totalOfficialSessionCount,
        totalMatches,
        wins: stats.totalWins,
        losses: stats.totalLosses,
        winRate,
        pointDiff: stats.totalDiff,
        bestRank: computeBestRank(stats.recentSessions),
        latestRank: stats.latestRank,
        top3Count: stats.top3Count,
        championCount: stats.firstPlaceCount,
    };
}

export function toRecentOfficialRecords(
    stats: KdkArchiveStats | null,
    limit = 3,
): RecentOfficialRecord[] {
    if (!stats) return [];
    return stats.recentSessions.slice(0, limit).map((s) => ({
        sessionId: s.archiveId,
        sessionDate: s.date,
        sessionTitle: s.title,
        finalRank: s.rank,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        pointDiff: s.diff ?? 0,
    }));
}

export function toPlayerCardStats(summary: ProfileKdkSummary): PlayerCardStats {
    const hasMatches = summary.totalMatches > 0;
    return {
        // 카드 표시 의미: 가장 최근 공식 KDK 세션의 최종 순위만 사용 (bestRank fallback 없음)
        latestRank: summary.latestRank,
        winRate: hasMatches ? summary.winRate : null,
        attend: summary.officialSessionCount,
        totalAttend: summary.totalOfficialSessionCount,
        record: hasMatches ? `${summary.wins}-${summary.losses}` : null,
    };
}

/**
 * Fetch official KDK archive rows and aggregate stats for a single member.
 *
 * Identification rules (already enforced in calculateKdkArchiveStats):
 *  - 1순위: ranking_data[].id === member.id (정회원 stable id)
 *  - 2순위: 정규화된 이름 exact match (manual-guest- 접두사, (G) 접미사 제거 후 lowercase)
 *  - manual-guest- 데이터는 정규화 단계에서 prefix가 떨어지므로 정회원 닉네임과
 *    충돌할 위험이 잔존함 → 동명이인이 있는 경우 정회원 stable id를 채워두는 것이 안전
 */
export async function fetchMemberOfficialStats(member: {
    id: string;
    name?: string | null;
}): Promise<MemberOfficialStatsResult> {
    // 단일 쿼리로 공식 KDK archive 전부 가져오기 — 클라이언트에서 집계.
    // archive row 수는 클럽당 분기/연간 수십 건 규모라 N+1 없이 한 번에 처리 가능.
    const { data: archives, error } = await supabase
        .from('teyeon_archive_v1')
        .select('id, created_at, raw_data, is_official, archive_type')
        .eq('archive_type', 'kdk')
        .eq('is_official', true)
        .order('created_at', { ascending: false });

    if (error) throw error;

    // 클럽 전체의 공식 KDK 세션 수 — SQL 필터(archive_type='kdk' AND is_official=true)를
    // 통과한 row 전체 수. 멤버 참가 여부와 무관, 미확정/테스트는 이미 제외됨.
    const archiveRows = (archives || []) as KdkArchiveRow[];
    const totalOfficialSessionCount = archiveRows.length;

    const stats = calculateKdkArchiveStats(archiveRows, member);
    const summary = toProfileKdkSummary(stats, totalOfficialSessionCount);

    return {
        summary,
        recentRecords: toRecentOfficialRecords(stats, 3),
        playerCardStats: toPlayerCardStats(summary),
        rawStats: stats,
    };
}
