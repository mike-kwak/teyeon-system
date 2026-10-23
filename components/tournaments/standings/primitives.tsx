'use client';

// 예선 조별리그 시각 부품 — Admin · Public 공용.
//   ⚠ 여기 있는 부품은 '이미 정해진 표시 값'만 받는다(라벨 · 색 · 텍스트).
//     무엇을 보여줄지(운영 경고 · 공개 문구 · 액션)는 Admin / Public 래퍼가 정해서 넘긴다.
//     isAdmin · isPublic 같은 역할 분기를 부품 안에 두지 않는다.

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { C, type Tone } from './presentation';

/** 순위결정전 같은 보조 라벨 색 — 강조하지 않는 옅은 blue. */
const TAG_COLOR = '#3D5A8F';
/** 조 카드 팀 줄의 한 줄 높이 — 이름 두 줄과 성적 두 줄의 기준선을 맞춘다(13px × 1.35). */
const ROW_LINE = '17.5px';

/**
 * compact 카드의 확정 탈락 팀(row.muted = 서버 FINAL · NOT_QUALIFIED) 음영.
 *   ⚠ opacity 를 쓰지 않는다 — 배경 · 이름 · 성적 · 배지 색을 각각 낮춘다.
 *   글자 대비(배경 #EEF1F5 기준): 이름 5.4:1 · 성적 5.0:1 · 배지 글자 4.7:1(배지 배경 기준).
 */
/** compact 카드 MY TEAM 표시 — 선택 조 테두리 · 내 팀 행 배경 · 왼쪽 줄(진출 teal · 탈락 회색 · 첫 경기 노랑과 겹치지 않는 파랑). */
const MY_BLUE = '#2F6FED';
/** compact 카드 첫 경기 출전 깃발 — 중립 남색(1차 teal · 2차 amber 차수 색과 섞이지 않게). */
const FIRST_FLAG = C.navy;
const MY_BG = '#EEF4FF';

const COMPACT_OUT = { rowBg: '#EEF1F5', name: '#556377', rec: '#5B6879', badgeBg: '#DDE3EA', badgeFg: '#556377' } as const;

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

/** 화면에는 보이지 않고 낭독기만 읽는 글자. */
const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

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
  /** 득실(서버 gameDiff 표기). null = 표시하지 않음(완료 경기 없음 · 순위결정전). */
  diff: string | null;
  diffColor?: string;
  muted: boolean;
  hit: boolean;
  /** 공개 화면 — 첫 경기 출전 표시(노란 줄 + 글자 배지). 없으면 그리지 않는다(관리자 화면은 넘기지 않는다). */
  first?: HighlightMark | null;
  /** 공개 compact — 참가자가 MY MATCH 에서 고른 내 팀(표시만 · 순위 · 진출 판정과 무관). */
  mine?: boolean;
}

/** 첫 경기 출전 같은 '안내' 강조 — 색 · 글자를 래퍼가 정해서 넘긴다(승패 · 진출 색과 섞지 않는다). */
export interface HighlightMark {
  label: string;
  bg: string;
  bd: string;
  fg: string;
}

/** 강조 배지 — 색만으로 구분하지 않도록 깃발 아이콘 + 글자. */
export function HighlightBadge({ mark, size = 11 }: { mark: HighlightMark; size?: number }) {
  return (
    <span data-first-badge style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 999,
      fontSize: size, fontWeight: 800, lineHeight: '16px', whiteSpace: 'nowrap',
      color: mark.fg, background: '#fff', border: `1px solid ${mark.bd}`,
    }}>
      <Flag size={size} strokeWidth={2.6} style={{ flexShrink: 0 }} />{mark.label}
    </span>
  );
}

export function GroupCompactCard({
  href, ariaLabel, title, tag, status, progress, segments, rows, extra, compact = false, selected = false,
}: {
  href: string;
  ariaLabel: string;
  title: string;
  /** 제목 옆 작은 보조 라벨(예: 순위결정전). */
  tag?: string;
  status: { label: string; color: string };
  progress: string;
  segments: string[];
  rows: CompactRow[];
  /** 상태 줄 아래 보조 줄(공개 화면의 조별 일정 안내). 없으면 아무것도 그리지 않는다. */
  extra?: React.ReactNode;
  /**
   * 공개 모바일 2열용 컴팩트 — 한 팀 = 한 줄('선수1 · 선수2'), 첫 경기 출전 = 이름 앞 작은 깃발, 여백 축소.
   *   성적이 있으면 이름 바로 아래 작은 줄('2승 0패  득실 +8'), 확정 탈락 팀은 중간 회색 음영.
   *   ⚠ 표시만 바꾼다(순위 · 성적 값은 그대로). 기본 false — 관리자 순위 화면은 기존 그대로.
   *   ⚠ 폭이 모자라면(긴 이름) 말줄임 없이 '·' 뒤에서 줄바꿈 — 카드 밖으로 나가지 않는다.
   */
  compact?: boolean;
  /** (compact) 내 팀이 있는 조 — 파란 테두리(inset · 카드 크기 그대로). */
  selected?: boolean;
}) {
  const mineCard = compact && selected;
  return (
    <Link href={href} className="stg-card" aria-label={ariaLabel}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, boxSizing: 'border-box',
        padding: compact ? '9px 8px 10px' : '12px 12px 13px', background: '#fff', border: `1px solid ${mineCard ? MY_BLUE : C.line}`, borderRadius: 14,
        textDecoration: 'none', color: C.navy, ...(mineCard ? { boxShadow: `inset 0 0 0 1px ${MY_BLUE}` } : null), ...(compact ? { gap: 6 } : null),
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{title}</span>
          {tag && <span style={{ fontSize: 11.5, fontWeight: 700, color: TAG_COLOR, whiteSpace: 'nowrap' }}>{tag}</span>}
        </span>
        <ChevronRight size={16} color={C.faint} strokeWidth={2.4} style={{ flexShrink: 0 }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <StatusDot label={status.label} color={status.color} />
        <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{progress}</span>
      </div>
      {extra}
      <Segments colors={segments} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 7, marginTop: compact ? 0 : 2 }}>
        {rows.map((r) => {
          const pre = r.rank === null;
          const out = compact && r.muted ? COMPACT_OUT : null;
          const mine = compact && !!r.mine;
          return (
            <div key={r.key} data-first-row={r.first ? 'true' : undefined} data-compact-row={compact ? 'true' : undefined} style={{
              display: 'flex', alignItems: 'flex-start', gap: compact ? 6 : 8,
              margin: '0 -5px', padding: compact ? '3px 5px' : r.first ? '4px 5px' : '2px 5px', borderRadius: 7,
              // 내 팀 — 탈락 회색 · 첫 경기 노랑 배경은 그대로 두고 왼쪽 파란 줄만 더한다(상태 표시를 덮지 않는다).
              // compact 는 첫 경기 출전을 깃발로만 보인다(노란 배경 · 줄 없음 — 1차 · 2차 색과 혼동 방지). 관리자 카드는 기존 그대로.
              background: r.hit ? C.tealTint : compact ? (out ? out.rowBg : mine ? MY_BG : 'transparent') : r.first ? r.first.bg : 'transparent',
              boxShadow: mine ? `inset 3px 0 0 ${MY_BLUE}` : !compact && r.first ? `inset 3px 0 0 ${r.first.bd}` : undefined,
            }} data-out-row={out ? 'true' : undefined} data-my-team={mine ? 'true' : undefined}>
              {/* ⚠ 경기 전에는 순위 숫자 대신 빈 표시만 둔다 */}
              <span style={{
                flexShrink: 0, width: compact ? 18 : 20, height: compact ? 18 : 20, boxSizing: 'border-box', marginTop: compact ? 0 : 1, borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                background: pre ? '#EEF2F8' : out ? out.badgeBg : r.tone.bg, color: out ? out.badgeFg : r.tone.fg,
                border: `1px solid ${pre ? '#EEF2F8' : out ? out.badgeBg : r.tone.bd}`,
              }}>
                {pre ? '' : r.rank}
              </span>
              <div style={{
                flex: 1, minWidth: 0, fontSize: compact ? 'clamp(12px, 3.6vw, 13px)' : 13, lineHeight: ROW_LINE,
                fontWeight: r.hit ? 800 : 600, color: out ? out.name : r.muted ? C.muted : C.navy,
                wordBreak: 'keep-all', overflowWrap: 'anywhere',
              }}>
                {compact ? (<>
                  {/* 한 줄 — '·' 앞은 붙여서(nbsp) 줄바꿈이 '·' 뒤에서만 일어나게. 첫 경기 출전 = 작은 깃발(색 + 아이콘 + 읽기 라벨). */}
                  <span data-compact-names>
                    {r.first && (
                      <span data-first-badge role="img" aria-label={r.first.label} title={r.first.label}
                        style={{ display: 'inline-flex', verticalAlign: '-1px', marginRight: 2, color: FIRST_FLAG }}>
                        <Flag size={11} strokeWidth={2.8} />
                      </span>
                    )}
                    {r.p1}<span style={{ color: C.faint, fontWeight: 600 }}>{'\u00A0·'} </span>{r.p2}
                    {mine && <span style={SR_ONLY}> (내 팀)</span>}
                  </span>
                  {/* 성적 — 이름 시작 위치에 맞춘 작은 줄. 값이 없으면(경기 전 · 미경기) 그리지 않는다. */}
                  {(r.record !== null || r.diff !== null) && (
                    <span data-compact-rec style={{
                      display: 'block', fontSize: 11, lineHeight: '14px', fontWeight: 600, whiteSpace: 'nowrap',
                      color: out ? out.rec : C.muted, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {r.record}{r.diff !== null && <>{' '}<span style={{ marginLeft: 3 }}>득실 <b style={{ fontWeight: 800, color: out ? out.rec : r.diffColor ?? C.muted }}>{r.diff}</b></span></>}
                    </span>
                  )}
                </>) : (
                  <>
                    <div>{r.p1}</div>
                    <div>{r.p2}</div>
                    {r.first && <div style={{ marginTop: 3 }}><HighlightBadge mark={r.first} /></div>}
                  </>
                )}
              </div>
              {/* 성적 — 이름 두 줄(선수1 / 선수2)과 같은 줄 높이로 승/패 · 득실을 두 줄에 둔다.
                  한 줄에 모두 넣으면 360px 에서 이름 칸이 3글자도 못 담을 만큼 줄어든다. */}
              {/* compact 는 이름 아래 줄에 성적을 그린다 — 오른쪽 두 줄 성적 칸은 관리자 · 기존 카드 전용. */}
              {!compact && (r.record !== null || r.diff !== null) && (
                <span style={{
                  flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
                  whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                }}>
                  {r.record !== null && (
                    <span style={{ fontSize: 11.5, lineHeight: ROW_LINE, fontWeight: 600, color: C.muted }}>{r.record}</span>
                  )}
                  {r.diff !== null && (
                    <span style={{ fontSize: 13, lineHeight: ROW_LINE, fontWeight: 800, color: r.diffColor ?? C.muted }}>{r.diff}</span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Link>
  );
}

// ── 상세 헤더 ───────────────────────────────────────────────────────────────
export function DetailHeader({
  title, tag, sub, status, progress,
}: {
  title: string;
  /** 제목 옆 보조 표시(예: 순위결정전). */
  tag?: string;
  sub: string;
  status: { label: string; color: string } | null;
  progress: string | null;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.navy, letterSpacing: '-0.02em', lineHeight: 1.3 }}>
          {title}
          {tag && (
            <span style={{
              display: 'inline-block', marginLeft: 8, verticalAlign: '3px', padding: '2px 8px', borderRadius: 6,
              fontSize: 12, fontWeight: 700, letterSpacing: 0, color: TAG_COLOR, background: '#EEF3FB',
            }}>{tag}</span>
          )}
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
/** teamNo 를 넘기지 않으면 번호 칸을 그리지 않는다(참가자 공개 화면 — 내부 팀 번호 비노출). 관리자 화면은 그대로 넘긴다. */
export function EntryRow({ teamNo, name, withdrawn, badge }: {
  teamNo?: number; name: string; withdrawn: boolean;
  /** 공개 화면 — 첫 경기 출전 배지. 없으면 그리지 않는다. */
  badge?: HighlightMark | null;
}) {
  return (
    <div data-first-row={badge ? 'true' : undefined} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.lineSoft}`,
      ...(badge ? { margin: '0 -8px', padding: '12px 8px', background: badge.bg, boxShadow: `inset 3px 0 0 ${badge.bd}` } : null),
    }}>
      {teamNo != null && (
        <span style={{ flexShrink: 0, minWidth: 36, fontSize: 12.5, fontWeight: 700, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
          {teamNo}번
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: C.navy, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
        {name}
        {badge && <span style={{ display: 'block', marginTop: 4 }}><HighlightBadge mark={badge} /></span>}
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
  label, sub, status, left, right, score1, score2, winner, done, cancelled, highlight,
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
  /** 공개 화면 — 첫 경기 안내 띠(배지 + 시간 · 코트 · 신고). 없으면 그리지 않는다. */
  highlight?: { mark: HighlightMark; detail: string | null } | null;
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
    <div data-first-match={highlight ? 'true' : undefined} style={{
      background: '#fff', border: `1px solid ${highlight ? highlight.mark.bd : C.line}`, borderRadius: 14, padding: '12px 14px 14px',
      boxShadow: highlight ? `inset 0 3px 0 ${highlight.mark.bd}` : undefined,
    }}>
      {highlight && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '-4px -6px 10px', padding: '7px 8px',
          borderRadius: 9, background: highlight.mark.bg, color: highlight.mark.fg,
          fontSize: 12.5, fontWeight: 800, lineHeight: 1.5, wordBreak: 'keep-all',
        }}>
          <HighlightBadge mark={highlight.mark} size={11.5} />
          {highlight.detail && <span style={{ minWidth: 0 }}>{highlight.detail}</span>}
        </div>
      )}
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
export interface PlacementTeamRow {
  key: string;
  /** 없으면 번호 줄을 그리지 않는다(참가자 공개 화면). */
  teamNo?: number;
  name: string;
  /** 완료 결과가 있을 때만 — 1승 0패 / 0승 1패. 없으면 null(만들지 않는다). */
  record: string | null;
  /** 완료 결과가 있을 때만 — 공식 점수 기준 +N / -N. 없으면 null. */
  diff: string | null;
  diffColor?: string;
  won: boolean;
  /** 공개 화면 — 첫 경기 출전 배지. 없으면 그리지 않는다. */
  badge?: HighlightMark | null;
}

const PLACEMENT_COLS = 'minmax(0, 1fr) 54px 32px auto';

export function PlacementDetailBlock({
  matchLabel, matchSub, status, teams, score1, score2, winner, done, highlight,
}: {
  /** 경기 카드 라벨(예: 1경기) · 보조 표시(예: #49, 없으면 null). */
  matchLabel: string;
  matchSub: string | null;
  status: { label: string; color: string };
  teams: PlacementTeamRow[];
  score1: number | null;
  score2: number | null;
  winner: 1 | 2 | null;
  done: boolean;
  /** 공개 화면 — 경기 카드의 첫 경기 안내 띠. */
  highlight?: { mark: HighlightMark; detail: string | null } | null;
}) {
  const [t1, t2] = teams;
  return (
    <>
      <section style={sectionStyle}>
        <div style={{ padding: '12px 0 8px' }}><h2 style={h2Style}>참가 팀</h2></div>
        <div style={{
          display: 'grid', gridTemplateColumns: PLACEMENT_COLS, columnGap: 8,
          padding: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.muted,
        }}>
          <span>팀</span>
          <span style={{ textAlign: 'right' }}>승/패</span>
          <span style={{ textAlign: 'right' }}>득실</span>
          <span style={{ textAlign: 'right', minWidth: 60 }}>진출</span>
        </div>
        {teams.map((t) => (
          <div key={t.key} style={{
            display: 'grid', gridTemplateColumns: PLACEMENT_COLS, columnGap: 8,
            alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${C.lineSoft}`,
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: t.won ? 800 : 700, color: C.navy, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                {t.name}
              </p>
              {t.badge && <p style={{ margin: '4px 0 0' }}><HighlightBadge mark={t.badge} /></p>}
              {t.teamNo != null && (
                <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 700, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{t.teamNo}번</p>
              )}
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: t.record ? C.body : C.muted, textAlign: 'right', whiteSpace: 'nowrap' }}>
              {t.record ?? '경기 전'}
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: t.diff ? (t.diffColor ?? C.muted) : C.faint }}>
              {t.diff ?? '–'}
            </span>
            <span style={{ justifySelf: 'end', fontSize: 11.5, fontWeight: 700, padding: '3px 7px', borderRadius: 6, whiteSpace: 'nowrap', color: C.tealText, background: C.tealTint }}>
              본선 진출
            </span>
          </div>
        ))}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SectionHead title="경기 결과" hint="6게임 1세트 · 노애드" inCard={false} />
        {t1 && t2 && (
          <MatchResultCard
            label={matchLabel} sub={matchSub} status={status}
            left={t1.name} right={t2.name} score1={score1} score2={score2}
            winner={winner} done={done} cancelled={false} highlight={highlight}
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
