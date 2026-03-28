export interface Player {
  id: string;
  name: string;
  group: string;
  times: [string, string]; // [start, end] e.g., ["19:00", "22:00"]
  isGuest?: boolean;
  birthdate?: string;
  age?: number;
  mbti?: string;
  achievements?: boolean;
}

export interface Match {
  id: string;
  group: string;
  round: number;
  court: number;
  team1: string[];
  team2: string[];
  score1: number;
  score2: number;
  status: 'pending' | 'complete';
  playerIds: string[];
}

export function generateKdkMatches(
  players: Player[],
  groupCourtMap: Record<string, number[]>,
  targetMatches: number = 4,
  concept: string = "랜덤 KDK",
  fixedPartners: [string, string][] = [], 
  fixedTeamMode: boolean = false,
  existingMatches: Match[] = [] // History for fair rest/redistribution
): Match[] {
  const allMatches: Match[] = [...existingMatches];
  
  // Calculate historical stats from existing matches
  const matchCounts: Record<string, number> = {};
  const restCounts: Record<string, number> = {};
  const partnerHistory: Record<string, Set<string>> = {};

  players.forEach((p) => {
    matchCounts[p.id] = 0;
    restCounts[p.id] = 0;
    partnerHistory[p.id] = new Set();
  });

  existingMatches.forEach(m => {
    (m.playerIds || []).forEach((pid: string, idx: number) => {
      if (matchCounts[pid] !== undefined) matchCounts[pid]++;
      // Partner history
      const teamIdx = idx < 2 ? 0 : 1;
      const partnerIdx = teamIdx === 0 ? (idx === 0 ? 1 : 0) : (idx === 2 ? 3 : 2);
      const partnerId = m.playerIds[partnerIdx];
      if (partnerHistory[pid] && partnerId) partnerHistory[pid].add(partnerId);
    });
  });

  const groups: Record<string, Player[]> = {};
  players.forEach((p) => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });

  // PRE-CALCULATE CONCEPT METRICS (e.g. Median Age for OB/YB)
  const calculateMedianAge = (pool: Player[]) => {
      const ages = pool.map(p => Number(p.age || p.birthdate || 0)).filter(a => a > 0).sort((a, b) => a - b);
      if (ages.length === 0) return 35; // Default fallback
      const mid = Math.floor(ages.length / 2);
      return ages.length % 2 !== 0 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2;
  };

  const isOB = (p: Player, median: number) => {
      const pAge = Number(p.age || p.birthdate || 0);
      return pAge >= median;
  };

  Object.entries(groups).forEach(([groupName, groupPlayers]) => {
    const courts = groupCourtMap[groupName] || [];
    if (courts.length === 0 || groupPlayers.length < 4) return;

    // Concept flags
    const isAgeMatch = concept === 'AGE';
    const isAwardMatch = concept === 'AWARD';
    const isMBTIMatch = concept === 'MBTI';
    
    // Dynamic Median for this group
    const groupMedianAge = calculateMedianAge(groupPlayers);

    const lastRound = existingMatches.reduce((max, m) => Math.max(max, m.round || 0), 0);
    const startTime = "18:00";
    const durationArr = 25; 

    for (let r = lastRound + 1; r <= 30; r++) {
      const minutes = (r - 1) * durationArr;
      const roundTime = addMinutesToTime(startTime, minutes);

      const available = groupPlayers.filter((p) => {
        const [start, end] = p.times;
        return roundTime >= start && roundTime < end && matchCounts[p.id] < targetMatches;
      });

      if (available.length < 4) continue;

      // PRIORITY for scheduling
      available.sort((a, b) => {
        if (r <= 4) {
          const a1830 = a.times[0] === "18:30";
          const b1830 = b.times[0] === "18:30";
          if (a1830 && !b1830) return -1;
          if (!a1830 && b1830) return 1;
        }
        if (matchCounts[a.id] !== matchCounts[b.id]) return matchCounts[a.id] - matchCounts[b.id];
        return restCounts[b.id] - restCounts[a.id];
      });

      const usedInRound = new Set<string>();

      for (const courtNum of courts) {
        const currentPool = available.filter((p) => !usedInRound.has(p.id));
        if (currentPool.length < 4) break;

        let p1: Player, p2: Player, p3: Player, p4: Player;

        // --- PARTNER SELECTION LOGIC ---
        // 1. Fixed Team Mode (All Rounds)
        // 2. Event Fixed (Round 1 Only)
        // 3. Concept/History Based (Standard KDK)

        const tryPickFixed = (round: number, pool: Player[]) => {
            for (const [idA, idB] of fixedPartners) {
                const indexA = pool.findIndex(p => p.id === idA);
                const indexB = pool.findIndex(p => p.id === idB);
                if (indexA !== -1 && indexB !== -1) {
                    // Strictly Round 1 for "Event Fixed", or any round for "Team Mode"
                    if (fixedTeamMode || round === 1) {
                        return [pool[indexA], pool[indexB]];
                    }
                }
            }
            return null;
        };

        const fixedPair = tryPickFixed(r, currentPool);
        if (fixedPair) {
            [p1, p2] = fixedPair;
        } else {
            p1 = currentPool[0];
            const partnerPool = currentPool.filter(p => p.id !== p1.id);
            // Concept filter for partner
            if (isAwardMatch) {
                // Partner Balancing: Winner + Non-Winner
                p2 = partnerPool.find(p => p.achievements !== p1.achievements && !partnerHistory[p1.id].has(p.id)) || 
                     partnerPool.find(p => !partnerHistory[p1.id].has(p.id)) || 
                     partnerPool[0];
            } else if (isMBTIMatch && p1.mbti) {
                const p1Type = p1.mbti[0]; // E or I
                p2 = partnerPool.find(p => p.mbti && p.mbti[0] !== p1Type && !partnerHistory[p1.id].has(p.id)) || 
                     partnerPool.find(p => !partnerHistory[p1.id].has(p.id)) || 
                     partnerPool[0];
            } else {
                p2 = partnerPool.find(p => !partnerHistory[p1.id].has(p.id)) || partnerPool[0];
            }
        }

        const remaining = currentPool.filter(p => p.id !== p1.id && p.id !== p2.id);
        if (remaining.length < 2) break;

        // Pick Opponents (Same fixed logic for Team 2)
        const fixedOppPair = tryPickFixed(r, remaining);
        if (fixedOppPair) {
            [p3, p4] = fixedOppPair;
        } else {
            if (isAgeMatch) {
                // Opponent Balancing: OB vs YB (Older Team vs Younger Team)
                const p1p2OB = isOB(p1, groupMedianAge) || isOB(p2!, groupMedianAge);
                const oppositePool = remaining.filter(p => isOB(p, groupMedianAge) !== p1p2OB);
                if (oppositePool.length >= 2) {
                    p3 = oppositePool[0];
                    p4 = oppositePool[1];
                } else {
                    p3 = remaining[0];
                    p4 = remaining[1];
                }
            } else {
                p3 = remaining[0];
                p4 = remaining[1];
            }
        }

        // Update records
        [p1, p2, p3, p4].forEach(p => {
          matchCounts[p.id]++;
          usedInRound.add(p.id);
        });

        partnerHistory[p1.id].add(p2.id);
        partnerHistory[p2.id].add(p1.id);
        partnerHistory[p3.id].add(p4.id);
        partnerHistory[p4.id].add(p3.id);

        allMatches.push({
          id: `match-${r}-${courtNum}-${Math.random().toString(36).substr(2, 5)}`,
          group: groupName,
          round: r,
          court: courtNum,
          team1: [p1.name, p2.name],
          team2: [p3.name, p4.name],
          score1: 0,
          score2: 0,
          status: 'pending',
          playerIds: [p1.id, p2.id, p3.id, p4.id] // Added IDs back for consistency
        } as any);
      }

      available.forEach((p) => {
        if (!usedInRound.has(p.id)) {
          restCounts[p.id]++;
        }
      });
    }
  });

  return allMatches;
}

function addMinutesToTime(time: string, mins: number) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function isOB(p: Player) {
  if (!p.birthdate) return false;
  const year = parseInt(p.birthdate.split('-')[0]);
  return year <= 1985; // Example OB threshold
}

export interface PlayerStats {
  name: string;
  wins: number;
  losses: number;
  ptsDiff: number;
  matches: number;
  rank: number;
  isGuest?: boolean;
  birthdate?: string;
}

export function calculateRankings(matches: Match[], players: Player[]): PlayerStats[] {
  const stats: Record<string, PlayerStats> = {};

  players.forEach(p => {
    stats[p.name] = {
      name: p.name,
      wins: 0,
      losses: 0,
      ptsDiff: 0,
      matches: 0,
      rank: 0,
      isGuest: p.isGuest,
      birthdate: p.birthdate
    };
  });

  matches.forEach(m => {
    if (m.status === 'complete') {
      const s1 = m.score1;
      const s2 = m.score2;
      const t1 = m.team1;
      const t2 = m.team2;

      const diff = Math.abs(s1 - s2);
      const winners = s1 > s2 ? t1 : t2;
      const losers = s1 > s2 ? t2 : t1;

      winners.forEach(p => {
        if (stats[p]) {
          stats[p].wins++;
          stats[p].ptsDiff += diff;
          stats[p].matches++;
        }
      });

      losers.forEach(p => {
        if (stats[p]) {
          stats[p].losses++;
          stats[p].ptsDiff -= diff;
          stats[p].matches++;
        }
      });
    }
  });

  const results = Object.values(stats);
  
  // Sort: Wins (desc) > PtsDiff (desc) > Birthdate (desc, younger first if logic implies)
  results.sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (a.ptsDiff !== b.ptsDiff) return b.ptsDiff - a.ptsDiff;
    return (b.birthdate || '').localeCompare(a.birthdate || '');
  });

  results.forEach((s, i) => {
    s.rank = i + 1;
  });

  return results;
}

export interface Settlement {
  name: string;
  amount: number;
  type: 'reward' | 'penalty' | 'none';
  note: string;
}

export function calculateSettlements(rankings: PlayerStats[]): Settlement[] {
  const settlements: Settlement[] = [];
  const totalPlayers = rankings.length;
  if (totalPlayers === 0) return [];

  // Logic: 
  // 1st place: +10,000 (Reward)
  // Bottom 25% or Last 25%: -3000 or -5000 (Penalty)
  // For demo, we'll use standard Teyeon rules.

  rankings.forEach((player, index) => {
    let amount = 0;
    let type: 'reward' | 'penalty' | 'none' = 'none';
    let note = "";

    if (player.rank === 1) {
      amount = 10000;
      type = 'reward';
      note = "👑 우승 상금";
    } else if (player.rank >= Math.ceil(totalPlayers * 0.75)) {
      amount = -5000;
      type = 'penalty';
      note = "❗ 하위 벌금";
    }

    settlements.push({
      name: player.name,
      amount,
      type,
      note
    });
  });

  return settlements;
}
