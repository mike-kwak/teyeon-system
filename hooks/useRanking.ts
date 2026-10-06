'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { Match, Member, AttendeeConfig, RankedPlayer, RankTrend } from '@/lib/tournament_types';
import { normalizeBirthYear, sortOfficialKdkRanking } from '@/lib/kdk/officialRanking';
import { aggregateKdkPlayerStats, EMPTY_KDK_PLAYER_STATS } from '@/lib/kdk/aggregate';

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
    //    ⚠ 집계식은 lib/kdk/aggregate.ts(SSoT)로 추출됐다 — 계산 결과는 과거와 동일하다.
    //      LIVE KDK · Special Match · Archive 정정이 같은 함수를 쓴다.
    const playerStatsData = useMemo(() => aggregateKdkPlayerStats(matches), [matches]);

    const playerStats = playerStatsData.stats;
    const nameLookup = playerStatsData.nameLookup;

    // 2. Compute Base Ranking (Primary logic for sorting)
    const baseRanking = useMemo(() => {
        const participantIds = (selectedIds?.size > 0)
            ? Array.from(selectedIds)
            : Array.from(new Set((matches || []).flatMap(m => m?.playerIds || [])));

        const mapped = participantIds.map(id => {
            const m = (allMembers || []).find(x => x?.id === id) || (tempGuests || []).find(x => x?.id === id);
            const resolvedName = m?.nickname || nameLookup[id] || id;

            const conf = attendeeConfigs?.[id] || { name: resolvedName, group: 'A', is_guest: m?.is_guest, age: m?.age || 99 };
            // 출생연도 우선순위: ① attendeeConfigs.birthYear(신규 명시 필드 — 게스트 입력/세션 snapshot)
            // ② conf.age / member.age (레거시 — 4자리 연도 형식일 때만 인정, 만 나이 숫자는 무시)
            // ③ members."나이"(4자리 연도 텍스트 — 회원 실데이터 소스)
            const birthYear =
                normalizeBirthYear((conf as any)?.birthYear) ??
                normalizeBirthYear(conf?.age) ??
                normalizeBirthYear(m?.age) ??
                normalizeBirthYear((m as any)?.['나이']);
            // 출생연도 확보 상태 — 순위 비교에는 쓰지 않고, 공식 확정 화면의 '미해결 참가자' 판별에만 쓴다.
            // 값이 확인되면 상태 기록 여부와 무관하게 provided(정상 비교).
            const birthYearStatus: 'provided' | 'declined' | undefined =
                birthYear !== null ? 'provided'
                    : (conf as any)?.birthYearStatus === 'declined' ? 'declined'
                        : undefined;
            return {
                id,
                playerId: id,
                name: resolvedName,
                is_guest: m?.is_guest || conf?.is_guest,
                avatar: m?.avatar_url || '',
                group: conf?.group || 'A',
                age: conf.age || m?.age || 99,
                birthYear,
                birthYearStatus,
                ...(playerStats?.[id] || EMPTY_KDK_PLAYER_STATS)
            };
        });
        // 공식 comparator 단일 사용 — 승수 → 득실 → 연장자(출생연도 작은 값 우선, 미제공 후순위) → 이름 → id.
        return sortOfficialKdkRanking(mapped);
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
