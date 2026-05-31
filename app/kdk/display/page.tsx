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

function CourtCard({ court, match, playerLookup, matchNumber }: { court: number; match?: Match; playerLookup: PlayerLookup; matchNumber?: number }) {
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
      {match && (
        <div className="absolute right-3.5 top-3.5 z-10 flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF4848] shadow-[0_0_6px_rgba(255,72,72,0.6)]" />
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[#FF4848]">LIVE</span>
        </div>
      )}

      <div className="relative flex h-full min-h-0 flex-col p-3.5 2xl:p-4">
        <div className="flex min-w-0 items-start justify-between gap-3 border-b border-white/8 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-20 shrink-0 items-center justify-center rounded-[10px] border bg-white/[0.055] text-[12px] font-black uppercase tracking-[0.16em] text-white/82" style={{ borderColor: match ? groupMeta.border : 'rgba(255,255,255,0.12)' }}>
              Court {court}
            </span>
            {match ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {matchNumber && matchNumber > 0 && (
                  <span className="flex h-[28px] items-center rounded-[8px] border border-[#F0B93F]/55 bg-[#F0B93F]/15 px-3.5 text-[14px] font-black uppercase tracking-[0.06em] text-[#FFE7A0] shadow-[0_0_12px_rgba(240,185,63,0.20)]">
                    M{String(matchNumber).padStart(2, '0')}
                  </span>
                )}
                <span className="rounded-[7px] border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em]" style={{ borderColor: groupMeta.accentMid, background: groupMeta.accentSoft, color: groupMeta.accentStrong }}>
                  {groupMeta.groupLabel}
                </span>
                <span className="rounded-[7px] border border-white/[0.06] bg-transparent px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-white/42">
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

function CompactMatch({ match, index, playerLookup, playingPlayerIds, matchNumber }: { match: Match; index: number; playerLookup: PlayerLookup; playingPlayerIds: Set<string>; matchNumber?: number }) {
  const groupMeta = getDisplayGroupMeta(match.groupName || match.group || 'A');
  const hasActivePlayer = (match.playerIds || []).some((playerId) => playingPlayerIds.has(playerId));
  const isNext = index === 0;
  const teamOne = teamLabel(match, 0, playerLookup);
  const teamTwo = teamLabel(match, 2, playerLookup);

  return (
    <div
      className={`relative min-h-[94px] overflow-hidden rounded-[14px] border px-3.5 py-2.5 ${
        isNext
          ? 'border-[#F0B93F]/90 bg-[linear-gradient(135deg,rgba(240,185,63,0.29),rgba(16,26,43,0.98)_42%,rgba(10,19,33,0.99))] shadow-[0_0_32px_rgba(240,185,63,0.28),0_12px_28px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.12),inset_0_-12px_24px_rgba(0,0,0,0.12)]'
          : 'bg-[linear-gradient(135deg,rgba(10,16,27,0.62),rgba(6,11,20,0.78))] shadow-[0_3px_8px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.03)]'
      }`}
      style={!isNext ? { borderColor: groupMeta.accentMid } : undefined}
    >
      {isNext && <div className="absolute inset-y-3 left-0 w-[5px] rounded-r-[8px] bg-[#F0B93F] shadow-[0_0_16px_rgba(240,185,63,0.45)]" />}
      <div className="absolute inset-x-5 top-0 h-px" style={{ background: isNext ? 'linear-gradient(to right, transparent, #F0B93F, transparent)' : 'linear-gradient(to right, transparent, rgba(255,255,255,0.04), transparent)' }} />
      <div className="relative flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-8 w-9 shrink-0 items-center justify-center rounded-[8px] border text-[13px] font-black ${
              isNext ? 'border-[#F0B93F]/78 bg-[#F0B93F] text-[#07101D]' : 'bg-white/[0.025] opacity-60'
            }`}
            style={!isNext ? { borderColor: groupMeta.accentMid, color: groupMeta.accent } : undefined}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          {isNext && (
            <span className="shrink-0 rounded-[7px] border border-[#F0B93F]/68 bg-[#F0B93F]/20 px-2 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-[#FFE7A0] shadow-[0_0_12px_rgba(240,185,63,0.18)]">
              NEXT
            </span>
          )}
          <span className={`shrink-0 rounded-[7px] border px-2 py-1 text-[8px] font-black uppercase tracking-[0.12em] ${
            isNext ? 'border-white/10 bg-black/22 text-white/56' : 'border-white/[0.05] bg-transparent text-white/28'
          }`}>
            Court {match.court || '-'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {matchNumber && matchNumber > 0 && (
            <span className={`flex h-[22px] items-center rounded-[7px] border px-2.5 text-[12px] font-black uppercase tracking-[0.06em] ${
              isNext
                ? 'border-[#F0B93F]/55 bg-[#F0B93F]/15 text-[#FFE7A0] shadow-[0_0_8px_rgba(240,185,63,0.18)]'
                : 'border-white/[0.18] bg-white/[0.04] text-white/65'
            }`}>
              M{String(matchNumber).padStart(2, '0')}
            </span>
          )}
          <span
            className="shrink-0 rounded-[7px] border px-1.5 py-1 text-[7px] font-black uppercase tracking-[0.1em]"
            style={isNext
              ? { borderColor: groupMeta.border, background: groupMeta.accentSoft, color: groupMeta.accentStrong }
              : { borderColor: groupMeta.accentMid, background: 'transparent', color: 'rgba(255,255,255,0.22)' }
            }
          >
            {groupMeta.groupLabel} · R{match.round || '-'}
          </span>
        </div>
      </div>

      <div className="relative mt-2.5 grid min-w-0 grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)] items-center gap-2">
        <p className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap break-keep text-right text-[clamp(12px,0.78vw,16px)] font-black leading-tight ${isNext ? 'text-white' : 'text-white/60'}`}>
          {teamOne}
        </p>
        <span
          className="flex h-8 w-8 items-center justify-center justify-self-center rounded-[9px] border bg-[#050B14]/82 text-[9px] font-black shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
          style={{ borderColor: isNext ? '#F0B93F' : groupMeta.accentMid, color: isNext ? '#FFE7A0' : 'rgba(255,255,255,0.28)', opacity: isNext ? 1 : 0.6 }}
        >
          VS
        </span>
        <p className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap break-keep text-left text-[clamp(12px,0.78vw,16px)] font-black leading-tight ${isNext ? 'text-white/92' : 'text-white/52'}`}>
          {teamTwo}
        </p>
      </div>
    </div>
  );
}

function CompletedMiniCard({ match, playerLookup, matchNumber }: { match: Match; playerLookup: PlayerLookup; matchNumber?: number }) {
  const groupMeta = getDisplayGroupMeta(match.groupName || match.group || 'A');
  const compactCompletedLabel = (value: string) =>
    value.replace(/\(G\)/g, 'G').replace(/\s*\/\s*/g, '·');
  return (
    <div
      className="relative min-w-0 overflow-hidden rounded-[14px] border bg-[linear-gradient(160deg,rgba(8,13,22,0.72),rgba(3,6,12,0.88))] shadow-[0_4px_12px_rgba(0,0,0,0.22)]"
      style={{ borderColor: groupMeta.accentSoft }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.035] bg-white/[0.015] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {matchNumber && matchNumber > 0 && (
            <span className="flex h-[20px] shrink-0 items-center rounded-[5px] border border-[#F0B93F]/22 bg-[#F0B93F]/6 px-2 text-[11px] font-black uppercase tracking-[0.08em] text-[#FFE7A0]/52">
              M{String(matchNumber).padStart(2, '0')}
            </span>
          )}
          <span
            className="rounded-[4px] px-1 py-px text-[7px] font-black uppercase tracking-[0.14em] text-white/28"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            {groupMeta.groupLabel} · R{match.round || '-'}
          </span>
        </div>
        <span className="shrink-0 text-[7px] font-black uppercase tracking-[0.22em] text-white/16">FINAL</span>
      </div>
      <div className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_54px_minmax(0,1fr)] items-center">
        <div className="flex min-w-0 items-center justify-center overflow-hidden px-2.5 py-3 text-center">
          <p className="w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[16px] font-black leading-tight text-white/65">
            {compactCompletedLabel(teamLabel(match, 0, playerLookup))}
          </p>
        </div>
        <div
          className="flex shrink-0 flex-col items-center justify-center self-stretch border-x bg-black/10 text-center"
          style={{ borderColor: groupMeta.accentSoft }}
        >
          <span className="text-[20px] font-black leading-none text-white/52">
            {match.score1 ?? 0}:{match.score2 ?? 0}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-center overflow-hidden px-2.5 py-3 text-center">
          <p className="w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-[16px] font-black leading-tight text-white/55">
            {compactCompletedLabel(teamLabel(match, 2, playerLookup))}
          </p>
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
    const style = document.createElement('style');
    style.dataset.id = 'ticker-marquee';
    style.textContent = '@keyframes ticker-scroll{0%{transform:translateX(-50%)}100%{transform:translateX(0)}}';
    document.head.appendChild(style);
    return () => { if (style.parentNode) style.remove(); };
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

  const matchNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    matches.forEach((match, i) => map.set(match.id, i + 1));
    return map;
  }, [matches]);

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
  const tickerNextMatch = waitingMatches[0] ?? null;
  const tickerNextMatchNum = tickerNextMatch ? (matchNumberMap.get(tickerNextMatch.id) ?? 0) : 0;
  const tickerLeader = liveRanking[0] ?? null;
  const tickerGuests = useMemo(() => {
    // playerLookup(멤버 DB)만 보면 manual-guest- 타입을 못 잡음.
    // 전체 matches를 순회해 실제 사용된 게스트를 추출한다.
    const seen = new Set<string>();
    const guests: string[] = [];

    matches.forEach((match) => {
      (match.playerIds || []).forEach((id, idx) => {
        if (!id) return;
        const idStr = String(id);

        const isGuestId =
          idStr.startsWith('manual-guest-') ||
          idStr.startsWith('g-') ||
          playerLookup[idStr]?.isGuest === true;

        const displayName = playerName(match, idx, playerLookup);
        const isGuestName = /\(G\)/i.test(displayName);

        if (isGuestId || isGuestName) {
          const compact = displayName.replace(/\s*\(G\)$/i, 'G');
          if (compact && compact !== 'Name loading' && compact !== '게스트G' && !seen.has(compact)) {
            seen.add(compact);
            guests.push(compact);
          }
        }
      });
    });

    return guests;
  }, [matches, playerLookup]);

  const tickerGroupContent = (
    <>
      {/* Block 1: UP NEXT — 핵심 정보, 가장 먼저 */}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <span className="font-extrabold text-[#FFE7A0]">UP NEXT</span>
        {tickerNextMatchNum > 0 && (
          <span className="text-[#FFE7A0]/70" style={{ marginLeft: '8px' }}>
            M{String(tickerNextMatchNum).padStart(2, '0')}
          </span>
        )}
        {tickerNextMatch ? (
          <>
            <span className="text-white/82" style={{ marginLeft: '20px' }}>
              {teamLabel(tickerNextMatch, 0, playerLookup).replace(/ \/ /g, '/')}
            </span>
            <span className="text-white/45" style={{ margin: '0 10px' }}>vs</span>
            <span className="text-white/82">
              {teamLabel(tickerNextMatch, 2, playerLookup).replace(/ \/ /g, '/')}
            </span>
          </>
        ) : (
          <span className="text-white/42" style={{ marginLeft: '16px' }}>대기 경기 없음</span>
        )}
      </div>
      {/* Separator + Block 2: LEADER */}
      {tickerLeader && (
        <>
          <span className="shrink-0 text-white/15" style={{ margin: '0 56px' }}>·</span>
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <span className="font-extrabold text-[#FFE7A0]">LEADER</span>
            <span className="text-white/82" style={{ marginLeft: '16px' }}>{tickerLeader.name}</span>
            <span
              className={`font-extrabold ${tickerLeader.diff > 0 ? 'text-emerald-300' : tickerLeader.diff < 0 ? 'text-red-300' : 'text-white/40'}`}
              style={{ marginLeft: '8px' }}
            >
              {tickerLeader.diff > 0 ? '+' : ''}{tickerLeader.diff}
            </span>
          </div>
        </>
      )}
      {/* Separator + Block 3: WELCOME — 게스트 있으면 이름, 없으면 fallback */}
      <span className="shrink-0 text-white/15" style={{ margin: '0 56px' }}>·</span>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <span className="font-extrabold text-[#FFE7A0]">WELCOME</span>
        <span className="text-white/82" style={{ marginLeft: '16px' }}>
          {tickerGuests.length > 0
            ? `${tickerGuests.slice(0, 3).join(', ')}${tickerGuests.length > 3 ? ` 외 ${tickerGuests.length - 3}명` : ''}`
            : 'TEYEON PLAYERS'}
        </span>
      </div>
      {/* Separator + Block 4: TEYEON KDK LIVE — 브랜드 꼬리 */}
      <span className="shrink-0 text-white/15" style={{ margin: '0 56px' }}>·</span>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <span className="font-black text-[#FFE7A0]/52">TEYEON KDK LIVE</span>
      </div>
    </>
  );

  return (
    <main className="fixed inset-0 z-[9999] overflow-hidden bg-[#070C18] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_0%,rgba(240,185,63,0.20),transparent_30%),radial-gradient(circle_at_84%_14%,rgba(56,191,255,0.16),transparent_28%),linear-gradient(135deg,#070C18_0%,#0C1524_46%,#050A13_100%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(90deg,rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="absolute left-0 right-0 top-[104px] h-px bg-gradient-to-r from-transparent via-[#F0B93F]/80 to-transparent shadow-[0_0_22px_rgba(240,185,63,0.55)]" />
      <div className="absolute right-[24%] top-8 h-24 w-[460px] -rotate-6 bg-[linear-gradient(90deg,transparent,rgba(56,191,255,0.14),rgba(240,185,63,0.14),transparent)] blur-xl" />

      <div className="relative flex h-screen flex-col p-4 2xl:p-5">
        <header className="pointer-events-auto relative z-20 mb-3.5 grid h-[64px] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-6 overflow-hidden rounded-[18px] border border-[#F0B93F]/32 bg-[#09131F]/95 px-5 shadow-[0_24px_64px_rgba(0,0,0,0.58),0_0_32px_rgba(240,185,63,0.12),inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-1px_0_rgba(240,185,63,0.08)]">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(112deg,rgba(240,185,63,0.16),transparent_55%)]" />
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F0B93F]/80 to-transparent" />
          {/* 왼쪽: 세션 정보 */}
          <div className="relative flex min-w-0 flex-col justify-center">
            <p className="text-[10px] font-black uppercase italic tracking-[0.18em] text-[#F0B93F]/80">TEYEON Arena Live Board</p>
            <h1 className="truncate text-[clamp(20px,2.2vw,38px)] font-black uppercase leading-none tracking-[0.01em] text-[#FFF8E8]">
              {sessionTitle || sessionId || 'No Session'}
            </h1>
          </div>
          {/* 중앙: ticker marquee only — 1fr 칸, overflow-hidden */}
          <div className="mx-3 flex h-[38px] min-w-0 max-w-[880px] items-center overflow-hidden rounded-[8px] border border-white/[0.07] bg-white/[0.022]">
            <div className="min-w-0 flex-1 overflow-hidden">
              <div
                className="flex shrink-0 items-center whitespace-nowrap text-[13px] font-bold leading-none tracking-wide"
                style={{ animation: 'ticker-scroll 38s linear infinite' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginRight: '200px' }}>
                  {tickerGroupContent}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginRight: '200px' }} aria-hidden="true">
                  {tickerGroupContent}
                </div>
              </div>
            </div>
          </div>
          {/* 상태 정보 — ticker 우측 별도 grid 칸 (auto), 시계 왼쪽 */}
          <div className="ml-4 flex h-[44px] shrink-0 items-center gap-2.5 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-5 text-[13px] font-bold leading-none tracking-[0.07em]">
            <span className="text-red-200/65">PLAYING <span className="font-black text-red-100/90">{playingCount}</span></span>
            <span className="text-white/20">·</span>
            <span className="text-[#FFE7A0]/55">WAITING <span className="font-black text-[#FFE7A0]/85">{waitingMatches.length}</span></span>
            <span className="text-white/20">·</span>
            <span className="text-emerald-200/60">DONE <span className="font-black text-emerald-200/90">{completedMatches.length}/{totalMatches}</span></span>
            <span className="text-white/20">·</span>
            <span className="font-black text-cyan-100/70">{progressPercent}%</span>
          </div>
          {/* 오른쪽: 시계 */}
          <div className="flex shrink-0 flex-col items-end justify-center rounded-[10px] border border-white/[0.07] bg-white/[0.022] px-4 py-1.5">
            <p className="text-[8px] font-black uppercase tracking-[0.22em] text-white/36">Time</p>
            <p className="text-[28px] font-black leading-none text-white">{clock}</p>
          </div>
          <button type="button" onClick={toggleFullscreen} className="hidden">
            {isFullscreen ? '전체화면 해제' : '전체화면'}
          </button>
        </header>

        <section className="grid min-h-0 flex-1 grid-cols-[minmax(0,54fr)_minmax(320px,21fr)_minmax(420px,25fr)] grid-rows-[minmax(0,1fr)_220px] gap-4 2xl:grid-rows-[minmax(0,1fr)_232px]">
          <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#F0B93F]/28 bg-[#050B17]/98 p-4 shadow-[0_0_0_1px_rgba(2,5,12,0.95),0_0_0_3px_rgba(240,185,63,0.16),0_26px_64px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-32px_52px_rgba(0,0,0,0.26)]">
            <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between border-b-2 border-[#F0B93F]/55 bg-[#020508] px-4 pt-5 pb-3">
              <h2 className="flex items-center gap-3 text-[20px] font-black uppercase italic tracking-[0.17em] text-[#FFE7A0]">
                <span className="h-7 w-[3px] rounded-[4px] bg-[#F0B93F] shadow-[0_0_12px_rgba(240,185,63,0.60)]" />
                Court Arena
              </h2>
              <span className="rounded-[8px] border border-[#F0B93F]/28 bg-[#F0B93F]/8 px-4 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-white/55">현재 진행 중인 경기</span>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-4">
              {[1, 2, 3, 4].map((court) => {
                const courtMatch = playingByCourt.get(court);
                return (
                  <CourtCard key={court} court={court} match={courtMatch} playerLookup={playerLookup} matchNumber={courtMatch ? matchNumberMap.get(courtMatch.id) || 0 : 0} />
                );
              })}
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
                    <CompletedMiniCard key={match.id} match={match} playerLookup={playerLookup} matchNumber={matchNumberMap.get(match.id) || 0} />
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#D8BE78]/18 bg-white/[0.025] py-9 text-center text-[13px] font-black uppercase tracking-[0.22em] text-white/38">
                  No Results Yet
                </div>
              )}
            </section>
          </section>

          <section className="relative flex min-h-0 flex-col overflow-hidden rounded-[18px] border border-[#F0B93F]/32 bg-[#050A18]/98 p-4 shadow-[0_0_0_1px_rgba(2,5,12,0.95),0_0_0_3px_rgba(240,185,63,0.14),0_24px_60px_rgba(0,0,0,0.68),inset_0_1px_0_rgba(255,255,255,0.09),inset_0_-28px_48px_rgba(0,0,0,0.28)]">
            <div className="absolute inset-y-0 left-0 w-[3px] rounded-r-[4px] bg-gradient-to-b from-transparent via-[#F0B93F]/72 to-transparent" />
            <div className="-mx-4 -mt-4 mb-4 flex items-center justify-between gap-2 border-b-2 border-[#F0B93F]/55 bg-[#020508] px-4 pt-5 pb-3">
              <h2 className="flex min-w-0 items-center gap-2 text-[18px] font-black uppercase italic tracking-[0.13em] text-[#FFE7A0]">
                <span className="h-5 w-[3px] rounded-[4px] bg-[#F0B93F] shadow-[0_0_12px_rgba(240,185,63,0.60)]" />
                Up Next Lane
              </h2>
              <span className="shrink-0 rounded-[8px] border border-[#F0B93F]/25 bg-[#F0B93F]/8 px-3 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-white/55">
                {waitingMatches.length} queued
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
              {waitingMatches.slice(0, 6).map((match, index) => (
                <CompactMatch key={match.id} match={match} index={index} playerLookup={playerLookup} playingPlayerIds={playingPlayerIds} matchNumber={matchNumberMap.get(match.id) || 0} />
              ))}
              {!loading && waitingMatches.length === 0 && (
                <div className="rounded-[14px] border border-dashed border-[#F0B93F]/20 bg-white/[0.025] py-12 text-center text-[12px] font-black uppercase tracking-[0.2em] text-white/36">
                  No Waiting Matches
                </div>
              )}
            </div>
          </section>

          <aside className="row-span-2 relative flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-[linear-gradient(180deg,#1E2A40_0%,#162030_30%,#0E1824_70%,#080E18_100%)] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.10)]">
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

            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-[radial-gradient(ellipse_500px_180px_at_50%_0%,rgba(240,203,101,0.07),transparent_70%),linear-gradient(180deg,#0B1424_0%,#040912_100%)] p-2 shadow-[inset_0_0_0_1px_rgba(212,160,64,0.28),inset_0_4px_16px_rgba(0,0,0,0.85)]">
              <div className="mb-1.5 border-l-[3px] border-[#B8982A] bg-[linear-gradient(90deg,rgba(138,111,42,0.55)_0%,transparent_60%)] px-2 py-1.5 shadow-[0_0_8px_rgba(240,203,101,0.18)]">
                <div className="flex items-center justify-between">
                  <h2 className="text-[16px] font-black uppercase tracking-[0.06em] text-[#EDE0C0]">★ RANKING TOWER</h2>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF4848] shadow-[0_0_6px_rgba(255,72,72,0.6)]" />
                    <span className="text-[9px] font-black uppercase tracking-[0.18em] text-[#FF4848]">LIVE</span>
                  </div>
                </div>
                <p className="text-[9px] text-[#C8A84A]/80">실시간 순위 · {liveRanking.length}명</p>
              </div>
              {liveRanking.length > 0 ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  {/* TOP3 Podium — 2위(좌) | 1위(중앙/최상) | 3위(우) */}
                  <div className="grid grid-cols-3 items-end gap-2">

                    {/* ── 2위 ── */}
                    {liveRanking[1] && (() => {
                      const p = liveRanking[1];
                      return (
                        <div className="relative flex min-h-[138px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-[14px] border border-slate-300/28 bg-[linear-gradient(160deg,rgba(200,210,230,0.13)_0%,rgba(10,17,32,0.96)_100%)] px-2 pt-3 pb-2 text-center shadow-[0_4px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.07)]">
                          <div className="flex flex-col items-center">
                            <div className="text-[7px] font-black uppercase tracking-[0.22em] text-slate-300/50">2nd</div>
                            {/* silver medal */}
                            <div className="mx-auto mt-1.5 flex h-12 w-12 items-center justify-center rounded-full border-2 border-slate-300/55 bg-[linear-gradient(135deg,#C8D4E8_0%,#7A8AA0_50%,#A8B8CC_100%)] text-[22px] font-black leading-none text-white shadow-[0_0_10px_rgba(180,200,230,0.28),inset_0_1px_0_rgba(255,255,255,0.35)]">
                              2
                            </div>
                          </div>
                          <p className="w-full min-w-0 truncate px-1 text-[16px] font-black leading-tight text-white">{p.name}</p>
                          <div className="flex flex-col items-center gap-0.5">
                            <p className="text-[9px] font-bold text-white/50">{p.wins}W {p.losses}L</p>
                            <p className={`text-[13px] font-black ${p.diff > 0 ? 'text-emerald-300' : p.diff < 0 ? 'text-red-300' : 'text-white/42'}`}>{p.diff > 0 ? '+' : ''}{p.diff}</p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── 1위 ── */}
                    {liveRanking[0] && (() => {
                      const p = liveRanking[0];
                      return (
                        <div className="relative flex min-h-[170px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-[16px] border border-[#F0B93F]/55 bg-[linear-gradient(160deg,rgba(240,185,63,0.20)_0%,rgba(8,15,28,0.97)_100%)] px-2 pt-3 pb-2 text-center shadow-[0_0_28px_rgba(240,185,63,0.22),0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,240,180,0.14)]">
                          <div className="flex flex-col items-center">
                            {/* crown */}
                            <div className="text-[11px] leading-none text-[#F0B93F]/70">♛</div>
                            <div className="text-[7px] font-black uppercase tracking-[0.22em] text-[#F0B93F]/65">Leader</div>
                            {/* gold medal */}
                            <div className="mx-auto mt-1.5 flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-[#F0CF60]/70 bg-[linear-gradient(135deg,#FFE066_0%,#D4920A_50%,#F5C842_100%)] text-[24px] font-black leading-none text-[#3A2400] shadow-[0_0_18px_rgba(240,185,63,0.45),inset_0_1px_0_rgba(255,255,220,0.5)]">
                              1
                            </div>
                          </div>
                          <p className="w-full min-w-0 truncate px-1 text-[20px] font-black leading-tight text-white">{p.name}</p>
                          <div className="flex flex-col items-center gap-0.5">
                            <p className="text-[10px] font-bold text-white/55">{p.wins}W {p.losses}L</p>
                            <p className={`text-[15px] font-black ${p.diff > 0 ? 'text-emerald-300' : p.diff < 0 ? 'text-red-300' : 'text-white/42'}`}>
                              {p.diff > 0 ? '+' : ''}{p.diff}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── 3위 ── */}
                    {liveRanking[2] && (() => {
                      const p = liveRanking[2];
                      return (
                        <div className="relative flex min-h-[122px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-[14px] border border-orange-400/28 bg-[linear-gradient(160deg,rgba(205,127,50,0.13)_0%,rgba(10,17,32,0.96)_100%)] px-2 pt-3 pb-2 text-center shadow-[0_4px_20px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]">
                          <div className="flex flex-col items-center">
                            <div className="text-[7px] font-black uppercase tracking-[0.22em] text-orange-300/50">3rd</div>
                            {/* bronze medal */}
                            <div className="mx-auto mt-1.5 flex h-11 w-11 items-center justify-center rounded-full border-2 border-orange-400/50 bg-[linear-gradient(135deg,#E8974A_0%,#924E10_50%,#D07830_100%)] text-[20px] font-black leading-none text-white shadow-[0_0_10px_rgba(205,127,50,0.28),inset_0_1px_0_rgba(255,200,140,0.3)]">
                              3
                            </div>
                          </div>
                          <p className="w-full min-w-0 truncate px-1 text-[16px] font-black leading-tight text-white">{p.name}</p>
                          <div className="flex flex-col items-center gap-0.5">
                            <p className="text-[9px] font-bold text-white/50">{p.wins}W {p.losses}L</p>
                            <p className={`text-[13px] font-black ${p.diff > 0 ? 'text-emerald-300' : p.diff < 0 ? 'text-red-300' : 'text-white/42'}`}>{p.diff > 0 ? '+' : ''}{p.diff}</p>
                          </div>
                        </div>
                      );
                    })()}

                  </div>

                  <div className="grid grid-cols-[38px_38px_98px_112px_38px_38px_54px] items-center gap-2 border-b border-[rgba(212,160,64,0.08)] px-3.5 py-1 text-[8px] font-black uppercase tracking-[0.13em] text-white/38">
                    <span className="text-center">순위</span>
                    <span className="text-center">변동</span>
                    <span>이름</span>
                    <span className="text-left">RATE</span>
                    <span className="text-center">승</span>
                    <span className="text-center">패</span>
                    <span className="text-center">득실</span>
                  </div>
                  <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
                    {liveRanking.slice(3).map((player, index) => {
                      const rankIndex = index + 3;
                      const settlement = calculateDisplaySettlement(player, rankIndex, liveRanking.length);
                      const totalPlayed = Math.max(1, player.wins + player.losses);
                      const winRate = Math.round((player.wins / totalPlayed) * 100);
                      const movementAmount = Math.min(3, Math.max(1, Math.ceil(Math.abs(player.diff) / 5)));
                      const moveLabel = player.diff > 0 ? `\u25B2${movementAmount}` : player.diff < 0 ? `\u25BC${movementAmount}` : '\u2014';
                      const moveClass = player.diff > 0 ? 'text-red-300' : player.diff < 0 ? 'text-cyan-300' : 'text-white/36';
                      return (
                        <div key={player.id} className={`relative grid min-h-[38px] grid-cols-[38px_38px_98px_112px_38px_38px_54px] items-center gap-2 border-b border-[rgba(212,160,64,0.08)] px-3.5 ${
                          settlement.isPenalty
                            ? 'bg-red-500/[0.052]'
                            : index % 2 === 1 ? 'bg-[rgba(212,160,64,0.04)]' : 'bg-transparent'
                        }`}>
                          {settlement.isPenalty && <div className="absolute inset-y-0 left-0 w-0.5 bg-red-400" />}
                          <span className={`flex h-6 w-6 items-center justify-center justify-self-center text-[13px] font-black leading-none ${settlement.isPenalty ? 'rounded-[5px] bg-red-500/70 text-white' : 'text-[#B0AB9A]'}`}>
                            {rankIndex + 1}
                          </span>
                          <span className={`justify-self-center text-[10px] font-black leading-none tabular-nums ${moveClass}`}>{moveLabel}</span>
                          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                            <p className="min-w-0 truncate text-[13px] font-black text-[#E8DFC0]">{player.name}</p>
                            {settlement.isPenalty && (
                              <span className="shrink-0 rounded-[5px] border border-red-300/22 bg-red-500/12 px-1 py-0.5 text-[7px] font-black leading-none text-red-200">PEN</span>
                            )}
                          </div>
                          <div className="h-[6px] w-[88px] justify-self-start overflow-hidden rounded-[2px] bg-white/[0.08]">
                            <div className="h-full rounded-[2px] shadow-[0_0_4px_rgba(240,203,101,0.28)]" style={{ width: `${winRate}%`, background: 'linear-gradient(90deg, #7A5F1A 0%, #D4A830 100%)' }} />
                          </div>
                          <span className="text-center text-[12px] font-black tabular-nums text-white/70">{player.wins}</span>
                          <span className="text-center text-[12px] font-black tabular-nums text-[#6B6657]">{player.losses}</span>
                          <span className={`text-center text-[12px] font-black tabular-nums ${player.diff > 0 ? 'text-emerald-300' : player.diff < 0 ? 'text-red-300' : 'text-[#6B6657]'}`}>
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

          <section className="col-span-2 relative min-h-0 overflow-hidden rounded-[18px] border border-white/8 bg-[#040810]/96 p-4 shadow-[0_0_0_1px_rgba(2,5,12,0.95),0_16px_38px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.05),inset_0_-16px_28px_rgba(0,0,0,0.18)]">
            <div className="-mx-4 -mt-4 mb-4 flex items-center border-b border-[#F0B93F]/28 bg-[#030810]/95 px-4 pt-4 pb-3">
              <h2 className="flex items-center gap-2.5 text-[21px] font-black uppercase italic tracking-[0.14em] text-[#FFE7A0]/88">
                <span className="h-6 w-[3px] rounded-[4px] bg-emerald-400/60" />
                Completed Recent
              </h2>
            </div>
            {completedMatches.length > 0 ? (
              <div className="grid grid-cols-4 gap-3">
                {completedMatches.slice(0, 4).map((match) => (
                  <CompletedMiniCard key={match.id} match={match} playerLookup={playerLookup} matchNumber={matchNumberMap.get(match.id) || 0} />
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
