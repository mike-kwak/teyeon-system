'use client';

// 예선 조별리그 시각 부품 — Admin · Public 공용.
//   ⚠ 여기 있는 부품은 '이미 정해진 표시 값'만 받는다(라벨 · 색 · 텍스트).
//     무엇을 보여줄지(운영 경고 · 공개 문구 · 액션)는 Admin / Public 래퍼가 정해서 넘긴다.
//     isAdmin · isPublic 같은 역할 분기를 부품 안에 두지 않는다.

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { C, type Tone } from './presentation';

// ── 상태 점 + 글자 ──────────────────────────────────────────────────────────
export function StatusDot({
  label, color, dot = 6, fontSize = 12, gap = 5,
}: { label: string; color: string; dot?: number; fontSize?: number; gap?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap, fontSize, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
      <span style={{ width: dot, height: dot, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

// ── 경기 진행 칸 ────────────────────────────────────────────────────────────
export function Segments({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${colors.length}, minmax(0, 1fr))`, gap: 3 }}>
      {colors.map((c, i) => <span key={i} style={{ height: 4, borderRadius: 2, background: c }} />)}
    </div>
  );
}

// ── 조 카드 (메인 목록) ─────────────────────────────────────────────────────
export interface CompactRow {
  key: string;
  p1: string;
  p2: string;
  /** null = 경기 전(순위 칸을 비워 둔다). */
  rank: string | null;
  tone: Tone;
  /** null = 표시하지 않음(경기 전). */
  record: string | null;
  muted: boolean;
  hit: boolean;
}

export function GroupCompactCard({
  href, ariaLabel, title, status, progress, segments, rows,
}: {
  href: string;
  ariaLabel: string;
  title: string;
  status: { label: string; color: string };
  progress: string;
  segments: string[];
  rows: CompactRow[];
}) {
  return (
    <Link href={href} className="stg-card" aria-label={ariaLabel}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, boxSizing: 'border-box',
        padding: '12px 12px 13px', background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14,
        textDecoration: 'none', color: C.navy,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>
        <ChevronRight size={16} color={C.faint} strokeWidth={2.4} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <StatusDot label={status.label} color={status.color} />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{progress}</span>
      </div>
      <Segments colors={segments} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
        {rows.map((r) => {
          const pre = r.rank === null;
          return (
            <div key={r.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              margin: '0 -5px', padding: '2px 5px', borderRadius: 7,
              background: r.hit ? C.tealTint : 'transparent',
            }}>
              {/* ⚠ 경기 전에는 순위 숫자 대신 빈 표시만 둔다 */}
              <span style={{
                flexShrink: 0, width: 20, height: 20, boxSizing: 'border-box', marginTop: 1, borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                background: pre ? '#EEF2F8' : r.tone.bg, color: r.tone.fg, border: `1px solid ${pre ? '#EEF2F8' : r.tone.bd}`,
              }}>
                {pre ? '' : r.rank}
              </span>
              <div style={{
                flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.35,
                fontWeight: r.hit ? 800 : 600, color: r.muted ? C.muted : C.navy,
                wordBreak: 'keep-all', overflowWrap: 'anywhere',
              }}>
                <div>{r.p1}</div>
                <div>{r.p2}</div>
              </div>
              {r.record !== null && (
                <span style={{ flexShrink: 0, marginTop: 2, fontSize: 11.5, fontWeight: 600, color: C.muted, whiteSpace: 'nowrap' }}>
                  {r.record}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Link>
  );
}

// ── 순위결정전 카드 (메인 목록) ─────────────────────────────────────────────
export interface PlacementTeamView {
  key: string;
  teamNo: number;
  name: string;
  won: boolean;
  hit: boolean;
}

export function PlacementCompactCard({
  href, status, teams, done, score1, score2, note,
}: {
  href: string;
  status: { label: string; color: string };
  teams: PlacementTeamView[];
  done: boolean;
  score1: number | null;
  score2: number | null;
  note: string;
}) {
  return (
    <Link href={href} className="stg-card" aria-label="순위결정전 상세정보"
      style={{
        display: 'flex', flexDirection: 'column', gap: 10, padding: '13px 14px 14px',
        background: '#F7F9FD', border: '1px dashed #BFCDE6', borderRadius: 14,
        textDecoration: 'none', color: C.navy,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '2px 8px', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>순위결정전</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#3D5A8F' }}>두 팀 모두 본선 진출</span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: status.color, flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.color }} />
          {status.label}
        </span>
        <ChevronRight size={16} color={C.faint} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', columnGap: 10, alignItems: 'center' }}>
        {teams.slice(0, 2).map((t, i) => {
          const side = (
            <div key={t.key} style={{
              minWidth: 0, textAlign: i === 0 ? 'right' : 'left', borderRadius: 7, padding: '2px 5px',
              background: t.hit ? C.tealTint : 'transparent',
            }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: C.muted }}>{t.teamNo}번</p>
              <p style={{
                margin: '1px 0 0', fontSize: 13, lineHeight: 1.35, fontWeight: t.won || t.hit ? 800 : 600,
                wordBreak: 'keep-all', overflowWrap: 'anywhere',
              }}>
                {t.name}
              </p>
            </div>
          );
          return i === 0 ? [side, (
            <span key="vs" style={{ fontSize: done ? 17 : 12.5, fontWeight: 800, color: done ? C.navy : C.faint, fontVariantNumeric: 'tabular-nums' }}>
              {done ? `${score1 ?? '-'} : ${score2 ?? '-'}` : 'VS'}
            </span>
          )] : side;
        })}
      </div>
      <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#5B6B82' }}>{note}</p>
    </Link>
  );
}

// ── 상세 헤더 ───────────────────────────────────────────────────────────────
export function DetailHeader({
  title, sub, status, progress,
}: {
  title: string;
  sub: string;
  status: { label: string; color: string } | null;
  progress: string | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.navy, letterSpacing: '-0.02em', lineHeight: 1.3 }}>
          {title}
        </h1>
        <p style={{ margin: '3px 0 0', fontSize: 12.5, fontWeight: 600, color: C.muted }}>{sub}</p>
      </div>
      {(status || progress) && (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, paddingTop: 3 }}>
          {status && <StatusDot label={status.label} color={status.color} dot={7} fontSize={12.5} gap={6} />}
          {progress && (
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
              {progress}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── 안내 상자 ───────────────────────────────────────────────────────────────
export const CALLOUT_TONE = {
  info:   { bg: '#fff', bd: C.line },
  amber:  { bg: C.amberTint, bd: C.amberLine },
  red:    { bg: '#FEF4F3', bd: '#F4D0CC' },
  blue:   { bg: '#F4F7FC', bd: '#D6E0F0' },
} as const;

export function Callout({
  tone, icon, children, padding = 14,
}: { tone: keyof typeof CALLOUT_TONE; icon?: React.ReactNode; children: React.ReactNode; padding?: number | string }) {
  const t = CALLOUT_TONE[tone];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 14, padding, background: t.bg, border: `1px solid ${t.bd}` }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ── 본선 진출 요약 (FINAL) ──────────────────────────────────────────────────
export function QualifiedHero({ rows }: { rows: { key: string; rank: string; name: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <div style={{
      background: '#F0F8F6', border: '1px solid #CDE7E2', borderRadius: 14, padding: '13px 15px',
      display: 'flex', flexDirection: 'column', gap: 9,
    }}>
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: C.tealText }}>
        <CheckCircle2 size={15} strokeWidth={2.4} /> 본선 진출
      </p>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ flexShrink: 0, width: 32, fontSize: 12.5, fontWeight: 800, color: C.tealText }}>{r.rank}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: C.navy, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
            {r.name}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 섹션 ────────────────────────────────────────────────────────────────────
export const sectionStyle: React.CSSProperties = {
  background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: '2px 14px 6px',
};
export const h2Style: React.CSSProperties = { margin: 0, fontSize: 15.5, fontWeight: 800, color: C.navy };

export function SectionHead({ title, hint, inCard = true }: { title: string; hint?: string; inCard?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: inCard ? '12px 0 8px' : '4px 2px 0' }}>
      <h2 style={h2Style}>{title}</h2>
      {hint && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted }}>{hint}</span>}
    </div>
  );
}

// ── 참가 팀 행 (경기 전) ────────────────────────────────────────────────────
export function EntryRow({ teamNo, name, withdrawn }: { teamNo: number; name: string; withdrawn: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.lineSoft}` }}>
      <span style={{ flexShrink: 0, minWidth: 36, fontSize: 12.5, fontWeight: 700, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
        {teamNo}번
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: C.navy, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
        {name}
      </span>
      {withdrawn && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.red }}>기권</span>}
    </div>
  );
}

// ── 순위표 ──────────────────────────────────────────────────────────────────
export interface RankRowView {
  key: string;
  rank: string;
  tone: Tone;
  name: string;
  muted: boolean;
  note: string;
  noteColor: string;
  record: string;
  recordMuted: boolean;
  diff: string;
  diffColor: string;
  badge: { label: string; fg: string; bg: string } | null;
}

const RANK_COLS_SETTLED = '28px minmax(0, 1fr) 54px 32px auto';
const RANK_COLS_LIVE = '28px minmax(0, 1fr) 54px 32px';

export function RankTable({ settled, rows }: { settled: boolean; rows: RankRowView[] }) {
  const cols = settled ? RANK_COLS_SETTLED : RANK_COLS_LIVE;
  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: cols, columnGap: 8,
        padding: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.muted,
      }}>
        <span style={{ textAlign: 'center' }}>순위</span>
        <span>팀</span>
        <span style={{ textAlign: 'right' }}>승/패</span>
        <span style={{ textAlign: 'right' }}>득실</span>
        {settled && <span style={{ textAlign: 'right', minWidth: 60 }}>진출</span>}
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{
          display: 'grid', gridTemplateColumns: cols, columnGap: 8,
          alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${C.lineSoft}`,
        }}>
          <span style={{
            width: 28, height: 28, boxSizing: 'border-box', borderRadius: 8,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            background: r.tone.bg, color: r.tone.fg, border: `1px solid ${r.tone.bd}`,
          }}>{r.rank}</span>
          <div style={{ minWidth: 0 }}>
            <p style={{
              margin: 0, fontSize: 14, lineHeight: 1.4, fontWeight: 700, color: r.muted ? C.muted : C.navy,
              wordBreak: 'keep-all', overflowWrap: 'anywhere',
            }}>
              {r.name}
            </p>
            {r.note && (
              <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 700, lineHeight: 1.5, wordBreak: 'keep-all', color: r.noteColor }}>
                {r.note}
              </p>
            )}
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: r.recordMuted ? C.muted : C.body, textAlign: 'right', whiteSpace: 'nowrap' }}>
            {r.record}
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.diffColor }}>
            {r.diff}
          </span>
          {settled && r.badge && (
            <span style={{
              justifySelf: 'end', fontSize: 11.5, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
              whiteSpace: 'nowrap', color: r.badge.fg, background: r.badge.bg,
            }}>
              {r.badge.label}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

// ── 경기 카드 ───────────────────────────────────────────────────────────────
export function MatchResultCard({
  label, sub, status, left, right, score1, score2, winner, done, cancelled,
}: {
  label: string;
  sub: string | null;
  status: { label: string; color: string };
  left: string;
  right: string;
  score1: number | null;
  score2: number | null;
  winner: 1 | 2 | null;
  done: boolean;
  cancelled: boolean;
}) {
  const w1 = done && winner === 1;
  const w2 = done && winner === 2;
  const nameStyle = (win: boolean, align: 'left' | 'right'): React.CSSProperties => ({
    margin: 0, textAlign: align, fontSize: 13.5, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere',
    fontWeight: win ? 800 : 600,
    color: cancelled ? C.faint : done && !win ? C.muted : C.navy,
  });
  const scoreColor = (win: boolean) => (done ? (win ? C.navy : C.faint) : '#B8C2D0');
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: 14, padding: '12px 14px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>
          {label}{sub ? ' ' : null}{sub && <span style={{ fontWeight: 600, color: C.faint }}>· {sub}</span>}
        </span>
        <StatusDot label={status.label} color={status.color} fontSize={11.5} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', columnGap: 12, alignItems: 'center', marginTop: 10 }}>
        <p style={nameStyle(w1, 'right')}>{left}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 24, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ minWidth: 15, textAlign: 'center', color: scoreColor(w1) }}>{done ? score1 : '–'}</span>
          <span style={{ fontSize: 16, color: '#B8C2D0' }}>:</span>
          <span style={{ minWidth: 15, textAlign: 'center', color: scoreColor(w2) }}>{done ? score2 : '–'}</span>
        </div>
        <p style={nameStyle(w2, 'left')}>{right}</p>
      </div>
    </div>
  );
}

// ── 순위결정전 상세 블록 ────────────────────────────────────────────────────
export function PlacementDetailBlock({
  matchNo, status, teams, score1, score2, winner, done,
}: {
  matchNo: number;
  status: { label: string; color: string };
  teams: { key: string; teamNo: number; name: string }[];
  score1: number | null;
  score2: number | null;
  winner: 1 | 2 | null;
  done: boolean;
}) {
  const [t1, t2] = teams;
  return (
    <>
      <section style={sectionStyle}>
        <div style={{ padding: '12px 0 8px' }}><h2 style={h2Style}>참가 팀</h2></div>
        {teams.map((t, i) => {
          const won = done && winner === i + 1;
          const lost = done && winner !== null && winner !== i + 1;
          return (
            <div key={t.key} style={{
              display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr) 24px auto', columnGap: 8,
              alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${C.lineSoft}`,
            }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{t.teamNo}번</span>
              <span style={{ minWidth: 0, fontSize: 14, fontWeight: won ? 800 : 700, color: C.navy, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                {t.name}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 800, textAlign: 'center', color: won ? C.tealText : C.muted }}>
                {won ? '승' : lost ? '패' : ''}
              </span>
              <span style={{ justifySelf: 'end', fontSize: 11.5, fontWeight: 700, padding: '3px 7px', borderRadius: 6, whiteSpace: 'nowrap', color: C.tealText, background: C.tealTint }}>
                본선 진출
              </span>
            </div>
          );
        })}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHead title="경기 결과" hint="6게임 1세트 · 노애드" inCard={false} />
        {t1 && t2 && (
          <MatchResultCard
            label="순위결정전" sub={`#${matchNo}`} status={status}
            left={t1.name} right={t2.name} score1={score1} score2={score2}
            winner={winner} done={done} cancelled={false}
          />
        )}
      </section>
    </>
  );
}

// ── 이전 조 / 다음 조 ──────────────────────────────────────────────────────
const navBtnBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
  minHeight: 44, padding: '0 14px', borderRadius: 11,
  fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${C.line}`, background: '#fff', color: C.body, textDecoration: 'none',
};

function NavBtn({ href, label, dir }: { href: string | null; label: string; dir: 'prev' | 'next' }) {
  const inner = (
    <>
      {dir === 'prev' && <ChevronLeft size={16} strokeWidth={2.4} />}
      {label}
      {dir === 'next' && <ChevronRight size={16} strokeWidth={2.4} />}
    </>
  );
  return href
    ? <Link href={href} style={navBtnBase}>{inner}</Link>
    : <span aria-disabled="true" style={{ ...navBtnBase, color: '#B8C2D0', background: C.surface }}>{inner}</span>;
}

export function PrevNextNav({
  prev, next,
}: { prev: { href: string; label: string } | null; next: { href: string; label: string } | null }) {
  return (
    <nav aria-label="조 이동" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, paddingTop: 2 }}>
      <NavBtn href={prev?.href ?? null} label={prev?.label ?? '이전 조'} dir="prev" />
      <NavBtn href={next?.href ?? null} label={next?.label ?? '다음 조'} dir="next" />
    </nav>
  );
}

// ── 목록 필터 · 그리드 CSS (메인 목록 공용) ─────────────────────────────────
export const LIST_CSS = (teal: string) => `
  .stg-filter { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px;
                padding: 3px; background: #E6EAF0; border-radius: 12px; }
  .stg-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  @media (min-width: 360px) { .stg-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 700px) { .stg-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (min-width: 1180px) { .stg-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .stg-card:focus-visible { outline: 2px solid ${teal}; outline-offset: 2px; }
`;

// ── 뒤로 · 안내 · 토스트 ────────────────────────────────────────────────────
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, minHeight: 40, marginLeft: -6, padding: '0 6px',
      fontSize: 14, fontWeight: 700, color: C.tealText, textDecoration: 'none',
    }}>
      <ChevronLeft size={18} strokeWidth={2.4} /> {label}
    </Link>
  );
}

export function Notice({ tone, text, icon }: { tone: 'info' | 'warn'; text: string; icon?: React.ReactNode }) {
  const warn = tone === 'warn';
  return (
    <div style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', borderRadius: 14, padding: 14,
      background: warn ? C.amberTint : '#fff', border: `1px solid ${warn ? C.amberLine : C.line}`,
    }}>
      {icon}
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: warn ? C.navy : C.muted, lineHeight: 1.6, wordBreak: 'keep-all' }}>{text}</p>
    </div>
  );
}

export function Toast({ text, bottom = 'calc(68px + env(safe-area-inset-bottom))' }: { text: string; bottom?: string }) {
  return (
    <div role="status" style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)',
      // ⚠ Admin BottomNav(모바일, 약 54px + safe-area) 위로 띄운다.
      bottom,
      maxWidth: 'calc(100vw - 32px)', padding: '11px 16px', borderRadius: 10,
      background: C.navy, color: '#fff', fontSize: 12.5, fontWeight: 700,
      lineHeight: 1.6, zIndex: 90, wordBreak: 'keep-all', textAlign: 'center',
    }}>
      {text}
    </div>
  );
}
