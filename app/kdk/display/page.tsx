'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Match, Member } from '@/lib/tournament_types';

const CLUB_ID = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';

type RealtimeStatus = 'IDLE' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | string;
type RankingEntry = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
};
type PlayerLookup = Record<string, { name: string; isGuest: boolean }>;

const formatClock = () => {
  return new Date().toLocaleTimeString('ko-KR', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
};

const sortMatches = (a: Match, b: Match) => {
  if ((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0);
  if ((a.court || 99) !== (b.court || 99)) return (a.court || 99) - (b.court || 99);
  return String(a.id).localeCompare(String(b.id));
};

function mapMatch(row: any): Match {
  return {
    id: String(row.id),
    playerIds: row.player_ids || row.playerIds || [],
    playerNames: row.player_names || row.playerNames || [],
    court: row.court ?? null,
    status: row.status || 'waiting',
    score1: row.score1,
    score2: row.score2,
    mode: row.mode || 'KDK',
    round: row.round,
    teams: row.teams,
    groupName: row.group_name || row.groupName || 'A',
  };
}

function isLikelyId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^[a-z0-9-]{18,}$/i.test(value);
}

function cleanPlayerName(value?: string) {
  return String(value || '').trim().replace(' (G)', ' G').replace(' g', ' G');
}

function playerName(match: Match, index: number, playerLookup: PlayerLookup) {
  const playerId = match.playerIds?.[index] || '';
  const lookup = playerId ? playerLookup[playerId] : null;
  if (lookup?.name) return lookup.isGuest ? `${lookup.name} G` : lookup.name;

  const storedName = cleanPlayerName(match.playerNames?.[index] || match.player_names?.[index]);
  if (storedName && storedName !== playerId && !isLikelyId(storedName)) return storedName;

  const teamIndex = index < 2 ? 0 : 1;
  const teamPlayerIndex = index < 2 ? index : index - 2;
  const teamName = cleanPlayerName(match.teams?.[teamIndex]?.[teamPlayerIndex]);
  if (teamName && teamName !== playerId && !isLikelyId(teamName)) return teamName;

  if (playerId?.startsWith('g-')) return storedName && !isLikelyId(storedName) ? `${storedName} G` : 'Guest';
  if (playerId && !isLikelyId(playerId)) return cleanPlayerName(playerId);
  return 'Name loading';
}

function teamLabel(match: Match, startIndex: number, playerLookup: PlayerLookup) {
  return `${playerName(match, startIndex, playerLookup)} / ${playerName(match, startIndex + 1, playerLookup)}`;
}

function teamPlayers(match: Match, startIndex: number, playerLookup: PlayerLookup) {
  return [
    playerName(match, startIndex, playerLookup),
    playerName(match, startIndex + 1, playerLookup),
  ];
}

function calculateLiveRanking(completedMatches: Match[], playerLookup: PlayerLookup): RankingEntry[] {
  const rankingMap = new Map<string, RankingEntry>();

  const ensurePlayer = (id: string, name: string) => {
    if (!rankingMap.has(id)) {
      rankingMap.set(id, {
        id,
        name,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        diff: 0,
      });
    }
    const player = rankingMap.get(id)!;
    player.name = name;
    return player;
  };

  completedMatches.forEach((match) => {
    const score1 = Number(match.score1 ?? 0);
    const score2 = Number(match.score2 ?? 0);
    if (score1 === score2) return;

    const team1 = [0, 1]
      .map((index) => ({ id: match.playerIds?.[index] || `${match.id}-${index}`, name: playerName(match, index, playerLookup) }))
      .filter((player) => player.name && player.name !== '-');
    const team2 = [2, 3]
      .map((index) => ({ id: match.playerIds?.[index] || `${match.id}-${index}`, name: playerName(match, index, playerLookup) }))
      .filter((player) => player.name && player.name !== '-');
    const team1Won = score1 > score2;

    team1.forEach(({ id, name }) => {
      const player = ensurePlayer(id, name);
      player.wins += team1Won ? 1 : 0;
      player.losses += team1Won ? 0 : 1;
      player.pointsFor += score1;
      player.pointsAgainst += score2;
      player.diff = player.pointsFor - player.pointsAgainst;
    });

    team2.forEach(({ id, name }) => {
      const player = ensurePlayer(id, name);
      player.wins += team1Won ? 0 : 1;
      player.losses += team1Won ? 1 : 0;
      player.pointsFor += score2;
      player.pointsAgainst += score1;
      player.diff = player.pointsFor - player.pointsAgainst;
    });
  });

  return Array.from(rankingMap.values()).sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.diff !== a.diff) return b.diff - a.diff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.name.localeCompare(b.name);
  });
}

function CourtCard({ court, match, playerLookup }: { court: number; match?: Match; playerLookup: PlayerLookup }) {
  const groupName = match?.groupName || match?.group || 'A';
  const teamA = match ? teamPlayers(match, 0, playerLookup) : [];
  const teamB = match ? teamPlayers(match, 2, playerLookup) : [];

  return (
    <section className={`group relative min-h-0 overflow-hidden rounded-[20px] border bg-[#090908] ${
      match
        ? 'border-red-500/82 shadow-[0_0_0_1px_rgba(255,214,107,0.22),0_0_34px_rgba(239,68,68,0.36),0_18px_48px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.055)]'
        : 'border-[#D8BE78]/46 shadow-[0_0_0_1px_rgba(216,190,120,0.14),0_18px_40px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.04)]'
    }`}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.085),transparent_30%,rgba(216,190,120,0.07)),radial-gradient(circle_at_50%_100%,rgba(216,190,120,0.18),transparent_38%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(118deg,transparent_0%,transparent_46%,rgba(255,214,107,0.08)_48%,transparent_52%)]" />
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/62 to-transparent" />
      {match && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-[4px] bg-gradient-to-r from-red-600 via-[#FFE6A3] to-red-600 shadow-[0_0_28px_rgba(239,68,68,1)]" />
          <div className="absolute inset-x-12 bottom-1 h-10 bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.34),transparent_70%)]" />
          <div className="absolute bottom-0 left-0 h-20 w-20 bg-[radial-gradient(circle_at_0%_100%,rgba(239,68,68,0.38),transparent_72%)]" />
          <div className="absolute bottom-0 right-0 h-20 w-20 bg-[radial-gradient(circle_at_100%_100%,rgba(239,68,68,0.3),transparent_72%)]" />
          <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-red-400/72 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-red-400/56 to-transparent" />
        </>
      )}
      <div className="absolute -bottom-7 left-9 right-9 h-24 border-x border-t border-[#D8BE78]/28 opacity-85" />
      <div className="absolute bottom-7 left-1/2 h-16 w-px -translate-x-1/2 bg-[#D8BE78]/34" />
      <div className="absolute bottom-7 left-[18%] right-[18%] h-px bg-[#D8BE78]/34" />
      <div className="absolute bottom-12 left-[16%] right-[16%] h-px bg-[#D8BE78]/18" />
      <div className="absolute bottom-[54px] left-[16%] right-[16%] h-px bg-[#D8BE78]/10" />

      <div className="relative flex h-full min-h-0 flex-col p-3 2xl:p-3.5">
        <div className={`absolute right-5 top-5 z-20 rounded-[14px] border px-4 py-2.5 text-[13px] font-black uppercase tracking-[0.16em] ${
          match
            ? 'border-red-400/82 bg-red-500/22 text-red-50 shadow-[0_0_20px_rgba(239,68,68,0.58),inset_0_1px_0_rgba(255,255,255,0.14)]'
            : 'border-emerald-400/62 bg-emerald-500/14 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.22),inset_0_1px_0_rgba(255,255,255,0.1)]'
        }`}>
          {match ? 'LIVE' : 'READY'}
        </div>
        <div className="flex items-start justify-between gap-3 border-b border-[#D8BE78]/18 pb-1.5 pr-28">
          <div className="flex items-end gap-3">
            <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white/82">Court</span>
            <span className="text-[38px] font-black leading-[0.8] text-[#FFD66B] drop-shadow-[0_0_16px_rgba(255,214,107,0.36)]">{court}</span>
          </div>
        </div>

        {match ? (
          <div className="relative flex min-h-0 flex-1 flex-col justify-center pt-0">
            <div className="-mt-2 mb-4 flex items-center justify-center gap-3">
              <span className="rounded-lg border border-[#D8BE78]/32 bg-[#D8BE78]/20 px-4 py-1.5 text-[18px] font-black uppercase tracking-[0.08em] text-[#FFD66B] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                Round {match.round || '-'}
              </span>
              <span className="rounded-lg border border-white/12 bg-white/[0.08] px-4 py-1.5 text-[18px] font-black uppercase tracking-[0.08em] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                Group {groupName}
              </span>
            </div>

            <div className="relative rounded-[18px] border border-[#D8BE78]/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.085),rgba(216,190,120,0.04)_42%,rgba(0,0,0,0.22))] p-3 shadow-[0_14px_28px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(216,190,120,0.09)]">
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/58 to-transparent" />
              <div className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-4">
                <div className="flex min-h-[68px] flex-col justify-center rounded-[14px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.11),rgba(216,190,120,0.055)_54%,rgba(0,0,0,0.26))] px-3 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-10px_24px_rgba(0,0,0,0.16)]">
                  {teamA.map((name, index) => (
                    <p key={index} className="break-keep text-[clamp(19px,1.65vw,31px)] font-black leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.78)] [overflow-wrap:anywhere]">
                      {name}
                    </p>
                  ))}
                </div>
                <div className="flex h-12 w-12 items-center justify-center justify-self-center rounded-full border border-[#FFD66B]/70 bg-black/88 text-[13px] font-black text-[#FFD66B] shadow-[0_0_18px_rgba(216,190,120,0.44),inset_0_0_14px_rgba(216,190,120,0.18)]">
                  VS
                </div>
                <div className="flex min-h-[68px] flex-col justify-center rounded-[14px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.11),rgba(216,190,120,0.055)_54%,rgba(0,0,0,0.26))] px-3 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-10px_24px_rgba(0,0,0,0.16)]">
                  {teamB.map((name, index) => (
                    <p key={index} className="break-keep text-[clamp(19px,1.65vw,31px)] font-black leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.78)] [overflow-wrap:anywhere]">
                      {name}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative mx-auto mt-2 flex min-w-[250px] items-center justify-center gap-5 rounded-[20px] border border-[#FFD66B]/16 bg-[linear-gradient(180deg,rgba(255,214,107,0.08),rgba(0,0,0,0.24))] px-8 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(0,0,0,0.2)]">
              <div className="absolute inset-x-8 bottom-0 h-px bg-gradient-to-r from-transparent via-red-400/58 to-transparent" />
              <span className="text-[clamp(56px,4.8vw,84px)] font-black leading-none text-[#FFF4C8] drop-shadow-[0_0_34px_rgba(255,214,107,0.9)]">
                {match.score1 ?? 1}
              </span>
              <span className="text-[clamp(42px,3.6vw,62px)] font-black leading-none text-[#FFD66B] drop-shadow-[0_0_28px_rgba(255,214,107,0.72)]">
                :
              </span>
              <span className="text-[clamp(56px,4.8vw,84px)] font-black leading-none text-[#FFF4C8] drop-shadow-[0_0_34px_rgba(255,214,107,0.9)]">
                {match.score2 ?? 1}
              </span>
            </div>
          </div>
        ) : (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
            <div className="relative h-7 w-11">
              <span className="absolute left-4 top-0 h-8 w-1 -rotate-45 rounded-full bg-[#EAD8A2]/62 shadow-[0_0_16px_rgba(216,190,120,0.25)]" />
              <span className="absolute right-4 top-0 h-8 w-1 rotate-45 rounded-full bg-[#EAD8A2]/62 shadow-[0_0_16px_rgba(216,190,120,0.25)]" />
            </div>
            <p className="text-[clamp(28px,2.45vw,42px)] font-black uppercase tracking-[0.15em] text-[#F1DC9C] drop-shadow-[0_0_24px_rgba(216,190,120,0.36)]">Standby</p>
            <div className="h-px w-56 bg-gradient-to-r from-transparent via-[#FFD66B]/72 to-transparent shadow-[0_0_18px_rgba(255,214,107,0.42)]" />
            <p className="rounded-full border border-[#D8BE78]/34 bg-black/48 px-8 py-3 text-[18px] font-black uppercase tracking-[0.14em] text-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              Waiting for match
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function CompactMatch({ match, index, playerLookup }: { match: Match; index: number; playerLookup: PlayerLookup }) {
  return (
    <div className="relative min-h-[78px] overflow-hidden rounded-[16px] border border-[#D8BE78]/26 bg-[linear-gradient(135deg,#11110F,rgba(216,190,120,0.065)_55%,#080808)] px-4 py-3.5 shadow-[0_9px_20px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.085)]">
      <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/66 to-transparent" />
      <div className="absolute inset-y-3 left-0 w-px bg-gradient-to-b from-transparent via-[#FFD66B]/28 to-transparent" />
      <div className="grid grid-cols-[40px_minmax(0,1fr)_44px_minmax(0,1fr)] items-center gap-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-[#D8BE78]/32 bg-[#D8BE78]/13 text-[13px] font-black text-[#FFD66B] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          {String(index + 1).padStart(2, '0')}
        </span>
        <p className="min-w-0 break-keep text-right text-[clamp(14px,0.86vw,17px)] font-black leading-snug text-white [overflow-wrap:anywhere]">{teamLabel(match, 0, playerLookup)}</p>
        <span className="flex h-8 w-8 items-center justify-center justify-self-center rounded-full border border-[#D8BE78]/38 bg-black/76 text-[9px] font-black text-[#FFD66B]">
          VS
        </span>
        <p className="min-w-0 break-keep text-[clamp(14px,0.86vw,17px)] font-black leading-snug text-white/90 [overflow-wrap:anywhere]">{teamLabel(match, 2, playerLookup)}</p>
      </div>
      <div className="ml-[54px] mt-2 inline-flex rounded-full border border-[#D8BE78]/16 bg-black/30 px-3 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-white/44">
        R{match.round || '-'} - Group {match.groupName || match.group || 'A'}
      </div>
    </div>
  );
}

function CompletedMiniCard({ match, playerLookup }: { match: Match; playerLookup: PlayerLookup }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[22px] border border-[#D8BE78]/40 bg-[linear-gradient(135deg,#11110F,rgba(216,190,120,0.075)_52%,#080808)] p-5 shadow-[0_16px_34px_rgba(0,0,0,0.36),0_0_22px_rgba(216,190,120,0.1),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-18px_38px_rgba(0,0,0,0.2)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/88 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent via-[#FFD66B]/70 to-transparent shadow-[0_0_18px_rgba(255,214,107,0.4)]" />
      <div className="absolute inset-x-12 bottom-1 h-8 bg-[radial-gradient(ellipse_at_center,rgba(255,214,107,0.12),transparent_72%)]" />
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="rounded-md border border-emerald-300/20 bg-emerald-400/12 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100/82">Done</span>
        <span className="rounded-md border border-[#D8BE78]/16 bg-black/24 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/42">R{match.round || '-'} / G{match.groupName || match.group || 'A'}</span>
      </div>
      <div className="grid min-h-[86px] grid-cols-[minmax(0,1fr)_112px_minmax(0,1fr)] items-stretch gap-3.5">
        <div className="flex min-w-0 items-center rounded-[16px] border border-[#D8BE78]/12 bg-black/28 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="break-keep text-[clamp(12px,0.8vw,16px)] font-black leading-tight text-white [overflow-wrap:anywhere]">{teamLabel(match, 0, playerLookup)}</p>
        </div>
        <span className="flex shrink-0 items-center justify-center rounded-[16px] border border-[#FFD66B]/34 bg-black/46 text-center text-[46px] font-black leading-none text-[#FFF4C8] drop-shadow-[0_0_32px_rgba(255,214,107,0.76)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          {match.score1 ?? 0}:{match.score2 ?? 0}
        </span>
        <div className="flex min-w-0 items-center justify-end rounded-[16px] border border-[#D8BE78]/12 bg-black/28 px-4 py-3 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          <p className="break-keep text-[clamp(12px,0.8vw,16px)] font-black leading-tight text-white/82 [overflow-wrap:anywhere]">{teamLabel(match, 2, playerLookup)}</p>
        </div>
      </div>
    </div>
  );
}

function KdkDisplayBoard() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';
  const [matches, setMatches] = useState<Match[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [sessionTitle, setSessionTitle] = useState('');
  const [clock, setClock] = useState(formatClock);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('IDLE');
  const [resolvedSessionId, setResolvedSessionId] = useState('');

  const fetchMembers = async () => {
    try {
      let query = supabase.from('members').select('*');
      if (CLUB_ID) query = query.eq('club_id', CLUB_ID);

      const { data, error: membersError } = await query;
      if (membersError) throw membersError;

      setMembers(data || []);
      console.log('[KDK Display] members loaded:', { count: data?.length || 0 });
    } catch (err) {
      console.error('[KDK Display] fetchMembers failed:', err);
    }
  };

  const fetchMatches = async (targetSessionId: string) => {
    if (!targetSessionId) {
      setMatches([]);
      setLoading(false);
      setError('Missing session query.');
      setResolvedSessionId('');
      return;
    }

    try {
      setError(null);
      const { data: sessionData, error: sessionError } = await supabase
        .from('matches')
        .select('*')
        .eq('club_id', CLUB_ID)
        .eq('session_id', targetSessionId)
        .order('round', { ascending: true })
        .order('court', { ascending: true });

      if (sessionError) throw sessionError;

      console.log('[KDK Display] fetchMatches by session_id:', {
        targetSessionId,
        count: sessionData?.length || 0,
      });

      let data = sessionData || [];
      let nextResolvedSessionId = data[0]?.session_id || targetSessionId;

      if (data.length === 0) {
        const { data: titleData, error: titleError } = await supabase
          .from('matches')
          .select('*')
          .eq('club_id', CLUB_ID)
          .eq('session_title', targetSessionId)
          .order('round', { ascending: true })
          .order('court', { ascending: true });

        if (titleError) throw titleError;

        console.log('[KDK Display] fetchMatches by session_title:', {
          targetSessionId,
          count: titleData?.length || 0,
          resolvedSessionId: titleData?.[0]?.session_id || '',
        });

        data = titleData || [];
        nextResolvedSessionId = data[0]?.session_id || targetSessionId;
      }

      if (data.length === 0) {
        const message = `No matches found for session "${targetSessionId}". Checked matches.session_id and matches.session_title.`;
        console.warn('[KDK Display] no matches found:', {
          targetSessionId,
          clubId: CLUB_ID,
          checkedColumns: ['session_id', 'session_title'],
        });
        setError(message);
      }

      const nextMatches = data.map(mapMatch).sort(sortMatches);
      setResolvedSessionId(nextResolvedSessionId);
      setMatches(nextMatches);
      setSessionTitle(data?.[0]?.session_title || targetSessionId);
      setLastSync(new Date().toLocaleTimeString('ko-KR', { hour12: false }));
    } catch (err: any) {
      console.error('[KDK Display] fetchMatches failed:', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setClock(formatClock()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    fetchMembers();
  }, []);

  useEffect(() => {
    fetchMatches(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    const realtimeFilter = `club_id=eq.${CLUB_ID}`;
    const activeRealtimeSessionId = resolvedSessionId || sessionId;
    const channel = supabase.channel(`kdk-display-${CLUB_ID}-${sessionId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'matches',
        filter: realtimeFilter,
      }, (payload: any) => {
        const payloadSessionId = payload.new?.session_id || payload.old?.session_id;
        const payloadSessionTitle = payload.new?.session_title || payload.old?.session_title;
        if (payloadSessionId === activeRealtimeSessionId || payloadSessionTitle === sessionId) {
          fetchMatches(activeRealtimeSessionId);
        }
      })
      .subscribe((status) => {
        setRealtimeStatus(status);
        console.log('[KDK Display] Realtime status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, resolvedSessionId]);

  const playingByCourt = useMemo(() => {
    const map = new Map<number, Match>();
    matches
      .filter((match) => match.status === 'playing' && match.court)
      .forEach((match) => {
        if (match.court && match.court >= 1 && match.court <= 4) map.set(match.court, match);
      });
    return map;
  }, [matches]);

  const waitingMatches = useMemo(() => {
    return matches.filter((match) => match.status === 'waiting').sort(sortMatches);
  }, [matches]);

  const completedMatches = useMemo(() => {
    return matches.filter((match) => match.status === 'complete').sort(sortMatches).reverse();
  }, [matches]);

  const playerLookup = useMemo(() => {
    return members.reduce<PlayerLookup>((acc, member: any) => {
      const name = String(member.nickname || member.name || '').trim();
      if (member.id && name) {
        acc[String(member.id)] = {
          name,
          isGuest: member.is_guest === true || member.isGuest === true || String(member.id).startsWith('g-'),
        };
      }
      return acc;
    }, {});
  }, [members]);

  const liveRanking = useMemo(() => calculateLiveRanking(completedMatches, playerLookup), [completedMatches, playerLookup]);
  const playingCount = matches.filter((match) => match.status === 'playing').length;
  const statusLabel = realtimeStatus === 'SUBSCRIBED' ? 'LIVE' : realtimeStatus;

  return (
    <main className="fixed inset-0 z-[9999] overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(216,190,120,0.22),transparent_26%),radial-gradient(circle_at_100%_18%,rgba(239,68,68,0.16),transparent_22%),linear-gradient(135deg,#050505_0%,#11110F_48%,#070707_100%)]" />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(90deg,rgba(216,190,120,0.22)_1px,transparent_1px),linear-gradient(rgba(216,190,120,0.12)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="absolute left-0 right-0 top-[104px] h-px bg-gradient-to-r from-transparent via-[#FFD66B] to-transparent shadow-[0_0_28px_rgba(255,214,107,0.8)]" />
      <div className="absolute right-[16%] top-10 h-24 w-[520px] -rotate-6 bg-[linear-gradient(90deg,transparent,rgba(239,68,68,0.22),rgba(255,214,107,0.2),transparent)] blur-xl" />

      <div className="relative flex h-screen flex-col p-4 2xl:p-5">
        <header className="relative mb-3.5 grid h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-[22px] border border-[#D8BE78]/28 bg-black/60 px-5 shadow-[0_20px_54px_rgba(0,0,0,0.52),0_0_24px_rgba(216,190,120,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(112deg,rgba(216,190,120,0.2),transparent_55%)]" />
          <div className="absolute -right-20 top-0 h-full w-[420px] bg-[linear-gradient(105deg,transparent,rgba(239,68,68,0.28),transparent)]" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/92 to-transparent shadow-[0_0_22px_rgba(255,214,107,0.72)]" />
          <div className="absolute right-[34%] top-0 h-full w-[360px] -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(255,214,107,0.12),rgba(239,68,68,0.1),transparent)]" />
          <div className="flex min-w-0 items-center gap-4">
            <div
              aria-label="TEYEON Tennis logo"
              className="relative h-[62px] w-[198px] shrink-0 overflow-hidden rounded-[16px] border border-white/10 bg-black/65 shadow-[0_0_34px_rgba(216,190,120,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]"
              role="img"
              style={{
                backgroundImage: "url('/logo.png')",
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '216px 216px',
              }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent_34%,rgba(239,68,68,0.08))]" />
            </div>
            <div className="relative min-w-0">
              <p className="text-[13px] font-black uppercase italic tracking-[0.16em] text-[#FFD66B] drop-shadow-[0_0_14px_rgba(255,214,107,0.28)]">TEYEON Live Board</p>
              <h1 className="mt-1 truncate text-[clamp(29px,2.8vw,46px)] font-black uppercase leading-none tracking-[0.02em] text-white [text-shadow:0_0_20px_rgba(255,255,255,0.14)]">
                {sessionTitle || sessionId || 'No Session'}
              </h1>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-[auto_auto_auto] items-center gap-3">
            <div className="text-right">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/34">Time</p>
              <p className="text-[32px] font-black leading-none text-white">{clock}</p>
            </div>
            <div className="flex items-center gap-2.5 rounded-[14px] border border-red-400/90 bg-red-500/24 px-3.5 py-2 text-red-50 shadow-[0_0_32px_rgba(239,68,68,0.72),inset_0_1px_0_rgba(255,255,255,0.14)]">
              <span className="h-3 w-3 rounded-full bg-red-300 shadow-[0_0_20px_rgba(248,113,113,1)]" />
              <span className="text-[20px] font-black uppercase tracking-[0.07em]">{statusLabel}</span>
            </div>
            <div className="rounded-[12px] border border-white/10 bg-white/[0.065] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/52">
              Read Only
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_600px] gap-4">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_248px] gap-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="flex items-center gap-3 text-[21px] font-black uppercase italic tracking-[0.18em] text-[#FFD66B] drop-shadow-[0_0_16px_rgba(255,214,107,0.28)]">
                <span className="h-7 w-1.5 rounded-full bg-[#FFD66B] shadow-[0_0_18px_rgba(255,214,107,0.8)]" />
                Now Playing
              </h2>
              <span className="rounded-full border border-[#D8BE78]/22 bg-[#D8BE78]/8 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.22em] text-white/45">4 Court Live Operation</span>
            </div>

            <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-4">
              {[1, 2, 3, 4].map((court) => (
                <CourtCard key={court} court={court} match={playingByCourt.get(court)} playerLookup={playerLookup} />
              ))}
            </div>

            <section className="relative min-h-0 overflow-hidden rounded-[20px] border border-[#D8BE78]/30 bg-black/58 p-[18px] shadow-[0_18px_42px_rgba(0,0,0,0.44),0_0_22px_rgba(216,190,120,0.08),inset_0_1px_0_rgba(255,255,255,0.075)]">
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/88 to-transparent" />
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase italic tracking-[0.18em] text-[#FFD66B]">
                  <span className="h-5 w-1 rounded-full bg-[#FFD66B]/90 shadow-[0_0_12px_rgba(255,214,107,0.6)]" />
                  Completed Recent
                </h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/34">{completedMatches.length} done</span>
              </div>
              {completedMatches.length > 0 ? (
                <div className="grid grid-cols-3 gap-4">
                  {completedMatches.slice(0, 3).map((match) => (
                    <CompletedMiniCard key={match.id} match={match} playerLookup={playerLookup} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#D8BE78]/18 bg-white/[0.025] py-9 text-center text-[13px] font-black uppercase tracking-[0.22em] text-white/38">
                  No Results Yet
                </div>
              )}
            </section>
          </div>

          <aside className="relative grid min-h-0 grid-rows-[136px_minmax(0,1fr)_350px] gap-3.5">
            <div className="pointer-events-none absolute -left-5 bottom-2 top-2 w-10 rounded-full bg-[linear-gradient(90deg,transparent,rgba(216,190,120,0.065),transparent)] blur-md" />
            <section className="relative overflow-hidden rounded-[20px] border border-[#D8BE78]/22 bg-black/58 p-4 shadow-[0_16px_38px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/62 to-transparent" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[18px] font-black uppercase italic tracking-[0.14em] text-[#FFD66B]">
                  <span className="h-5 w-1 rounded-full bg-red-400 shadow-[0_0_14px_rgba(239,68,68,0.8)]" />
                  Live Status
                </h2>
                <span className="rounded-full border border-red-400/35 bg-red-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-100">{statusLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-3.5">
                <div className="flex h-[78px] flex-col items-center justify-center rounded-[16px] border border-red-400/45 bg-red-500/14 text-center shadow-[0_0_18px_rgba(239,68,68,0.16),inset_0_1px_0_rgba(255,255,255,0.09)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-red-100/76">Playing</p>
                  <p className="mt-1 text-[38px] font-black leading-none text-red-50 drop-shadow-[0_0_16px_rgba(248,113,113,0.35)]">{playingCount}</p>
                </div>
                <div className="flex h-[78px] flex-col items-center justify-center rounded-[16px] border border-[#D8BE78]/40 bg-[#D8BE78]/13 text-center shadow-[0_0_18px_rgba(216,190,120,0.13),inset_0_1px_0_rgba(255,255,255,0.09)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#FFD66B]/76">Waiting</p>
                  <p className="mt-1 text-[38px] font-black leading-none text-[#FFF0BF] drop-shadow-[0_0_16px_rgba(255,214,107,0.28)]">{waitingMatches.length}</p>
                </div>
                <div className="flex h-[78px] flex-col items-center justify-center rounded-[16px] border border-emerald-400/34 bg-emerald-500/11 text-center shadow-[0_0_18px_rgba(16,185,129,0.1),inset_0_1px_0_rgba(255,255,255,0.09)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100/62">Done</p>
                  <p className="mt-1 text-[38px] font-black leading-none text-white/90">{completedMatches.length}</p>
                </div>
              </div>
            </section>

            <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[20px] border border-[#D8BE78]/22 bg-black/58 p-4 shadow-[0_16px_38px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/62 to-transparent" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[18px] font-black uppercase italic tracking-[0.14em] text-[#FFD66B]">
                  <span className="h-5 w-1 rounded-full bg-[#FFD66B]/90 shadow-[0_0_12px_rgba(255,214,107,0.62)]" />
                  Up Next
                </h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/36">{waitingMatches.length} queued</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-hidden">
                {waitingMatches.slice(0, 5).map((match, index) => (
                  <CompactMatch key={match.id} match={match} index={index} playerLookup={playerLookup} />
                ))}
                {!loading && waitingMatches.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-[#D8BE78]/18 bg-white/[0.025] py-12 text-center text-[13px] font-black uppercase tracking-[0.22em] text-white/38">
                    No Waiting Matches
                  </div>
                )}
              </div>
            </section>

            <section className="relative overflow-hidden rounded-[20px] border border-[#D8BE78]/22 bg-black/58 p-4 shadow-[0_16px_38px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/62 to-transparent" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[17px] font-black uppercase italic tracking-[0.12em] text-[#FFD66B]">
                  <span className="h-5 w-1 rounded-full bg-[#FFD66B]/90 shadow-[0_0_12px_rgba(255,214,107,0.62)]" />
                  Live Ranking Top 5
                </h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/34">W-L / Diff</span>
              </div>
              {liveRanking.length > 0 ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-[44px_minmax(0,1fr)_72px_56px] items-center gap-3 px-4 text-[9px] font-black uppercase tracking-[0.14em] text-white/34">
                    <span className="text-center">Rank</span>
                    <span>Player</span>
                    <span className="text-center">W/L</span>
                    <span className="text-center">Diff</span>
                  </div>
                  {liveRanking.slice(0, 5).map((player, index) => (
                    <div key={player.id} className={`relative grid min-h-[64px] grid-cols-[44px_minmax(0,1fr)_72px_56px] items-center gap-3 overflow-hidden rounded-[14px] border px-4 py-3 ${
                      index === 0
                        ? 'border-[#FFD66B]/36 bg-[#D8BE78]/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : index === 1
                          ? 'border-white/16 bg-white/[0.065] shadow-[inset_0_1px_0_rgba(255,255,255,0.065)]'
                          : index === 2
                            ? 'border-orange-400/22 bg-orange-400/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                            : 'border-white/8 bg-white/[0.045]'
                    }`}>
                      {index < 3 && (
                        <div className={`absolute inset-y-0 left-0 w-1 ${
                          index === 0 ? 'bg-[#FFD66B]' : index === 1 ? 'bg-white/45' : 'bg-orange-400/65'
                        }`} />
                      )}
                      <span className={`flex h-9 w-9 items-center justify-center justify-self-center rounded-md text-[17px] font-black leading-none ${
                        index === 0
                          ? 'bg-[#FFD66B] text-black shadow-[0_0_16px_rgba(255,214,107,0.38)]'
                          : index === 1
                            ? 'bg-white/70 text-black'
                            : index === 2
                              ? 'bg-orange-400/75 text-black'
                              : 'bg-white/10 text-white/58'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="min-w-0 self-center">
                        <p className={`truncate text-[17px] font-black ${index < 3 ? 'text-white' : 'text-white/88'}`}>{player.name}</p>
                        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-white/32">PF {player.pointsFor}</p>
                      </div>
                      <span className="w-full whitespace-nowrap text-center text-[15px] font-black text-white/82">{player.wins}W {player.losses}L</span>
                      <span className={`w-full text-center text-[19px] font-black ${player.diff > 0 ? 'text-emerald-300' : player.diff < 0 ? 'text-red-300' : 'text-white/62'}`}>
                        {player.diff > 0 ? '+' : ''}{player.diff}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-[12px] font-black uppercase tracking-[0.2em] text-white/38">No Ranking Yet</p>
              )}
            </section>
          </aside>
        </section>

        {error && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-2xl border border-red-400/25 bg-red-500/15 px-6 py-4 text-[14px] font-black text-red-100">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

export default function KdkDisplayPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 z-[9999] bg-[#10100F]" />}>
      <KdkDisplayBoard />
    </Suspense>
  );
}
