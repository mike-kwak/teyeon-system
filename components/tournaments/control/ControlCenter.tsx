'use client';

// Control Center — 대회 당일 관제 (Batch 4F-1 · 조작 4F-3 · 조작 안전성 4F-4a · 자동 갱신 4F-4b · 확인 필요 4F-4c-2).
//
//   읽는 순서: 머리말 → 요약 → 코트 → 확인 필요 → 진행/대기, 오른쪽은 단계 상태 레일.
//   ⚠ 숫자와 상태는 전부 controlModel 의 순수 함수가 만든다. 여기서 다시 세지 않는다.
//   ⚠ 코트 수 · 조 수를 숫자로 박지 않는다. 서버가 준 만큼 그린다.
//   ⚠ 빈 코트에 조 일정 기준 '추천 경기' 를 보여 줄 뿐, 코트를 자동 배정하지 않고, 대신 호명하지 않는다.
//     투입은 운영자가 경기(또는 [추천 경기 투입]) → 코트 두 번을 직접 고른 뒤에만 일어난다.
//   ⚠ 조작 결과를 화면이 미리 그리지 않는다(optimistic 금지). 끝나면 전부 다시 읽는다.

import React from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, AlertTriangle, X, Sparkles } from 'lucide-react';
import {
  CONTROL_PHASE_LABEL, countCourtStates, deriveAssignable, deriveAttention, deriveCourtSuggestions, deriveCourts, deriveKnockout,
  deriveNextUps, deriveNextUpRecommendations, deriveOpeningFeedGroups, nextUpAssignBlock,
  derivePhase, derivePickState, derivePlaying, derivePreliminary, deriveRowContext, deriveScoreConflict,
  deriveSummary, deriveWaiting, type ControlPlannedGroup,
} from './controlModel';
import type { ControlCourt, ControlCourtSuggestion, ControlGroup, ControlMatchRow, ControlNextUp, ControlPickState, NextUpRecItem, NextUpRecommendation } from './controlModel';
import { useCourtNextUp } from './useCourtNextUp';
import NextUpServerSync from './NextUpServerSync';
import { ControlAttention, ControlOperations, CourtCardTimer } from './ControlOperations';
import type { ControlOps } from './ControlOperations';
import ControlScoreDialog from './ControlScoreDialog';
import { useControlActions } from './controlActions';
import type { UnverifiedAction } from './controlActions';
import { useControlData } from './controlView';
import SignatureDisplayLauncher from '../SignatureDisplayLauncher';
import MatchElapsedClock from '../MatchElapsedClock';
import { clockOffset, formatElapsed, matchTimerState } from '@/lib/tournaments/matchTimer';
import { matchHeadLabel } from '@/lib/tournaments/matchTypes';
import { fetchAdminGroupSchedule } from '@/lib/tournaments/groupScheduleService';
import { uncheckedTeams } from '@/lib/tournaments/checkinModel';
import { useControlCheckins } from './useControlCheckins';
import ControlCheckinWarning from './ControlCheckinWarning';

/**
 * 대기 목록에 한 번에 그리는 줄 수 — 화면 밀도를 위한 표시 제한일 뿐이다.
 *   ⚠ 대회 규칙이 아니다. 전체 개수는 항상 따로 보여 주고, 나머지는 경기 운영 화면에서 본다.
 */
const WAITING_ROWS = 6;
import type { ControlEvent } from '@/lib/tournaments/testTournament';

// ── 스타일 — 기존 Admin 화면(신청 목록 · 팀 관리)과 같은 토큰을 쓴다 ────────
const INK = '#0F172A';
const INK_SOFT = '#334155';
const MUTED = '#64748B';
const FAINT = '#94A3B8';
const LINE = '#E2E8F0';
const LINE_SOFT = '#EEF2F7';
const TEAL = '#0E8C80';
const TEAL_SOFT = '#E7F3F1';
const NAVY = '#102A3D';
/** 스마트 추천 코트 투입 — 일반 투입(청록)과 구분되는 파란색. */
const REC_BLUE = '#1D4ED8';
const REC_BLUE_SOFT = '#EFF6FF';
const LABEL = 'var(--font-rajdhani), sans-serif';

const card: React.CSSProperties = {
  background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 15,
};
const eyebrow: React.CSSProperties = {
  margin: 0, fontFamily: LABEL, fontSize: 11, fontWeight: 800,
  letterSpacing: '0.14em', color: FAINT,
};
const navBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 30, padding: '5px 10px', borderRadius: 8,
  border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT,
  fontSize: 12, fontWeight: 800, textDecoration: 'none', cursor: 'pointer',
};

const pct = (v: number | null): string => (v === null ? '—' : `${Math.round(v * 100)}%`);
const hhmmss = (t: number | null): string => {
  if (t === null) return '—';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ── 머리말 ──────────────────────────────────────────────────────────────────

function PhasePill({ phase }: { phase: keyof typeof CONTROL_PHASE_LABEL }) {
  const active = phase === 'preliminary' || phase === 'knockout';
  return (
    <span style={{
      fontFamily: LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.12em',
      padding: '5px 11px', borderRadius: 7,
      background: active ? NAVY : '#F1F5F9',
      color: active ? '#fff' : MUTED,
      whiteSpace: 'nowrap',
    }}>
      {CONTROL_PHASE_LABEL[phase]}
    </span>
  );
}

function Header({
  event, slug, phase, updatedAt, refreshing, onReload,
}: {
  event: ControlEvent; slug: string; phase: keyof typeof CONTROL_PHASE_LABEL;
  updatedAt: number | null; refreshing: boolean; onReload: () => void;
}) {
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={eyebrow}>TOURNAMENT CONTROL CENTER</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          <h1 style={{
            margin: 0, fontFamily: LABEL, fontSize: 21, fontWeight: 800,
            letterSpacing: '0.01em', color: INK,
            // 테스트 대회 이름(slug 포함)은 길 수 있다 — 좁은 화면에서 줄을 바꾼다.
            whiteSpace: event.test ? 'normal' : 'nowrap', overflowWrap: 'anywhere',
          }}>
            {event.titleFull}
          </h1>
          <PhasePill phase={phase} />
          <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, whiteSpace: 'nowrap' }}>
            {event.eventDateLabel} · {event.venueName}
          </span>
        </div>
      </div>

      {/* 좁은 화면(320~430px)에서는 이 묶음이 줄을 바꾼다 — 버튼을 숨기거나 화면 밖으로 밀지 않는다. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: FAINT, whiteSpace: 'nowrap' }}>
          마지막 갱신 {hhmmss(updatedAt)}
        </span>
        <button type="button" onClick={onReload} disabled={refreshing} style={{
          ...navBtn, minHeight: 34, padding: '7px 12px',
          opacity: refreshing ? 0.55 : 1, cursor: refreshing ? 'default' : 'pointer',
        }}>
          <RefreshCw size={13} strokeWidth={2.4} />
          {refreshing ? '조회 중' : '새로고침'}
        </button>
        {/* 테스트 대회는 공개 전광판으로 가는 링크를 두지 않는다(공개 화면에는 나오지 않는다). */}
        {!event.test && (
          <Link
            href={`/tournaments/${slug}/arena?mode=prelim`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...navBtn, minHeight: 34, padding: '7px 12px', background: NAVY, borderColor: NAVY, color: '#fff' }}
          >
            ARENA TV 열기
            <ExternalLink size={13} strokeWidth={2.4} />
          </Link>
        )}
      </div>
    </div>
  );
}

/** 기존 운영 화면으로 가는 가벼운 이동 줄. 머리말보다 강해지지 않게 한 단계 작게 둔다. */
function TournamentNav({ slug, test = false }: { slug: string; test?: boolean }) {
  const items: Array<[string, string]> = [
    ['팀 관리', 'teams'], ['조편성', 'groups'], ['경기 운영', 'matches'],
    ['예선 순위', 'standings'], ['본선 대진', 'bracket'], ['코트 관리', 'courts'],
  ];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {/* 현장 운영 — 허브(전체 메뉴) · 체크인 · 현장 운영자. 모바일에서는 하단 메뉴가 없으므로 여기서 이동한다.
          테스트 대회는 공식 허브로 가지 않는다(허브는 실제 대회 전용). */}
      {!test && (
        <Link href="/admin/teyeon-open" data-control-nav="hub"
          style={{ ...navBtn, minHeight: 28, padding: '4px 9px', fontSize: 11.5, color: INK_SOFT }}>
          TEYEON OPEN 허브
        </Link>
      )}
      <Link href={`/admin/tournaments/${slug}/checkin`} data-control-nav="checkin"
        style={{ ...navBtn, minHeight: 28, padding: '4px 9px', fontSize: 11.5, color: TEAL, borderColor: TEAL }}>
        선수 체크인
      </Link>
      <Link href={`/admin/tournaments/${slug}/staff`} data-control-nav="staff"
        style={{ ...navBtn, minHeight: 28, padding: '4px 9px', fontSize: 11.5, color: TEAL, borderColor: TEAL }}>
        현장 운영자
      </Link>
      {items.map(([label, path]) => (
        <Link key={path} href={`/admin/tournaments/${slug}/${path}`}
          style={{ ...navBtn, minHeight: 28, padding: '4px 9px', fontSize: 11.5, color: MUTED }}>
          {label}
        </Link>
      ))}
    </div>
  );
}

// ── 요약 ────────────────────────────────────────────────────────────────────

function SummaryItem({ value, label, tone }: { value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap' }}>
      <span style={{
        fontFamily: LABEL, fontSize: 19, fontWeight: 800, color: tone ?? INK,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>{label}</span>
    </div>
  );
}

function SummaryBar({ s }: { s: ReturnType<typeof deriveSummary> }) {
  return (
    <div style={{
      ...card, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: LABEL, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
        color: FAINT, whiteSpace: 'nowrap',
      }}>
        {s.stage === 'knockout' ? '본선 경기' : '예선 경기'}
      </span>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <SummaryItem value={s.total} label="전체" />
        <SummaryItem value={s.completed} label="완료" />
        <SummaryItem value={s.playing} label="진행" tone={s.playing > 0 ? TEAL : undefined} />
        <SummaryItem value={s.calling} label="호명" />
        <SummaryItem value={s.waiting} label="대기" />
        <SummaryItem value={s.cancelled} label="취소" tone={s.cancelled > 0 ? '#B91C1C' : undefined} />
        <SummaryItem value={`${s.busyCourts} / ${s.activeCourts}`} label="사용 코트" />
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, minWidth: 180 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, whiteSpace: 'nowrap' }}>진행률</span>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: LINE_SOFT, minWidth: 90 }}>
          <div style={{
            width: `${s.progress === null ? 0 : Math.round(s.progress * 100)}%`,
            height: '100%', borderRadius: 3, background: NAVY,
          }} />
        </div>
        <span style={{
          fontFamily: LABEL, fontSize: 16, fontWeight: 800, color: INK,
          fontVariantNumeric: 'tabular-nums', minWidth: 42, textAlign: 'right',
        }}>
          {pct(s.progress)}
        </span>
      </div>
    </div>
  );
}

// ── 코트 ────────────────────────────────────────────────────────────────────

function CourtTeam({ team }: { team: { teamNo: number; player1Name: string; player2Name: string } }) {
  const names = [team.player1Name, team.player2Name].filter((x) => x.trim() !== '').join(' · ');
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{
        margin: 0, fontFamily: LABEL, fontSize: 10.5, fontWeight: 800,
        letterSpacing: '0.1em', color: FAINT,
      }}>
        TEAM {String(team.teamNo).padStart(2, '0')}
      </p>
      <p style={{
        margin: '1px 0 0', fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {names || '—'}
      </p>
    </div>
  );
}

const SESSION_LABEL = (s: number | null): string => (s === 1 ? '1차' : s === 2 ? '2차' : '');

/**
 * 빈 코트의 추천 경기 — 표시 전용.
 *   ⚠ [추천 경기 투입] 은 투입하지 않는다. 그 경기를 '투입할 경기' 로 고를 뿐이고,
 *     운영자가 코트의 [이 코트에 투입] 을 한 번 더 눌러야 기존 확인(체크인 경고) · start_match 가 나간다.
 */
function CourtSuggestion({
  s, scheduleState, disabled, onSuggest,
}: {
  s: ControlCourtSuggestion | undefined;
  scheduleState: 'loading' | 'ready' | 'failed';
  disabled: boolean;
  onSuggest: (m: ControlMatchRow, courtNo: number) => void;
}) {
  if (!s) {
    return <p style={{ margin: 'auto 0 2px', fontSize: 12.5, fontWeight: 600, color: FAINT }}>현재 경기 없음</p>;
  }
  if (s.kind !== 'match') {
    const text = s.kind === 'unknown' && scheduleState === 'loading' ? '조 일정 확인 중…' : s.message;
    return (
      <p data-court-suggest={s.kind} style={{
        margin: 'auto 0 2px', fontSize: 12, fontWeight: 700, lineHeight: 1.45, wordBreak: 'keep-all',
        color: s.kind === 'none' ? FAINT : '#9A3412',
      }}>
        {text}
      </p>
    );
  }
  const m = s.match;
  const unchecked = new Set(s.uncheckedTeamNos);
  const teamRow = (t: ControlMatchRow['team1']) => {
    const names = [t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join(' · ') || '—';
    const no = s.checkin === null ? null : !unchecked.has(t.teamNo);
    return (
      <div data-suggest-team={t.teamNo} data-suggest-team-checked={no === null ? '' : no ? '1' : '0'}
        style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span style={{
          fontSize: 12.5, fontWeight: 700, color: INK, minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {names}
        </span>
        {no !== null && (
          <span style={{
            flexShrink: 0, padding: '0 5px', borderRadius: 5, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
            color: no ? TEAL : '#9A3412', background: no ? TEAL_SOFT : '#FFF7ED',
            border: `1px solid ${no ? '#B6DED8' : '#FDBA74'}`,
          }}>
            {no ? '체크인' : '미체크인'}
          </span>
        )}
      </div>
    );
  };
  return (
    <div data-court-suggest="match" data-court-suggest-match={m.matchNo} data-court-suggest-group={m.groupNo ?? ''}
      data-court-suggest-session={s.sessionNo ?? ''} data-court-suggest-checkin={s.checkin ?? ''}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, marginTop: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', color: TEAL }}>추천</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>
          {m.publicLabel ?? matchHeadLabel(m)} · M{m.matchNo}
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, color: MUTED }}>{SESSION_LABEL(s.sessionNo)}</span>
        {m.status === 'calling' && <span style={{ fontSize: 11, fontWeight: 800, color: '#9A3412' }}>호명됨</span>}
      </div>
      {teamRow(m.team1)}
      <span style={{ fontFamily: LABEL, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.14em', color: FAINT }}>VS</span>
      {teamRow(m.team2)}
      {s.checkin === null && (
        <span style={{ fontSize: 10.5, fontWeight: 700, color: FAINT }}>체크인 정보 없음</span>
      )}
      <button
        type="button"
        data-control-action={`suggest-${s.courtNo}`}
        disabled={disabled}
        onClick={() => onSuggest(m, s.courtNo)}
        style={{
          marginTop: 3, minHeight: 34, borderRadius: 9,
          border: `1px solid ${TEAL}`, background: '#fff', color: TEAL,
          fontSize: 12.5, fontWeight: 800,
          opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
        }}
      >
        추천 경기 투입
      </button>
    </div>
  );
}

/** 코트 NEXT UP 조작 묶음(본부 PC 저장). 화면 상태는 위에서 만들어 내려준다. */
interface NextUpOps {
  byCourt: Map<number, ControlNextUp>;
  /** 대기 지정 후보(대기 · 호명 경기 전부). */
  assignable: ControlMatchRow[];
  /** matchId → 대기 코트. */
  reservedBy: Map<string, number>;
  onAssign: (courtNo: number, m: ControlMatchRow) => string | null;
  onClear: (courtNo: number) => void;
  onInsert: (courtNo: number) => void;
  /** 이 코트 스마트 추천(표시 전용 · 최대 3개). */
  recommend: (courtNo: number) => NextUpRecommendation;
  /** 추천 지정 직전 재확인 — 경기판 · 체크인을 새로 읽어 다시 계산한다. 그대로면 null, 바뀌었거나 못 읽었으면 이유. */
  recheck: (courtNo: number, matchId: string, tier: NextUpRecItem['tier']) => Promise<string | null>;
  /** matchId → 경기 중인 팀의 코트 · 체크인 미완료 팀(직접 선택 목록 표시용). */
  flags: Map<string, { busyCourt: number | null; unchecked: number[] | null }>;
}

const teamNames = (t: ControlMatchRow['team1']) =>
  [t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join('·') || `TEAM ${t.teamNo}`;

const nuBtn = (tone: 'solid' | 'line' | 'quiet', disabled: boolean): React.CSSProperties => ({
  minHeight: 30, minWidth: 0, padding: '4px 6px', borderRadius: 8, fontSize: 12, fontWeight: 800,
  border: `1px solid ${tone === 'quiet' ? LINE : NAVY}`,
  background: tone === 'solid' ? NAVY : '#fff', color: tone === 'solid' ? '#fff' : tone === 'line' ? NAVY : MUTED,
  opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
});

const groupKeyOf = (m: ControlMatchRow) => (m.stage === 'knockout' ? 'ko' : String(m.groupNo ?? ''));

/**
 * [다음 경기 지정] 창 — 위: 스마트 추천(최대 3개) · 아래: 직접 경기 선택(조 필터 · 번호/선수명 검색).
 *   ⚠ 어느 쪽이든 NEXT UP 지정(이 PC 저장)만 한다. 실제 투입은 코트 카드의 [대기 경기 투입] 으로 따로 한다.
 *   ⚠ 추천 지정 직전에 최신 상태로 다시 계산해, 그사이 바뀌었으면 지정하지 않고 이유를 보여 준다.
 */
function NextUpPicker({
  courtNo, empty, options, defaultId, ops, error, setError, onClose,
}: {
  courtNo: number;
  empty: boolean;
  options: ControlMatchRow[];
  defaultId: string;
  ops: NextUpOps;
  error: string | null;
  setError: (e: string | null) => void;
  onClose: () => void;
}) {
  const rec = React.useMemo(() => ops.recommend(courtNo), [ops, courtNo]);
  const [choice, setChoice] = React.useState(defaultId);
  const [group, setGroup] = React.useState('');
  const [query, setQuery] = React.useState('');

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = React.useMemo(() => {
    const seen = new Map<string, string>();
    [...options].sort((a, b) => (a.stage === 'knockout' ? 1 : 0) - (b.stage === 'knockout' ? 1 : 0) || ((a.groupNo ?? 0) - (b.groupNo ?? 0)))
      .forEach((m) => { const k = groupKeyOf(m); if (!seen.has(k)) seen.set(k, m.stage === 'knockout' ? '본선' : (m.publicLabel ?? matchHeadLabel(m))); });
    return [...seen];
  }, [options]);
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '');
    const no = /^m?\d+$/.test(q) ? Number(q.replace(/^m/, '')) : null;
    return options.filter((m) => {
      if (group && groupKeyOf(m) !== group) return false;
      if (!q) return true;
      if (no !== null) return m.matchNo === no;
      return [m.team1, m.team2].some((t) => `${t.player1Name}${t.player2Name}`.replace(/\s+/g, '').toLowerCase().includes(q));
    });
  }, [options, group, query]);
  const value = shown.some((m) => m.matchId === choice) ? choice : '';

  const assign = (m: ControlMatchRow) => {
    const msg = ops.onAssign(courtNo, m);
    if (msg) { setError(msg); return; }
    onClose();
  };
  const [checking, setChecking] = React.useState(false);
  const pickRec = async (it: NextUpRecItem) => {
    if (checking) return;
    setChecking(true); setError(null);
    const changed = await ops.recheck(courtNo, it.match.matchId, it.tier);
    setChecking(false);
    if (changed) { setError(changed); return; }
    assign(it.match);
  };
  const save = () => {
    const m = options.find((x) => x.matchId === value);
    if (!m) { setError('대기로 지정할 경기를 골라 주세요.'); return; }
    assign(m);
  };

  const field: React.CSSProperties = { minWidth: 0, minHeight: 34, borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 12.5, fontWeight: 700, color: INK, background: '#fff', padding: '0 8px' };
  const sub: React.CSSProperties = { margin: 0, fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', color: FAINT };

  return (
    <div role="dialog" aria-modal="true" aria-label={`${courtNo}번 코트 NEXT UP 지정`} data-nextup-editor={courtNo}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(15,23,42,0.42)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <p style={sub}>COURT {String(courtNo).padStart(2, '0')} · {empty ? '비어 있음' : '경기 중 — 끝난 뒤 투입'}</p>
          <p style={{ margin: '3px 0 0', fontSize: 16, fontWeight: 800, color: INK }}>다음 경기(NEXT UP) 지정</p>
          <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: MUTED, lineHeight: 1.55, wordBreak: 'keep-all' }}>
            지정은 이 PC 의 대기 예약만 합니다. 경기 상태 · 호명은 바뀌지 않고, 실제 투입은 코트의 [대기 경기 투입] 으로 따로 합니다.
          </p>
        </div>

        {error && <p role="alert" data-nextup-error={courtNo} style={{ margin: 0, padding: '8px 10px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FCA5A5', fontSize: 12, fontWeight: 700, color: '#B91C1C', wordBreak: 'keep-all' }}>{error}</p>}

        {/* 스마트 추천 */}
        <div data-nextup-rec-list={courtNo} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <p style={sub}>추천 후보</p>
          {rec.note ? (
            <p data-nextup-rec-note style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: MUTED }}>{rec.note}</p>
          ) : rec.items.length === 0 ? (
            <p data-nextup-rec-none style={{ margin: 0, padding: '9px 11px', borderRadius: 9, background: '#F8FAFC', border: `1px solid ${LINE}`, fontSize: 12.5, fontWeight: 800, color: MUTED }}>
              추천 가능한 경기 없음 — 아래에서 직접 골라 주세요.
            </p>
          ) : rec.items.map((it, i) => {
            const m = it.match; const check = it.tier === 'check';
            return (
              <div key={m.matchId} data-nextup-rec={m.matchNo} data-rec-tier={it.tier} data-rec-source={it.source}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, minWidth: 0,
                  border: `1px solid ${check ? '#FDBA74' : '#B6DED8'}`, background: check ? '#FFF7ED' : '#F3FAF8' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{m.publicLabel ?? matchHeadLabel(m)} · M{m.matchNo}</span>
                    {m.planned?.courtNo && <span style={{ fontSize: 11, fontWeight: 800, color: MUTED }}>예정 {m.planned.courtNo}번{m.planned.sessionNo ? `·${m.planned.sessionNo}차` : ''}</span>}
                    {check && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#9A3412', border: '1px solid #FDBA74', borderRadius: 5, padding: '0 5px', background: '#fff' }}>확인 필요</span>}
                    {m.status === 'calling' && <span style={{ fontSize: 11, fontWeight: 800, color: '#9A3412' }}>호명됨</span>}
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 700, color: INK_SOFT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {teamNames(m.team1)} vs {teamNames(m.team2)}
                  </p>
                  <p data-rec-reason style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 700, color: check ? '#9A3412' : TEAL, wordBreak: 'keep-all' }}>{it.reason}</p>
                </div>
                <button type="button" data-control-action={`nextup-rec-${courtNo}-${i}`} onClick={() => { void pickRec(it); }} disabled={checking}
                  style={{ ...nuBtn(check ? 'line' : 'solid', checking), flexShrink: 0, minHeight: 34, padding: '4px 10px' }}>
                  {checking ? '확인 중…' : '이 경기로 지정'}
                </button>
              </div>
            );
          })}
          {rec.excluded.length > 0 && (
            <div data-nextup-excluded style={{ fontSize: 11, fontWeight: 600, color: FAINT, lineHeight: 1.6, wordBreak: 'keep-all' }}>
              추천 제외 · {rec.excluded.map((x) => `M${x.matchNo} ${x.reason}`).join(' / ')}
            </div>
          )}
        </div>

        {/* 직접 경기 선택 */}
        <div data-nextup-manual={courtNo} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${LINE}`, paddingTop: 11 }}>
          <p style={sub}>직접 경기 선택</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select data-control-action={`nextup-group-${courtNo}`} value={group} onChange={(e) => { setGroup(e.target.value); setError(null); }} style={{ ...field, flex: '0 0 110px' }}>
              <option value="">전체 조</option>
              {groups.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <input data-control-action={`nextup-search-${courtNo}`} value={query} onChange={(e) => { setQuery(e.target.value); setError(null); }}
              placeholder="경기 번호(M12) · 선수명" style={{ ...field, flex: '1 1 160px' }} />
          </div>
          <select
            data-control-action={`nextup-select-${courtNo}`}
            value={value}
            onChange={(e) => { setChoice(e.target.value); setError(null); }}
            style={{ ...field, width: '100%' }}
          >
            <option value="">{shown.length ? `경기 선택 (${shown.length}개)` : '조건에 맞는 경기 없음'}</option>
            {shown.map((m) => {
              const block = nextUpAssignBlock(m, courtNo);
              const at = ops.reservedBy.get(m.matchId);
              const f = ops.flags.get(m.matchId);
              const plan = m.planned?.courtNo ? ` · 예정 ${m.planned.courtNo}번${m.planned.sessionNo ? `·${m.planned.sessionNo}차` : ''}` : '';
              const tag = at !== undefined && at !== courtNo ? ` · ${at}번 대기` : '';
              const busy = f && f.busyCourt !== null ? ` · 경기 중(${f.busyCourt}번)` : '';
              const unck = f?.unchecked?.length ? ' · 체크인 미완료' : '';
              return (
                <option key={m.matchId} value={m.matchId} disabled={!!block}>
                  {`${m.publicLabel ?? matchHeadLabel(m)} M${m.matchNo}${plan}${tag}${busy}${unck}${block ? ' · 지정 불가' : ''} — ${teamNames(m.team1)} vs ${teamNames(m.team2)}`}
                </option>
              );
            })}
          </select>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" data-control-action={`nextup-save-${courtNo}`} onClick={save} style={{ ...nuBtn('solid', false), flex: 1, minHeight: 34 }}>대기 지정</button>
            <button type="button" data-control-action={`nextup-close-${courtNo}`} onClick={onClose} style={{ ...nuBtn('quiet', false), minHeight: 34, padding: '4px 14px' }}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 코트 NEXT UP — 본부가 '이 코트 대기' 로 지정한 경기.
 *   ⚠ 지정 · 변경 · 해제는 이 PC 저장만 바꾼다. 경기 상태 · 호명 · 코트 점유 · 타이머 · 점수는 그대로다.
 *   ⚠ [대기 경기 투입] 만 서버 조작이다(기존 체크인 확인 → start_match).
 */
function CourtNextUp({
  courtNo, empty, nu, suggestion, ops, disabled,
}: {
  courtNo: number;
  /** 코트가 비어 있는가 — 그때만 [대기 경기 투입]. */
  empty: boolean;
  nu: ControlNextUp | undefined;
  suggestion: ControlCourtSuggestion | undefined;
  ops: NextUpOps;
  disabled: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // 후보 순서 — 이 코트 예정 조(1차 → 2차, 경기 번호) 먼저, 그다음 나머지 경기 번호 순.
  const options = React.useMemo(() => {
    const here = ops.assignable.filter((m) => m.planned?.courtNo === courtNo)
      .sort((a, b) => ((a.planned?.sessionNo ?? 9) - (b.planned?.sessionNo ?? 9)) || (a.matchNo - b.matchNo));
    const rest = ops.assignable.filter((m) => m.planned?.courtNo !== courtNo);
    return [...here, ...rest];
  }, [ops.assignable, courtNo]);
  const defaultId = React.useMemo(() => {
    if (nu?.kind === 'ready') return nu.matchId;
    if (suggestion?.kind === 'match') return suggestion.match.matchId;
    const free = options.find((m) => m.planned?.courtNo === courtNo && ops.reservedBy.get(m.matchId) === undefined && !nextUpAssignBlock(m, courtNo));
    return free?.matchId ?? '';
  }, [nu, suggestion, options, ops.reservedBy, courtNo]);
  const open = () => { setError(null); setEditing(true); };
  const close = React.useCallback(() => { setEditing(false); setError(null); }, []);

  const editor = editing && (
    <NextUpPicker courtNo={courtNo} empty={empty} options={options} defaultId={defaultId} ops={ops}
      error={error} setError={setError} onClose={close} />
  );

  if (!nu) {
    return (
      <div data-nextup-court={courtNo} data-nextup-kind="" style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        {editor || (
          <button type="button" data-control-action={`nextup-open-${courtNo}`} onClick={open} disabled={disabled}
            style={{ ...nuBtn('line', disabled), width: '100%' }}>
            다음 경기 지정
          </button>
        )}
      </div>
    );
  }

  const m = nu.match;
  const busy = nu.kind === 'ready' ? nu.busyTeams : [];
  const unchecked = new Set(nu.kind === 'ready' ? (nu.uncheckedTeamNos ?? []) : []);
  const team = (t: ControlMatchRow['team1']) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {teamNames(t)}
      </span>
      {busy.includes(t.teamNo) ? (
        <span data-nextup-team-busy={t.teamNo} style={{ flexShrink: 0, padding: '0 5px', borderRadius: 5, fontSize: 10, fontWeight: 800, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FCA5A5' }}>경기 중</span>
      ) : nu.kind === 'ready' && nu.uncheckedTeamNos !== null ? (
        <span style={{
          flexShrink: 0, padding: '0 5px', borderRadius: 5, fontSize: 10, fontWeight: 800,
          color: unchecked.has(t.teamNo) ? '#9A3412' : TEAL, background: unchecked.has(t.teamNo) ? '#FFF7ED' : TEAL_SOFT,
          border: `1px solid ${unchecked.has(t.teamNo) ? '#FDBA74' : '#B6DED8'}`,
        }}>
          {unchecked.has(t.teamNo) ? '미체크인' : '체크인'}
        </span>
      ) : null}
    </div>
  );
  const canInsert = nu.kind === 'ready' && empty && busy.length === 0;

  return (
    <div data-nextup-court={courtNo} data-nextup-kind={nu.kind} data-nextup-match={nu.kind === 'ready' ? nu.match.matchNo : nu.matchNo}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, padding: '8px 9px', borderRadius: 9,
        border: `1.5px solid ${nu.kind === 'ready' ? NAVY : '#FDBA74'}`, background: nu.kind === 'ready' ? '#F1F5F9' : '#FFF7ED',
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em',
          color: '#fff', background: nu.kind === 'ready' ? NAVY : '#C2410C', padding: '1px 6px', borderRadius: 5,
        }}>
          NEXT UP
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>
          {m ? `${m.publicLabel ?? matchHeadLabel(m)} · M${m.matchNo}` : `M${nu.kind === 'invalid' ? nu.matchNo : ''}`}
        </span>
        {m?.status === 'calling' && <span style={{ fontSize: 11, fontWeight: 800, color: '#9A3412' }}>호명됨</span>}
      </div>
      {nu.kind === 'ready' && m && (<>{team(m.team1)}<span style={{ fontFamily: LABEL, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.14em', color: FAINT }}>VS</span>{team(m.team2)}</>)}
      {nu.kind === 'invalid' && (
        <p data-nextup-invalid={courtNo} style={{ margin: 0, display: 'flex', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#9A3412', wordBreak: 'keep-all' }}>
          <AlertTriangle size={12} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
          무효 지정 — {nu.message}
        </p>
      )}
      {nu.kind === 'ready' && busy.length > 0 && (
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#B91C1C', wordBreak: 'keep-all' }}>
          경기 중인 팀이 있어 그 경기가 끝나야 투입할 수 있습니다.
        </p>
      )}
      {editor || (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
          {nu.kind === 'ready' && empty && (
            <button type="button" data-control-action={`nextup-insert-${courtNo}`} disabled={disabled || !canInsert}
              onClick={() => ops.onInsert(courtNo)}
              style={{ ...nuBtn('solid', disabled || !canInsert), minHeight: 34, fontSize: 12.5 }}>
              대기 경기 투입
            </button>
          )}
          {/* 좁은 칸(146px)에서는 두 버튼이 줄을 바꾼다 — 칸 밖으로 밀지 않는다. */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button type="button" data-control-action={`nextup-change-${courtNo}`} onClick={open} disabled={disabled}
              style={{ ...nuBtn('line', disabled), flex: '1 1 64px' }}>대기 변경</button>
            <button type="button" data-control-action={`nextup-clear-${courtNo}`} onClick={() => ops.onClear(courtNo)} disabled={disabled}
              style={{ ...nuBtn('quiet', disabled), flex: '1 1 64px' }}>대기 해제</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CourtPanel({
  court, selectable, disabled, onPick, suggestion, scheduleState, onSuggest, hinted = false, nextUp, nuOps, timerRow, ops,
}: {
  /** 진행 중 경기 줄(NOW PLAYING 과 같은 값) — 코트 카드 타이머용. 없으면 타이머를 그리지 않는다. */
  timerRow?: ControlMatchRow;
  ops?: ControlOps;
  nextUp?: ControlNextUp;
  nuOps: NextUpOps;
  court: ControlCourt;
  /** 투입 선택 모드에서 이 코트를 고를 수 있는가(비어 있는 코트만 true). */
  selectable: boolean;
  disabled: boolean;
  onPick: (courtNo: number) => void;
  suggestion?: ControlCourtSuggestion;
  scheduleState: 'loading' | 'ready' | 'failed';
  onSuggest: (m: ControlMatchRow, courtNo: number) => void;
  /** 추천으로 고른 경기의 추천 코트인가 — 그 코트 버튼을 강조한다. */
  hinted?: boolean;
}) {
  const playing = court.state === 'playing' && court.now;
  const closed = court.state === 'closed';

  return (
    <div
      data-court={court.courtNo}
      data-court-state={court.state}
      data-court-selectable={selectable ? '1' : undefined}
      data-court-hinted={hinted && selectable ? '1' : undefined}
      style={{
        // ⚠ border 축약형과 borderTop* 을 섞지 않는다 — 리렌더 때 서로 덮어써 경고가 난다.
        borderStyle: 'solid',
        borderColor: hinted && selectable ? REC_BLUE : playing || selectable ? TEAL : LINE,
        borderWidth: playing ? '3px 1px 1px' : hinted && selectable ? 3 : 1,
        borderRadius: 12,
        background: hinted && selectable ? REC_BLUE_SOFT : selectable ? TEAL_SOFT : closed ? '#F8FAFC' : '#fff',
        padding: '11px 13px 13px',
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
        minHeight: 128,
        opacity: closed ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={eyebrow}>COURT</p>
          <p style={{
            margin: '1px 0 0', fontFamily: LABEL, fontSize: 25, fontWeight: 800,
            color: closed ? FAINT : INK, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums',
          }}>
            {String(court.courtNo).padStart(2, '0')}
          </p>
        </div>
        <span style={{
          fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em',
          color: playing ? TEAL : closed ? FAINT : MUTED,
          background: playing ? TEAL_SOFT : 'transparent',
          padding: playing ? '3px 7px' : '3px 0', borderRadius: 6, whiteSpace: 'nowrap',
        }}>
          {playing ? 'PLAYING' : closed ? 'CLOSED' : 'EMPTY'}
        </span>
      </div>

      {playing && court.now ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <CourtTeam team={court.now.team1} />
          <span style={{
            fontFamily: LABEL, fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: FAINT,
          }}>
            VS
          </span>
          <CourtTeam team={court.now.team2} />
          {timerRow && ops && <CourtCardTimer m={timerRow} ops={ops} />}
          <div style={{ marginTop: 4 }}>
            <CourtNextUp courtNo={court.courtNo} empty={false} nu={nextUp} suggestion={undefined} ops={nuOps} disabled={disabled} />
          </div>
        </div>
      ) : selectable ? (
        // ⚠ 선택지일 뿐이다. 비어 있는지 최종 판정은 서버(start_match)가 한다.
        //   추천 코트는 파란색 + 추천 표시(색만으로 구분하지 않는다) · 누르는 동작은 일반 투입과 같다.
        <button
          type="button"
          data-control-action={`court-${court.courtNo}`}
          data-court-pick-kind={hinted ? 'recommended' : 'normal'}
          disabled={disabled}
          onClick={() => onPick(court.courtNo)}
          style={{
            margin: 'auto 0 0', minHeight: 34, borderRadius: 9, padding: '4px 8px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, flexWrap: 'wrap',
            border: `1px solid ${hinted ? REC_BLUE : TEAL}`, background: hinted ? REC_BLUE : TEAL, color: '#fff',
            fontSize: 12.5, fontWeight: 800, lineHeight: 1.25, wordBreak: 'keep-all',
            opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {hinted && <Sparkles size={13} strokeWidth={2.4} aria-hidden style={{ flexShrink: 0 }} />}
          {hinted ? '추천 코트에 투입' : '이 코트에 투입'}
        </button>
      ) : closed ? (
        <p style={{ margin: 'auto 0 2px', fontSize: 12.5, fontWeight: 600, color: FAINT }}>사용 중지</p>
      ) : nextUp ? (
        // 대기 지정이 있으면 자동 추천 대신 그 경기를 보여 준다(추천이 지정을 덮지 않는다).
        <div style={{ marginTop: 'auto' }}>
          <CourtNextUp courtNo={court.courtNo} empty nu={nextUp} suggestion={suggestion} ops={nuOps} disabled={disabled} />
        </div>
      ) : (
        <>
          <CourtSuggestion s={suggestion} scheduleState={scheduleState} disabled={disabled} onSuggest={onSuggest} />
          <CourtNextUp courtNo={court.courtNo} empty nu={undefined} suggestion={suggestion} ops={nuOps} disabled={disabled} />
        </>
      )}
      {/* 투입 선택 중이어도 이 코트의 대기 지정은 알 수 있게 한 줄 남긴다. */}
      {selectable && nextUp && (
        <p data-nextup-note={court.courtNo} style={{ margin: 0, fontSize: 11, fontWeight: 800, color: NAVY }}>
          NEXT UP · M{nextUp.kind === 'ready' ? nextUp.match.matchNo : nextUp.matchNo}
        </p>
      )}
    </div>
  );
}

function CourtBoard({
  courts, picking, disabled, onPick, suggestions, suggestWarnings, scheduleState, onSuggest, hintCourt, nuOps, nuStorageError, playingRows, ops,
}: {
  /** 진행 중 경기 줄(경기 id → 줄) — 코트 카드 타이머용. */
  playingRows?: Map<string, ControlMatchRow>;
  ops?: ControlOps;
  courts: ControlCourt[];
  /** 투입할 경기를 고른 상태인가. 그때만 빈 코트가 선택 가능해진다. */
  picking: boolean;
  disabled: boolean;
  onPick: (courtNo: number) => void;
  suggestions: Map<number, ControlCourtSuggestion>;
  /** 조 일정 배정 경고 — 고치지 않고 보여 준다. */
  suggestWarnings: string[];
  scheduleState: 'loading' | 'ready' | 'failed';
  onSuggest: (m: ControlMatchRow, courtNo: number) => void;
  hintCourt: number | null;
  nuOps: NextUpOps;
  /** NEXT UP 저장 실패 안내(정상이면 null). */
  nuStorageError: string | null;
}) {
  const n = countCourtStates(courts);
  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11 }}>
        <p style={eyebrow}>COURTS</p>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>
          경기 중 {n.playing} · 비어 있음 {n.empty} · 중지 {n.closed}
        </span>
        <span data-nextup-guide style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: FAINT, wordBreak: 'keep-all' }}>
          NEXT UP 은 이 PC 브라우저에만 저장됩니다 · 본부 PC 한 대 기준
        </span>
      </div>

      {nuStorageError && (
        <p data-nextup-storage-error role="alert" style={{
          margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 700, color: '#B91C1C',
        }}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          {nuStorageError}
        </p>
      )}

      {/* 추천은 조 일정의 예정 코트 · 차수로만 만든다. 어긋난 배정은 고치지 않고 여기 알린다. */}
      {suggestWarnings.length > 0 && (
        <div data-court-suggest-warnings role="note" style={{
          display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10,
          padding: '8px 11px', borderRadius: 9, border: '1px solid #FDBA74', background: '#FFF7ED',
        }}>
          {suggestWarnings.map((w) => (
            <p key={w} style={{
              margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6,
              fontSize: 12, fontWeight: 700, color: '#9A3412', wordBreak: 'keep-all',
            }}>
              <AlertTriangle size={13} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 2 }} />
              {w}
            </p>
          ))}
        </div>
      )}

      {courts.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: FAINT }}>
          등록된 코트가 없습니다. 코트 관리에서 먼저 등록해 주세요.
        </p>
      ) : (
        <div style={{
          display: 'grid',
          // 한 줄에 다섯 칸까지. 칸의 최소 폭을 '행의 1/5' 로 두어 넓은 화면에서도 6칸으로 벌어지지 않고,
          // 좁아지면 146px 바닥에 걸려 자연스럽게 줄 수가 늘어난다.
          //   ⚠ 코트 수를 숫자로 박지 않는다 — auto-fit 이라 코트가 적으면 그만큼만 그려진다.
          gridTemplateColumns: 'repeat(auto-fit, minmax(max(146px, calc((100% - 32px) / 5)), 1fr))',
          gap: 8,
        }}>
          {courts.map((c) => (
            <CourtPanel
              key={c.courtNo} court={c}
              selectable={picking && c.state === 'empty'}
              disabled={disabled} onPick={onPick}
              suggestion={suggestions.get(c.courtNo)} scheduleState={scheduleState}
              onSuggest={onSuggest} hinted={hintCourt === c.courtNo}
              nextUp={nuOps.byCourt.get(c.courtNo)} nuOps={nuOps}
              timerRow={c.now ? playingRows?.get(c.now.matchId) : undefined} ops={ops}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── 단계 상태 ───────────────────────────────────────────────────────────────

function StatCell({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <p style={{
        margin: 0, fontFamily: LABEL, fontSize: 18, fontWeight: 800,
        color: tone ?? INK, fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </p>
      <p style={{ margin: '1px 0 0', fontSize: 11, fontWeight: 700, color: MUTED }}>{label}</p>
    </div>
  );
}

function GroupChip({ g }: { g: ControlGroup }) {
  const tone = g.state === 'attention'
    ? { bg: '#FFF7ED', bd: '#FDBA74', fg: '#9A3412' }
    : g.state === 'done'
      ? { bg: TEAL_SOFT, bd: '#B6DED8', fg: TEAL }
      : g.state === 'running'
        ? { bg: '#fff', bd: LINE, fg: INK_SOFT }
        : { bg: '#F8FAFC', bd: LINE_SOFT, fg: FAINT };

  const mark = g.state === 'attention' ? '!'
    : g.state === 'done' ? '✓'
    : `${g.completedMatches}/${g.expectedMatches}`;

  return (
    <div data-group={g.groupNo} data-group-state={g.state} style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 5,
      padding: '5px 8px', borderRadius: 7,
      border: `1px solid ${tone.bd}`, background: tone.bg,
      fontSize: 11.5, fontWeight: 700, color: tone.fg, minWidth: 0,
    }}>
      <span style={{ whiteSpace: 'nowrap' }}>{g.groupNo}조</span>
      <span style={{ fontFamily: LABEL, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{mark}</span>
    </div>
  );
}

function PreliminaryStatus({ p }: { p: NonNullable<ReturnType<typeof derivePreliminary>> }) {
  return (
    <section style={card} data-control-section="preliminary">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 11 }}>
        <p style={eyebrow}>PRELIMINARY STATUS</p>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>{p.groups.length}개 조</span>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8,
        paddingBottom: 11, marginBottom: 11, borderBottom: `1px solid ${LINE_SOFT}`,
      }}>
        <StatCell value={p.done} label="완료" tone={p.done > 0 ? TEAL : undefined} />
        <StatCell value={p.running} label="진행 중" />
        <StatCell value={p.attention} label="확인 필요" tone={p.attention > 0 ? '#9A3412' : undefined} />
        <StatCell value={p.notStarted} label="대기" />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))', gap: 6,
      }}>
        {p.groups.map((g) => <GroupChip key={g.groupNo} g={g} />)}
      </div>

      {p.ageCheckGroups.length > 0 && (
        <p style={{
          margin: '11px 0 0', fontSize: 12, fontWeight: 700, color: '#9A3412',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          {p.ageCheckGroups.map((n) => `${n}조`).join(' · ')} 합산연령 확인 필요
        </p>
      )}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      padding: '7px 0', borderBottom: `1px solid ${LINE_SOFT}`,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: MUTED }}>{label}</span>
      <span style={{
        fontFamily: LABEL, fontSize: 12.5, fontWeight: 800, color: tone ?? INK,
        letterSpacing: '0.04em', fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
    </div>
  );
}

function KnockoutStatus({ k }: { k: NonNullable<ReturnType<typeof deriveKnockout>> }) {
  return (
    <section style={card} data-control-section="knockout">
      <p style={{ ...eyebrow, marginBottom: 7 }}>KNOCKOUT STATUS</p>
      <Row label="본선 경로" value={k.pathLocked ? 'LOCKED' : 'NOT LOCKED'}
        tone={k.pathLocked ? TEAL : '#9A3412'} />
      <Row label="예선 결과 반영" value={`${k.resolved} / ${k.qualifiers}`} />
      <Row label="본선 경기"
        value={k.matchesReady ? `READY · ${k.matchesCompleted}/${k.matchesTotal}` : 'NOT READY'}
        tone={k.matchesReady ? TEAL : MUTED} />
      {k.championDecided && <Row label="우승" value="CHAMPION 확정" tone="#B8860B" />}
    </section>
  );
}

// ── 안내 ────────────────────────────────────────────────────────────────────

/**
 * 투입할 경기로 고른 뒤 띄우는 안내 줄.
 *   ⚠ 아직 아무 것도 저장되지 않았다. 코트를 고르는 순간 한 번의 start_match 가 나간다.
 *   ⚠ 보여 주는 경기는 **고른 순간의 값**이다. 다른 곳에서 바뀌면 경고로 바꾸고 투입을 막는다
 *     — 선택을 지우지도, 다른 경기로 옮기지도 않는다. 해제는 운영자가 [선택 취소] 로 한다.
 */
const pickNames = (t: ControlMatchRow['team1']) => [t.player1Name, t.player2Name].filter((x) => x.trim() !== '').join('·');

function PickBanner({
  match, state, disabled, onCancel, unchecked = null, hintCourt = null,
}: {
  match: ControlMatchRow; state: ControlPickState; disabled: boolean; onCancel: () => void;
  /** 체크인 안 된 팀 번호(모르면 null). 표시 전용 — 코트를 고르면 한 번 더 확인한다. */
  unchecked?: number[] | null;
  /** 코트 추천에서 고른 경우 그 추천 코트. */
  hintCourt?: number | null;
}) {
  const head = matchHeadLabel(match);
  const ok = state.kind === 'ok';
  const tone = ok ? TEAL : '#9A3412';

  return (
    <div data-control-pick={match.matchNo} data-control-pick-state={state.kind} style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '10px 14px', borderRadius: 11,
      border: `1px solid ${ok ? TEAL : '#FDBA74'}`, background: ok ? TEAL_SOFT : '#FFF7ED',
    }}>
      <span style={{
        fontFamily: LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.12em', color: tone,
      }}>
        투입할 경기
      </span>
      <span style={{ fontSize: 13, fontWeight: 800, color: INK, minWidth: 0 }}>
        {head} · M{match.matchNo}
        <span style={{ color: MUTED, fontWeight: 700 }}>
          {' · '}TEAM {String(match.team1.teamNo).padStart(2, '0')} {pickNames(match.team1)}
          {' vs '}TEAM {String(match.team2.teamNo).padStart(2, '0')} {pickNames(match.team2)}
        </span>
      </span>
      {ok ? (
        <span style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT }}>
          {hintCourt !== null
            ? `추천 코트는 ${hintCourt}번입니다. ${hintCourt}번 코트의 [추천 코트에 투입]을 눌러 확정해 주세요.`
            : '아래에서 비어 있는 코트를 선택해 주세요.'}
          {unchecked && unchecked.length > 0 && (
            <span data-control-pick-unchecked={unchecked.join(',')} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6,
              color: '#9A3412', fontWeight: 800,
            }}>
              <AlertTriangle size={12} strokeWidth={2.4} />
              {unchecked.map((n) => `TEAM ${String(n).padStart(2, '0')}`).join(' · ')} 미체크인
            </span>
          )}
        </span>
      ) : (
        <span role="alert" data-control-pick-warning style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 700, color: tone,
        }}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          {state.message} 투입하려면 선택을 취소하고 다시 골라 주세요.
        </span>
      )}
      <button type="button" data-control-action="pick-cancel" onClick={onCancel} disabled={disabled}
        style={{
          ...navBtn, marginLeft: 'auto', minHeight: 28, padding: '4px 10px', fontSize: 11.5,
          opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
        }}>
        <X size={12} strokeWidth={2.6} />
        선택 취소
      </button>
    </div>
  );
}

/**
 * 조작 결과 확인 필요(4F-4c-2).
 *   결과를 확인할 수 없었던 조작을 운영자가 [확인함] 을 누를 때까지 남긴다(토스트는 사라지므로).
 *   ⚠ 이 브라우저 세션의 임시 기록이다 — DB · 서버 이력에 남기지 않는다.
 *   ⚠ 여러 건이면 쌓아 보여 준다(마지막 건으로 덮어쓰지 않는다).
 *   ⚠ 좁은 화면(360px)에서도 경기 정보와 버튼이 잘리지 않게 줄을 바꾼다.
 */
function UnverifiedList({
  items, refreshing, onRefresh, onAcknowledge,
}: {
  items: UnverifiedAction[];
  refreshing: boolean;
  onRefresh: () => void;
  onAcknowledge: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section data-control-verify-list role="region" aria-label="조작 결과 확인 필요" style={{
      ...card, border: '1px solid #FDBA74', background: '#FFF7ED', padding: 13,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <AlertTriangle size={14} strokeWidth={2.4} color="#9A3412" />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#9A3412' }}>
          조작 결과 확인 필요 {items.length}건
        </p>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#9A3412', minWidth: 0 }}>
          응답을 받지 못해 이 화면의 요청이 처리됐는지 확인할 수 없습니다. 현장에서 확인한 뒤 [확인함]을 눌러 주세요.
        </span>
      </div>
      {items.map((it) => (
        <div key={it.id} data-control-verify-item={it.id} style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '9px 11px', borderRadius: 10, background: '#fff', border: `1px solid ${LINE}`,
        }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: INK, wordBreak: 'keep-all' }}>
              {it.match}
              <span style={{ fontWeight: 700, color: INK_SOFT }}> — {it.request} 요청</span>
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: MUTED, wordBreak: 'keep-all' }}>
              {hhmmss(it.at)} · 확인 당시 서버 상태: {it.server ?? '다시 읽지 못함'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
            <button type="button" data-control-action="verify-refresh" onClick={onRefresh} disabled={refreshing}
              style={{ ...navBtn, minHeight: 32, opacity: refreshing ? 0.55 : 1 }}>
              <RefreshCw size={12} strokeWidth={2.4} />
              {refreshing ? '조회 중' : '새로고침'}
            </button>
            <button type="button" data-control-action={`verify-ack-${it.id}`} onClick={() => onAcknowledge(it.id)}
              style={{ ...navBtn, minHeight: 32, background: NAVY, borderColor: NAVY, color: '#fff' }}>
              확인함
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function Quiet({ title, desc, retry }: {
  title: string; desc?: string;
  /** 첫 조회 실패처럼 머리말(새로고침)이 없는 화면에서만 준다. */
  retry?: { busy: boolean; onRetry: () => void };
}) {
  return (
    <section style={{ ...card, textAlign: 'center', padding: '26px 15px' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: INK_SOFT }}>{title}</p>
      {desc && <p style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 600, color: MUTED }}>{desc}</p>}
      {retry && (
        <button type="button" data-control-action="retry" onClick={retry.onRetry} disabled={retry.busy}
          style={{
            ...navBtn, margin: '12px auto 0', minHeight: 34, padding: '7px 14px',
            opacity: retry.busy ? 0.55 : 1, cursor: retry.busy ? 'default' : 'pointer',
          }}>
          <RefreshCw size={13} strokeWidth={2.4} />
          {retry.busy ? '조회 중' : '다시 시도'}
        </button>
      )}
    </section>
  );
}

// ── 화면 ────────────────────────────────────────────────────────────────────

export default function ControlCenter({ slug, event }: { slug: string; event: ControlEvent }) {
  const st = useControlData(slug);
  const snap = st.snapshot;

  const phase = React.useMemo(
    () => derivePhase(snap?.board ?? null, snap?.bracket ?? null),
    [snap],
  );
  const summary = React.useMemo(() => deriveSummary(snap?.board ?? null, phase), [snap, phase]);
  // 병행 운영 — 본선 단계여도 예선 경기가 남아 있으면 예선 요약을 한 줄 더 보여 준다(위 요약은 본선만 센다).
  const prelimSummary = React.useMemo(() => {
    if (summary.stage !== 'knockout') return null;
    const p = deriveSummary(snap?.board ?? null, 'preliminary');
    return p.waiting + p.calling + p.playing > 0 ? p : null;
  }, [snap, summary.stage]);
  const courts = React.useMemo(() => deriveCourts(snap?.board ?? null), [snap]);
  const prelim = React.useMemo(() => derivePreliminary(snap?.standings ?? null), [snap]);
  const knockout = React.useMemo(() => deriveKnockout(snap?.bracket ?? null), [snap]);
  // 예정 코트 · 차수(조 일정) — 대기 줄 안내 · 코트 추천 전용. 처음 한 번 + [새로고침] 때 다시 읽는다
  //   (실패 · 미적용이면 표시 · 추천만 없다 — 관제는 그대로. 읽었던 값은 실패해도 유지한다).
  const [schedule, setSchedule] = React.useState<ControlPlannedGroup[] | null>(null);
  const [scheduleState, setScheduleState] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [scheduleTick, setScheduleTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    fetchAdminGroupSchedule(slug)
      .then((r) => {
        if (!alive) return;
        if (r.data) {
          setSchedule(r.data.groups.map((g) => ({ groupNo: g.groupNo, plannedCourtNo: g.plannedCourtNo, sessionNo: g.sessionNo })));
          setScheduleState('ready');
        } else setScheduleState((s) => (s === 'ready' ? s : 'failed'));
      })
      .catch(() => { if (alive) setScheduleState((s) => (s === 'ready' ? s : 'failed')); });
    return () => { alive = false; };
  }, [slug, scheduleTick]);
  const rowCtx = React.useMemo(() => deriveRowContext(snap?.board ?? null, schedule), [snap, schedule]);
  // ⚠ 진행 중 · 대기는 화면 단계(phase)로 거르지 않는다 — 본선 선행 경기가 생겨도 예선 경기가 목록에서 사라지지 않게.
  const playing = React.useMemo(
    () => derivePlaying(snap?.board ?? null, 'all', snap?.bracket ?? null, rowCtx),
    [snap, rowCtx],
  );
  const playingRows = React.useMemo(() => new Map(playing.map((m) => [m.matchId, m])), [playing]);
  const waiting = React.useMemo(
    () => deriveWaiting(snap?.board ?? null, 'preliminary', WAITING_ROWS, snap?.bracket ?? null, rowCtx),
    [snap, rowCtx],
  );
  const knockoutWaiting = React.useMemo(
    () => deriveWaiting(snap?.board ?? null, 'knockout', WAITING_ROWS, snap?.bracket ?? null, rowCtx),
    [snap, rowCtx],
  );
  const hasKnockout = React.useMemo(() => (snap?.board?.matches ?? []).some((m) => m.stage === 'knockout'), [snap]);
  const emptyCourts = React.useMemo(() => new Set(courts.filter((c) => c.state === 'empty').map((c) => c.courtNo)), [courts]);
  const attention = React.useMemo(
    () => deriveAttention({ summary, preliminary: prelim, knockout, phase }),
    [summary, prelim, knockout, phase],
  );

  // ── 조작 ──────────────────────────────────────────────────────────────────
  // 조작은 조회 큐와 함께 돈다 — 조작 중에는 조회를 멈추고, 조작 전 응답은 반영하지 않는다.
  const act = useControlActions({
    reload: st.reload, hold: st.hold, release: st.release, latest: st.latest,
  });

  // 팀 체크인 — 별도 조회(실패해도 관제에 영향 없음). 대기 줄 표시와 투입 직전 경고에만 쓴다.
  const checkins = useControlCheckins(slug);

  /**
   * 투입할 경기로 고른 상태 — **고른 순간의 행 그대로**(matchId · version · 팀)를 들고 있다.
   *   ⚠ 재조회로 바꾸지 않는다. 최신 상태는 derivePickState 로 비교만 한다.
   *   ⚠ 다른 곳에서 바뀌어도 선택을 지우지 않는다(투입만 막는다). 해제는 운영자가 한다.
   */
  const [pick, setPick] = React.useState<ControlMatchRow | null>(null);
  /**
   * 점수를 입력할 경기 — **모달을 연 순간의 행 그대로**(matchId · version · 팀 · 결승 여부).
   *   ⚠ 재조회로 모달을 닫거나 다른 경기로 바꾸지 않는다. 최신 상태는 deriveScoreConflict 로 비교만 한다.
   */
  const [scoreFor, setScoreFor] = React.useState<ControlMatchRow | null>(null);

  const pickState = React.useMemo(
    () => (pick ? derivePickState(pick, snap?.board ?? null) : null),
    [pick, snap],
  );
  const scoreConflict = React.useMemo(
    () => (scoreFor ? deriveScoreConflict(scoreFor, snap?.board ?? null) : null),
    [scoreFor, snap],
  );
  const canStart = pick !== null && pickState?.kind === 'ok';

  /**
   * 미체크인 경고 — 코트를 고른 순간 체크인 안 된 팀이 있으면 바로 투입하지 않고 한 번 묻는다.
   *   ⚠ 경고일 뿐이다. 운영자(CEO/ADMIN)가 [예외 허용]을 누르면 기존 투입 그대로 진행한다(서버는 막지 않는다).
   *   ⚠ 체크인 정보를 모르면(조회 실패 · 미적용) 묻지 않고 기존대로 투입한다 — 경고 기능이 진행을 막지 않게.
   */
  const [checkinWarn, setCheckinWarn] = React.useState<
    { match: ControlMatchRow; courtNo: number; teamNos: number[]; source: 'pick' | 'nextup' } | null
  >(null);
  /** 투입 직전 체크인 확인 중(최대 2.5초) — 그동안 코트 버튼을 다시 받지 않는다. */
  const [checkingIn, setCheckingIn] = React.useState(false);
  // 코트 NEXT UP(본부 PC 저장) — 지정된 경기는 그 코트에 고정된다(다른 코트 추천에서 빠진다).
  const nextUp = useCourtNextUp(slug);
  const reservedBy = React.useMemo(
    () => new Map(nextUp.loaded ? nextUp.entries.map((e) => [e.matchId, e.courtNo] as const) : []),
    [nextUp.entries, nextUp.loaded],
  );
  const nextUps = React.useMemo(
    () => deriveNextUps(nextUp.loaded ? nextUp.entries : [], snap?.board ?? null, checkins.lookup, rowCtx),
    [nextUp.entries, nextUp.loaded, snap, checkins.lookup, rowCtx],
  );
  const assignable = React.useMemo(() => deriveAssignable(snap?.board ?? null, snap?.bracket ?? null, rowCtx), [snap, rowCtx]);
  // 코트별 다음 경기 추천 — 표시 전용(투입은 운영자가 코트를 직접 눌러야 한다).
  const suggestions = React.useMemo(
    () => deriveCourtSuggestions(snap?.board ?? null, schedule, checkins.lookup, rowCtx, reservedBy),
    [snap, schedule, checkins.lookup, rowCtx, reservedBy],
  );
  /** 추천으로 고른 경기의 추천 코트(강조 표시만). 다른 빈 코트를 골라도 된다. */
  const [hintCourt, setHintCourt] = React.useState<number | null>(null);
  React.useEffect(() => { if (!pick) setHintCourt(null); }, [pick]);
  const onSuggest = React.useCallback((m: ControlMatchRow, courtNo: number) => {
    // 기존 투입 흐름 그대로 — 그 경기를 '투입할 경기' 로 고르기만 한다. 저장은 코트를 누를 때 한 번.
    setPick(m);
    setHintCourt(courtNo);
  }, []);
  const pickUnchecked = React.useMemo(
    () => (pick ? uncheckedTeams(checkins.lookup, [pick.team1.teamNo, pick.team2.teamNo]) : null),
    [pick, checkins.lookup],
  );

  // 서버 시계 보정 — 보드를 받을 때마다 다시 잰다. serverNow 가 없는 서버면 null(타이머 숨김).
  const offset = React.useMemo(
    () => clockOffset(snap?.board?.serverNow ?? null, snap?.board?.receivedAt ?? null),
    [snap],
  );
  /**
   * 점수 모달 머리의 경과 시간 — 모달을 연 순간의 행이 아니라 **최신 board** 의 그 경기에서 읽는다
   *   (모달을 연 뒤 다른 기기에서 경기 시작을 눌렀어도 보인다). 모달 · 점수 판정과는 무관한 표시다.
   */
  const scoreTimer = React.useMemo(() => {
    if (!scoreFor || offset === null) return null;
    const m = (snap?.board?.matches ?? []).find((x) => x.matchId === scoreFor.matchId);
    return m ? matchTimerState(m) : null;
  }, [scoreFor, snap, offset]);

  const ops: ControlOps = React.useMemo(() => ({
    busy: act.busy,
    selectedMatchId: pick?.matchId ?? null,
    onCall: (m) => { void act.call(m); },
    onUncall: (m) => { void act.uncall(m); },
    // 지금 화면에 보이는 행을 그대로 고정한다 — 운영자가 본 version 이 곧 투입할 version 이다.
    onPickCourt: (m) => { setPick(m); setHintCourt(null); },
    onCancelPick: () => setPick(null),
    onScore: (m) => setScoreFor(m),
    onStartTimer: (m) => { void act.startTimer(m); },
    clockOffset: offset,
    checkin: checkins.lookup,
    emptyCourts,
  }), [act, pick, offset, checkins.lookup, emptyCourts]);

  /**
   * 코트를 고른 순간 — 여기서 처음으로 저장이 일어난다(코트 배정 + 시작이 한 번).
   *   ⚠ 보내는 version 은 운영자가 **고른 순간의** 값이다. 최신 조회 값으로 바꿔 넣지 않는다.
   *   ⚠ 성공했을 때만 선택을 푼다. 실패(코트 충돌 · 늦음) · 확인 불가면 선택을 남겨 운영자가 보고 정한다.
   */
  const startOnCourt = React.useCallback((m: ControlMatchRow, courtNo: number) => {
    // 성공했을 때만 그 경기의 대기 지정을 푼다(실패 · 확인 불가면 지정을 그대로 둔다).
    void act.start(m, courtNo).then((r) => { if (r === 'success') { setPick(null); nextUp.clearMatch(m.matchId); } });
  }, [act, nextUp]);

  /** 같은 순간의 연타 방지 — 상태(checkingIn)는 다음 렌더에야 반영된다. */
  const checkingRef = React.useRef(false);
  /** 체크인 확인 → (미체크인이면 경고) → start_match. 투입 경로(선택 · 추천 · 대기 경기)가 모두 이 한 길로 간다. */
  const beginStart = React.useCallback((m: ControlMatchRow, courtNo: number, source: 'pick' | 'nextup') => {
    if (act.busy || checkingRef.current) return;
    checkingRef.current = true;
    setCheckingIn(true);
    // 다른 기기에서 방금 체크인했을 수 있다 — 최신 값을 한 번 읽는다(지연 · 실패면 마지막 값).
    void checkins.fresh().then((lookup) => {
      checkingRef.current = false;
      setCheckingIn(false);
      const missing = uncheckedTeams(lookup, [m.team1.teamNo, m.team2.teamNo]);
      if (missing && missing.length > 0) {
        setCheckinWarn({ match: m, courtNo, teamNos: missing, source });
        return;
      }
      startOnCourt(m, courtNo);
    });
  }, [act, checkins, startOnCourt]);

  const onCourtPick = React.useCallback((courtNo: number) => {
    if (!pick || !canStart || act.busy || checkingRef.current) return;
    const m = pick;
    // 대기 지정과 어긋나는 수동 투입 — 본부장이 확인한 뒤에만 진행한다(지정을 말없이 바꾸지 않는다).
    const here = nextUps.get(courtNo);
    if (here && here.kind === 'ready' && here.matchId !== m.matchId
      && !window.confirm(`${courtNo}번 코트에는 M${here.match.matchNo}이(가) 대기 지정되어 있습니다.\nM${m.matchNo}을(를) 이 코트에 먼저 투입할까요?\n(M${here.match.matchNo} 대기 지정은 그대로 남습니다)`)) return;
    const other = reservedBy.get(m.matchId);
    if (other !== undefined && other !== courtNo
      && !window.confirm(`M${m.matchNo}은(는) ${other}번 코트 대기로 지정되어 있습니다.\n${courtNo}번 코트에 투입할까요?\n(투입되면 ${other}번 코트 대기 지정은 해제됩니다)`)) return;
    beginStart(m, courtNo, 'pick');
  }, [act, pick, canStart, nextUps, reservedBy, beginStart]);

  /** [대기 경기 투입] — 지금 화면의 그 경기(최신 행)로 기존 투입 흐름을 탄다. 막힌 상태면 보내지 않는다. */
  const onNextUpInsert = React.useCallback((courtNo: number) => {
    const nu = nextUps.get(courtNo);
    const court = courts.find((c) => c.courtNo === courtNo);
    if (!nu || nu.kind !== 'ready' || nu.busyTeams.length > 0 || court?.state !== 'empty' || pick) return;
    beginStart(nu.match, courtNo, 'nextup');
  }, [nextUps, courts, pick, beginStart]);

  // 추천 계산 입력의 최신 값(일정 · 대기 지정) — 지정 직전 재확인에서 쓴다.
  const koFeeds = React.useMemo(() => deriveOpeningFeedGroups(snap?.bracket ?? null), [snap]);
  const recInput = React.useRef({ schedule, ctx: rowCtx, reserved: reservedBy, feeds: koFeeds });
  React.useEffect(() => { recInput.current = { schedule, ctx: rowCtx, reserved: reservedBy, feeds: koFeeds }; }, [schedule, rowCtx, reservedBy, koFeeds]);
  const recommendNextUp = React.useCallback(
    (courtNo: number) => deriveNextUpRecommendations(snap?.board ?? null, schedule, checkins.lookup, rowCtx, reservedBy, courtNo, undefined, koFeeds),
    [snap, schedule, checkins.lookup, rowCtx, reservedBy, koFeeds],
  );
  /**
   * 추천 지정 직전 재확인 — 경기판 · 체크인을 새로 읽고(최대 3초) 다시 계산한다.
   *   그대로면 null. 후보에서 빠졌거나 '확인 필요' 로 바뀌었거나 새로 읽지 못했으면 이유(지정하지 않는다).
   */
  const recheckNextUp = React.useCallback(async (courtNo: number, matchId: string, tier: NextUpRecItem['tier']): Promise<string | null> => {
    const before = st.latest()?.at ?? null;
    const [, lookup] = await Promise.all([
      Promise.race([st.reload().catch(() => undefined), new Promise<void>((res) => { window.setTimeout(res, 3_000); })]),
      checkins.fresh(),
    ]);
    const got = st.latest();
    if (!got || got.at === before) return '최신 경기 상태를 확인하지 못했습니다. [새로고침] 후 다시 골라 주세요.';
    const r = recInput.current;
    const board = got.board;
    // 순위만 밀린 후보는 그대로 지정할 수 있다 — 제한 없이 다시 계산해 그 경기의 현재 판정을 본다.
    const now = deriveNextUpRecommendations(board, r.schedule, lookup, r.ctx, r.reserved, courtNo, Number.POSITIVE_INFINITY, r.feeds);
    const it = now.items.find((x) => x.match.matchId === matchId);
    if (it && it.tier === tier) return null;
    const no = board?.matches.find((x) => x.matchId === matchId)?.matchNo;
    if (it) return `M${no} 상태가 바뀌어 '확인 필요' 후보가 되었습니다 — ${it.reason}. 다시 확인한 뒤 골라 주세요.`;
    const why = now.excluded.find((x) => x.matchNo === no)?.reason;
    return `M${no ?? ''} 은(는) 지금 추천 후보가 아닙니다${why ? ` — ${why}` : ''}. 목록을 다시 확인해 주세요.`;
  }, [st, checkins]);
  // 직접 선택 목록 표시 — 경기 중인 팀의 코트 · 체크인 미완료 팀.
  const nextUpFlags = React.useMemo(() => {
    const out = new Map<string, { busyCourt: number | null; unchecked: number[] | null }>();
    const board = snap?.board; if (!board) return out;
    const busyAt = new Map<number, number | null>();
    board.matches.filter((m) => m.status === 'playing').forEach((m) => { busyAt.set(m.team1.teamNo, m.courtNo); busyAt.set(m.team2.teamNo, m.courtNo); });
    const lk = checkins.lookup;
    board.matches.filter((m) => m.status === 'waiting' || m.status === 'calling').forEach((m) => {
      const t = [m.team1.teamNo, m.team2.teamNo];
      const b = t.find((n) => busyAt.has(n));
      out.set(m.matchId, {
        busyCourt: b === undefined ? null : (busyAt.get(b) ?? null),
        unchecked: lk ? t.filter((n) => { const v = lk.get(n); return v !== undefined && v.status === 'active' && !v.checkedIn; }) : null,
      });
    });
    return out;
  }, [snap, checkins.lookup]);

  /** 대기 지정 — 이 PC 저장만 바꾼다. 다른 코트 대기였던 경기는 확인 후 옮긴다. 막히면 이유를 돌려준다. */
  const onNextUpAssign = React.useCallback((courtNo: number, m: ControlMatchRow): string | null => {
    // 지정 직전 — 마지막으로 받은 경기판에서 아직 대기 · 호명인지 다시 본다(진행 · 완료 · 취소 경기는 지정하지 않는다).
    const cur = (st.latest()?.board ?? null)?.matches.find((x) => x.matchId === m.matchId);
    if (!cur) return `M${m.matchNo} 경기를 찾을 수 없습니다. [새로고침] 후 다시 골라 주세요.`;
    if (cur.status !== 'waiting' && cur.status !== 'calling') {
      return `M${m.matchNo} 은(는) 이미 ${cur.status === 'playing' ? `${cur.courtNo ?? '?'}번 코트에서 진행 중` : cur.status === 'completed' ? '완료' : '취소'}이라 대기 지정할 수 없습니다.`;
    }
    const block = nextUpAssignBlock(m, courtNo);
    if (block) return block;
    const other = reservedBy.get(m.matchId);
    if (other !== undefined && other !== courtNo
      && !window.confirm(`M${m.matchNo}은(는) ${other}번 코트 대기입니다.\n${courtNo}번 코트 대기로 옮길까요?`)) return '대기 코트를 옮기지 않았습니다.';
    nextUp.assign(courtNo, m.matchId, m.matchNo);
    return null;
  }, [reservedBy, nextUp, st]);

  const nuOps: NextUpOps = React.useMemo(() => ({
    byCourt: nextUps, assignable, reservedBy,
    onAssign: onNextUpAssign, onClear: nextUp.clearCourt, onInsert: onNextUpInsert,
    recommend: recommendNextUp, recheck: recheckNextUp, flags: nextUpFlags,
  }), [nextUps, assignable, reservedBy, onNextUpAssign, nextUp.clearCourt, onNextUpInsert, recommendNextUp, recheckNextUp, nextUpFlags]);

  // 고른 경기가 바뀌거나 풀리면 그 경기의 경고도 닫는다(다른 경기로 잘못 투입되지 않게). 대기 경기 투입 경고는 선택과 무관하다.
  React.useEffect(() => {
    setCheckinWarn((w) => (w && w.source === 'pick' && w.match.matchId !== pick?.matchId ? null : w));
  }, [pick]);

  /** [예외 허용 — 투입] — 경고를 띄운 그 경기가 아직 투입 가능할 때만 보낸다. */
  const onCheckinOverride = React.useCallback(() => {
    const w = checkinWarn;
    setCheckinWarn(null);
    if (!w || act.busy) return;
    if (w.source === 'pick') {
      if (!pick || pick.matchId !== w.match.matchId || !canStart) return;
      startOnCourt(pick, w.courtNo);
      return;
    }
    // 대기 경기 — 그 코트의 대기가 아직 그 경기이고, 경기가 경고를 띄운 그대로이며, 코트가 비어 있을 때만.
    const nu = nextUps.get(w.courtNo);
    const court = courts.find((c) => c.courtNo === w.courtNo);
    if (!nu || nu.kind !== 'ready' || nu.matchId !== w.match.matchId || nu.busyTeams.length > 0 || court?.state !== 'empty') return;
    if (derivePickState(w.match, snap?.board ?? null).kind !== 'ok') return;
    startOnCourt(w.match, w.courtNo);
  }, [checkinWarn, pick, canStart, act, startOnCourt, nextUps, courts, snap]);

  /**
   * 점수 저장 — 모달을 연 순간의 version 으로 보낸다.
   *   ⚠ 성공했을 때만 모달을 닫는다. 실패 · 충돌 · 확인 불가면 모달과 입력값을 그대로 둔다.
   */
  const onScoreSubmit = React.useCallback((s1: number, s2: number) => {
    if (!scoreFor || scoreConflict !== null || act.busy) return;
    void act.complete(scoreFor, s1, s2).then((r) => { if (r === 'success') setScoreFor(null); });
  }, [act, scoreFor, scoreConflict]);

  const manualReload = React.useCallback(() => { setScheduleTick((n) => n + 1); void st.reload({ manual: true }); }, [st]);

  if (!st.authorized && !snap) {
    return <Quiet title="운영 권한이 필요합니다." desc="CEO · ADMIN 계정으로 로그인한 뒤 다시 열어 주세요." />;
  }
  if (st.loading && !snap) {
    return <Quiet title="불러오는 중…" />;
  }
  if (st.failed && !snap) {
    return (
      <Quiet title="대회 정보를 불러오지 못했습니다." desc="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
        retry={{ busy: st.refreshing, onRetry: manualReload }} />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <TournamentNav slug={slug} test={!!event.test} />
      </div>

      {/* 테스트(리허설) 대회 — 실제 대회와 헷갈리지 않게 맨 위에 크게 띄운다. */}
      {event.test && (
        <div data-control-test-banner role="note" style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '11px 14px', borderRadius: 11,
          background: '#FEF3C7', border: '2px dashed #D97706', color: '#78350F',
        }}>
          <AlertTriangle size={16} strokeWidth={2.6} />
          <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '0.02em' }}>테스트 대회</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, wordBreak: 'keep-all' }}>
            실제 대회가 아닙니다. 참가자 화면 · 전광판 · 공식 기록에 나오지 않습니다.
          </span>
        </div>
      )}

      <Header event={event} slug={slug} phase={phase} updatedAt={st.updatedAt}
        refreshing={st.refreshing} onReload={manualReload} />

      {/* Signature 전광판 3종(새 탭) — 관제 화면을 밀어내지 않게 한 줄로. 기존 ARENA TV 버튼은 머리말에 그대로 있다. */}
      {!event.test && <SignatureDisplayLauncher slug={slug} variant="compact" />}

      {/* 결과를 확인할 수 없었던 조작 — 운영자가 [확인함] 을 누를 때까지 남는다. */}
      <UnverifiedList items={act.unverified} refreshing={st.refreshing}
        onRefresh={manualReload} onAcknowledge={act.acknowledge} />

      {/* 갱신이 밀린 상태는 작은 줄로만 알린다 — 화면을 덮지 않는다. */}
      {st.staleError && (
        <p data-control-sync-issue style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 700, color: '#9A3412',
        }}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          {st.staleError} 화면은 마지막으로 확인된 상태입니다.
        </p>
      )}
      {/* 마지막 정상 갱신이 30초를 넘으면 — 오류 문구와 별개로, 지금 보는 정보가 오래됐음을 알린다. */}
      {st.stale && (
        <p data-control-stale style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 700, color: '#9A3412',
        }}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          마지막 정상 갱신 {hhmmss(st.updatedAt)} — 30초 넘게 새 정보를 받지 못했습니다.
        </p>
      )}

      {summary.total === 0 && courts.length === 0 ? (
        <Quiet title="예선 준비 중"
          desc="코트 등록과 조편성이 끝나면 이곳에 경기 현황이 표시됩니다." />
      ) : (
        <>
          <SummaryBar s={summary} />
          {prelimSummary && <SummaryBar s={prelimSummary} />}

          {/* 왼쪽이 본문 흐름(코트 → 확인 필요 → 진행/대기), 오른쪽은 상태 레일이다.
              ⚠ 본문을 레일 바깥에 두면 레일이 길어질 때 그 높이만큼 다음 영역이 아래로 밀린다.
                 그래서 본문 세 영역을 한 열 안에 둔다(레일 높이와 무관하게 이어진다). */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 고른 경기는 코트 바로 위에 둔다 — 다음에 누를 곳이 눈앞에 있어야 한다. */}
              {pick && pickState && (
                <PickBanner match={pick} state={pickState} disabled={act.busy !== ''}
                  onCancel={() => setPick(null)} unchecked={pickUnchecked} hintCourt={hintCourt} />
              )}
              {/* 코트 전광판 NEXT 연동(서버 복사) — SQL 미적용 · 권한 없음이면 그리지 않는다. 경기 운영과 무관. */}
              <NextUpServerSync slug={slug} entries={nextUp.entries} loaded={nextUp.loaded} />
              <CourtBoard
                courts={courts}
                picking={canStart}
                disabled={act.busy !== '' || checkingIn || checkinWarn !== null}
                onPick={onCourtPick}
                suggestions={suggestions.byCourt}
                suggestWarnings={suggestions.warnings}
                scheduleState={scheduleState}
                onSuggest={onSuggest}
                hintCourt={hintCourt}
                nuOps={nuOps}
                nuStorageError={nextUp.storageError}
                playingRows={playingRows} ops={ops}
              />
              {summary.total === 0 && (
                <Quiet title="경기 생성 전"
                  desc="조편성을 확정하고 경기를 생성하면 진행 현황이 표시됩니다." />
              )}

              {/* 확인 필요 — 있을 때만 나온다. */}
              <ControlAttention items={attention} slug={slug} />

              <ControlOperations
                playing={playing}
                waiting={waiting}
                knockoutWaiting={hasKnockout ? knockoutWaiting : null}
                slug={slug}
                allDone={phase === 'completed'}
                ops={ops}
              />
            </div>

            <div style={{ flex: '0 1 300px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {prelim
                ? <PreliminaryStatus p={prelim} />
                : <Quiet title="예선 조편성 전" desc="조가 만들어지면 조별 진행 상황이 표시됩니다." />}
              {knockout && <KnockoutStatus k={knockout} />}
            </div>
          </div>
        </>
      )}

      {scoreFor && (
        <ControlScoreDialog
          // 경기마다 새로 mount — 다른 경기의 입력값이 섞이지 않는다.
          key={scoreFor.matchId}
          match={scoreFor}
          conflict={scoreConflict}
          busy={act.busy !== ''}
          onClose={() => setScoreFor(null)}
          onSubmit={onScoreSubmit}
          timer={scoreTimer && offset !== null
            ? scoreTimer.kind === 'running'
              ? <MatchElapsedClock name={`score-${scoreFor.matchNo}`} startMs={scoreTimer.startMs} offsetMs={offset} />
              : scoreTimer.kind === 'not_started' ? '시작 기록 없음'
                : scoreTimer.kind === 'finished' ? formatElapsed(scoreTimer.durationMs) : null
            : null}
        />
      )}

      {checkinWarn && (
        <ControlCheckinWarning
          match={checkinWarn.match}
          courtNo={checkinWarn.courtNo}
          teamNos={checkinWarn.teamNos}
          slug={slug}
          busy={act.busy !== ''}
          onClose={() => setCheckinWarn(null)}
          onOverride={onCheckinOverride}
        />
      )}

      {act.toast && (
        <div role="status" data-control-toast style={{
          position: 'fixed', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(68px + env(safe-area-inset-bottom))',
          maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10,
          background: INK, color: '#fff', fontSize: 12.5, fontWeight: 700,
          lineHeight: 1.6, zIndex: 130, wordBreak: 'keep-all', textAlign: 'center',
          // 안내일 뿐이다 — 아래의 운영 버튼(호명 · 점수 입력)을 가리지 않게 클릭을 통과시킨다.
          pointerEvents: 'none',
        }}>
          {act.toast}
        </div>
      )}
    </div>
  );
}
