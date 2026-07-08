'use client';

// TEYEON Ranking — 공식 Archive 기반 클럽 랭킹 (MVP, 2026-07 확정 정책)
//   · 데이터: lib/ranking/clubRankingService.fetchClubRanking — 공식 확정 KDK(teyeon_archive_v1)만.
//     기존 localStorage(teyeon_matches/teyeon_players)·하드코딩 데모 랭킹·장식 탭(Weekly 등)은 전부 제거.
//   · 산식/자격/동률은 clubRankingCore(확정 A안)가 단일 출처 — 이 화면은 표시만 담당한다.
//   · 디자인: Cool Premium Light + TOP3 Championship accent(골드/실버/브론즈 포인트만, 네온/글로우/blur 금지).
//   · 레이아웃: GlobalMain 단일 스크롤 구조 준수 — 페이지 wrapper 에 minHeight/overflow 를 두지 않는다(b055a7a).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Trophy, BarChart3, RefreshCw, ChevronRight, CalendarDays } from 'lucide-react';
import RecordsSectionTabs from '@/components/records/RecordsSectionTabs';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { normalizeAvatarUrl } from '@/lib/memberDisplayResolver';
import {
  PlayerCardModal,
  type PlayerCardMember,
  type PlayerCardStats,
  type VisibilityLevel,
  MEMBER_LIST_COLS,
} from '@/components/players/PlayerCardModal';
import {
  fetchMemberOfficialStats,
  type MemberOfficialStatsResult,
} from '@/lib/profile/getMemberOfficialStats';
import {
  fetchClubRanking,
  RANKING_POINTS,
  RANKING_MIN_SESSIONS,
  BEST_WINRATE_MIN_GAMES,
  type ClubRankingResult,
  type ClubRankingEntry,
  type ClubRankingAwardWinner,
} from '@/lib/ranking/clubRankingService';

const CURRENT_SEASON = new Date().getFullYear();

// ── 팔레트 (Cool Premium Light + Championship accent) ─────────────────────────
const C = {
  text: '#0F172A',
  sub: '#64748B',
  faint: '#94A3B8',
  teal: '#0D9488',
  tealBg: 'rgba(13,148,136,0.08)',
  card: '#FFFFFF',
  border: 'rgba(15,23,42,0.07)',
  gold: '#B8891C',
  goldBg: 'rgba(201,168,76,0.12)',
  goldBorder: 'rgba(201,168,76,0.45)',
  silver: '#64748B',
  silverBg: 'rgba(148,163,184,0.14)',
  bronze: '#A16207',
  bronzeBg: 'rgba(180,131,58,0.12)',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: C.card,
  borderRadius: 16,
  border: `1px solid ${C.border}`,
  boxShadow: '0 2px 10px rgba(15,23,42,0.05)',
};

// ── 공용 소품 ────────────────────────────────────────────────────────────────
function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.border}`, backgroundColor: '#EEF2F7' }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        backgroundColor: C.tealBg, color: C.teal, border: `1px solid rgba(13,148,136,0.25)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.max(11, Math.round(size * 0.42)), fontWeight: 800,
      }}
    >
      {(name || '?').slice(0, 1)}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: 999,
      backgroundColor: C.tealBg, color: C.teal, border: '1px solid rgba(13,148,136,0.20)',
      fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ── 기록 리더 카드 (2×2 그리드) ──────────────────────────────────────────────
//   표시 4종만 사용: 최다 우승 / 최다 참가 / 최고 승률 / TOP3 최다.
//   '최다 승리'(mostWins)는 코어 계산·타입은 유지하되 이 화면 표시 대상에서만 제외한다.
//   TOP3 최다는 코어의 기존 mostTop3(= 기간 내 1·2·3위 횟수 합 최다, 동률은 기존 comparator 상위)를 그대로 재사용.
const AWARD_DEFS: {
  key: keyof ClubRankingResult['awards'];
  label: string;
  unit: string;
  accent: 'gold' | 'teal';
  note?: string;
}[] = [
  { key: 'mostChampionships', label: '최다 우승', unit: '회', accent: 'gold' },
  { key: 'mostParticipation', label: '최다 참가', unit: '회', accent: 'teal' },
  { key: 'bestWinRate', label: '최고 승률', unit: '%', accent: 'teal', note: `공식 ${BEST_WINRATE_MIN_GAMES}경기 이상 기준` },
  { key: 'mostTop3', label: 'TOP3 최다', unit: '회', accent: 'gold' },
];

function AwardCard({ label, unit, accent, note, winner, onOpen }: {
  label: string; unit: string; accent: 'gold' | 'teal'; note?: string; winner: ClubRankingAwardWinner;
  onOpen: (memberId: string) => void;
}) {
  const valueColor = accent === 'gold' ? C.gold : C.teal;
  const body = (
    <>
      {/* 우선순위: ① 항목명 ② 이름 ③ 수치 ④ 기준 문구 — 장식(아바타)보다 정보가 먼저 읽히게 */}
      <span style={{ fontSize: 10, fontWeight: 800, color: C.gold, letterSpacing: '0.05em' }}>{label}</span>
      <p style={{ margin: 0, fontSize: 14.5, fontWeight: 900, color: winner ? C.text : C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {winner ? winner.name : '집계 예정'}
      </p>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: winner ? valueColor : C.faint, lineHeight: 1 }}>
        {winner ? `${winner.value}${unit}` : '-'}
      </p>
      {note && <p style={{ margin: '2px 0 0', fontSize: 9, fontWeight: 600, color: C.faint, lineHeight: 1.4 }}>{note}</p>}
    </>
  );
  const boxStyle: React.CSSProperties = { ...cardStyle, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 };
  // 수상자가 있으면 회원 카드 모달을 현재 화면에서 오픈(실제 button) — null/'집계 예정' 카드는 클릭 불가(정적 div, 시각 동일).
  if (winner) {
    return (
      <button
        type="button"
        onClick={() => onOpen(winner.memberId)}
        aria-label={`${winner.name} 회원 프로필 보기`}
        className="rank-row"
        style={{ ...boxStyle, textAlign: 'left', font: 'inherit', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}
      >
        {body}
      </button>
    );
  }
  return <div style={boxStyle}>{body}</div>;
}

// ── TOP3 포디움 ──────────────────────────────────────────────────────────────
function PodiumCard({ entry, place }: { entry: ClubRankingEntry | undefined; place: 1 | 2 | 3 }) {
  const accent = place === 1
    ? { color: C.gold, bg: C.goldBg, border: C.goldBorder, label: 'CHAMPION' }
    : place === 2
      ? { color: C.silver, bg: C.silverBg, border: 'rgba(148,163,184,0.45)', label: '2ND' }
      : { color: C.bronze, bg: C.bronzeBg, border: 'rgba(180,131,58,0.40)', label: '3RD' };
  const big = place === 1;
  if (!entry) return <div style={{ flex: 1 }} />;
  return (
    <div style={{
      flex: 1, minWidth: 0,
      backgroundColor: C.card,
      borderRadius: 16,
      border: `1.5px solid ${accent.border}`,
      boxShadow: big ? '0 4px 16px rgba(184,137,28,0.14)' : '0 2px 10px rgba(15,23,42,0.05)',
      padding: big ? '16px 10px' : '12px 8px',
      marginTop: big ? 0 : 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      textAlign: 'center',
    }}>
      <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', color: accent.color, backgroundColor: accent.bg, padding: '2px 8px', borderRadius: 999 }}>
        {accent.label}
      </span>
      <Avatar name={entry.name} url={entry.avatarUrl} size={big ? 52 : 42} />
      <p style={{ margin: 0, fontSize: big ? 15 : 13, fontWeight: 900, color: C.text, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {entry.name}
      </p>
      <p style={{ margin: 0, fontSize: big ? 20 : 16, fontWeight: 900, color: accent.color, lineHeight: 1 }}>
        {entry.points}<span style={{ fontSize: 10, fontWeight: 800, marginLeft: 2 }}>PT</span>
      </p>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: C.sub, lineHeight: 1.5 }}>
        참가 {entry.sessions} · 승률 {entry.winRate}%<br />우승 {entry.championCount} · TOP3 {entry.top3Count}
      </p>
    </div>
  );
}

// ── 전체 목록 행 — 회원 카드 모달을 Ranking 안에서 직접 오픈(라우트 이동 없음) ──
//   실제 <button>(키보드 Enter/포커스 표시 유지). stable members.id 만 사용.
//   닫으면 현재 화면·기간 탭·스크롤이 그대로 유지된다(/members?member= 외부 딥링크는 별도 유지).
function RankingRow({ entry, displayRank, onOpen }: { entry: ClubRankingEntry; displayRank: number; onOpen: (memberId: string) => void }) {
  const dim = !entry.eligible;
  return (
    <button
      type="button"
      onClick={() => onOpen(entry.memberId)}
      aria-label={`${entry.name} 회원 프로필 보기`}
      className="rank-row"
      style={{
      display: 'flex', alignItems: 'center', gap: 10,
      width: '100%',
      padding: '11px 12px',
      backgroundColor: dim ? 'rgba(148,163,184,0.07)' : C.card,
      border: 'none',
      borderTop: `1px solid ${C.border}`,
      opacity: dim ? 0.85 : 1,
      textAlign: 'left',
      font: 'inherit',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ width: 30, textAlign: 'center', fontSize: 15, fontWeight: 900, color: dim ? C.faint : displayRank <= 3 ? C.gold : C.text, flexShrink: 0 }}>
        {dim ? '—' : displayRank}
      </span>
      <Avatar name={entry.name} url={entry.avatarUrl} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</p>
          {dim && (
            <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 800, color: C.faint, border: `1px solid ${C.border}`, borderRadius: 999, padding: '1px 7px', backgroundColor: '#F8FAFC' }}>
              집계 예정 {entry.sessions}/{RANKING_MIN_SESSIONS}회
            </span>
          )}
        </div>
        <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 600, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          참가 {entry.sessions} · {entry.wins}승 {entry.losses}패 · 승률 {entry.winRate}%
          {(entry.championCount > 0 || entry.top3Count > 0) && <> · 우승 {entry.championCount} · TOP3 {entry.top3Count}</>}
        </p>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: dim ? C.faint : C.teal, lineHeight: 1 }}>{entry.points}</p>
        <p style={{ margin: 0, fontSize: 8.5, fontWeight: 800, letterSpacing: '0.1em', color: C.faint }}>POINT</p>
      </div>
      <ChevronRight size={14} color={C.faint} style={{ flexShrink: 0, marginLeft: -2 }} aria-hidden />
    </button>
  );
}

// ── Ranking Rule ─────────────────────────────────────────────────────────────
function RuleLine({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ fontSize: 12, fontWeight: 600, color: C.sub, lineHeight: 1.7 }}>{children}</li>
  );
}

function RankingRules() {
  return (
    <section id="ranking-rules" style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <BarChart3 size={15} color={C.teal} />
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: C.text, letterSpacing: '0.02em' }}>RANKING RULE · 산정 기준</h2>
      </div>

      <div style={{ padding: '10px 12px', borderRadius: 12, backgroundColor: C.tealBg, border: '1px solid rgba(13,148,136,0.18)' }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.teal, lineHeight: 1.6 }}>
          TEYEON Ranking은 공식 KDK 참여와 경기 성과를 함께 반영한 종합 포인트입니다.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 10.5, fontWeight: 600, color: C.sub }}>
          승률 순위나 순수 실력 순위가 아닙니다 — 참여할수록, 이길수록, 상위에 오를수록 포인트가 쌓입니다.
        </p>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 900, color: C.faint, letterSpacing: '0.08em' }}>집계 원칙</p>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          <RuleLine>공식 확정된 KDK 기록만 반영 (Archive 기준)</RuleLine>
          <RuleLine>테스트·미확정 기록 제외</RuleLine>
          <RuleLine>게스트 기록은 Archive에 유지하되 회원 랭킹에서는 제외</RuleLine>
        </ul>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 900, color: C.faint, letterSpacing: '0.08em' }}>랭킹 포인트</p>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          <RuleLine>공식 KDK 참가 1회 <b style={{ color: C.text }}>+{RANKING_POINTS.participation}점</b></RuleLine>
          <RuleLine>공식 경기 승리 1회 <b style={{ color: C.text }}>+{RANKING_POINTS.win}점</b></RuleLine>
          <RuleLine>
            세션 순위 점수 — 1위 <b style={{ color: C.gold }}>+{RANKING_POINTS.bonusFirst}점</b> · 2위 <b style={{ color: C.text }}>+{RANKING_POINTS.bonusSecond}점</b> · 3위 <b style={{ color: C.text }}>+{RANKING_POINTS.bonusThird}점</b>
          </RuleLine>
          <RuleLine>승률·득실은 포인트에 넣지 않고 동률 처리에만 사용</RuleLine>
        </ul>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 900, color: C.faint, letterSpacing: '0.08em' }}>자격</p>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          <RuleLine>정식 랭킹 자격: 공식 KDK <b style={{ color: C.text }}>{RANKING_MIN_SESSIONS}회 이상</b> (1회 참가자는 &lsquo;집계 예정&rsquo;으로 표시)</RuleLine>
          <RuleLine>최고 승률상: 공식 <b style={{ color: C.text }}>{BEST_WINRATE_MIN_GAMES}경기 이상</b>인 회원만 대상</RuleLine>
        </ul>
      </div>

      <div>
        <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 900, color: C.faint, letterSpacing: '0.08em' }}>동률 처리 기준 (순서대로)</p>
        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: C.sub, lineHeight: 1.7 }}>
          ① 랭킹 포인트 → ② 우승 횟수 → ③ TOP3 횟수 → ④ 승률 → ⑤ 득실 → ⑥ 최근 공식 순위 → ⑦ 공식 참가 횟수
        </p>
      </div>
    </section>
  );
}

// ── 상태 화면들 ──────────────────────────────────────────────────────────────
function LoadingSkeleton() {
  const bar = (h: number, w: string) => (
    <div style={{ height: h, width: w, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.18)' }} />
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="랭킹 불러오는 중">
      <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bar(18, '55%')}{bar(12, '80%')}{bar(12, '64%')}
      </div>
      <div style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bar(14, '40%')}{bar(46, '100%')}{bar(46, '100%')}{bar(46, '100%')}
      </div>
    </div>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ ...cardStyle, padding: 20, borderColor: 'rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#B91C1C' }}>랭킹 정보를 불러오지 못했습니다</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6 }}>
        잠시 후 다시 시도해 주세요. Archive 원본 기록에는 영향이 없습니다.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', backgroundColor: C.teal, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
      >
        <RefreshCw size={13} /> 다시 시도
      </button>
    </div>
  );
}

function EmptyOfficialCard() {
  return (
    <div style={{ ...cardStyle, padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <div style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: C.tealBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Trophy size={22} color={C.teal} />
      </div>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 900, color: C.text }}>아직 공식 확정된 KDK 기록이 없습니다</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6 }}>
        공식 기록이 확정되면 TEYEON Ranking이 자동으로 집계됩니다.
      </p>
      <Link
        href="/archive"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4, padding: '9px 16px', borderRadius: 10, backgroundColor: C.teal, color: '#fff', fontSize: 12, fontWeight: 800, textDecoration: 'none' }}
      >
        Archive 바로가기 <ChevronRight size={13} />
      </Link>
    </div>
  );
}

function MonthlyEmptyCard({ ym }: { ym: { year: number; month: number } }) {
  return (
    <div style={{ ...cardStyle, padding: '26px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
      <div style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.tealBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CalendarDays size={20} color={C.teal} />
      </div>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: C.text }}>
        {ym.year}년 {ym.month}월의 공식 KDK 기록이 없습니다.
      </p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6 }}>
        공식 확정된 경기만 월간 Ranking에 반영됩니다.
      </p>
    </div>
  );
}

function MonthlyErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ ...cardStyle, padding: 20, borderColor: 'rgba(239,68,68,0.25)', backgroundColor: 'rgba(239,68,68,0.04)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: '#B91C1C' }}>월간 Ranking을 불러오지 못했습니다.</p>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6 }}>
        잠시 후 다시 시도해 주세요. Archive 원본 기록에는 영향이 없습니다.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, border: 'none', backgroundColor: C.teal, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
      >
        <RefreshCw size={13} /> 다시 시도
      </button>
    </div>
  );
}

function NoEligibleBanner() {
  return (
    <div style={{ ...cardStyle, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: C.text }}>현재 시즌 랭킹 집계 준비 중</p>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: C.sub }}>
        공식 KDK {RANKING_MIN_SESSIONS}회 이상 참가 시 정식 랭킹에 반영됩니다.
      </p>
    </div>
  );
}

// ── 공동 순위: 7개 동률 기준이 전부 동일할 때만 같은 표시 순위를 부여(코어 정렬은 유지) ──
function computeDisplayRanks(entries: ClubRankingEntry[]): Map<string, number> {
  const eligible = entries.filter((e) => e.eligible);
  const ranks = new Map<string, number>();
  const sameAll = (a: ClubRankingEntry, b: ClubRankingEntry) =>
    a.points === b.points && a.championCount === b.championCount && a.top3Count === b.top3Count &&
    a.winRate === b.winRate && a.pointDiff === b.pointDiff &&
    (a.latestRank ?? -1) === (b.latestRank ?? -1) && a.sessions === b.sessions;
  eligible.forEach((e, i) => {
    if (i > 0 && sameAll(e, eligible[i - 1])) {
      ranks.set(e.memberId, ranks.get(eligible[i - 1].memberId)!);
    } else {
      ranks.set(e.memberId, i + 1);
    }
  });
  return ranks;
}

// ── 기간 상태 (URL query 로 관리 — 새로고침/공유/뒤로가기 유지) ────────────────
//   /ranking?period=season | all | monthly (&year=YYYY&month=M)
//   잘못된 파라미터는 안전 기본값(season / 현재 연·월)으로 fallback.
type PeriodTab = 'season' | 'all' | 'monthly';
type YearMonth = { year: number; month: number };

const nowYearMonth = (): YearMonth => {
  const d = new Date(); // 로컬 날짜 기준(월 경계 UTC 밀림 없음 — 필터도 문자열 비교)
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

function parsePeriodParams(sp: URLSearchParams | null): { tab: PeriodTab; ym: YearMonth } {
  const period = sp?.get('period');
  const tab: PeriodTab = period === 'all' || period === 'monthly' ? period : 'season';
  let ym = nowYearMonth();
  if (tab === 'monthly') {
    const y = Number(sp?.get('year'));
    const m = Number(sp?.get('month'));
    if (Number.isInteger(y) && y >= 2000 && y <= 2100 && Number.isInteger(m) && m >= 1 && m <= 12) {
      ym = { year: y, month: m };
    }
  }
  return { tab, ym };
}

const cacheKeyOf = (tab: PeriodTab, ym: YearMonth) =>
  tab === 'monthly' ? `monthly:${ym.year}-${ym.month}` : tab;

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function RankingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = parsePeriodParams(searchParams);
  const [tab, setTab] = useState<PeriodTab>(initial.tab);
  const [ym, setYm] = useState<YearMonth>(initial.ym);
  const [cache, setCache] = useState<Record<string, ClubRankingResult>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mountedRef = useRef(false);

  const load = useCallback(async (which: PeriodTab, whichYm: YearMonth, force = false) => {
    const key = cacheKeyOf(which, whichYm);
    if (!force && cache[key]) { setLoading(false); setError(false); return; }
    setLoading(true);
    setError(false);
    try {
      const season = which === 'season' ? CURRENT_SEASON : which === 'all' ? 'all' as const : whichYm;
      const result = await fetchClubRanking(season);
      setCache((prev) => ({ ...prev, [key]: result }));
    } catch (err) {
      console.warn('[Ranking] load failed:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cache]);

  useEffect(() => { void load(tab, ym); }, [tab, ym, load]);

  // URL 동기화 — replace(히스토리 미적재)로 새로고침/공유 상태 유지. 최초 마운트는 URL 이 원본이므로 생략.
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    const qs = tab === 'monthly'
      ? `?period=monthly&year=${ym.year}&month=${ym.month}`
      : tab === 'all' ? '?period=all' : '?period=season';
    router.replace(`/ranking${qs}`, { scroll: false });
  }, [tab, ym, router]);

  const moveMonth = (delta: number) => {
    setYm((prev) => {
      const total = prev.year * 12 + (prev.month - 1) + delta;
      return { year: Math.floor(total / 12), month: (total % 12) + 1 };
    });
  };

  const data = cache[cacheKeyOf(tab, ym)];

  // ── 회원 카드 모달 (Ranking 내부에서 직접 오픈 — 라우트 이동 없음) ─────────────
  //   닫으면 현재 기간 탭/URL/스크롤이 그대로 유지된다. /members?member=<id> 딥링크 수신부는 별도 유지.
  //   상세/통계는 /members 화면과 동일 소스: members 1건 + profiles exact 매칭, fetchMemberOfficialStats(공통 helper).
  const { user } = useAuth();
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<PlayerCardMember | null>(null);
  const [selectedStats, setSelectedStats] = useState<PlayerCardStats | undefined>(undefined);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const memberCacheRef = useRef<Map<string, PlayerCardMember>>(new Map());
  const statsCacheRef = useRef<Map<string, MemberOfficialStatsResult>>(new Map());

  const openMember = useCallback((memberId: string) => {
    if (!memberId) return; // id 누락 시 무동작(이름 fallback 금지)
    setSelectedMemberId(memberId);
  }, []);
  const closeMember = useCallback(() => { setSelectedMemberId(null); setSelectedMember(null); }, []);

  // 회원 상세 1건 조회(+프로필 사진 exact 매칭: auth_user_id → email) — 클릭 시 1회, 멤버별 캐시.
  useEffect(() => {
    if (!selectedMemberId) return;
    const cached = memberCacheRef.current.get(selectedMemberId);
    if (cached) { setSelectedMember(cached); return; }
    let cancelled = false;
    (async () => {
      try {
        // P1 개인정보 최소화 — members 명시 컬럼(phone/email/나이/member_number 등 제외).
        //   아바타 매칭은 auth_user_id → profiles 만(email fallback 제거).
        const { data: row, error } = await supabase
          .from('members').select(MEMBER_LIST_COLS).eq('id', selectedMemberId).maybeSingle();
        if (error || !row) { if (!cancelled) setSelectedMemberId(null); return; }
        let profileAvatar: string | undefined;
        let visibility: VisibilityLevel | undefined;
        try {
          if (row.auth_user_id) {
            const { data: p } = await supabase.from('profiles').select('avatar_url, profile_visibility_level').eq('id', row.auth_user_id).maybeSingle();
            profileAvatar = normalizeAvatarUrl(p?.avatar_url) || undefined;
            visibility = (p?.profile_visibility_level as VisibilityLevel | undefined) || undefined;
          }
        } catch { /* 프로필 매칭 실패해도 카드 표시는 유지 */ }
        const member: PlayerCardMember = { ...row, nickname: row.nickname || '', profile_avatar_url: profileAvatar, profile_visibility_level: visibility };
        memberCacheRef.current.set(selectedMemberId, member);
        if (!cancelled) setSelectedMember(member);
      } catch (err) {
        console.warn('[Ranking] member detail load failed:', err);
        if (!cancelled) setSelectedMemberId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedMemberId]);

  // 공식 KDK 통계 — PROFILE/members 와 동일 helper 재사용(멤버별 1회 캐시).
  useEffect(() => {
    if (!selectedMember) { setSelectedStats(undefined); return; }
    const cached = statsCacheRef.current.get(selectedMember.id);
    if (cached) { setSelectedStats(cached.playerCardStats); setIsStatsLoading(false); return; }
    let cancelled = false;
    setSelectedStats(undefined);
    setIsStatsLoading(true);
    fetchMemberOfficialStats({ id: selectedMember.id, name: selectedMember.nickname })
      .then((result) => {
        statsCacheRef.current.set(selectedMember.id, result);
        if (!cancelled) setSelectedStats(result.playerCardStats);
      })
      .catch(() => { /* 통계 실패 시 '--' placeholder — 모달 자체는 유지 */ })
      .finally(() => { if (!cancelled) setIsStatsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedMember]);

  // 아바타/본인 판정 — auth_user_id 로만(email 미조회, P1 개인정보 최소화). /members 와 동일 기준.
  const isOwnCard = Boolean(
    selectedMember &&
    selectedMember.auth_user_id && user?.id && selectedMember.auth_user_id === user.id,
  );
  const selectedAvatar = selectedMember
    ? (normalizeAvatarUrl(selectedMember.avatar_url) ||
       normalizeAvatarUrl(selectedMember.profile_avatar_url) ||
       (isOwnCard
         ? normalizeAvatarUrl(
             (user?.user_metadata?.avatar_url as string | undefined) ||
             (user?.user_metadata?.picture as string | undefined),
           ) || undefined
         : undefined))
    : undefined;
  const handleVisibilitySaved = useCallback((level: VisibilityLevel) => {
    setSelectedMember((prev) => {
      if (!prev) return prev;
      const next = { ...prev, profile_visibility_level: level };
      memberCacheRef.current.set(prev.id, next);
      return next;
    });
  }, []);

  const eligible = data ? data.entries.filter((e) => e.eligible) : [];
  const pending = data ? data.entries.filter((e) => !e.eligible) : [];
  const displayRanks = data ? computeDisplayRanks(data.entries) : new Map<string, number>();
  const top3 = eligible.slice(0, 3);

  const tabBtn = (which: PeriodTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(which)}
      style={{
        flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', cursor: 'pointer',
        fontSize: 12.5, fontWeight: 800,
        backgroundColor: tab === which ? C.teal : 'transparent',
        color: tab === which ? '#fff' : C.sub,
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <main
      style={{
        position: 'relative',
        width: '100%',
        backgroundColor: '#F2F4F7',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflowX: 'clip',
        // 하단 BottomNav 여백은 공통 GlobalMain(var(--page-bottom-safe))이 단일 적용 — 페이지 자체 clearance 금지.
      }}
    >
      <div style={{ width: '100%', maxWidth: 430, padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 딥링크 행/카드 hover·active — 인라인 배경과 충돌하지 않도록 filter/opacity 사용(페이지 로컬 클래스, 전역 CSS 아님) */}
        <style>{`.rank-row{transition:filter .15s,opacity .1s}.rank-row:hover{filter:brightness(0.98)}.rank-row:active{opacity:.9}`}</style>

        {/* ── 헤더: 뒤로 + 타이틀 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingTop: 16 }}>
          <Link
            href="/"
            aria-label="메인으로"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.sub, flexShrink: 0, textDecoration: 'none' }}
          >
            <ChevronLeft size={19} />
          </Link>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.2em', color: C.teal, fontFamily: 'var(--font-rajdhani), sans-serif' }}>CLUB RANKING</p>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: C.text, letterSpacing: '0.02em', fontFamily: 'var(--font-rajdhani), sans-serif' }}>RANKING</h1>
          </div>
        </div>

        {loading && <LoadingSkeleton />}
        {!loading && error && (
          tab === 'monthly'
            ? <MonthlyErrorCard onRetry={() => void load(tab, ym, true)} />
            : <ErrorCard onRetry={() => void load(tab, ym, true)} />
        )}

        {!loading && !error && data && (
          <>
            {/* ── 1. Ranking Hero ── */}
            <section style={{ ...cardStyle, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, background: 'linear-gradient(160deg, #FFFFFF 0%, #F0FBF9 100%)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.tealBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <BarChart3 size={19} color={C.teal} />
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 9.5, fontWeight: 900, letterSpacing: '0.16em', color: C.teal }}>TEYEON RANKING</p>
                  <p style={{ margin: 0, fontSize: 18, fontWeight: 900, color: C.text, fontFamily: 'var(--font-rajdhani), sans-serif' }}>
                    {tab === 'season' ? `${CURRENT_SEASON} SEASON` : tab === 'all' ? 'ALL TIME' : `${ym.year}년 ${ym.month}월`}
                  </p>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: C.sub, lineHeight: 1.6 }}>
                공식 KDK 기록으로 집계된 클럽 랭킹입니다. Archive에서 공식 확정된 기록만 반영됩니다.
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Chip>공식 기록 기준</Chip>
                <Chip>테스트 제외</Chip>
                <Chip>게스트 제외</Chip>
                <Chip>집계 대상 {data.aggregatedMembers}명</Chip>
              </div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: C.faint }}>
                {data.latestSessionDate
                  ? `마지막 공식 기록 ${data.latestSessionDate} · 공식 세션 ${data.totalOfficialSessions}회 반영`
                  : '아직 반영된 공식 세션이 없습니다'}
              </p>
            </section>

            {/* 기록 영역 공통 진입 탭 — 공식 기록 ↔ TEYEON Ranking (/archive 와 동일 컴포넌트).
                아래 시즌/누적(채움형 pill)과 시각 계층 구분: 이 탭은 흰 카드+언더라인 방식. */}
            <RecordsSectionTabs />

            {/* ── 2. 기간 탭 (시즌/누적/월간) — 공통 진입 탭보다 한 단계 아래 계층(채움형 pill) ── */}
            <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 13, backgroundColor: 'rgba(15,23,42,0.05)' }}>
              {tabBtn('season', `${CURRENT_SEASON} 시즌`)}
              {tabBtn('monthly', '월간')}
              {tabBtn('all', '누적')}
            </div>

            {/* ── 2-1. 월 이동 내비게이터 (월간 탭 전용) — < 2026년 7월 > ── */}
            {tab === 'monthly' && (
              <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px' }}>
                <button
                  type="button"
                  onClick={() => moveMonth(-1)}
                  aria-label="이전 달"
                  style={{ width: 42, height: 42, borderRadius: 10, border: 'none', backgroundColor: 'transparent', color: C.sub, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <ChevronLeft size={18} />
                </button>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 900, color: C.text, whiteSpace: 'nowrap' }}>
                  <CalendarDays size={14} color={C.teal} /> {ym.year}년 {ym.month}월
                </span>
                <button
                  type="button"
                  onClick={() => moveMonth(1)}
                  aria-label="다음 달"
                  style={{ width: 42, height: 42, borderRadius: 10, border: 'none', backgroundColor: 'transparent', color: C.sub, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}

            {data.totalOfficialSessions === 0 ? (
              /* ── 공식 기록 0건 — 월간은 전용 문구 ── */
              tab === 'monthly' ? <MonthlyEmptyCard ym={ym} /> : <EmptyOfficialCard />
            ) : (
              <>
                {eligible.length === 0 && <NoEligibleBanner />}

                {/* ── 3. 기록 리더 (2×2 그리드 — 캐러셀/가로 스크롤 없이 한눈에) ── */}
                {eligible.length > 0 && (
                  <section>
                    <p style={{ margin: '2px 0 8px', fontSize: 12, fontWeight: 900, letterSpacing: '0.02em', color: C.text }}>
                      {tab === 'season' ? `${CURRENT_SEASON} 시즌 기록 리더` : tab === 'all' ? '누적 기록 리더' : `${ym.month}월 기록 리더`}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {AWARD_DEFS.map((d) => (
                        <AwardCard key={d.key} label={d.label} unit={d.unit} accent={d.accent} note={d.note} winner={data.awards[d.key]} onOpen={openMember} />
                      ))}
                    </div>
                  </section>
                )}

                {/* ── 4. TOP 3 ── */}
                {top3.length > 0 && (
                  <section>
                    <p style={{ margin: '2px 0 8px', fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', color: C.faint }}>
                      TOP 3 <span style={{ fontWeight: 700 }}>{tab === 'season' ? 'SEASON PODIUM' : tab === 'all' ? 'ALL-TIME PODIUM' : 'MONTHLY PODIUM'}</span>
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <PodiumCard entry={top3[1]} place={2} />
                      <PodiumCard entry={top3[0]} place={1} />
                      <PodiumCard entry={top3[2]} place={3} />
                    </div>
                  </section>
                )}

                {/* 산정 기준 안내 스트립 */}
                <a
                  href="#ranking-rules"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 12, backgroundColor: C.card, border: `1px solid ${C.border}`, textDecoration: 'none' }}
                >
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.sub }}>랭킹 포인트는 어떻게 계산되나요?</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.teal, display: 'inline-flex', alignItems: 'center', gap: 2 }}>산정 기준 <ChevronRight size={12} /></span>
                </a>

                {/* ── 5. 전체 랭킹 목록 ── */}
                {data.entries.length > 0 && (
                  <section style={{ ...cardStyle, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 14px 10px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 900, color: C.text }}>전체 랭킹</h2>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: C.faint }}>{eligible.length}명 정식 · {pending.length}명 집계 예정</span>
                    </div>
                    {eligible.map((e) => (
                      <RankingRow key={e.memberId} entry={e} displayRank={displayRanks.get(e.memberId) ?? e.rank} onOpen={openMember} />
                    ))}
                    {pending.map((e) => (
                      <RankingRow key={e.memberId} entry={e} displayRank={0} onOpen={openMember} />
                    ))}
                    <p style={{ margin: 0, padding: '10px 14px', fontSize: 9.5, fontWeight: 600, color: C.faint, lineHeight: 1.6, borderTop: `1px solid ${C.border}`, backgroundColor: '#F8FAFC' }}>
                      최소 참가 기준(공식 KDK {RANKING_MIN_SESSIONS}회) 미달 회원은 순위 없이 절제 표시됩니다. 게스트 기록은 Archive에만 남고 회원 랭킹에는 반영되지 않습니다.
                    </p>
                  </section>
                )}
              </>
            )}

            {/* ── 6. Ranking Rule ── */}
            <RankingRules />
          </>
        )}

        {/* 하단 스크롤 여유 — 실제 흐름 요소(마지막 카드가 BottomNav 뒤로 깔리지 않도록 GlobalMain clearance 에 더해 소량 유지) */}
        <div aria-hidden style={{ height: 8, flexShrink: 0 }} />
      </div>

      {/* ── 회원 카드 모달 — /members 와 동일 컴포넌트·동일 통계 helper. 닫으면 현재 랭킹 화면 그대로 유지 ── */}
      {selectedMember && (
        <PlayerCardModal
          member={selectedMember}
          finalAvatar={selectedAvatar}
          isOwnCard={isOwnCard}
          stats={selectedStats}
          isStatsLoading={isStatsLoading}
          onClose={closeMember}
          onVisibilitySaved={handleVisibilitySaved}
        />
      )}
    </main>
  );
}
