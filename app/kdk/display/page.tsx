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
  isGuest?: boolean;
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

function resolveDisplayRowGroup(row: any) {
  const directGroup = row.group_name || row.groupName || row.group || row.group_label || row.groupLabel || row.groupNameLabel;
  const normalizedDirect = normalizeDisplayGroup(directGroup);
  if (normalizedDirect) return normalizedDirect;

  try {
    const sessionId = row.session_id || row.sessionId;
    const matchId = row.id;
    if (typeof window !== 'undefined' && sessionId && matchId) {
      const rawCache = window.localStorage.getItem(`kdk_manual_group_cache_${sessionId}`);
      if (rawCache) {
        const cached = JSON.parse(rawCache);
        const cachedGroup = normalizeDisplayGroup(cached?.[String(matchId)]);
        if (cachedGroup) return cachedGroup;
      }
    }
  } catch {}

  return 'A';
}

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
    groupName: resolveDisplayRowGroup(row),
  };
}

function isLikelyId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^[a-z0-9-]{18,}$/i.test(value);
}

function formatKDKPlayerName(value?: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  if (trimmed.toLowerCase().startsWith('manual-guest-')) {
    const guestName = trimmed.replace(/^manual-guest-/i, '').replace(/\s*\(G\)$/i, '').trim();
    return guestName ? `${guestName}(G)` : '게스트(G)';
  }

  const normalizedGuest = trimmed.replace(/\s*\(G\)$/i, '(G)');
  if (/\s+g$/i.test(normalizedGuest)) {
    return `${normalizedGuest.replace(/\s+g$/i, '').trim()}(G)`;
  }

  return normalizedGuest;
}

function cleanPlayerName(value?: string) {
  return formatKDKPlayerName(value);
}

function normalizeDisplayGroup(value?: string) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.includes('BLUE') || raw === 'B') return 'B';
  if (raw.includes('GOLD') || raw === 'A') return 'A';
  return raw.includes('B') ? 'B' : 'A';
}

function getDisplayGroupMeta(value?: string) {
  const normalizedGroup = normalizeDisplayGroup(value);
  const isGroupB = normalizedGroup === 'B';
  return {
    normalizedGroup,
    isGroupB,
    label: isGroupB ? 'GROUP B / BLUE' : 'GROUP A / GOLD',
    groupLabel: isGroupB ? 'GROUP B' : 'GROUP A',
    accent: isGroupB ? '#38D9FF' : '#FFD66B',
    accentStrong: isGroupB ? '#1CA7FF' : '#F0B93F',
    accentSoft: isGroupB ? 'rgba(56, 217, 255, 0.11)' : 'rgba(255, 214, 107, 0.11)',
    accentMid: isGroupB ? 'rgba(56, 217, 255, 0.2)' : 'rgba(255, 214, 107, 0.2)',
    border: isGroupB ? 'rgba(56, 217, 255, 0.82)' : 'rgba(255, 214, 107, 0.72)',
    panel: 'linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.03)_46%,rgba(0,0,0,0.3))',
  };
}

function playerName(match: Match, index: number, playerLookup: PlayerLookup) {
  const playerId = match.playerIds?.[index] || '';
  const lookup = playerId ? playerLookup[playerId] : null;
  if (lookup?.name) {
    const lookupName = cleanPlayerName(lookup.name);
    return lookup.isGuest && !lookupName.endsWith('(G)') ? `${lookupName}(G)` : lookupName;
  }

  const storedName = cleanPlayerName(match.playerNames?.[index] || match.player_names?.[index]);
  if (storedName && storedName !== playerId && !isLikelyId(storedName)) return storedName;

  const teamIndex = index < 2 ? 0 : 1;
  const teamPlayerIndex = index < 2 ? index : index - 2;
  const teamName = cleanPlayerName(match.teams?.[teamIndex]?.[teamPlayerIndex]);
  if (teamName && teamName !== playerId && !isLikelyId(teamName)) return teamName;

  if (playerId?.startsWith('manual-guest-')) return cleanPlayerName(playerId);
  if (playerId?.startsWith('g-')) return storedName && !isLikelyId(storedName) ? cleanPlayerName(storedName) : '게스트(G)';
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
    const isGuest = playerLookup[id]?.isGuest === true
      || /^manual-guest-/i.test(String(id || ''))
      || /^g-/i.test(String(id || ''))
      || /\s*\(G\)$/i.test(String(name || ''));
    if (!rankingMap.has(id)) {
      rankingMap.set(id, {
        id,
        name,
        isGuest,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        diff: 0,
      });
    }
    const player = rankingMap.get(id)!;
    player.name = name;
    player.isGuest = player.isGuest || isGuest;
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

function calculateDisplaySettlement(player: RankingEntry, rankIndex: number, total: number) {
  const firstPrize = 10000;
  const l1Penalty = 3000;
  const l2Penalty = 5000;
  const guestFee = 10000;
  const bottomHalfCount = Math.ceil(total / 2);
  const penaltyCount = Math.ceil(bottomHalfCount / 2);
  const isPenaltyTier = rankIndex >= total - penaltyCount;
  const isFineTier = !isPenaltyTier && rankIndex >= total - bottomHalfCount;
  let amount = 0;

  if (!player.isGuest && rankIndex === 0) {
    amount = firstPrize;
  } else if (isPenaltyTier) {
    amount = -l2Penalty;
  } else if (isFineTier) {
    amount = -l1Penalty;
  }

  if (player.isGuest) amount -= guestFee;

  return { amount, isPenalty: amount < 0 };
}

function CourtCard({ court, match, playerLookup }: { court: number; match?: Match; playerLookup: PlayerLookup }) {
  const groupName = match?.groupName || match?.group || 'A';
  const groupMeta = getDisplayGroupMeta(groupName);
  const teamA = match ? teamPlayers(match, 0, playerLookup) : [];
  const teamB = match ? teamPlayers(match, 2, playerLookup) : [];

  return (
    <section className={`group relative min-h-0 overflow-hidden rounded-[20px] border bg-[#090908] ${
      match
        ? 'shadow-[0_18px_48px_rgba(0,0,0,0.6),inset_0_0_0_1px_rgba(255,255,255,0.055)]'
        : 'border-[#D8BE78]/46 shadow-[0_0_0_1px_rgba(216,190,120,0.14),0_18px_40px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(255,255,255,0.04)]'
    }`} style={match ? { borderColor: groupMeta.border, boxShadow: `0 0 0 1px ${groupMeta.accentMid}, 0 18px 48px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.055)` } : undefined}>
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.07),transparent 34%,rgba(255,255,255,0.025)),radial-gradient(circle_at_50%_100%,rgba(255,255,255,0.045),transparent 40%)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(118deg,transparent 0%,transparent 46%,rgba(255,255,255,0.035) 48%,transparent 52%)' }}
      />
      <div className="absolute inset-x-5 top-0 h-[3px] bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${groupMeta.accent}, transparent)` }} />
      {match && (
        <>
          <div
            className="absolute inset-x-0 bottom-0 h-[4px]"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(220,38,38,0.82), ${groupMeta.accent}, rgba(220,38,38,0.82))`,
              boxShadow: '0 0 16px rgba(239,68,68,0.56)',
            }}
          />
          <div className="absolute inset-x-12 bottom-1 h-10 bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.34),transparent_70%)]" />
          <div className="absolute bottom-0 left-0 h-20 w-20 bg-[radial-gradient(circle_at_0%_100%,rgba(239,68,68,0.38),transparent_72%)]" />
          <div className="absolute bottom-0 right-0 h-20 w-20 bg-[radial-gradient(circle_at_100%_100%,rgba(239,68,68,0.3),transparent_72%)]" />
          <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-red-400/72 to-transparent" />
          <div className="absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-red-400/56 to-transparent" />
          <div className="absolute inset-y-5 left-0 w-[4px] rounded-r-full" style={{ background: `linear-gradient(to bottom, transparent, ${groupMeta.accent}, transparent)` }} />
        </>
      )}
      <div className="absolute -bottom-7 left-9 right-9 h-24 border-x border-t opacity-85" style={{ borderColor: groupMeta.border }} />
      <div className="absolute bottom-7 left-1/2 h-16 w-px -translate-x-1/2" style={{ backgroundColor: groupMeta.border }} />
      <div className="absolute bottom-7 left-[18%] right-[18%] h-px" style={{ backgroundColor: groupMeta.border }} />
      <div className="absolute bottom-12 left-[16%] right-[16%] h-px" style={{ backgroundColor: groupMeta.accentSoft }} />
      <div className="absolute bottom-[54px] left-[16%] right-[16%] h-px" style={{ backgroundColor: groupMeta.accentSoft.replace('0.18', '0.1') }} />

      <div className="relative flex h-full min-h-0 flex-col p-3 2xl:p-3.5">
        <div className={`absolute right-5 top-5 z-20 rounded-[14px] border px-4 py-2.5 text-[13px] font-black uppercase tracking-[0.16em] ${
          match
            ? 'border-red-400/82 bg-red-500/22 text-red-50 shadow-[0_0_20px_rgba(239,68,68,0.58),inset_0_1px_0_rgba(255,255,255,0.14)]'
            : 'border-emerald-400/62 bg-emerald-500/14 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.22),inset_0_1px_0_rgba(255,255,255,0.1)]'
        }`}>
          {match ? 'LIVE' : 'READY'}
        </div>
        <div className="relative flex min-h-[58px] items-center border-b pb-2 pr-32" style={{ borderColor: groupMeta.accentSoft }}>
          <div className="flex items-end gap-3">
            <span className="text-[12px] font-black uppercase tracking-[0.2em] text-white/82">Court</span>
            <span className="text-[38px] font-black leading-[0.8]" style={{ color: groupMeta.accent }}>{court}</span>
          </div>
          {match && (
            <div className="absolute left-1/2 top-1.5 flex max-w-[56%] -translate-x-1/2 items-center justify-center gap-2.5">
              <span className="whitespace-nowrap rounded-lg border bg-black/46 px-3 py-1.5 text-[12px] font-black uppercase tracking-[0.1em]" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>
                Round {match.round || '-'}
              </span>
              <span className="max-w-[172px] truncate rounded-lg border bg-black/46 px-3 py-1.5 text-[12px] font-black uppercase tracking-[0.1em]" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>
                {groupMeta.label}
              </span>
            </div>
          )}
        </div>

        {match ? (
          <div className="relative flex min-h-0 flex-1 flex-col justify-center pt-0">
            <div className="relative mt-3 rounded-[20px] border px-4 py-3.5 shadow-[0_14px_28px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] 2xl:mt-4 2xl:px-5 2xl:py-4" style={{ borderColor: groupMeta.border, background: groupMeta.panel, boxShadow: `0 14px 28px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)` }}>
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${groupMeta.accent}, transparent)` }} />
              <div className="grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] items-start gap-4">
                <div className="flex min-h-[78px] min-w-0 flex-col justify-center overflow-hidden rounded-[16px] border border-white/10 bg-black/28 px-3 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] 2xl:min-h-[82px] 2xl:px-4 2xl:py-3">
                  {teamA.map((name, index) => (
                    <p key={index} className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[clamp(18px,1.45vw,29px)] font-black leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.72)]">
                      {name}
                    </p>
                  ))}
                </div>
                <div className="flex h-[82px] items-center justify-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border bg-black/68 text-[21px] font-black uppercase tracking-[0.04em]" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>
                    VS
                  </span>
                </div>
                <div className="flex min-h-[78px] min-w-0 flex-col justify-center overflow-hidden rounded-[16px] border border-white/10 bg-black/28 px-3 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] 2xl:min-h-[82px] 2xl:px-4 2xl:py-3">
                  {teamB.map((name, index) => (
                    <p key={index} className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[clamp(18px,1.45vw,29px)] font-black leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.72)]">
                      {name}
                    </p>
                  ))}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_74px_minmax(0,1fr)] items-center gap-4">
                <span className="text-center text-[clamp(46px,3.8vw,66px)] font-black leading-none text-[#FFF4C8]">
                  {match.score1 ?? 1}
                </span>
                <span className="text-center text-[22px] font-black leading-none text-white/28">:</span>
                <span className="text-center text-[clamp(46px,3.8vw,66px)] font-black leading-none text-[#FFF4C8]">
                  {match.score2 ?? 1}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-2.5 text-center">
            <div className="relative h-7 w-11">
              <span className="absolute left-4 top-0 h-8 w-1 -rotate-45 rounded-full bg-[#EAD8A2]/62 shadow-[0_0_16px_rgba(216,190,120,0.25)]" />
              <span className="absolute right-4 top-0 h-8 w-1 rotate-45 rounded-full bg-[#EAD8A2]/62 shadow-[0_0_16px_rgba(216,190,120,0.25)]" />
            </div>
            <p className="text-[clamp(28px,2.45vw,42px)] font-black uppercase tracking-[0.15em] text-[#F1DC9C]">Standby</p>
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

function CompactMatch({ match, index, playerLookup, playingPlayerIds }: { match: Match; index: number; playerLookup: PlayerLookup; playingPlayerIds: Set<string> }) {
  const groupMeta = getDisplayGroupMeta(match.groupName || match.group || 'A');
  const hasActivePlayer = (match.playerIds || []).some((playerId) => playingPlayerIds.has(playerId));
  const renderPlayer = (playerIndex: number) => {
    const playerId = match.playerIds?.[playerIndex] || '';
    const isPlaying = !!playerId && playingPlayerIds.has(playerId);

    return (
      <span className="flex min-w-0 items-center justify-center gap-1 overflow-hidden">
        {isPlaying && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.42)]" />
        )}
        <span className="max-w-full truncate">{playerName(match, playerIndex, playerLookup)}</span>
      </span>
    );
  };

  return (
    <div className={`relative min-h-[72px] overflow-hidden rounded-[15px] border px-3.5 py-2 shadow-[0_9px_20px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.085)] ${
      hasActivePlayer
        ? 'border-red-400/42 bg-[linear-gradient(135deg,#140D0D,rgba(239,68,68,0.085)_46%,#080808)]'
        : ''
    }`} style={{ borderColor: groupMeta.border }}>
      {!hasActivePlayer && (
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#11110F,rgba(255,255,255,0.035)_55%,#080808)]" />
      )}
      <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${groupMeta.accent}, transparent)` }} />
      <div className={`absolute inset-y-3 left-0 w-px bg-gradient-to-b from-transparent ${
        hasActivePlayer
          ? 'via-red-400/72 to-transparent shadow-[0_0_12px_rgba(239,68,68,0.48)]'
          : ''
      }`} style={!hasActivePlayer ? { backgroundImage: `linear-gradient(to bottom, transparent, ${groupMeta.accent}, transparent)` } : undefined} />
      <div className="grid grid-cols-[34px_minmax(0,1fr)_34px_minmax(0,1fr)] items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border text-[12px] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" style={{ borderColor: groupMeta.border, background: groupMeta.accentSoft, color: groupMeta.accent }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="grid min-w-0 grid-cols-2 items-end gap-1.5 break-keep text-center text-[clamp(15px,0.98vw,19px)] font-black leading-snug text-white">
          {renderPlayer(0)}
          {renderPlayer(1)}
        </div>
        <span className="flex h-7 w-7 items-center justify-center justify-self-center rounded-full border bg-black/76 text-[9px] font-black" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>
          VS
        </span>
        <div className="grid min-w-0 grid-cols-2 items-end gap-1.5 break-keep text-center text-[clamp(15px,0.98vw,19px)] font-black leading-snug text-white/90">
          {renderPlayer(2)}
          {renderPlayer(3)}
        </div>
      </div>
      <div className="ml-[46px] mt-1.5 inline-flex max-w-[calc(100%-46px)] truncate rounded-full border bg-black/42 px-2.5 py-0.5 text-[8px] font-black uppercase tracking-[0.16em]" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>
        R{match.round || '-'} - {groupMeta.label}
      </div>
    </div>
  );
}

function CompletedMiniCard({ match, playerLookup }: { match: Match; playerLookup: PlayerLookup }) {
  const groupMeta = getDisplayGroupMeta(match.groupName || match.group || 'A');
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[20px] border bg-[linear-gradient(135deg,#11110F,rgba(255,255,255,0.035)_52%,#080808)] p-4 shadow-[0_16px_34px_rgba(0,0,0,0.36),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-18px_38px_rgba(0,0,0,0.2)]" style={{ borderColor: groupMeta.border }}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${groupMeta.accent}, transparent)` }} />
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${groupMeta.accent}, transparent)` }} />
      <div className="absolute inset-x-12 bottom-1 h-8 opacity-55" style={{ background: `radial-gradient(ellipse at center, ${groupMeta.accentSoft}, transparent 72%)` }} />
      <div className="relative mb-2.5 flex items-center justify-start gap-3">
        <span className="rounded-md border border-emerald-300/20 bg-emerald-400/12 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-100/82">Done</span>
        <span className="absolute left-1/2 max-w-[72%] -translate-x-1/2 truncate rounded-md border bg-black/24 px-2.5 py-1 text-center text-[9px] font-black uppercase tracking-[0.16em]" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>R{match.round || '-'} / {groupMeta.label}</span>
      </div>
      <div className="grid min-h-[86px] grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] items-stretch gap-3">
        <div className="flex min-w-0 items-center justify-center overflow-hidden rounded-[16px] border bg-black/28 px-3 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" style={{ borderColor: groupMeta.accentMid }}>
          <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-center text-[clamp(13px,0.9vw,20px)] font-black leading-none tracking-[-0.04em] text-white">{teamLabel(match, 0, playerLookup)}</p>
        </div>
        <span className="flex shrink-0 items-center justify-center rounded-[16px] border bg-black/46 text-center text-[38px] font-black leading-none text-[#FFF4C8] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" style={{ borderColor: groupMeta.accentMid }}>
          {match.score1 ?? 0}:{match.score2 ?? 0}
        </span>
        <div className="flex min-w-0 items-center justify-center overflow-hidden rounded-[16px] border bg-black/28 px-3 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" style={{ borderColor: groupMeta.accentMid }}>
          <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-center text-[clamp(13px,0.9vw,20px)] font-black leading-none tracking-[-0.04em] text-white/88">{teamLabel(match, 2, playerLookup)}</p>
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
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    const handleFullscreenChange = () => {
      const fullscreenDocument = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement));
    };

    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    fetchMembers();
  }, []);

  const toggleFullscreen = async () => {
    try {
      const fullscreenDocument = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitFullscreenEnabled?: boolean;
        webkitExitFullscreen?: () => Promise<void> | void;
      };
      const root = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      const fullscreenElement = document.fullscreenElement || fullscreenDocument.webkitFullscreenElement;
      const fullscreenEnabled = document.fullscreenEnabled || fullscreenDocument.webkitFullscreenEnabled || Boolean(root.requestFullscreen || root.webkitRequestFullscreen);

      if (!fullscreenEnabled) {
        alert('이 브라우저는 전체화면을 지원하지 않습니다.');
        return;
      }

      if (fullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (fullscreenDocument.webkitExitFullscreen) {
          await fullscreenDocument.webkitExitFullscreen();
        }
      } else {
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if (root.webkitRequestFullscreen) {
          await root.webkitRequestFullscreen();
        }
      }
    } catch (err) {
      console.warn('[KDK Display] fullscreen toggle failed:', err);
    }
  };

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

  const playingPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    matches
      .filter((match) => match.status === 'playing')
      .forEach((match) => {
        (match.playerIds || []).forEach((playerId) => {
          if (playerId) ids.add(playerId);
        });
      });
    return ids;
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
          name: cleanPlayerName(name),
          isGuest: member.is_guest === true || member.isGuest === true || String(member.id).startsWith('g-') || String(member.id).startsWith('manual-guest-'),
        };
      }
      return acc;
    }, {});
  }, [members]);

  const liveRanking = useMemo(() => calculateLiveRanking(completedMatches, playerLookup), [completedMatches, playerLookup]);
  const liveRankingColumns = useMemo(() => {
    if (liveRanking.length <= 9) return [liveRanking];
    const splitAt = Math.ceil(liveRanking.length / 2);
    return [liveRanking.slice(0, splitAt), liveRanking.slice(splitAt)];
  }, [liveRanking]);
  const playingCount = matches.filter((match) => match.status === 'playing').length;
  const statusLabel = realtimeStatus === 'SUBSCRIBED' ? 'LIVE' : realtimeStatus;

  return (
    <main className="fixed inset-0 z-[9999] overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(216,190,120,0.22),transparent_26%),radial-gradient(circle_at_100%_18%,rgba(239,68,68,0.16),transparent_22%),linear-gradient(135deg,#050505_0%,#11110F_48%,#070707_100%)]" />
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(90deg,rgba(216,190,120,0.22)_1px,transparent_1px),linear-gradient(rgba(216,190,120,0.12)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="absolute left-0 right-0 top-[104px] h-px bg-gradient-to-r from-transparent via-[#FFD66B] to-transparent shadow-[0_0_28px_rgba(255,214,107,0.8)]" />
      <div className="absolute right-[16%] top-10 h-24 w-[520px] -rotate-6 bg-[linear-gradient(90deg,transparent,rgba(239,68,68,0.22),rgba(255,214,107,0.2),transparent)] blur-xl" />

      <div className="relative flex h-screen flex-col p-4 2xl:p-5">
        <header className="pointer-events-auto relative z-20 mb-3.5 grid h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-[22px] border border-[#D8BE78]/28 bg-black/60 px-5 shadow-[0_20px_54px_rgba(0,0,0,0.52),0_0_24px_rgba(216,190,120,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(112deg,rgba(216,190,120,0.2),transparent_55%)]" />
          <div className="pointer-events-none absolute -right-20 top-0 h-full w-[420px] bg-[linear-gradient(105deg,transparent,rgba(239,68,68,0.28),transparent)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/92 to-transparent shadow-[0_0_22px_rgba(255,214,107,0.72)]" />
          <div className="pointer-events-none absolute right-[34%] top-0 h-full w-[360px] -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(255,214,107,0.12),rgba(239,68,68,0.1),transparent)]" />
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
          <div className="grid shrink-0 grid-cols-[auto_auto_auto_auto] items-center gap-6">
            <div className="text-right">
              <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/34">Time</p>
              <p className="text-[32px] font-black leading-none text-white">{clock}</p>
            </div>
            <div className="flex items-center gap-2.5 rounded-[14px] border border-red-400/90 bg-red-500/24 px-3.5 py-2 text-red-50 shadow-[0_0_20px_rgba(239,68,68,0.48),inset_0_1px_0_rgba(255,255,255,0.14)]">
              <span className="h-3 w-3 rounded-full bg-red-300 shadow-[0_0_12px_rgba(248,113,113,0.72)]" />
              <span className="text-[20px] font-black uppercase tracking-[0.07em]">{statusLabel}</span>
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="pointer-events-auto relative z-30 rounded-[12px] border border-[#FFD66B]/48 bg-[#D8BE78]/12 px-3.5 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-[#FFE7A0] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-[#FFD66B]/80 hover:bg-[#D8BE78]/20 active:scale-95"
            >
              {isFullscreen ? '전체화면 해제' : '전체화면'}
            </button>
            <div className="rounded-[12px] border border-white/10 bg-white/[0.065] px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/52">
              Read Only
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_600px] gap-4">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_238px] gap-4 2xl:grid-rows-[auto_minmax(0,1fr)_248px]">
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

            <section className="relative min-h-0 overflow-hidden rounded-[20px] border border-[#D8BE78]/30 bg-black/58 p-4 shadow-[0_18px_42px_rgba(0,0,0,0.44),0_0_22px_rgba(216,190,120,0.08),inset_0_1px_0_rgba(255,255,255,0.075)] 2xl:p-[18px]">
              <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#FFD66B]/88 to-transparent" />
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[16px] font-black uppercase italic tracking-[0.18em] text-[#FFD66B]">
                  <span className="h-5 w-1 rounded-full bg-[#FFD66B]/90 shadow-[0_0_12px_rgba(255,214,107,0.6)]" />
                  Completed Recent
                </h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/34">{completedMatches.length} done</span>
              </div>
              {completedMatches.length > 0 ? (
                <div className="grid grid-cols-3 gap-3 2xl:gap-4">
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

          <aside className="relative grid min-h-0 grid-rows-[132px_minmax(0,1fr)_350px] gap-3.5">
            <div className="pointer-events-none absolute -left-5 bottom-2 top-2 w-10 rounded-full bg-[linear-gradient(90deg,transparent,rgba(216,190,120,0.065),transparent)] blur-md" />
            <section className="relative min-h-0 overflow-hidden rounded-[20px] border border-[#D8BE78]/22 bg-black/58 p-4 shadow-[0_16px_38px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red-400/62 to-transparent" />
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[18px] font-black uppercase italic tracking-[0.14em] text-[#FFD66B]">
                  <span className="h-5 w-1 rounded-full bg-red-400 shadow-[0_0_14px_rgba(239,68,68,0.8)]" />
                  Live Status
                </h2>
                <span className="rounded-full border border-red-400/35 bg-red-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-100">{statusLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="flex h-[74px] flex-col items-center justify-center rounded-[16px] border border-red-400/45 bg-red-500/14 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-red-100/76">Playing</p>
                  <p className="mt-1 text-[38px] font-black leading-none text-red-50">{playingCount}</p>
                </div>
                <div className="flex h-[74px] flex-col items-center justify-center rounded-[16px] border border-[#D8BE78]/40 bg-[#D8BE78]/13 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#FFD66B]/76">Waiting</p>
                  <p className="mt-1 text-[38px] font-black leading-none text-[#FFF0BF]">{waitingMatches.length}</p>
                </div>
                <div className="flex h-[74px] flex-col items-center justify-center rounded-[16px] border border-emerald-400/34 bg-emerald-500/11 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
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
              <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
                {waitingMatches.slice(0, 5).map((match, index) => (
                  <CompactMatch key={match.id} match={match} index={index} playerLookup={playerLookup} playingPlayerIds={playingPlayerIds} />
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
                  Live Ranking
                </h2>
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/34">All {liveRanking.length}</span>
              </div>
              {liveRanking.length > 0 ? (
                <div className={`grid h-full w-full gap-2 ${liveRankingColumns.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {liveRankingColumns.map((column, columnIndex) => {
                    const rankOffset = liveRankingColumns.slice(0, columnIndex).reduce((sum, items) => sum + items.length, 0);
                    return (
                      <div key={`ranking-column-${columnIndex}`} className="min-w-0 space-y-1.5">
                        <div className="grid grid-cols-[30px_minmax(0,1fr)_48px_36px] items-center gap-2 px-2 text-[8px] font-black uppercase tracking-[0.12em] text-white/32">
                          <span className="text-center">Rank</span>
                          <span>Player</span>
                          <span className="text-right">W/L</span>
                          <span className="text-right">Diff</span>
                        </div>
                        {column.map((player, localIndex) => {
                          const rankIndex = rankOffset + localIndex;
                          const settlement = calculateDisplaySettlement(player, rankIndex, liveRanking.length);
                          return (
                            <div key={player.id} className={`relative grid min-h-[28px] grid-cols-[30px_minmax(0,1fr)_48px_36px] items-center gap-2 overflow-hidden rounded-[10px] border px-2 py-1 ${
                              settlement.isPenalty
                                ? 'border-red-400/24 bg-red-500/[0.075]'
                                : rankIndex === 0
                                ? 'border-[#FFD66B]/28 bg-[#D8BE78]/10'
                                : rankIndex === 1
                                  ? 'border-white/12 bg-white/[0.052]'
                                  : rankIndex === 2
                                    ? 'border-orange-400/16 bg-orange-400/[0.04]'
                                    : 'border-white/8 bg-white/[0.035]'
                            }`}>
                              {(rankIndex < 3 || settlement.isPenalty) && (
                                <div className={`absolute inset-y-0 left-0 w-0.5 ${
                                  settlement.isPenalty ? 'bg-red-400' : rankIndex === 0 ? 'bg-[#FFD66B]' : rankIndex === 1 ? 'bg-white/45' : 'bg-orange-400/65'
                                }`} />
                              )}
                              <span className={`flex h-6 w-6 items-center justify-center justify-self-center rounded-md text-[11px] font-black leading-none ${
                                settlement.isPenalty
                                  ? 'bg-red-500/80 text-white'
                                  : rankIndex === 0
                                  ? 'bg-[#FFD66B] text-black'
                                  : rankIndex === 1
                                    ? 'bg-white/70 text-black'
                                    : rankIndex === 2
                                      ? 'bg-orange-400/75 text-black'
                                      : 'bg-white/10 text-white/58'
                              }`}>
                                {rankIndex + 1}
                              </span>
                              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                                <p className={`min-w-0 truncate text-[11px] font-black ${rankIndex < 3 ? 'text-white' : 'text-white/86'}`}>{player.name}</p>
                                {settlement.isPenalty && (
                                  <span className="shrink-0 rounded-full border border-red-300/25 bg-red-500/15 px-1.5 py-0.5 text-[7px] font-black leading-none text-red-200">
                                    PEN
                                  </span>
                                )}
                              </div>
                              <span className="w-full whitespace-nowrap text-right text-[9px] font-black text-white/76">{player.wins}W {player.losses}L</span>
                              <span className={`w-full text-right text-[12px] font-black ${player.diff > 0 ? 'text-emerald-300' : player.diff < 0 ? 'text-red-300' : 'text-white/62'}`}>
                                {player.diff > 0 ? '+' : ''}{player.diff}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
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
