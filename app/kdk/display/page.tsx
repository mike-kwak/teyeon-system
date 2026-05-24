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
    label: isGroupB ? 'B조 / BLUE' : 'A조 / GOLD',
    groupLabel: isGroupB ? 'B조' : 'A조',
    accent: isGroupB ? '#38BFFF' : '#F0B93F',
    accentStrong: isGroupB ? '#22A7F2' : '#FFD66B',
    accentSoft: isGroupB ? 'rgba(56, 191, 255, 0.13)' : 'rgba(240, 185, 63, 0.13)',
    accentMid: isGroupB ? 'rgba(56, 191, 255, 0.24)' : 'rgba(240, 185, 63, 0.24)',
    border: isGroupB ? 'rgba(56, 191, 255, 0.68)' : 'rgba(240, 185, 63, 0.66)',
    panel: 'linear-gradient(180deg,rgba(17,31,52,0.92),rgba(9,14,26,0.95)_54%,rgba(6,10,18,0.98))',
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
    <section
      className="group relative min-h-0 overflow-hidden rounded-[18px] border bg-[#101A2B] shadow-[0_18px_46px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.075)]"
      style={match ? { borderColor: groupMeta.border, boxShadow: `0 0 0 1px ${groupMeta.accentSoft}, 0 18px 46px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.075)` } : { borderColor: 'rgba(240,185,63,0.24)' }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.07),transparent_34%,rgba(56,191,255,0.035)),radial-gradient(circle_at_50%_100%,rgba(240,185,63,0.08),transparent_44%)]" />
      <div className="absolute inset-x-0 top-0 h-[4px]" style={{ background: `linear-gradient(to right, transparent, ${match ? groupMeta.accent : 'rgba(240,185,63,0.42)'}, transparent)` }} />
      <div className="absolute inset-4 rounded-[14px] border border-white/[0.055]" />
      {match && <div className="absolute inset-y-6 left-0 w-[4px] rounded-r-[6px]" style={{ background: `linear-gradient(to bottom, transparent, ${groupMeta.accent}, transparent)` }} />}

      <div className="relative flex h-full min-h-0 flex-col p-3.5 2xl:p-4">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/8 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-20 shrink-0 items-center justify-center rounded-[10px] border bg-white/[0.055] text-[12px] font-black uppercase tracking-[0.16em] text-white/82" style={{ borderColor: match ? groupMeta.border : 'rgba(255,255,255,0.12)' }}>
              Court {court}
            </span>
            {match ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-[8px] border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]" style={{ borderColor: groupMeta.border, background: groupMeta.accentSoft, color: groupMeta.accentStrong }}>
                  {groupMeta.groupLabel}
                </span>
                <span className="rounded-[8px] border border-white/10 bg-black/24 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-white/70">
                  R{match.round || '-'}
                </span>
                <span className="rounded-[8px] border border-emerald-300/24 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-200">
                  Playing
                </span>
              </div>
            ) : (
              <span className="rounded-[8px] border border-emerald-300/22 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-200/82">
                Ready
              </span>
            )}
          </div>
          {match && (
            <span className="shrink-0 rounded-full border border-red-400/48 bg-red-500/16 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-red-100 shadow-[0_0_14px_rgba(239,68,68,0.28)]">
              LIVE
            </span>
          )}
        </div>

        {match ? (
          <div className="relative flex min-h-0 flex-1 items-center py-3">
            <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_70px_minmax(0,1fr)] items-center gap-3 2xl:grid-cols-[minmax(0,1fr)_82px_minmax(0,1fr)] 2xl:gap-4">
              <div className="relative flex min-h-[122px] min-w-0 flex-col justify-center overflow-hidden rounded-[14px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.065),rgba(12,24,41,0.82))] px-4 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-16px_28px_rgba(0,0,0,0.14)] ring-1 ring-inset ring-white/[0.04]" style={{ borderColor: groupMeta.accentMid }}>
                <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
                {teamA.map((name, index) => (
                  <p key={index} className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[clamp(21px,1.55vw,34px)] font-black leading-[1.16] text-[#FFF8E8]">
                    {name}
                  </p>
                ))}
              </div>
              <div className="flex min-w-0 flex-col items-center justify-center gap-2">
                <div className="h-px w-full bg-gradient-to-r from-transparent via-white/12 to-transparent" />
                <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full border bg-[#050B14]/92 text-[18px] font-black uppercase tracking-[0.08em] shadow-[0_0_16px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.12)] 2xl:h-[68px] 2xl:w-[68px] 2xl:text-[20px]" style={{ borderColor: groupMeta.border, color: groupMeta.accent }}>
                  VS
                </span>
                <span className="whitespace-nowrap text-[8px] font-black uppercase tracking-[0.18em] text-white/32">
                  Assignment
                </span>
                <div className="h-px w-full bg-gradient-to-r from-transparent via-white/12 to-transparent" />
              </div>
              <div className="relative flex min-h-[122px] min-w-0 flex-col justify-center overflow-hidden rounded-[14px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.065),rgba(12,24,41,0.82))] px-4 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-16px_28px_rgba(0,0,0,0.14)] ring-1 ring-inset ring-white/[0.04]" style={{ borderColor: groupMeta.accentMid }}>
                <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" />
                {teamB.map((name, index) => (
                  <p key={index} className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[clamp(21px,1.55vw,34px)] font-black leading-[1.16] text-[#FFF8E8]">
                    {name}
                  </p>
                ))}
              </div>
            </div>
            <div className="absolute bottom-1 left-0 right-0 flex items-center justify-between px-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/28">
              <span>Live court assignment</span>
              <span>Score {match.score1 ?? 1}:{match.score2 ?? 1}</span>
            </div>
          </div>
        ) : (
          <div className="relative flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-[clamp(24px,2.2vw,40px)] font-black uppercase tracking-[0.16em] text-[#F0B93F]/86">Standby</p>
            <div className="h-px w-48 bg-gradient-to-r from-transparent via-[#F0B93F]/48 to-transparent" />
            <p className="rounded-[10px] border border-white/10 bg-white/[0.035] px-6 py-2 text-[12px] font-black uppercase tracking-[0.16em] text-white/42">
              Waiting for assignment
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
  const isNext = index === 0;
  const teamOne = teamLabel(match, 0, playerLookup);
  const teamTwo = teamLabel(match, 2, playerLookup);

  return (
    <div
      className={`relative min-h-[94px] overflow-hidden rounded-[14px] border px-3.5 py-2.5 shadow-[0_12px_26px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.085),inset_0_-12px_24px_rgba(0,0,0,0.1)] ${
        isNext
          ? 'border-[#F0B93F]/90 bg-[linear-gradient(135deg,rgba(240,185,63,0.29),rgba(16,26,43,0.98)_42%,rgba(10,19,33,0.99))] shadow-[0_0_32px_rgba(240,185,63,0.28),0_12px_28px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-12px_24px_rgba(0,0,0,0.12)]'
          : hasActivePlayer
            ? 'border-[#F0B93F]/34 bg-[linear-gradient(135deg,rgba(240,185,63,0.1),rgba(15,27,45,0.98)_46%,#0A1424)]'
            : 'bg-[linear-gradient(135deg,rgba(18,31,51,0.94),rgba(10,18,31,0.99))]'
      }`}
      style={!isNext ? { borderColor: hasActivePlayer ? 'rgba(240,185,63,0.34)' : groupMeta.border } : undefined}
    >
      {isNext && <div className="absolute inset-y-3 left-0 w-[5px] rounded-r-[8px] bg-[#F0B93F] shadow-[0_0_16px_rgba(240,185,63,0.45)]" />}
      <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent to-transparent" style={{ backgroundImage: `linear-gradient(to right, transparent, ${isNext ? '#F0B93F' : groupMeta.accent}, transparent)` }} />
      <div className="relative flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`flex h-8 w-9 shrink-0 items-center justify-center rounded-[8px] border text-[13px] font-black ${isNext ? 'border-[#F0B93F]/78 bg-[#F0B93F] text-[#07101D]' : 'bg-white/[0.055]'}`} style={!isNext ? { borderColor: groupMeta.border, color: groupMeta.accent } : undefined}>
            {String(index + 1).padStart(2, '0')}
          </span>
          {isNext && (
            <span className="shrink-0 rounded-[7px] border border-[#F0B93F]/68 bg-[#F0B93F]/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-[#FFE7A0] shadow-[0_0_12px_rgba(240,185,63,0.18)]">
              NEXT
            </span>
          )}
          <span className="shrink-0 rounded-[7px] border border-white/10 bg-black/22 px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] text-white/56">
            Court {match.court || '-'}
          </span>
        </div>
        <span className="shrink-0 rounded-[7px] border px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em]" style={{ borderColor: groupMeta.border, background: groupMeta.accentSoft, color: groupMeta.accentStrong }}>
          {groupMeta.groupLabel} · R{match.round || '-'}
        </span>
      </div>

      <div className="relative mt-2.5 grid min-w-0 grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)] items-center gap-2">
        <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap break-keep text-right text-[clamp(12px,0.78vw,16px)] font-black leading-tight text-white">
          {teamOne}
        </p>
        <span className="flex h-8 w-8 items-center justify-center justify-self-center rounded-[9px] border bg-[#050B14]/82 text-[9px] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]" style={{ borderColor: isNext ? '#F0B93F' : groupMeta.border, color: isNext ? '#FFE7A0' : groupMeta.accent }}>
          VS
        </span>
        <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap break-keep text-left text-[clamp(12px,0.78vw,16px)] font-black leading-tight text-white/92">
          {teamTwo}
        </p>
      </div>
    </div>
  );
}

function CompletedMiniCard({ match, playerLookup }: { match: Match; playerLookup: PlayerLookup }) {
  const groupMeta = getDisplayGroupMeta(match.groupName || match.group || 'A');
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[14px] border bg-[linear-gradient(135deg,rgba(18,30,49,0.78),rgba(13,23,39,0.92))] p-3.5 shadow-[0_10px_22px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]" style={{ borderColor: groupMeta.accentMid }}>
      <div className="absolute inset-y-4 left-0 w-[3px] rounded-r-[6px] opacity-80" style={{ background: groupMeta.accent }} />
      <div className="relative mb-2 flex min-w-0 items-center justify-between gap-2">
        <span className="shrink-0 rounded-[7px] border px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em]" style={{ borderColor: groupMeta.border, background: groupMeta.accentSoft, color: groupMeta.accentStrong }}>
          {groupMeta.groupLabel} · R{match.round || '-'}
        </span>
        <span className="shrink-0 rounded-[7px] border border-emerald-300/18 bg-emerald-400/[0.075] px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-emerald-200/82">
          Final
        </span>
      </div>
      <div className="grid min-h-[82px] grid-cols-[minmax(0,1fr)_68px_minmax(0,1fr)] items-stretch gap-2.5">
        <div className="flex min-w-0 items-center justify-center overflow-hidden rounded-[10px] border border-white/7 bg-[#0B1626]/62 px-3 py-2 text-center">
          <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[clamp(13px,0.86vw,18px)] font-black leading-tight text-white">{teamLabel(match, 0, playerLookup)}</p>
        </div>
        <span className="flex shrink-0 items-center justify-center rounded-[10px] border bg-[#081321]/74 text-center text-[25px] font-black leading-none text-[#FFE7A0]/90" style={{ borderColor: groupMeta.accentMid }}>
          {match.score1 ?? 0}:{match.score2 ?? 0}
        </span>
        <div className="flex min-w-0 items-center justify-center overflow-hidden rounded-[10px] border border-white/7 bg-[#0B1626]/62 px-3 py-2 text-center">
          <p className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[clamp(13px,0.86vw,18px)] font-black leading-tight text-white/88">{teamLabel(match, 2, playerLookup)}</p>
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
  const totalMatches = matches.length;
  const progressPercent = totalMatches > 0 ? Math.round((completedMatches.length / totalMatches) * 100) : 0;
  const statusLabel = realtimeStatus === 'SUBSCRIBED' ? 'LIVE' : realtimeStatus;

  return (
    <main className="fixed inset-0 z-[9999] overflow-hidden bg-[#0E1828] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(240,185,63,0.16),transparent_28%),radial-gradient(circle_at_82%_16%,rgba(56,191,255,0.14),transparent_26%),linear-gradient(135deg,#0E1828_0%,#101A2B_46%,#0B1320_100%)]" />
      <div className="absolute inset-0 opacity-[0.13] [background-image:linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.1)_1px,transparent_1px)] [background-size:76px_76px]" />
      <div className="absolute left-0 right-0 top-[104px] h-px bg-gradient-to-r from-transparent via-[#F0B93F]/80 to-transparent shadow-[0_0_22px_rgba(240,185,63,0.55)]" />
      <div className="absolute right-[24%] top-8 h-24 w-[460px] -rotate-6 bg-[linear-gradient(90deg,transparent,rgba(56,191,255,0.14),rgba(240,185,63,0.14),transparent)] blur-xl" />

      <div className="relative flex h-screen flex-col p-4 2xl:p-5">
        <header className="pointer-events-auto relative z-20 mb-3.5 grid h-[88px] grid-cols-[minmax(0,1fr)_minmax(760px,auto)] items-center gap-5 overflow-hidden rounded-[18px] border border-[#F0B93F]/24 bg-[#101A2B]/88 px-5 shadow-[0_20px_54px_rgba(0,0,0,0.38),0_0_24px_rgba(240,185,63,0.08),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(112deg,rgba(240,185,63,0.16),transparent_55%)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F0B93F]/80 to-transparent" />
          <div className="flex min-w-0 items-center gap-4">
            <div
              aria-label="TEYEON Tennis logo"
              className="relative h-[60px] w-[190px] shrink-0 overflow-hidden rounded-[14px] border border-white/10 bg-[#0A1220]/82 shadow-[0_0_28px_rgba(240,185,63,0.13),inset_0_1px_0_rgba(255,255,255,0.08)]"
              role="img"
              style={{
                backgroundImage: "url('/logo.png')",
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '210px 210px',
              }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.05),transparent_34%,rgba(56,191,255,0.07))]" />
            </div>
            <div className="relative min-w-0">
              <p className="text-[12px] font-black uppercase italic tracking-[0.18em] text-[#F0B93F]">TEYEON Arena Live Board</p>
              <h1 className="mt-1 truncate text-[clamp(28px,2.6vw,44px)] font-black uppercase leading-none tracking-[0.01em] text-[#FFF8E8]">
                {sessionTitle || sessionId || 'No Session'}
              </h1>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-[minmax(470px,1fr)_auto_auto_auto_auto] items-center gap-3">
            <div className="grid grid-cols-4 gap-2 rounded-[14px] border border-white/10 bg-[#07101D]/58 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <div className="rounded-[9px] border border-red-400/26 bg-red-500/10 px-3 py-2 text-center">
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-red-200/72">Playing</p>
                <p className="text-[24px] font-black leading-none text-red-100">{playingCount}</p>
              </div>
              <div className="rounded-[9px] border border-[#F0B93F]/24 bg-[#F0B93F]/10 px-3 py-2 text-center">
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-[#FFE7A0]/72">Waiting</p>
                <p className="text-[24px] font-black leading-none text-[#FFE7A0]">{waitingMatches.length}</p>
              </div>
              <div className="rounded-[9px] border border-emerald-400/24 bg-emerald-500/10 px-3 py-2 text-center">
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-emerald-200/72">Done</p>
                <p className="text-[24px] font-black leading-none text-emerald-200">{completedMatches.length}</p>
              </div>
              <div className="rounded-[9px] border border-cyan-300/22 bg-cyan-400/10 px-3 py-2 text-center">
                <p className="text-[8px] font-black uppercase tracking-[0.14em] text-cyan-100/72">Progress</p>
                <p className="text-[24px] font-black leading-none text-cyan-100">{progressPercent}%</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/34">Time</p>
              <p className="text-[30px] font-black leading-none text-white">{clock}</p>
            </div>
            <div className="flex items-center gap-2 rounded-[13px] border border-red-400/78 bg-red-500/22 px-3 py-2 text-red-50 shadow-[0_0_18px_rgba(239,68,68,0.38),inset_0_1px_0_rgba(255,255,255,0.12)]">
              <span className="h-2.5 w-2.5 rounded-full bg-red-300 shadow-[0_0_12px_rgba(248,113,113,0.7)]" />
              <span className="text-[17px] font-black uppercase tracking-[0.08em]">{statusLabel}</span>
            </div>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="pointer-events-auto relative z-30 whitespace-nowrap rounded-[12px] border border-[#F0B93F]/48 bg-[#F0B93F]/12 px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#FFE7A0] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:border-[#F0B93F]/80 hover:bg-[#F0B93F]/20 active:scale-95"
            >
              {isFullscreen ? '전체화면 해제' : '전체화면'}
            </button>
            <div className="whitespace-nowrap rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-white/52">
              Read Only
            </div>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,54fr)_minmax(320px,21fr)_minmax(420px,25fr)] grid-rows-[minmax(0,1fr)_220px] gap-4 2xl:grid-rows-[minmax(0,1fr)_232px]">
          <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#F0B93F]/22 bg-[#101A2B]/70 p-4 shadow-[0_18px_46px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.075)]">
            <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#F0B93F]/82 to-transparent" />
            <div className="flex items-center justify-between px-1">
              <h2 className="flex items-center gap-3 text-[20px] font-black uppercase italic tracking-[0.17em] text-[#FFE7A0]">
                <span className="h-7 w-1.5 rounded-[4px] bg-[#F0B93F] shadow-[0_0_16px_rgba(240,185,63,0.52)]" />
                Court Arena
              </h2>
              <span className="rounded-[8px] border border-[#F0B93F]/22 bg-[#F0B93F]/8 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/44">현재 진행 중인 경기</span>
            </div>

            <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-4">
              {[1, 2, 3, 4].map((court) => (
                <CourtCard key={court} court={court} match={playingByCourt.get(court)} playerLookup={playerLookup} />
              ))}
            </div>

            <section className="hidden">
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
          </section>

          <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#F0B93F]/30 bg-[#0F1B2D]/86 p-4 shadow-[0_18px_46px_rgba(0,0,0,0.34),0_0_20px_rgba(240,185,63,0.055),inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-18px_34px_rgba(0,0,0,0.12)]">
            <div className="absolute inset-y-8 left-0 w-[4px] rounded-r-[6px] bg-gradient-to-b from-transparent via-[#F0B93F]/82 to-transparent" />
            <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#F0B93F]/62 to-transparent" />
            <div className="mb-3 flex items-center justify-between gap-2 rounded-[10px] border border-white/8 bg-white/[0.035] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              <h2 className="flex min-w-0 items-center gap-2 text-[18px] font-black uppercase italic tracking-[0.13em] text-[#FFE7A0]">
                <span className="h-5 w-1 rounded-[4px] bg-[#F0B93F] shadow-[0_0_12px_rgba(240,185,63,0.5)]" />
                Up Next Lane
              </h2>
              <span className="shrink-0 rounded-[8px] border border-white/10 bg-white/[0.045] px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/42">
                {waitingMatches.length} queued
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
              {waitingMatches.slice(0, 6).map((match, index) => (
                <CompactMatch key={match.id} match={match} index={index} playerLookup={playerLookup} playingPlayerIds={playingPlayerIds} />
              ))}
              {!loading && waitingMatches.length === 0 && (
                <div className="rounded-[14px] border border-dashed border-[#F0B93F]/20 bg-white/[0.025] py-12 text-center text-[12px] font-black uppercase tracking-[0.2em] text-white/36">
                  No Waiting Matches
                </div>
              )}
            </div>
          </section>

          <aside className="row-span-2 relative flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#F0B93F]/30 bg-[#0C1727]/88 p-4 shadow-[0_22px_54px_rgba(0,0,0,0.36),0_0_28px_rgba(240,185,63,0.08),inset_0_1px_0_rgba(255,255,255,0.075)]">
            <div className="pointer-events-none absolute -left-5 bottom-2 top-2 w-10 rounded-full bg-[linear-gradient(90deg,transparent,rgba(216,190,120,0.065),transparent)] blur-md" />
            <section className="hidden">
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

            <section className="hidden">
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

            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[16px] border border-[#F0B93F]/28 bg-[#0C1727]/76 p-4 shadow-[0_18px_42px_rgba(0,0,0,0.4),0_0_24px_rgba(240,185,63,0.07),inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-18px_34px_rgba(0,0,0,0.18)]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#F0B93F]/76 to-transparent" />
              <div className="absolute inset-x-4 top-[42px] h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="mb-3 flex items-center justify-between rounded-[10px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015))] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <h2 className="flex items-center text-[19px] font-black uppercase italic tracking-[0.12em] text-[#FFE7A0]">
                  Ranking Tower
                </h2>
                <span className="rounded-[7px] border border-[#F0B93F]/24 bg-[#F0B93F]/8 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-white/44">All {liveRanking.length}</span>
              </div>
              {liveRanking.length > 0 ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                  <div className="grid grid-cols-3 gap-2.5">
                    {liveRanking.slice(0, 3).map((player, index) => {
                      const tone = index === 0
                        ? 'border-[#F0B93F]/78 bg-[linear-gradient(180deg,rgba(240,185,63,0.24),rgba(11,19,32,0.92))] text-[#FFE7A0] shadow-[0_0_22px_rgba(240,185,63,0.18),inset_0_1px_0_rgba(255,255,255,0.12)]'
                        : index === 1
                          ? 'border-slate-200/42 bg-[linear-gradient(180deg,rgba(226,232,240,0.16),rgba(13,23,39,0.92))] text-slate-100'
                          : 'border-orange-300/42 bg-[linear-gradient(180deg,rgba(251,146,60,0.16),rgba(13,23,39,0.92))] text-orange-200';
                      const totalPlayed = Math.max(1, player.wins + player.losses);
                      const winRate = Math.round((player.wins / totalPlayed) * 100);
                      return (
                        <div key={player.id} className={`relative min-w-0 overflow-hidden rounded-[14px] border px-3 py-3 text-center ${tone}`}>
                          <div className="text-[10px] font-black uppercase tracking-[0.16em] opacity-74">{index === 0 ? 'Leader' : `Top ${index + 1}`}</div>
                          <div className="mx-auto mt-2 flex h-12 w-12 items-center justify-center rounded-[14px] border border-current bg-black/26 text-[25px] font-black leading-none">
                            {index + 1}
                          </div>
                          <p className="mt-2 min-w-0 truncate text-[14px] font-black text-white">{player.name}</p>
                          <p className="mt-1 text-[11px] font-black text-white/62">{player.wins}W {player.losses}L</p>
                          <div className="mx-auto mt-2 h-1.5 w-16 overflow-hidden rounded-[3px] bg-black/34">
                            <div className="h-full rounded-[3px] bg-current" style={{ width: `${winRate}%` }} />
                          </div>
                          <p className={`mt-1 text-[16px] font-black ${player.diff > 0 ? 'text-emerald-300' : player.diff < 0 ? 'text-red-300' : 'text-white/60'}`}>
                            {player.diff > 0 ? '+' : ''}{player.diff}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-[36px_44px_minmax(80px,0.85fr)_78px_30px_30px_42px] items-center gap-1.5 border-b border-white/8 px-2.5 pb-1.5 text-[8px] font-black uppercase tracking-[0.13em] text-white/38">
                    <span className="text-center">Rank</span>
                    <span className="text-center">변동</span>
                    <span>Name</span>
                    <span className="text-center">Rate</span>
                    <span className="text-center">W</span>
                    <span className="text-center">L</span>
                    <span className="text-right">Diff</span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden">
                    {liveRanking.slice(3).map((player, index) => {
                      const rankIndex = index + 3;
                      const settlement = calculateDisplaySettlement(player, rankIndex, liveRanking.length);
                      const totalPlayed = Math.max(1, player.wins + player.losses);
                      const winRate = Math.round((player.wins / totalPlayed) * 100);
                      const movementAmount = Math.min(3, Math.max(1, Math.ceil(Math.abs(player.diff) / 5)));
                      const moveLabel = player.diff > 0 ? `\u25B2${movementAmount}` : player.diff < 0 ? `\u25BC${movementAmount}` : '\u2014';
                      const moveClass = player.diff > 0 ? 'text-red-300' : player.diff < 0 ? 'text-cyan-300' : 'text-white/36';
                      return (
                        <div key={player.id} className={`relative grid h-[34px] grid-cols-[36px_44px_minmax(80px,0.85fr)_78px_30px_30px_42px] items-center gap-1.5 overflow-hidden rounded-[7px] border px-2.5 py-1 ${
                          settlement.isPenalty
                            ? 'border-red-400/18 bg-red-500/[0.052]'
                            : 'border-white/8 bg-white/[0.036]'
                        }`}>
                          {settlement.isPenalty && <div className="absolute inset-y-0 left-0 w-0.5 bg-red-400" />}
                          <span className={`flex h-6 w-7 items-center justify-center justify-self-center rounded-[6px] text-[12px] font-black leading-none ${settlement.isPenalty ? 'bg-red-500/70 text-white' : 'bg-white/9 text-white/62'}`}>
                            {rankIndex + 1}
                          </span>
                          <span className={`text-center text-[11px] font-black leading-none tracking-[-0.02em] ${moveClass}`}>{moveLabel}</span>
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <p className="min-w-0 truncate text-[13px] font-black text-white/90">{player.name}</p>
                            {settlement.isPenalty && (
                                <span className="shrink-0 rounded-[5px] border border-red-300/22 bg-red-500/12 px-1.5 py-0.5 text-[7px] font-black leading-none text-red-200">
                                PEN
                              </span>
                            )}
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-black/34">
                            <div className="h-full rounded-[2px] bg-[#F0B93F]/80" style={{ width: `${winRate}%` }} />
                          </div>
                          <span className="w-full text-center text-[12px] font-black text-white/74">{player.wins}</span>
                          <span className="w-full text-center text-[12px] font-black text-white/58">{player.losses}</span>
                          <span className={`w-full text-right text-[13px] font-black ${player.diff > 0 ? 'text-emerald-300' : player.diff < 0 ? 'text-red-300' : 'text-white/62'}`}>
                            {player.diff > 0 ? '+' : ''}{player.diff}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="py-10 text-center text-[12px] font-black uppercase tracking-[0.2em] text-white/38">No Ranking Yet</p>
              )}
            </section>
          </aside>

          <section className="col-span-2 relative min-h-0 overflow-hidden rounded-[18px] border border-white/10 bg-[#101A2B]/60 p-4 shadow-[0_16px_34px_rgba(0,0,0,0.26),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[#F0B93F]/42 to-transparent" />
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[17px] font-black uppercase italic tracking-[0.16em] text-[#FFE7A0]/86">
                <span className="h-5 w-1 rounded-[4px] bg-emerald-400/78 shadow-[0_0_10px_rgba(52,211,153,0.32)]" />
                Completed Recent
              </h2>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/34">{completedMatches.length} done</span>
            </div>
            {completedMatches.length > 0 ? (
              <div className="grid grid-cols-4 gap-3">
                {completedMatches.slice(0, 4).map((match) => (
                  <CompletedMiniCard key={match.id} match={match} playerLookup={playerLookup} />
                ))}
              </div>
            ) : (
              <div className="rounded-[14px] border border-dashed border-[#F0B93F]/14 bg-white/[0.025] py-10 text-center text-[13px] font-black uppercase tracking-[0.22em] text-white/38">
                No Results Yet
              </div>
            )}
          </section>
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
