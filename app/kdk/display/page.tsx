'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

const CANVAS_PADDING = 40;
const HEADER_HEIGHT = 88;
const TICKER_HEIGHT = 60;
const STACK_GAP = 14;
const RANKING_TOWER_HEIGHT =
  DESIGN_HEIGHT - CANVAS_PADDING * 2 - HEADER_HEIGHT - STACK_GAP - TICKER_HEIGHT - STACK_GAP;
const RANKING_HEADER_H = 48;
const RANKING_PODIUM_H = 158;
const RANKING_LIST_HEADER_H = 32;

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
  const m: any = {
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
    startedAt: row.started_at || row.startedAt || row.updated_at || row.updatedAt || null,
  };
  return m;
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

// Ranking Tower strips the (G) suffix so guests blend into the leaderboard like regular
// members. Court cards / Up Next still get the (G) marker from cleanPlayerName().
function rankingDisplayName(value?: string) {
  return String(value || '').replace(/\s*\(G\)\s*$/i, '').trim();
}

// Associate members who are displayed as regular members but must pay the guest fee
// each time they attend a KDK session. They never get the (G) marker nor a PEN badge
// just because of the fee — only an actual fine/penalty tier triggers PEN.
const ASSOCIATE_GUEST_FEE_NAMES: ReadonlySet<string> = new Set(['차형원']);
function owesAssociateGuestFee(player: { name?: string; isGuest?: boolean }) {
  if (player.isGuest) return false; // already counted as a regular guest
  const clean = rankingDisplayName(player.name).replace(/\s+/g, '');
  return clean.length > 0 && ASSOCIATE_GUEST_FEE_NAMES.has(clean);
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
  // 앱 전체 통일 의미: A조 = Blue, B조 = Orange/Amber. 모바일과 같은 색 의미를 쓰되,
  //   전광판(TV·원거리)에서는 채도·명도 대비를 더 강하게(보색 대비 Blue↔Orange)로 즉시 구분.
  return {
    normalizedGroup,
    isGroupB,
    groupLabel: isGroupB ? 'B조' : 'A조',
    accent: isGroupB ? '#F5811A' : '#2F6FEA',        // main vivid — top strip / border / queue plate
    accentStrong: isGroupB ? '#C2570C' : '#1A52AC',  // strong border/text
    accentDeep: isGroupB ? '#7A3A06' : '#0B2A66',    // deep — VS 원 / COURT 번호 / 배지
    chipBg: isGroupB ? '#B45309' : '#1747A0',
    tintPale: isGroupB ? '#FCEEDB' : '#E8F0FB',       // pale tint — meta capsule / strip 배경
    // 좌측 COURT/Queue plate 솔리드(중간→딥) — 흰색 텍스트가 얹혀 원거리 식별.
    plate: isGroupB
      ? 'linear-gradient(180deg, #F5811A 0%, #C2570C 100%)'
      : 'linear-gradient(180deg, #2F6FEA 0%, #1A47A6 100%)',
    // 카드 본문 배경 — 선수명 가독성 위해 밝게 유지(연한 조 tint).
    //   B조: 본문 넓은 영역 tint 는 강조 요소(plate/strip/border/capsule/VS)와 분리해
    //   기존(#FBEEDC→#F4D9B2)보다 끝쪽 주황을 ~12% 완화한 더 밝은 cream-orange 로 조정.
    backdrop: isGroupB
      ? 'linear-gradient(165deg, #FDF3E6 0%, #F7E1C2 100%)'
      : 'linear-gradient(165deg, #E9EFF8 0%, #CCD9EC 100%)',
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

function formatElapsed(startedAt: string | null | undefined, nowMs: number): string {
  if (!startedAt) return '';
  const start = new Date(startedAt).getTime();
  if (isNaN(start)) return '';
  const diff = Math.max(0, nowMs - start);
  const total = Math.min(diff, 99 * 60000 + 59000);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

// guestFee: KDK 세션 단일 출처(kdk_session_meta.guest_fee). null = 미설정 → 게스트비 미차감(임의 10,000 fabrication 금지).
// isRealPenalty/penaltyTier 는 순위 tier 기반이라 guestFee 와 무관 → 그 값만 쓰는 호출부는 기본값(null)로 호출해도 안전.
function calculateDisplaySettlement(player: RankingEntry, rankIndex: number, total: number, guestFee: number | null = null) {
  const firstPrize = 10000;
  const l1Penalty = 3000;
  const l2Penalty = 5000;
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

  if ((player.isGuest || owesAssociateGuestFee(player)) && guestFee != null) amount -= guestFee;

  // isPenalty includes the guest fee (for finance/settlement parity, untouched).
  // isRealPenalty is the rank-tier signal the Ranking Tower uses for its zone / PEN badge,
  // so guests/associates that aren't in a fine/penalty tier render as ordinary positive rows.
  // penaltyTier surfaces the EXISTING rank-tier fine amount (5000 / 3000 / 0) purely for color —
  //   계산 로직은 그대로(위에서 이미 정한 tier 를 노출만). 게스트비는 penaltyTier 에 포함하지 않음.
  const penaltyTier = isPenaltyTier ? l2Penalty : (isFineTier ? l1Penalty : 0);
  return { amount, isPenalty: amount < 0, isRealPenalty: isPenaltyTier || isFineTier, penaltyTier };
}

function CourtCard({
  court,
  match,
  playerLookup,
  matchNumber,
  nowMs,
}: {
  court: number;
  match?: Match;
  playerLookup: PlayerLookup;
  matchNumber?: number;
  nowMs: number;
}) {
  const groupMeta = getDisplayGroupMeta(match?.groupName || match?.group || 'A');
  const teamA = match ? teamPlayers(match, 0, playerLookup) : [];
  const teamB = match ? teamPlayers(match, 2, playerLookup) : [];
  const live = !!match;
  const elapsed = live ? formatElapsed((match as any).startedAt, nowMs) : '';

  // 전광판 Court 팔레트 — TV·원거리용으로 strip/border 는 채도 높은 vivid accent 그대로 사용
  //   (모바일보다 강하게). 좌측 plate 는 솔리드 조 색(흰 텍스트), 본문 backdrop 만 밝게 유지.
  //   빈 코트(READY)는 중립 슬레이트로 분리.
  const accent = live ? groupMeta.accent : '#7F90A8';
  const accentDeep = live ? groupMeta.accentDeep : '#27324A';
  const plateBg = live ? groupMeta.plate : 'linear-gradient(180deg, #8A98AD 0%, #5E6B80 100%)';
  const metaTint = live ? groupMeta.tintPale : '#EEF1F6';
  const backdrop = live ? groupMeta.backdrop : 'linear-gradient(165deg, #E6EAF1 0%, #C4CCDA 100%)';

  return (
    <section
      className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px]"
      style={{
        background: backdrop,
        boxShadow: `0 0 0 1.5px ${accent}, 0 10px 22px rgba(20,62,146,0.14), inset 0 1px 0 rgba(255,255,255,0.60), inset 0 0 0 1px rgba(255,255,255,0.18)`,
      }}
    >
      <div className="relative z-10 h-[5px] w-full shrink-0" style={{ background: accent }} />

      {/* Court interior — left vertical plate (court number) + right main content (info row + players) */}
      <div className="relative z-10 flex min-h-0 flex-1 items-stretch">
        {/* Left vertical Court Plate — solid identifier visible at TV distance */}
        <div
          className="flex w-[80px] shrink-0 flex-col items-center justify-center gap-0.5"
          style={{
            background: plateBg,
            borderRight: '1px solid rgba(255,255,255,0.22)',
            boxShadow: 'inset -6px 0 12px rgba(0,0,0,0.10)',
          }}
        >
          <span
            className="text-[11px] font-black uppercase tracking-[0.24em]"
            style={{ color: '#FFFFFF', opacity: 0.86 }}
          >
            COURT
          </span>
          <span
            className="text-[60px] font-black leading-none"
            style={{ color: '#FFFFFF' }}
          >
            {court}
          </span>
        </div>

        {/* Right main content — info row + divider + body */}
        <div className="flex min-w-0 flex-1 flex-col">

      {/* Top row: A·R·M chip (centered) · elapsed + LIVE/READY (right) — fixed height for cross-card alignment */}
      <div
        className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-5"
        style={{ height: 44 }}
      >
        <div />
        <div className="justify-self-center">
          {live && (
            <span
              className="flex items-center gap-2 rounded-full px-5 py-1.5 text-[18px] font-black tracking-[0.02em] shadow-[0_2px_6px_rgba(20,62,146,0.12)]"
              style={{
                color: accentDeep,
                background: metaTint,
                border: `1px solid ${accentDeep}40`,
              }}
            >
              <span style={{ color: groupMeta.chipBg }}>{groupMeta.groupLabel}</span>
              <span className="opacity-30">·</span>
              <span className="tabular-nums">{match.round || '-'}R</span>
              <span className="opacity-30">·</span>
              <span className="tabular-nums">{matchNumber != null && matchNumber > 0 ? matchNumber : '--'}경기</span>
            </span>
          )}
        </div>
        <div className="flex items-center justify-self-end gap-1.5">
          {live ? (
            <>
              {elapsed && (
                <span
                  className="rounded-[8px] bg-white/85 px-2.5 py-1 text-[16px] font-black tabular-nums tracking-[0.04em] shadow-[0_2px_5px_rgba(20,62,146,0.10)]"
                  style={{ color: accentDeep }}
                >
                  {elapsed}
                </span>
              )}
              <span className="flex items-center gap-1.5 rounded-[8px] bg-[#D8324A] px-2.5 py-1 text-[15px] font-black uppercase tracking-[0.18em] text-white shadow-[0_2px_6px_rgba(216,50,74,0.32)]">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                LIVE
              </span>
            </>
          ) : (
            <span className="rounded-[8px] bg-[#7F90A8] px-3 py-1 text-[15px] font-black uppercase tracking-[0.22em] text-white">
              READY
            </span>
          )}
        </div>
      </div>

      {/* Hairline divider between top info row and body — defines the scoreboard sections */}
      <div
        className="relative z-10 mx-5 h-px shrink-0"
        style={{ background: `linear-gradient(90deg, transparent 0%, ${accentDeep}33 30%, ${accentDeep}33 70%, transparent 100%)` }}
      />

      {/* Body: name plates stretch to fill card height so the panel reads as one unit, not floating text. */}
      <div className="relative z-10 grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-stretch gap-2 px-3.5 pt-2 pb-3">
        {live ? (
          <>
            <div className="relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[8px] bg-white/30 px-3 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.48),inset_0_-6px_14px_rgba(255,255,255,0.10)]">
              {teamA.map((name, i) => (
                <p
                  key={i}
                  className="w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-center text-[clamp(30px,2.4vw,48px)] font-black leading-[1.04] tracking-[-0.014em] text-[#0A172F]"
                >
                  {name}
                </p>
              ))}
            </div>
            <div className="flex items-center justify-center">
              <span
                className="flex h-[48px] w-[48px] items-center justify-center rounded-full text-[15px] font-black uppercase tracking-[0.06em] text-white shadow-[0_3px_8px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.32)]"
                style={{ background: accentDeep }}
              >
                VS
              </span>
            </div>
            <div className="relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[8px] bg-white/30 px-3 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.48),inset_0_-6px_14px_rgba(255,255,255,0.10)]">
              {teamB.map((name, i) => (
                <p
                  key={i}
                  className="w-full overflow-hidden text-ellipsis whitespace-nowrap break-keep text-center text-[clamp(30px,2.4vw,48px)] font-black leading-[1.04] tracking-[-0.014em] text-[#0A172F]"
                >
                  {name}
                </p>
              ))}
            </div>
          </>
        ) : (
          <div className="col-span-3 flex flex-col items-center justify-center gap-1.5 rounded-[8px] bg-white/22 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.40)]">
            <p className="text-[34px] font-black uppercase tracking-[0.26em] text-[#3F506A]">STAND BY</p>
            <p className="text-[12px] font-black uppercase tracking-[0.28em] text-[#5B6B82]">코트 비어있음</p>
          </div>
        )}
      </div>
        </div>
      </div>
    </section>
  );
}

// Single uniform card. NEXT is the first in the lane with a slightly stronger ring
// and a gold NEXT chip — visually the leader of the queue, not a separate block.
function UpNextCard({
  match,
  index,
  playerLookup,
  matchNumber,
}: {
  match: Match;
  index: number;
  playerLookup: PlayerLookup;
  matchNumber?: number;
}) {
  const groupMeta = getDisplayGroupMeta(match.groupName || match.group || 'A');
  const isNext = index === 0;
  const teamA = teamLabel(match, 0, playerLookup);
  const teamB = teamLabel(match, 2, playerLookup);

  // Meta bar 는 조-코드 연한 tint(A=pale blue / B=pale amber) — 흰 본문이 주 가독 영역.
  //   좌측 queue plate 는 솔리드 조 색(groupMeta.plate)으로 멀리서도 A/B 가 바로 보이게 한다.
  const metaStripBg = isNext
    ? (groupMeta.isGroupB ? '#FBDFC0' : '#D8E5F8')
    : (groupMeta.isGroupB ? '#FCEEDB' : '#E8F0FB');
  const metaStripBorder = groupMeta.isGroupB
    ? 'rgba(194,87,12,0.30)'
    : 'rgba(26,82,172,0.25)';

  return (
    <div
      className="relative flex h-full min-w-0 overflow-hidden rounded-[12px] bg-white backdrop-blur-sm"
      style={{
        boxShadow: isNext
          ? `0 0 0 1.5px ${groupMeta.accentStrong}, 0 3px 8px rgba(31,75,160,0.18), inset 0 1px 0 rgba(255,255,255,0.80), inset 0 0 0 1px rgba(255,255,255,0.55)`
          : `0 0 0 1px ${groupMeta.accent}55, 0 2px 6px rgba(31,49,87,0.10), inset 0 1px 0 rgba(255,255,255,0.75), inset 0 0 0 1px rgba(255,255,255,0.45)`,
      }}
    >
      {/* Queue Plate — uniform 01/02/03/04 marker; 솔리드 조 색 + 흰 숫자로 A/B 원거리 식별 */}
      <div
        className="flex w-[44px] shrink-0 flex-col items-center justify-center"
        style={{ background: groupMeta.plate, borderRight: '1px solid rgba(255,255,255,0.22)' }}
      >
        <span
          className="text-[22px] font-black leading-none tabular-nums"
          style={{ color: '#FFFFFF' }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
      </div>
      {/* Right column — meta bar + match body */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Meta bar — M number + 조 only (NEXT/#N moved out to queue plate for uniformity) */}
        <div
          className="flex shrink-0 items-center justify-center gap-1.5 px-2.5"
          style={{ height: 28, background: metaStripBg, borderBottom: `1px solid ${metaStripBorder}` }}
        >
          {matchNumber != null && matchNumber > 0 && (
            <span
              className="rounded-[5px] px-2 py-0.5 text-[15px] font-black leading-none tabular-nums text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.20)]"
              style={{ background: groupMeta.accentDeep }}
            >
              M{String(matchNumber).padStart(2, '0')}
            </span>
          )}
          <span
            className="rounded-[5px] bg-white/85 px-1.5 py-0.5 text-[11px] font-black uppercase leading-none tracking-[0.12em]"
            style={{ color: groupMeta.accentDeep }}
          >
            {groupMeta.groupLabel}
          </span>
        </div>
        {/* Match body — players & VS */}
        <div className="flex flex-1 min-h-0 items-center justify-between gap-1.5 px-2.5 py-2">
        <p
          className="min-w-0 flex-1 break-keep text-center text-[clamp(18px,1.3vw,25px)] font-black leading-[1.12] tracking-[-0.014em] text-[#050D20]"
          style={{ textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}
        >
          {teamA.split(' / ').map((n, i) => (
            <span key={i} className="block break-keep">{n}</span>
          ))}
        </p>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#050D20] text-[11px] font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.20)]">
          VS
        </span>
        <p
          className="min-w-0 flex-1 break-keep text-center text-[clamp(18px,1.3vw,25px)] font-black leading-[1.12] tracking-[-0.014em] text-[#050D20]"
          style={{ textShadow: '0 1px 0 rgba(255,255,255,0.45)' }}
        >
          {teamB.split(' / ').map((n, i) => (
            <span key={i} className="block break-keep">{n}</span>
          ))}
        </p>
      </div>
      </div>
    </div>
  );
}

function HeaderStat({ title, value, color }: { title: string; value: number | string; color: string }) {
  return (
    <div className="flex h-[56px] min-w-[78px] flex-col items-center justify-center rounded-[10px] bg-white/[0.08] px-3 backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <p className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color }}>{title}</p>
      <p className="mt-0.5 text-[22px] font-black leading-none tabular-nums text-white">{value}</p>
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
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('IDLE');
  const [resolvedSessionId, setResolvedSessionId] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tickerMessage, setTickerMessage] = useState('');
  // 게스트비 단일 출처(kdk_session_meta.guest_fee). null = 미설정(미차감).
  const [displayGuestFee, setDisplayGuestFee] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [zoom, setZoom] = useState({ userZoom: 1, panX: 0, panY: 0 });

  const viewerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  // [동시 조작 안정화] Realtime refresh debounce + stale 응답 폐기 (표시 로직/디자인 무변경).
  const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchMatchesSeqRef = useRef(0);
  const tickerGroupRef = useRef<HTMLDivElement>(null);
  const [tickerDuration, setTickerDuration] = useState(18);
  const edgeSwipeRef = useRef({ isEdge: false, startX: 0, startY: 0 });
  zoomRef.current = zoom;
  const gestureRef = useRef<{
    isPinching: boolean;
    isDragging: boolean;
    lastTapTime: number;
    initialPinchDist: number;
    startUserZoom: number;
    dragStartX: number;
    dragStartY: number;
    startPanX: number;
    startPanY: number;
  }>({
    isPinching: false,
    isDragging: false,
    lastTapTime: 0,
    initialPinchDist: 0,
    startUserZoom: 1,
    dragStartX: 0,
    dragStartY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  const fetchTickerMessage = async (sid: string) => {
    if (!sid) return;
    const { data } = await supabase
      .from('kdk_session_meta')
      .select('ticker_message, guest_fee')
      .eq('session_id', sid)
      .maybeSingle();
    setTickerMessage(data?.ticker_message ?? '');
    // 게스트비 단일 출처. 숫자(≥0)만 반영, 그 외(null/컬럼 미적용)는 미설정으로 둔다(미차감).
    const gf = (data as { guest_fee?: unknown } | null)?.guest_fee;
    setDisplayGuestFee(typeof gf === 'number' && gf >= 0 ? gf : null);
  };

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

    const seq = ++fetchMatchesSeqRef.current; // 최신 요청 식별
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

      // stale 응답 폐기: 이 요청 이후 더 최신 fetch 가 시작됐으면 화면 반영하지 않음
      // (연속 Realtime 이벤트 / 세션 전환 시 이전 snapshot 이 최신 화면을 덮는 것 방지).
      if (seq !== fetchMatchesSeqRef.current) return;

      const nextMatches = data.map(mapMatch).sort(sortMatches);
      setResolvedSessionId(nextResolvedSessionId);
      setMatches(nextMatches);
      setSessionTitle(data?.[0]?.session_title || targetSessionId);
      fetchTickerMessage(nextResolvedSessionId);
      setLastSync(new Date().toLocaleTimeString('ko-KR', { hour12: false }));
    } catch (err: any) {
      console.error('[KDK Display] fetchMatches failed:', err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(formatClock());
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const applyKeyframe = (w: number) => {
      let st = document.querySelector('style[data-id="ticker-marquee"]') as HTMLStyleElement | null;
      if (!st) {
        st = document.createElement('style');
        st.dataset.id = 'ticker-marquee';
        document.head.appendChild(st);
      }
      st.textContent = `@keyframes ticker-scroll{from{transform:translateX(-${w}px)}to{transform:translateX(0)}}`;
      setTickerDuration(Math.max(10, Math.round(w / 80)));
    };

    const measure = () => {
      const el = tickerGroupRef.current;
      if (!el || el.offsetWidth === 0) return;
      applyKeyframe(el.offsetWidth);
    };

    const raf = requestAnimationFrame(measure);

    const ro = new ResizeObserver(() => {
      const el = tickerGroupRef.current;
      if (el && el.offsetWidth > 0) applyKeyframe(el.offsetWidth);
    });
    if (tickerGroupRef.current) ro.observe(tickerGroupRef.current);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      const s = document.querySelector('style[data-id="ticker-marquee"]');
      if (s?.parentNode) s.parentNode.removeChild(s);
    };
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
    const calcScale = () => {
      const sw = window.innerWidth / DESIGN_WIDTH;
      const sh = window.innerHeight / DESIGN_HEIGHT;
      setScale(Math.min(sw, sh, 1));
    };
    calcScale();
    window.addEventListener('resize', calcScale);
    return () => window.removeEventListener('resize', calcScale);
  }, []);

  const router = useRouter();
  const handleBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/kdk');
  };

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const pinchDist = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const g = gestureRef.current;
      const { userZoom, panX, panY } = zoomRef.current;

      if (e.touches.length === 2) {
        g.isPinching = true;
        g.isDragging = false;
        g.initialPinchDist = pinchDist(e.touches);
        g.startUserZoom = userZoom;
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - g.lastTapTime < 300) {
          setZoom({ userZoom: 1, panX: 0, panY: 0 });
          g.lastTapTime = 0;
          return;
        }
        g.lastTapTime = now;
        g.isPinching = false;
        g.isDragging = true;
        g.dragStartX = e.touches[0].clientX;
        g.dragStartY = e.touches[0].clientY;
        g.startPanX = panX;
        g.startPanY = panY;
        const ex = e.touches[0].clientX;
        edgeSwipeRef.current = { isEdge: ex < 32, startX: ex, startY: e.touches[0].clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const g = gestureRef.current;

      if (g.isPinching && e.touches.length === 2) {
        const ratio = pinchDist(e.touches) / g.initialPinchDist;
        const newUserZoom = Math.min(3, Math.max(1, g.startUserZoom * ratio));
        setZoom((prev) => ({
          ...prev,
          userZoom: newUserZoom,
          ...(newUserZoom <= 1 ? { panX: 0, panY: 0 } : {}),
        }));
      } else if (g.isDragging && e.touches.length === 1) {
        if (zoomRef.current.userZoom <= 1) return;
        const dx = e.touches[0].clientX - g.dragStartX;
        const dy = e.touches[0].clientY - g.dragStartY;
        setZoom((prev) => ({
          ...prev,
          panX: g.startPanX + dx,
          panY: g.startPanY + dy,
        }));
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (e.touches.length < 2) g.isPinching = false;
      if (e.touches.length === 0) {
        g.isDragging = false;
        const es = edgeSwipeRef.current;
        if (es.isEdge && !g.isPinching && zoomRef.current.userZoom === 1 && e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          const dx = t.clientX - es.startX;
          const dy = t.clientY - es.startY;
          if (dx > 90 && Math.abs(dy) < 60) {
            edgeSwipeRef.current.isEdge = false;
            if (window.history.length > 1) router.back();
            else router.push('/kdk');
          }
        }
        edgeSwipeRef.current.isEdge = false;
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
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
          // [동시 조작 안정화] 이벤트마다 즉시 재조회하지 않고 220ms debounce 후 1회만 재조회.
          if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
          realtimeRefreshTimerRef.current = setTimeout(() => fetchMatches(activeRealtimeSessionId), 220);
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'kdk_session_meta',
        filter: `session_id=eq.${activeRealtimeSessionId}`,
      }, (payload: any) => {
        if (payload.new) {
          setTickerMessage(payload.new.ticker_message ?? '');
        }
      })
      .subscribe((status) => {
        setRealtimeStatus(status);
        console.log('[KDK Display] Realtime status:', status);
      });

    return () => {
      if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
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

  // Up Next picks 4 matches with A조 / B조 balanced (2 each by default).
  // If one group has fewer than 2 waiting, the remaining slots are filled from the other
  // group / fallback group in the original waiting order, so the lane is never short
  // while the natural sort order is preserved within each group.
  const upNextMatches = useMemo(() => {
    const groupKey = (m: Match) => normalizeDisplayGroup(m.groupName || m.group || '');
    const groupA = waitingMatches.filter((m) => groupKey(m) === 'A');
    const groupB = waitingMatches.filter((m) => groupKey(m) === 'B');
    const others = waitingMatches.filter((m) => {
      const key = groupKey(m);
      return key !== 'A' && key !== 'B';
    });

    const picks: Match[] = [];
    const seen = new Set<string>();
    const take = (list: Match[], n: number) => {
      for (const m of list) {
        if (picks.length >= 4) return;
        if (n <= 0) return;
        if (seen.has(m.id)) continue;
        picks.push(m);
        seen.add(m.id);
        n--;
      }
    };

    take(groupA, 2);
    take(groupB, 2);

    // Fill remaining slots from leftover A, B, then non-grouped matches, preserving order.
    if (picks.length < 4) take(groupA, 4 - picks.length);
    if (picks.length < 4) take(groupB, 4 - picks.length);
    if (picks.length < 4) take(others, 4 - picks.length);

    // Final order follows the natural waiting sort so the lane reads left→right
    // in the same priority the operator sees in /kdk.
    const indexOf = new Map<string, number>();
    waitingMatches.forEach((m, i) => indexOf.set(m.id, i));
    picks.sort((a, b) => (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0));
    return picks;
  }, [waitingMatches]);

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
  const playingCount = matches.filter((match) => match.status === 'playing').length;
  const totalMatches = matches.length;
  const progressPercent = totalMatches > 0 ? Math.round((completedMatches.length / totalMatches) * 100) : 0;
  const statusLabel = realtimeStatus === 'SUBSCRIBED' ? 'LIVE' : realtimeStatus;
  const tickerNextMatch = waitingMatches[0] ?? null;
  const tickerNextMatchNum = tickerNextMatch ? (matchNumberMap.get(tickerNextMatch.id) ?? 0) : 0;
  const tickerLeader = liveRanking[0] ?? null;
  const tickerGuests = useMemo(() => {
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

  const manualTicker = tickerMessage?.trim() || '';

  // Dark Arena-style ranking: TOP3 podium (separate), then rows 4..N below.
  // Row height + tiny row gap adapt to participant count so the list reaches further
  // down the Tower when few people are present, without breaking grid alignment.
  const rankingTotal = liveRanking.length;
  const rankRestCount = Math.max(0, rankingTotal - 3);
  // Canvas-derived: aside content area minus header(48) + footer(44) + p-2(16) + podium(158) + gap-1.5×2(12) + list-header(32)
  // = 824 - 48 - 44 - 16 - 158 - 12 - 32 = 514
  // Footer is 44px so TOTAL N PLAYERS · UPDATED HH:MM reads in one line without crowding.
  const rankingRowsAvail = 514;
  const rankRowBase = 50;
  const rankRowMax = 64;
  const rankRowMin = 32;
  let rankRowH = rankRowBase;
  let rankRowGap = 0;
  if (rankRestCount > 0) {
    const raw = rankingRowsAvail / rankRestCount;
    if (raw < rankRowBase) {
      rankRowH = Math.max(rankRowMin, raw);
    } else if (raw <= rankRowMax) {
      rankRowH = raw;
    } else {
      rankRowH = rankRowMax;
      const slack = rankingRowsAvail - rankRowH * rankRestCount;
      rankRowGap = rankRestCount > 1 ? Math.min(14, slack / (rankRestCount - 1)) : 0;
    }
  }
  const rankNameFont = Math.max(13, Math.min(17, rankRowH * 0.32));
  const rankNumFont = Math.max(12, Math.min(15, rankRowH * 0.30));
  const rankRankFont = Math.max(13, Math.min(16, rankRowH * 0.30));
  const rankMoveFont = Math.max(11, Math.min(13, rankRowH * 0.24));

  // Ticker — 4 items at most (NOTICE only when message exists, LEADER only when ranking has data).
  const tickerLabelStyle = (color: string): React.CSSProperties => ({
    color,
    fontWeight: 900,
    letterSpacing: '0.22em',
    fontSize: 16,
    textTransform: 'uppercase',
    flexShrink: 0,
  });
  const tickerTextStyle: React.CSSProperties = {
    color: '#FFFFFF',
    fontWeight: 900,
    fontSize: 23,
    letterSpacing: '0.005em',
    flexShrink: 0,
  };
  const tickerDimStyle: React.CSSProperties = {
    color: '#D7E5FB',
    fontWeight: 800,
    fontSize: 23,
    flexShrink: 0,
  };

  const tickerItems: React.ReactNode[] = [];

  if (manualTicker) {
    tickerItems.push(
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 10 }}>
        <span style={tickerLabelStyle('#FFD66B')}>NOTICE</span>
        <span style={tickerTextStyle}>{manualTicker}</span>
      </div>
    );
  }

  tickerItems.push(
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 10 }}>
      <span style={tickerLabelStyle('#A8E3FF')}>UP NEXT</span>
      {tickerNextMatchNum > 0 && (
        <span style={{ ...tickerDimStyle }}>M{String(tickerNextMatchNum).padStart(2, '0')}</span>
      )}
      {tickerNextMatch ? (
        <span style={tickerTextStyle}>
          {teamLabel(tickerNextMatch, 0, playerLookup).replace(/ \/ /g, '/')}{' '}
          <span style={{ color: '#A8C7F0', fontWeight: 800 }}>vs</span>{' '}
          {teamLabel(tickerNextMatch, 2, playerLookup).replace(/ \/ /g, '/')}
        </span>
      ) : (
        <span style={tickerDimStyle}>대기 경기 없음</span>
      )}
    </div>
  );

  if (tickerLeader) {
    tickerItems.push(
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 10 }}>
        <span style={tickerLabelStyle('#FFD66B')}>LEADER</span>
        <span style={tickerTextStyle}>{tickerLeader.name}</span>
        <span
          style={{
            color: tickerLeader.diff > 0 ? '#8EEACA' : tickerLeader.diff < 0 ? '#FFB6BE' : '#D7E5FB',
            fontWeight: 900,
            fontSize: 23,
            flexShrink: 0,
          }}
        >
          {tickerLeader.diff > 0 ? '+' : ''}{tickerLeader.diff}
        </span>
      </div>
    );
  }

  tickerItems.push(
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: 10 }}>
      <span style={tickerLabelStyle('#9CECD1')}>WELCOME</span>
      <span style={tickerTextStyle}>
        {tickerGuests.length > 0
          ? `${tickerGuests.slice(0, 5).join(', ')}${tickerGuests.length > 5 ? ` 외 ${tickerGuests.length - 5}명` : ''}`
          : 'TEYEON PLAYERS'}
      </span>
    </div>
  );

  const tickerGroupContent = (
    <>
      {tickerItems.map((item, i) => (
        <React.Fragment key={i}>{item}</React.Fragment>
      ))}
    </>
  );

  return (
    <div
      ref={viewerRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-[#C7D5E8]"
      style={{ touchAction: 'none' }}
    >
      <button
        onClick={handleBack}
        className="fixed z-[10000] flex items-center gap-1 rounded-full border border-[#1F4080]/40 bg-white/85 px-3 py-2 text-[13px] font-bold text-[#0F2F5F] backdrop-blur-sm transition-all active:scale-95 md:hidden"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)', left: 'calc(env(safe-area-inset-left, 0px) + 8px)' }}
      >
        ← BACK
      </button>
      <div
        style={{
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `translate(${zoom.panX}px, ${zoom.panY}px) scale(${scale * zoom.userZoom})`,
          transformOrigin: 'center center',
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#E6EEF9_0%,#D3DEEF_55%,#BFCEE5_100%)]" />
        <div className="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(rgba(28,62,118,0.8)_1px,transparent_1px),linear-gradient(90deg,rgba(28,62,118,0.8)_1px,transparent_1px)] [background-size:96px_96px]" />

        <div className="relative flex h-full flex-col gap-3.5 p-10 text-[#0A172F]">

          {/* HEADER */}
          <header
            className="relative grid shrink-0 grid-cols-[auto_1fr_auto] items-center overflow-hidden rounded-[16px] bg-[linear-gradient(180deg,#163E73_0%,#0A234F_100%)] px-8 shadow-[0_14px_28px_rgba(15,40,95,0.28),inset_0_1px_0_rgba(255,255,255,0.14),inset_0_-1px_0_rgba(242,199,101,0.30)]"
            style={{ height: HEADER_HEIGHT }}
          >
            {/* LEFT column — session info; position handled by header px-8 alone, no forced shift */}
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[12px] font-black uppercase leading-[1.15] tracking-[0.32em] text-[#F2C765]">TEYEON KDK · LIVE BOARD</p>
              <h1 className="truncate text-[34px] font-black leading-[1.1] text-white">
                {sessionTitle || sessionId || 'NO SESSION'}
              </h1>
            </div>
            {/* MIDDLE column — flexible empty spacer (1fr) that guarantees the right cluster sits on the right side regardless of title length */}
            <div aria-hidden="true" />
            {/* RIGHT column — stats + TIME + LIVE; anchored to the right edge by the grid template */}
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-2">
                <HeaderStat title="PLAYING" value={playingCount} color="#FFC0C8" />
                <HeaderStat title="WAITING" value={waitingMatches.length} color="#FFE08A" />
                <HeaderStat title="DONE" value={`${completedMatches.length}/${totalMatches}`} color="#8FE6C9" />
                <HeaderStat title="PROGRESS" value={`${progressPercent}%`} color="#9DC8FF" />
              </div>
              <div className="flex h-[56px] flex-col items-end justify-center border-l border-white/20 pl-4">
                <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[#B6CCE6]">TIME</p>
                <p className="text-[28px] font-black leading-none text-white tabular-nums">{clock}</p>
              </div>
              <span className="rounded-full bg-[#D8324A] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-white shadow-[0_2px_6px_rgba(216,50,74,0.36)]">
                {statusLabel}
              </span>
            </div>
            <button type="button" onClick={toggleFullscreen} className="hidden">
              {isFullscreen ? '전체화면 해제' : '전체화면'}
            </button>
          </header>

          {/* TICKER */}
          <div
            className="flex shrink-0 items-stretch overflow-hidden rounded-[12px] shadow-[0_10px_20px_rgba(15,40,95,0.18),inset_0_-1px_0_rgba(255,255,255,0.20),inset_0_1px_0_rgba(255,255,255,0.12)]"
            style={{ height: TICKER_HEIGHT }}
          >
            <div className="flex w-[136px] shrink-0 items-center justify-center gap-2 bg-[linear-gradient(180deg,#E13548_0%,#B6263A_100%)]">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]" />
              <span className="text-[22px] font-black uppercase tracking-[0.22em] text-white">LIVE</span>
            </div>
            <div
              className="relative flex flex-1 min-w-0 items-center overflow-hidden bg-[linear-gradient(90deg,#143E92_0%,#1C58B5_100%)] px-5"
              style={{
                maskImage: 'linear-gradient(90deg, transparent 0, #000 20px, #000 calc(100% - 32px), transparent 100%)',
                WebkitMaskImage: 'linear-gradient(90deg, transparent 0, #000 20px, #000 calc(100% - 32px), transparent 100%)',
              }}
            >
              <div
                className="flex shrink-0 items-center whitespace-nowrap"
                style={{ animation: `ticker-scroll ${tickerDuration}s linear infinite`, willChange: 'transform' }}
              >
                <div ref={tickerGroupRef} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: '48px', paddingRight: '80px' }}>
                  {tickerGroupContent}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, gap: '48px', paddingRight: '80px' }} aria-hidden="true">
                  {tickerGroupContent}
                </div>
              </div>
            </div>
          </div>

          {/* MAIN — left (Courts + Up Next stacked) | right (Ranking Tower full height) */}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_460px] gap-4">

            <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_136px] gap-4">
              <div className="grid min-h-0 min-w-0 grid-cols-2 grid-rows-2 gap-4">
                {[1, 2, 3, 4].map((court) => {
                  const courtMatch = playingByCourt.get(court);
                  return (
                    <CourtCard
                      key={court}
                      court={court}
                      match={courtMatch}
                      playerLookup={playerLookup}
                      matchNumber={courtMatch ? matchNumberMap.get(courtMatch.id) || 0 : 0}
                      nowMs={nowMs}
                    />
                  );
                })}
              </div>

              {/* UP NEXT LANE — neutral slate background so the lane reads as a calmer side area, distinct from the blue Court panels above */}
              <div className="flex gap-2.5 rounded-[16px] bg-[linear-gradient(180deg,#E8ECF2_0%,#D7DEE8_100%)] p-2.5 shadow-[0_8px_18px_rgba(15,40,95,0.12),inset_0_1px_0_rgba(255,255,255,0.7),inset_0_0_0_1px_rgba(255,255,255,0.45)]">
                <div className="flex w-[84px] shrink-0 flex-col items-center justify-center rounded-[12px] bg-[linear-gradient(160deg,#1747A0_0%,#0E2E72_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#A8C7F0]">UP NEXT</p>
                  <p className="mt-0.5 text-[30px] font-black leading-none tabular-nums text-white">{waitingMatches.length}</p>
                  <p className="mt-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-[#A8C7F0]">대기</p>
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-4 gap-2">
                  {upNextMatches.map((match, index) => (
                    <UpNextCard
                      key={match.id}
                      match={match}
                      index={index}
                      playerLookup={playerLookup}
                      matchNumber={matchNumberMap.get(match.id) || 0}
                    />
                  ))}
                  {!loading && waitingMatches.length === 0 && (
                    <div className="col-span-4 flex items-center justify-center rounded-[12px] bg-white/75 text-[15px] font-black uppercase tracking-[0.18em] text-[#3F506A]">
                      대기 경기 없음
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT column: RANKING TOWER — Dark Arena structure restored in light colors */}
            <aside
              className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[16px] bg-[#FBF6E5]"
              style={{ boxShadow: '0 0 0 1.5px #C9B274, 0 14px 28px rgba(80,60,20,0.16), inset 0 1px 0 rgba(255,255,255,0.70), inset 0 0 0 1px rgba(255,245,210,0.55)' }}
            >
              {/* Header — title only; participant count moved to the bottom footer (TOTAL N PLAYERS) */}
              <div
                className="flex shrink-0 items-center bg-[linear-gradient(180deg,#142340_0%,#0A1A33_100%)] px-5 shadow-[inset_0_-2px_0_rgba(255,200,90,0.30)]"
                style={{ height: RANKING_HEADER_H }}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-block h-5 w-[3px] shrink-0 rounded-[2px] bg-[#F2C765]" />
                  <h2 className="truncate text-[18px] font-black uppercase tracking-[0.22em] text-[#F2C765]">★ RANKING TOWER</h2>
                </div>
              </div>

              {rankingTotal === 0 ? (
                <div className="flex flex-1 items-center justify-center px-4 text-center text-[14px] font-black uppercase tracking-[0.2em] text-[#9C7E3A]">
                  랭킹 데이터가 없습니다
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
                  {/* TOP3 Podium — 2위 left | 1위 center (raised) | 3위 right (Dark Arena layout) */}
                  <div
                    className="grid shrink-0 grid-cols-3 items-end gap-2"
                    style={{ height: RANKING_PODIUM_H }}
                  >
                    {/* 2위 — silver, left */}
                    {liveRanking[1] && (() => {
                      const p = liveRanking[1];
                      const isPen = calculateDisplaySettlement(p, 1, liveRanking.length).isRealPenalty;
                      return (
                        <div className="relative flex min-h-[124px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-[12px] border border-[#7B8AA0]/55 bg-[linear-gradient(160deg,#ECF1F8_0%,#B6C5DA_100%)] px-2 pt-2 pb-2 text-center shadow-[0_3px_8px_rgba(80,60,20,0.10),inset_0_1px_0_rgba(255,255,255,0.45)]">
                          <div className="flex flex-col items-center">
                            <div className="text-[7px] font-black uppercase tracking-[0.22em] text-[#1F2A3F]/55">2nd</div>
                            <div className="mx-auto mt-1 flex h-10 w-10 items-center justify-center rounded-full border border-[#7B8AA0] bg-[linear-gradient(135deg,#EAEEF5_0%,#7A8AA0_60%,#BDC8D9_100%)] text-[18px] font-black leading-none text-white shadow-[0_0_8px_rgba(180,196,220,0.30),inset_0_1px_0_rgba(255,255,255,0.40)]">
                              2
                            </div>
                          </div>
                          <div className="flex w-full min-w-0 items-center justify-center gap-1">
                            <p className="min-w-0 truncate px-1 text-[15px] font-black leading-tight text-[#16213A]">{p.name}</p>
                            {isPen && <span className="shrink-0 rounded-[3px] bg-[#D8324A] px-1 py-0.5 text-[7px] font-black leading-none text-white">PEN</span>}
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <p className="text-[9px] font-black text-[#16213A]/65 tabular-nums">{p.wins}W {p.losses}L</p>
                            <p
                              className="text-[13px] font-black tabular-nums"
                              style={{ color: p.diff > 0 ? '#0C6E36' : p.diff < 0 ? '#B12830' : '#16213A' }}
                            >
                              {p.diff > 0 ? '+' : ''}{p.diff}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 1위 — gold, center (raised) */}
                    {liveRanking[0] && (() => {
                      const p = liveRanking[0];
                      const isPen = calculateDisplaySettlement(p, 0, liveRanking.length).isRealPenalty;
                      return (
                        <div className="relative flex min-h-[152px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-[14px] border border-[#A87A1E]/68 bg-[linear-gradient(160deg,#FCEEC0_0%,#E4C262_100%)] px-2 pt-2 pb-2 text-center shadow-[0_0_18px_rgba(216,170,60,0.28),0_5px_14px_rgba(80,60,20,0.20),inset_0_1px_0_rgba(255,245,210,0.55)]">
                          <div className="flex flex-col items-center">
                            <div className="text-[12px] leading-none text-[#A87A1E]">♛</div>
                            <div className="text-[7px] font-black uppercase tracking-[0.22em] text-[#A87A1E]">LEADER</div>
                            <div className="mx-auto mt-1 flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#C8A04E] bg-[linear-gradient(135deg,#FFE066_0%,#C28B0A_55%,#F5C842_100%)] text-[22px] font-black leading-none text-[#3A2400] shadow-[0_0_14px_rgba(216,170,60,0.45),inset_0_1px_0_rgba(255,255,220,0.55)]">
                              1
                            </div>
                          </div>
                          <div className="flex w-full min-w-0 items-center justify-center gap-1">
                            <p className="min-w-0 truncate px-1 text-[18px] font-black leading-tight text-[#2C1A00]">{p.name}</p>
                            {isPen && <span className="shrink-0 rounded-[3px] bg-[#D8324A] px-1 py-0.5 text-[7px] font-black leading-none text-white">PEN</span>}
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <p className="text-[10px] font-black text-[#3A2400]/70 tabular-nums">{p.wins}W {p.losses}L</p>
                            <p
                              className="text-[15px] font-black tabular-nums"
                              style={{ color: p.diff > 0 ? '#0C6E36' : p.diff < 0 ? '#B12830' : '#3A2400' }}
                            >
                              {p.diff > 0 ? '+' : ''}{p.diff}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* 3위 — bronze, right */}
                    {liveRanking[2] && (() => {
                      const p = liveRanking[2];
                      const isPen = calculateDisplaySettlement(p, 2, liveRanking.length).isRealPenalty;
                      return (
                        <div className="relative flex min-h-[114px] min-w-0 flex-col items-center justify-between overflow-hidden rounded-[12px] border border-[#8A4E18]/55 bg-[linear-gradient(160deg,#F1CFA0_0%,#B57543_100%)] px-2 pt-2 pb-2 text-center shadow-[0_3px_8px_rgba(80,60,20,0.10),inset_0_1px_0_rgba(255,225,200,0.45)]">
                          <div className="flex flex-col items-center">
                            <div className="text-[7px] font-black uppercase tracking-[0.22em] text-[#3A1D02]/65">3rd</div>
                            <div className="mx-auto mt-1 flex h-9 w-9 items-center justify-center rounded-full border border-[#8A4E18] bg-[linear-gradient(135deg,#E8974A_0%,#924E10_55%,#D07830_100%)] text-[16px] font-black leading-none text-white shadow-[0_0_8px_rgba(180,116,68,0.30),inset_0_1px_0_rgba(255,200,140,0.40)]">
                              3
                            </div>
                          </div>
                          <div className="flex w-full min-w-0 items-center justify-center gap-1">
                            <p className="min-w-0 truncate px-1 text-[15px] font-black leading-tight text-[#2A1300]">{p.name}</p>
                            {isPen && <span className="shrink-0 rounded-[3px] bg-[#D8324A] px-1 py-0.5 text-[7px] font-black leading-none text-white">PEN</span>}
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                            <p className="text-[9px] font-black text-[#2A1300]/65 tabular-nums">{p.wins}W {p.losses}L</p>
                            <p
                              className="text-[13px] font-black tabular-nums"
                              style={{ color: p.diff > 0 ? '#0C6E36' : p.diff < 0 ? '#B12830' : '#2A1300' }}
                            >
                              {p.diff > 0 ? '+' : ''}{p.diff}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 8-column list header — last column is right-safe spacer */}
                  <div
                    className="grid shrink-0 grid-cols-[36px_42px_minmax(0,1fr)_90px_42px_42px_48px_24px] items-center gap-1.5 border-t border-[#C9B274]/70 border-b-2 border-b-[rgba(90,65,20,0.30)] bg-[#E8D8A8] px-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#4F3A0D]"
                    style={{ height: RANKING_LIST_HEADER_H }}
                  >
                    <span className="text-center">순위</span>
                    <span className="text-center">변동</span>
                    <span>이름</span>
                    <span className="text-left">RATE</span>
                    <span className="text-center">승</span>
                    <span className="text-center">패</span>
                    <span className="pr-1 text-right">득실</span>
                    <span aria-hidden="true" />
                  </div>

                  {/* Rank 4..N list — Dark Arena 7-col grid in light tones */}
                  <div
                    className="flex min-h-0 flex-1 flex-col overflow-hidden"
                    style={{ rowGap: rankRowGap }}
                  >
                    {liveRanking.slice(3).map((player, index) => {
                      const rankIndex = index + 3;
                      const settlement = calculateDisplaySettlement(player, rankIndex, liveRanking.length, displayGuestFee);
                      const totalPlayed = Math.max(1, player.wins + player.losses);
                      const winRate = Math.round((player.wins / totalPlayed) * 100);
                      const movementAmount = Math.min(3, Math.max(1, Math.ceil(Math.abs(player.diff) / 5)));
                      const moveLabel = player.diff > 0 ? `▲${movementAmount}` : player.diff < 0 ? `▼${movementAmount}` : '—';
                      const moveColor = player.diff > 0 ? '#B12830' : player.diff < 0 ? '#0C7F94' : '#7A6655';
                      // Absolute rank parity drives per-row identity so each line reads on its own:
                      //   positive even rank (4, 6, 8...) → near-white + muted-gold accent
                      //   positive odd rank (5, 7, 9...)  → pale blue-gray + muted-slate accent
                      //   penalty odd rank (7, 9, 11...) → light coral
                      //   penalty even rank (8, 10, 12)  → slightly deeper coral
                      // Every row gets a left strip so the line's start is visible at TV distance.
                      const rankNumber = rankIndex + 1;
                      const isRankEven = rankNumber % 2 === 0;
                      // Use isRealPenalty (rank tier) for every visual decision so a guest who
                      // sits outside the fine/penalty tier renders like any other positive row.
                      const isPenZone = settlement.isRealPenalty;
                      // 벌금 tier 별 색 분리(계산 결과만 시각화): 5,000원 = Coral/Red, 3,000원 = Amber/Orange.
                      //   ※ 이 Amber 는 Ranking Tower row/PEN badge 전용 — Court/Up Next 의 B조 Orange 와 역할 분리.
                      const penaltyTier = settlement.penaltyTier; // 5000 | 3000 | 0
                      const isHeavyPen = penaltyTier === 5000;
                      const isFinePen = penaltyTier === 3000;
                      const rowBg = isHeavyPen
                        ? (isRankEven ? '#FAD9D2' : '#FFE6E1')
                        : isFinePen
                          ? (isRankEven ? '#FBE2BE' : '#FFF1D6')
                          : (isRankEven ? '#FFFFFF' : '#EAF1F8');
                      const rowBorderColor = isHeavyPen
                        ? 'rgba(170,70,60,0.22)'
                        : isFinePen
                          ? 'rgba(176,116,28,0.24)'
                          : 'rgba(60,80,110,0.20)';
                      const rateTrackBg = isHeavyPen ? '#E8C6BB' : isFinePen ? '#EAD6AE' : '#C9D3DE';
                      const rateFill = isHeavyPen
                        ? 'linear-gradient(90deg, #B68A7E 0%, #CFA096 100%)'
                        : isFinePen
                          ? 'linear-gradient(90deg, #C79A4E 0%, #DDB877 100%)'
                          : 'linear-gradient(90deg, #5E748A 0%, #71869E 100%)';
                      const leftAccentWidth = isPenZone ? 4 : 2;
                      const leftAccentColor = isHeavyPen ? '#C72238' : isFinePen ? '#E0850E' : '#7A8DA8';
                      const prevIsRealPenalty = index > 0
                        ? calculateDisplaySettlement(liveRanking[rankIndex - 1], rankIndex - 1, liveRanking.length).isRealPenalty
                        : false;
                      const isFirstPenalty = isPenZone && !prevIsRealPenalty;
                      return (
                        <div
                          key={player.id}
                          className="relative grid grid-cols-[36px_42px_minmax(0,1fr)_90px_42px_42px_48px_24px] items-center gap-1.5 px-1.5"
                          style={{
                            height: rankRowH,
                            flexShrink: 0,
                            background: rowBg,
                            borderBottom: `1px solid ${rowBorderColor}`,
                            ...(isFirstPenalty ? { borderTop: `3px solid ${isHeavyPen ? 'rgba(216,50,74,0.45)' : 'rgba(224,133,14,0.45)'}` } : {}),
                          }}
                        >
                          <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: leftAccentWidth, background: leftAccentColor }} />
                          <span
                            className="flex h-7 w-7 items-center justify-center justify-self-center font-black leading-none tabular-nums"
                            style={{
                              fontSize: rankRankFont,
                              ...(penaltyTier > 0
                                ? { borderRadius: 5, background: isHeavyPen ? '#C72238' : '#E0850E', color: '#FFFFFF' }
                                : { color: '#3F2C08' }),
                            }}
                          >
                            {rankIndex + 1}
                          </span>
                          <span
                            className="justify-self-center font-black leading-none tabular-nums"
                            style={{ color: moveColor, fontSize: rankMoveFont }}
                          >
                            {moveLabel}
                          </span>
                          <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                            <p
                              className="min-w-0 truncate font-black text-[#1F1408]"
                              style={{ fontSize: rankNameFont }}
                            >
                              {player.name}
                            </p>
                            {penaltyTier > 0 && (
                              <span
                                className="shrink-0 rounded-[4px] px-1 py-0.5 text-[8px] font-black leading-none"
                                style={isHeavyPen
                                  ? { border: '1px solid rgba(216,50,74,0.30)', background: 'rgba(216,50,74,0.15)', color: '#7E1B26' }
                                  : { border: '1px solid rgba(224,133,14,0.34)', background: 'rgba(224,133,14,0.16)', color: '#7A4708' }}
                              >
                                {isHeavyPen ? 'PEN 5K' : 'PEN 3K'}
                              </span>
                            )}
                          </div>
                          <div
                            className="h-[7px] w-[68px] justify-self-start overflow-hidden rounded-[2px] shadow-[inset_0_1px_0_rgba(0,0,0,0.05)]"
                            style={{ background: rateTrackBg }}
                          >
                            <div
                              className="h-full rounded-[2px] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                              style={{
                                width: `${winRate}%`,
                                background: rateFill,
                              }}
                            />
                          </div>
                          <span
                            className="text-center font-black tabular-nums text-[#3F2C08]"
                            style={{ fontSize: rankNumFont }}
                          >
                            {player.wins}
                          </span>
                          <span
                            className="text-center font-black tabular-nums text-[#7A6655]"
                            style={{ fontSize: rankNumFont }}
                          >
                            {player.losses}
                          </span>
                          <span
                            className="pr-1 text-right font-black tabular-nums"
                            style={{
                              fontSize: rankNumFont,
                              color: player.diff > 0 ? '#0C6E36' : player.diff < 0 ? '#B12830' : '#7A6655',
                            }}
                          >
                            {player.diff > 0 ? '+' : ''}{player.diff}
                          </span>
                          <span aria-hidden="true" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {rankingTotal > 0 && (() => {
                // Normalize lastSync to a compact HH:MM regardless of locale ("09:56:22" or "9시 56분 22초")
                const updatedShort = (() => {
                  if (!lastSync) return '--:--';
                  const m = lastSync.match(/(\d{1,2})[시:]\s*(\d{1,2})/);
                  return m ? `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}` : lastSync.slice(0, 5);
                })();
                return (
                  <div
                    className="flex shrink-0 items-center justify-between gap-3 border-t border-[#C9B274]/60 bg-[linear-gradient(180deg,#F3EAD0_0%,#E5D2A0_100%)] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]"
                    style={{ height: 44 }}
                  >
                    <span className="whitespace-nowrap text-[13px] font-black uppercase tracking-[0.14em] text-[#4F3A0D]">
                      TOTAL {rankingTotal} PLAYERS
                    </span>
                    <span className="whitespace-nowrap text-[13px] font-black uppercase tracking-[0.14em] tabular-nums text-[#6E5418]">
                      UPDATED {updatedShort}
                    </span>
                  </div>
                );
              })()}
            </aside>
          </div>
        </div>

        {error && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-[14px] bg-[#D8324A] px-5 py-2.5 text-[13px] font-black text-white shadow-[0_6px_16px_rgba(216,50,74,0.32)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

export default function KdkDisplayPage() {
  return (
    <Suspense fallback={<main className="fixed inset-0 z-[9999] bg-[#D6E2F2]" />}>
      <KdkDisplayBoard />
    </Suspense>
  );
}
