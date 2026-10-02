'use client';

// Control Center — 대회 당일 관제 (Batch 4F-1).
//
//   읽는 순서: 머리말 → 요약 → 코트 → 단계 상태.
//   ⚠ 이번 단계는 **읽기 전용**이다. 호명 · 투입 · 점수 · 완료는 4F-3 에서 붙인다.
//   ⚠ 숫자와 상태는 전부 controlModel 의 순수 함수가 만든다. 여기서 다시 세지 않는다.
//   ⚠ 코트 수 · 조 수를 숫자로 박지 않는다. 서버가 준 만큼 그린다.

import React from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  CONTROL_PHASE_LABEL, countCourtStates, deriveCourts, deriveKnockout,
  derivePhase, derivePreliminary, deriveSummary,
} from './controlModel';
import type { ControlCourt, ControlGroup } from './controlModel';
import { useControlData } from './controlView';
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

function CourtPanel({ court }: { court: ControlCourt }) {
  const playing = court.state === 'playing' && court.now;
  const closed = court.state === 'closed';

  return (
    <div
      data-court={court.courtNo}
      data-court-state={court.state}
      style={{
        border: `1px solid ${playing ? TEAL : LINE}`,
        borderTopWidth: playing ? 3 : 1,
        borderTopColor: playing ? TEAL : LINE,
        borderRadius: 12,
        background: closed ? '#F8FAFC' : '#fff',
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
      ) : (
        <p style={{ margin: 'auto 0 2px', fontSize: 12.5, fontWeight: 600, color: FAINT }}>
          {closed ? '사용 중지' : '현재 경기 없음'}
        </p>
      )}
    </div>
  );
}

function CourtBoard({ courts }: { courts: ControlCourt[] }) {
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
          {courts.map((c) => <CourtPanel key={c.courtNo} court={c} />)}
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

function Quiet({ title, desc }: { title: string; desc?: string }) {
  return (
    <section style={{ ...card, textAlign: 'center', padding: '26px 15px' }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 800, color: INK_SOFT }}>{title}</p>
      {desc && <p style={{ margin: '5px 0 0', fontSize: 12, fontWeight: 600, color: MUTED }}>{desc}</p>}
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

  if (!st.authorized && !snap) {
    return <Quiet title="운영 권한이 필요합니다." desc="CEO · ADMIN 계정으로 로그인한 뒤 다시 열어 주세요." />;
  }
  if (st.loading && !snap) {
    return <Quiet title="불러오는 중…" />;
  }
  if (st.failed && !snap) {
    return <Quiet title="대회 정보를 불러오지 못했습니다." desc="잠시 후 새로고침해 주세요." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        <TournamentNav slug={slug} />
      </div>

      <Header event={event} slug={slug} phase={phase} updatedAt={st.updatedAt}
        refreshing={st.refreshing} onReload={st.reload} />

      {/* 갱신이 밀린 상태는 작은 줄로만 알린다 — 화면을 덮지 않는다. */}
      {st.staleError && (
        <p style={{
          margin: 0, display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 700, color: '#9A3412',
        }}>
          <AlertTriangle size={13} strokeWidth={2.4} />
          {st.staleError} 화면은 마지막으로 확인된 상태입니다.
        </p>
      )}

      {summary.total === 0 && courts.length === 0 ? (
        <Quiet title="예선 준비 중"
          desc="코트 등록과 조편성이 끝나면 이곳에 경기 현황이 표시됩니다." />
      ) : (
        <>
          <SummaryBar s={summary} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <CourtBoard courts={courts} />
              {summary.total === 0 && (
                <Quiet title="경기 생성 전"
                  desc="조편성을 확정하고 경기를 생성하면 진행 현황이 표시됩니다." />
              )}
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
    </div>
  );
}
