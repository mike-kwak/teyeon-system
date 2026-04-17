'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Match, Member, AttendeeConfig, RankedPlayer, RankTrend } from '@/lib/tournament_types';

interface RankStats {
    wins: number;
    losses: number;
    diff: number;
    games: number;
    pf: number;
    pa: number;
}

/**
 * useRanking Hook - Portable ranking logic for KDK and Special Matches.
 * Handles real-time stats calculation and rank trend tracking.
 */
export function useRanking(
    matches: Match[],
    allMembers: Member[],
    tempGuests: Member[],
    selectedIds: Set<string>,
    attendeeConfigs: Record<string, AttendeeConfig>
) {
    // 1. Calculate Player Stats from completed matches
    const playerStatsData = useMemo(() => {
        const res: Record<string, RankStats> = {};
        const nameMap: Record<string, string> = {};

        matches?.forEach(m => {
            // [v35.8.4] Build a name map from all matches (not just complete ones) to assist in name recovery
            if (m?.playerIds && m?.player_names) {
                m.playerIds.forEach((pid, idx) => {
                    const pName = m.player_names?.[idx];
                    if (pName && !pName.startsWith('g-')) {
                        nameMap[pid] = pName;
                    }
                });
            }

            if (m?.status !== 'complete') return;
            
            m?.playerIds?.forEach((pid, idx) => {
                if (!res[pid]) res[pid] = { wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0 };
                const isTeam1 = idx < 2;
                const score1 = Number(m?.score1 || 0);
                const score2 = Number(m?.score2 || 0);
                const win = isTeam1 ? (score1 > score2) : (score2 > score1);
                const d = isTeam1 ? (score1 - score2) : (score2 - score1);

                res[pid].games += 1;
                res[pid].pf += isTeam1 ? score1 : score2;
                res[pid].pa += isTeam1 ? score2 : score1;
                if (win) res[pid].wins += 1;
                else res[pid].losses += 1;
                res[pid].diff += d;
            });
        });
        return { stats: res, nameLookup: nameMap };
    }, [matches]);

    const playerStats = playerStatsData.stats;
    const nameLookup = playerStatsData.nameLookup;

    // 2. Compute Base Ranking (Primary logic for sorting)
    const baseRanking = useMemo(() => {
        const participantIds = (selectedIds?.size > 0)
            ? Array.from(selectedIds)
            : Array.from(new Set((matches || []).flatMap(m => m?.playerIds || [])));

        return participantIds.map(id => {
            const m = (allMembers || []).find(x => x?.id === id) || (tempGuests || []).find(x => x?.id === id);
            const resolvedName = m?.nickname || nameLookup[id] || id;

            const conf = attendeeConfigs?.[id] || { name: resolvedName, group: 'A', is_guest: m?.is_guest, age: m?.age || 99 };
            return {
                id,
                name: resolvedName,
                is_guest: m?.is_guest || conf?.is_guest,
                avatar: m?.avatar_url || '',
                group: conf?.group || 'A',
                age: conf.age || m?.age || 99,
                ...(playerStats?.[id] || { wins: 0, losses: 0, diff: 0, games: 0, pf: 0, pa: 0 })
            };
        }).sort((a, b) => 
            (b?.wins || 0) - (a?.wins || 0) || 
            (b?.diff || 0) - (a?.diff || 0) || 
            (a?.age || 999) - (b?.age || 999)
        );
    }, [playerStats, attendeeConfigs, selectedIds, matches, allMembers, tempGuests]);

    // 3. Track Rank Changes (Trend)
    const [trends, setTrends] = useState<Record<string, RankTrend>>({});
    const prevRankingRef = useRef<string[]>([]);
    const lastMatchCountRef = useRef<number>(0);

    const completeCount = useMemo(() => matches.filter(m => m.status === 'complete').length, [matches]);

    useEffect(() => {
        // [v34.0] Trigger trend calculation only when a match results in completion
        if (completeCount > lastMatchCountRef.current) {
            const currentOrder = baseRanking.map(p => p.id);
            const newTrends: Record<string, RankTrend> = {};

            if (prevRankingRef.current.length > 0) {
                currentOrder.forEach((id, currentIndex) => {
                    const prevIndex = prevRankingRef.current.indexOf(id);
                    if (prevIndex === -1) {
                        newTrends[id] = 'same';
                    } else if (currentIndex < prevIndex) {
                        newTrends[id] = 'up';
                    } else if (currentIndex > prevIndex) {
                        newTrends[id] = 'down';
                    } else {
                        newTrends[id] = 'same';
                    }
                });
            }

            setTrends(newTrends);
            prevRankingRef.current = currentOrder;
            lastMatchCountRef.current = completeCount;
        } else if (completeCount === 0 && prevRankingRef.current.length === 0) {
            // Initial seed for trends to avoid confusion on first match
            prevRankingRef.current = baseRanking.map(p => p.id);
        }
    }, [completeCount, baseRanking]);

    // 4. Final Enrich Ranking with Trend Data
    const ranking: RankedPlayer[] = useMemo(() => {
        return baseRanking.map(p => ({
            ...p,
            trend: trends[p.id] || 'same'
        })) as RankedPlayer[];
    }, [baseRanking, trends]);

    return { ranking, playerStats };
}
