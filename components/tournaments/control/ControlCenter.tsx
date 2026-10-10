'use client';

// Control Center — 대회 당일 관제 (Batch 4F-1 · 조작 4F-3 · 조작 안전성 4F-4a · 자동 갱신 4F-4b · 확인 필요 4F-4c-2).
//
//   읽는 순서: 머리말 → 요약 → 코트 → 확인 필요 → 진행/대기, 오른쪽은 단계 상태 레일.
//   ⚠ 숫자와 상태는 전부 controlModel 의 순수 함수가 만든다. 여기서 다시 세지 않는다.
//   ⚠ 코트 수 · 조 수를 숫자로 박지 않는다. 서버가 준 만큼 그린다.
//   ⚠ 시스템이 다음 경기를 고르지 않고, 코트를 자동 배정하지 않고, 대신 호명하지 않는다.
//     투입도 운영자가 경기 → 코트 두 번을 직접 고른 뒤에만 일어난다.
//   ⚠ 조작 결과를 화면이 미리 그리지 않는다(optimistic 금지). 끝나면 전부 다시 읽는다.

import React from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, AlertTriangle, X } from 'lucide-react';
import {
  CONTROL_PHASE_LABEL, countCourtStates, deriveAttention, deriveCourts, deriveKnockout,
  derivePhase, derivePickState, derivePlaying, derivePreliminary, deriveScoreConflict,
  deriveSummary, deriveWaiting,
} from './controlModel';
import type { ControlCourt, ControlGroup, ControlMatchRow, ControlPickState } from './controlModel';
import { ControlAttention, ControlOperations } from './ControlOperations';
import type { ControlOps } from './ControlOperations';
import ControlScoreDialog from './ControlScoreDialog';
import { useControlActions } from './controlActions';
import type { UnverifiedAction } from './controlActions';
import { useControlData } from './controlView';

/**
 * 대기 목록에 한 번에 그리는 줄 수 — 화면 밀도를 위한 표시 제한일 뿐이다.
 *   ⚠ 대회 규칙이 아니다. 전체 개수는 항상 따로 보여 주고, 나머지는 경기 운영 화면에서 본다.
 */
const WAITING_ROWS = 6;
import type { OfficialTournament } from '@/lib/tournaments/types';

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
  event: OfficialTournament; slug: string; phase: keyof typeof CONTROL_PHASE_LABEL;
  updatedAt: number | null; refreshing: boolean; onReload: () => void;
}) {
  return (
    <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={eyebrow}>TOURNAMENT CONTROL CENTER</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
          <h1 style={{
            margin: 0, fontFamily: LABEL, fontSize: 21, fontWeight: 800,
            letterSpacing: '0.01em', color: INK, whiteSpace: 'nowrap',
          }}>
            {event.titleFull}
          </h1>
          <PhasePill phase={phase} />
          <span style={{ fontSize: 12, fontWeight: 600, color: MUTED, whiteSpace: 'nowrap' }}>
            {event.eventDateLabel} · {event.venueName}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
        <Link
          href={`/tournaments/${slug}/arena?mode=prelim`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...navBtn, minHeight: 34, padding: '7px 12px', background: NAVY, borderColor: NAVY, color: '#fff' }}
        >
          ARENA TV 열기
          <ExternalLink size={13} strokeWidth={2.4} />
        </Link>
      </div>
    </div>
  );
}

/** 기존 운영 화면으로 가는 가벼운 이동 줄. 머리말보다 강해지지 않게 한 단계 작게 둔다. */
function TournamentNav({ slug }: { slug: string }) {
  const items: Array<[string, string]> = [
    ['팀 관리', 'teams'], ['조편성', 'groups'], ['경기 운영', 'matches'],
    ['예선 순위', 'standings'], ['본선 대진', 'bracket'], ['코트 관리', 'courts'],
  ];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

function CourtPanel({
  court, selectable, disabled, onPick,
}: {
  court: ControlCourt;
  /** 투입 선택 모드에서 이 코트를 고를 수 있는가(비어 있는 코트만 true). */
  selectable: boolean;
  disabled: boolean;
  onPick: (courtNo: number) => void;
}) {
  const playing = court.state === 'playing' && court.now;
  const closed = court.state === 'closed';

  return (
    <div
      data-court={court.courtNo}
      data-court-state={court.state}
      data-court-selectable={selectable ? '1' : undefined}
      style={{
        // ⚠ border 축약형과 borderTop* 을 섞지 않는다 — 리렌더 때 서로 덮어써 경고가 난다.
        borderStyle: 'solid',
        borderColor: playing || selectable ? TEAL : LINE,
        borderWidth: playing ? '3px 1px 1px' : 1,
        borderRadius: 12,
        background: selectable ? TEAL_SOFT : closed ? '#F8FAFC' : '#fff',
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
        </div>
      ) : selectable ? (
        // ⚠ 선택지일 뿐이다. 비어 있는지 최종 판정은 서버(start_match)가 한다.
        <button
          type="button"
          data-control-action={`court-${court.courtNo}`}
          disabled={disabled}
          onClick={() => onPick(court.courtNo)}
          style={{
            margin: 'auto 0 0', minHeight: 34, borderRadius: 9,
            border: `1px solid ${TEAL}`, background: TEAL, color: '#fff',
            fontSize: 12.5, fontWeight: 800,
            opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
          }}
        >
          이 코트에 투입
        </button>
      ) : (
        <p style={{ margin: 'auto 0 2px', fontSize: 12.5, fontWeight: 600, color: FAINT }}>
          {closed ? '사용 중지' : '현재 경기 없음'}
        </p>
      )}
    </div>
  );
}

function CourtBoard({
  courts, picking, disabled, onPick,
}: {
  courts: ControlCourt[];
  /** 투입할 경기를 고른 상태인가. 그때만 빈 코트가 선택 가능해진다. */
  picking: boolean;
  disabled: boolean;
  onPick: (courtNo: number) => void;
}) {
  const n = countCourtStates(courts);
  return (
    <section style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11 }}>
        <p style={eyebrow}>COURTS</p>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: MUTED }}>
          경기 중 {n.playing} · 비어 있음 {n.empty} · 중지 {n.closed}
        </span>
      </div>

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
function PickBanner({
  match, state, disabled, onCancel,
}: {
  match: ControlMatchRow; state: ControlPickState; disabled: boolean; onCancel: () => void;
}) {
  const head = match.stage === 'knockout'
    ? (match.roundName ?? '본선')
    : match.groupNo !== null ? `${match.groupNo}조` : '순위결정전';
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
          {' · '}TEAM {String(match.team1.teamNo).padStart(2, '0')}
          {' vs '}TEAM {String(match.team2.teamNo).padStart(2, '0')}
        </span>
      </span>
      {ok ? (
        <span style={{ fontSize: 12, fontWeight: 700, color: INK_SOFT }}>
          아래에서 비어 있는 코트를 선택해 주세요.
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

export default function ControlCenter({ slug, event }: { slug: string; event: OfficialTournament }) {
  const st = useControlData(slug);
  const snap = st.snapshot;

  const phase = React.useMemo(
    () => derivePhase(snap?.board ?? null, snap?.bracket ?? null),
    [snap],
  );
  const summary = React.useMemo(() => deriveSummary(snap?.board ?? null, phase), [snap, phase]);
  const courts = React.useMemo(() => deriveCourts(snap?.board ?? null), [snap]);
  const prelim = React.useMemo(() => derivePreliminary(snap?.standings ?? null), [snap]);
  const knockout = React.useMemo(() => deriveKnockout(snap?.bracket ?? null), [snap]);
  const playing = React.useMemo(
    () => derivePlaying(snap?.board ?? null, summary.stage, snap?.bracket ?? null),
    [snap, summary.stage],
  );
  const waiting = React.useMemo(
    () => deriveWaiting(snap?.board ?? null, summary.stage, WAITING_ROWS, snap?.bracket ?? null),
    [snap, summary.stage],
  );
  const attention = React.useMemo(
    () => deriveAttention({ summary, preliminary: prelim, knockout, phase }),
    [summary, prelim, knockout, phase],
  );

  // ── 조작 ──────────────────────────────────────────────────────────────────
  // 조작은 조회 큐와 함께 돈다 — 조작 중에는 조회를 멈추고, 조작 전 응답은 반영하지 않는다.
  const act = useControlActions({
    reload: st.reload, hold: st.hold, release: st.release, latest: st.latest,
  });

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

  const ops: ControlOps = React.useMemo(() => ({
    busy: act.busy,
    selectedMatchId: pick?.matchId ?? null,
    onCall: (m) => { void act.call(m); },
    onUncall: (m) => { void act.uncall(m); },
    // 지금 화면에 보이는 행을 그대로 고정한다 — 운영자가 본 version 이 곧 투입할 version 이다.
    onPickCourt: (m) => setPick(m),
    onCancelPick: () => setPick(null),
    onScore: (m) => setScoreFor(m),
  }), [act, pick]);

  /**
   * 코트를 고른 순간 — 여기서 처음으로 저장이 일어난다(코트 배정 + 시작이 한 번).
   *   ⚠ 보내는 version 은 운영자가 **고른 순간의** 값이다. 최신 조회 값으로 바꿔 넣지 않는다.
   *   ⚠ 성공했을 때만 선택을 푼다. 실패(코트 충돌 · 늦음) · 확인 불가면 선택을 남겨 운영자가 보고 정한다.
   */
  const onCourtPick = React.useCallback((courtNo: number) => {
    if (!pick || !canStart || act.busy) return;
    void act.start(pick, courtNo).then((r) => { if (r === 'success') setPick(null); });
  }, [act, pick, canStart]);

  /**
   * 점수 저장 — 모달을 연 순간의 version 으로 보낸다.
   *   ⚠ 성공했을 때만 모달을 닫는다. 실패 · 충돌 · 확인 불가면 모달과 입력값을 그대로 둔다.
   */
  const onScoreSubmit = React.useCallback((s1: number, s2: number) => {
    if (!scoreFor || scoreConflict !== null || act.busy) return;
    void act.complete(scoreFor, s1, s2).then((r) => { if (r === 'success') setScoreFor(null); });
  }, [act, scoreFor, scoreConflict]);

  const manualReload = React.useCallback(() => { void st.reload({ manual: true }); }, [st]);

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
        <TournamentNav slug={slug} />
      </div>

      <Header event={event} slug={slug} phase={phase} updatedAt={st.updatedAt}
        refreshing={st.refreshing} onReload={manualReload} />

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

          {/* 왼쪽이 본문 흐름(코트 → 확인 필요 → 진행/대기), 오른쪽은 상태 레일이다.
              ⚠ 본문을 레일 바깥에 두면 레일이 길어질 때 그 높이만큼 다음 영역이 아래로 밀린다.
                 그래서 본문 세 영역을 한 열 안에 둔다(레일 높이와 무관하게 이어진다). */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 고른 경기는 코트 바로 위에 둔다 — 다음에 누를 곳이 눈앞에 있어야 한다. */}
              {pick && pickState && (
                <PickBanner match={pick} state={pickState} disabled={act.busy !== ''}
                  onCancel={() => setPick(null)} />
              )}
              <CourtBoard
                courts={courts}
                picking={canStart}
                disabled={act.busy !== ''}
                onPick={onCourtPick}
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
