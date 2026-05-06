'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Match } from '@/lib/tournament_types';

const CLUB_ID = process.env.NEXT_PUBLIC_CLUB_ID || '512d047d-a076-4080-97e5-6bb5a2c07819';

type RealtimeStatus = 'IDLE' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' | string;
type RankingEntry = {
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
};

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

function playerName(match: Match, index: number) {
  const raw = match.playerNames?.[index] || match.player_names?.[index] || match.playerIds?.[index] || '-';
  return String(raw).replace(' (G)', ' G').replace(' g', ' G');
}

function teamLabel(match: Match, startIndex: number) {
  return `${playerName(match, startIndex)} / ${playerName(match, startIndex + 1)}`;
}

function calculateLiveRanking(completedMatches: Match[]): RankingEntry[] {
  const rankingMap = new Map<string, RankingEntry>();

  const ensurePlayer = (name: string) => {
    if (!rankingMap.has(name)) {
      rankingMap.set(name, {
        name,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        diff: 0,
      });
    }
    return rankingMap.get(name)!;
  };

  completedMatches.forEach((match) => {
    const score1 = Number(match.score1 ?? 0);
    const score2 = Number(match.score2 ?? 0);
    if (score1 === score2) return;

    const team1 = [playerName(match, 0), playerName(match, 1)].filter((name) => name && name !== '-');
    const team2 = [playerName(match, 2), playerName(match, 3)].filter((name) => name && name !== '-');
    const team1Won = score1 > score2;

    team1.forEach((name) => {
      const player = ensurePlayer(name);
      player.wins += team1Won ? 1 : 0;
      player.losses += team1Won ? 0 : 1;
      player.pointsFor += score1;
      player.pointsAgainst += score2;
      player.diff = player.pointsFor - player.pointsAgainst;
    });

    team2.forEach((name) => {
      const player = ensurePlayer(name);
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

function CourtCard({ court, match }: { court: number; match?: Match }) {
  const groupName = match?.groupName || match?.group || 'A';

  return (
    <section className="relative min-h-0 overflow-hidden rounded-[20px] border border-[#D8BE78]/25 bg-[#181817] shadow-[0_16px_34px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-[#D8BE78] to-transparent" />
      <div className="flex h-full min-h-0 flex-col p-3.5 2xl:p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#D8BE78]/70">Court</p>
            <h2 className="text-[32px] font-black leading-none tracking-tight text-[#F4E7BD] 2xl:text-[38px]">{court}</h2>
          </div>
          <div className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] ${
            match ? 'border-red-400/35 bg-red-500/15 text-red-200' : 'border-white/10 bg-white/5 text-white/35'
          }`}>
            {match ? 'LIVE' : 'READY'}
          </div>
        </div>

        {match ? (
          <div className="mt-1.5 flex min-h-0 flex-1 flex-col justify-center">
            <div className="mb-2.5 flex items-center justify-center gap-3">
              <span className="rounded-full bg-[#D8BE78]/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#D8BE78]">
                Round {match.round || '-'}
              </span>
              <span className="rounded-full bg-white/7 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/55">
                Group {groupName}
              </span>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <div className="rounded-[16px] border border-white/10 bg-white/[0.06] p-2.5 text-center">
                <p className="text-[clamp(18px,1.7vw,28px)] font-black leading-tight text-white">
                  {teamLabel(match, 0)}
                </p>
              </div>
              <div className="text-[13px] font-black uppercase tracking-[0.22em] text-[#D8BE78]/70">vs</div>
              <div className="rounded-[16px] border border-white/10 bg-white/[0.06] p-2.5 text-center">
                <p className="text-[clamp(18px,1.7vw,28px)] font-black leading-tight text-white">
                  {teamLabel(match, 2)}
                </p>
              </div>
            </div>

            <div className="mt-3 text-center">
              <span className="text-[clamp(32px,3vw,46px)] font-black leading-none tracking-tight text-[#D8BE78]">
                {match.score1 ?? 1}:{match.score2 ?? 1}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[18px] font-black uppercase tracking-[0.24em] text-white/35">Waiting</p>
          </div>
        )}
      </div>
    </section>
  );
}

function CompactMatch({ match, index }: { match: Match; index: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.05] p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-[#D8BE78]/75">
          #{index + 1} R{match.round || '-'}
        </span>
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
          {match.groupName || match.group || 'A'}
        </span>
      </div>
      <p className="truncate text-[14px] font-black text-white">{teamLabel(match, 0)}</p>
      <p className="mt-1 truncate text-[14px] font-black text-white/80">{teamLabel(match, 2)}</p>
    </div>
  );
}

function CompletedMiniCard({ match }: { match: Match }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.05] p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#D8BE78]/70">R{match.round || '-'}</span>
        <span className="shrink-0 text-[22px] font-black leading-none text-[#D8BE78]">{match.score1 ?? 0}:{match.score2 ?? 0}</span>
      </div>
      <p className="truncate text-[12px] font-black text-white/75">{teamLabel(match, 0)}</p>
      <p className="mt-1 truncate text-[12px] font-black text-white/45">{teamLabel(match, 2)}</p>
    </div>
  );
}

function KdkDisplayBoard() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session') || '';
  const [matches, setMatches] = useState<Match[]>([]);
  const [sessionTitle, setSessionTitle] = useState('');
  const [clock, setClock] = useState(formatClock);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('IDLE');
  const [resolvedSessionId, setResolvedSessionId] = useState('');

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

  const liveRanking = useMemo(() => calculateLiveRanking(completedMatches), [completedMatches]);
  const playingCount = matches.filter((match) => match.status === 'playing').length;
  const statusLabel = realtimeStatus === 'SUBSCRIBED' ? 'LIVE' : realtimeStatus;

  return (
    <main className="fixed inset-0 z-[9999] overflow-hidden bg-[#10100F] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(216,190,120,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_28%)]" />
      <div className="relative flex h-screen flex-col p-5 2xl:p-6">
        <header className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-[#D8BE78]/18 pb-3">
          <div className="min-w-0 pr-8">
            <p className="text-[12px] font-black uppercase tracking-[0.38em] text-[#D8BE78]/75">TEYEON Live Board</p>
            <h1 className="mt-1 truncate text-[clamp(28px,2.4vw,40px)] font-black uppercase leading-none tracking-tight text-[#F4E7BD]">
              {sessionTitle || sessionId || 'No Session'}
            </h1>
          </div>
          <div className="grid shrink-0 grid-cols-[auto_auto_auto] items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2">
              <p className="text-[9px] font-black uppercase tracking-[0.24em] text-white/40">Time</p>
              <p className="text-[24px] font-black leading-none text-white">{clock}</p>
            </div>
            <div className="rounded-2xl border border-red-400/25 bg-red-500/12 px-4 py-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-[0_0_18px_rgba(248,113,113,0.9)]" />
                <span className="text-[16px] font-black uppercase tracking-[0.18em] text-red-100">{statusLabel}</span>
              </div>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.15em] text-white/35">Sync {lastSync || '--:--:--'}</p>
            </div>
            <div className="rounded-full border border-[#D8BE78]/20 bg-[#D8BE78]/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-[#F4E7BD]/75">
              Read Only
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-5">
          <div className="grid min-h-0 grid-rows-[auto_52vh_minmax(190px,1fr)] gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-black uppercase tracking-[0.26em] text-[#F4E7BD]">Now Playing</h2>
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">4 Court Live Operation</span>
            </div>

            <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-4">
              {[1, 2, 3, 4].map((court) => (
                <CourtCard key={court} court={court} match={playingByCourt.get(court)} />
              ))}
            </div>

            <section className="min-h-0 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[14px] font-black uppercase tracking-[0.22em] text-white/70">Completed Recent</h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">{completedMatches.length} done</span>
              </div>
              {completedMatches.length > 0 ? (
                <div className="grid grid-cols-4 gap-3">
                  {completedMatches.slice(0, 4).map((match) => (
                    <CompletedMiniCard key={match.id} match={match} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-[13px] font-black uppercase tracking-[0.22em] text-white/35">
                  No Results Yet
                </div>
              )}
            </section>
          </div>

          <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_minmax(260px,auto)] gap-4">
            <section className="rounded-[24px] border border-[#D8BE78]/14 bg-[#181817]/95 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.32)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[15px] font-black uppercase tracking-[0.22em] text-[#F4E7BD]">Live Status</h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{statusLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-red-200/70">Playing</p>
                  <p className="mt-1 text-[34px] font-black leading-none text-red-100">{playingCount}</p>
                </div>
                <div className="rounded-2xl border border-[#D8BE78]/20 bg-[#D8BE78]/10 p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-[#D8BE78]/70">Waiting</p>
                  <p className="mt-1 text-[34px] font-black leading-none text-[#F4E7BD]">{waitingMatches.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/40">Done</p>
                  <p className="mt-1 text-[34px] font-black leading-none text-white/80">{completedMatches.length}</p>
                </div>
              </div>
            </section>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-[#D8BE78]/14 bg-[#181817]/95 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.32)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[16px] font-black uppercase tracking-[0.22em] text-[#F4E7BD]">Up Next</h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{waitingMatches.length} queued</span>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
                {waitingMatches.slice(0, 5).map((match, index) => (
                  <CompactMatch key={match.id} match={match} index={index} />
                ))}
                {!loading && waitingMatches.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-[13px] font-black uppercase tracking-[0.22em] text-white/35">
                    No Waiting Matches
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[24px] border border-[#D8BE78]/14 bg-[#181817]/95 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.32)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[14px] font-black uppercase tracking-[0.22em] text-[#F4E7BD]">Live Ranking Top 5</h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">W/D/PF</span>
              </div>
              {liveRanking.length > 0 ? (
                <div className="space-y-2">
                  {liveRanking.slice(0, 5).map((player, index) => (
                    <div key={player.name} className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2">
                      <span className={`text-[20px] font-black leading-none ${index === 0 ? 'text-[#D8BE78]' : 'text-white/45'}`}>
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-black text-white">{player.name}</p>
                        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">
                          {player.wins}W {player.losses}L / Diff {player.diff > 0 ? '+' : ''}{player.diff}
                        </p>
                      </div>
                      <span className="text-[18px] font-black text-[#D8BE78]">{player.pointsFor}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-[12px] font-black uppercase tracking-[0.2em] text-white/35">No Ranking Yet</p>
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
