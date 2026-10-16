'use client';

// Signature Court Board — 코트 전용 전광판 (/tournaments/arena-design/signature/courts 전용 Demo).
//
//   보조 모니터에서 선수가 '내 코트'를 빨리 찾게 하는 화면이다. 코트 1~10 을 한 화면에.
//   카드 하나 = 코트 하나: 코트 번호(가장 큰 숫자) · 상태 · NOW PLAYING(가장 큰 선수명) · NEXT(한 단계 작게).
//   ⚠ 별도의 NEXT 목록 · 하단 대기 영역은 두지 않는다. NEXT 는 각 코트 카드 안에만 있다.
//   ⚠ NEXT 는 가상 fixture 값이다. 없으면 '미정' — 화면이 다음 경기를 추측해 만들지 않는다.
//   ⚠ 운영 중지 코트는 경기 · NEXT 를 보이지 않는다.
//   ⚠ 이름은 줄이지 않는다(축약 없음). 길면 선수별 두 줄로 끝까지 보인다.
//
//   배치 두 가지 — 둘 다 정식 지원(운영진이 화면에서 언제든 바꾼다 · 전체화면 포함):
//     2x5 = 2열 × 5행(기본 — TV 실물 검수 10-16) — 가로로 긴 카드. 왼쪽 코트 번호 칸 + 오른쪽 NOW(팀 좌우) / NEXT(한 줄).
//           코트 순서는 위→아래 먼저(왼쪽 열 1~5, 오른쪽 열 6~10) — 목록처럼 읽힌다.
//     5x2 = 5열 × 2행 — 세로로 긴 카드. 위 코트 번호 → NOW(팀 위아래) → NEXT. 순서는 왼→오(위 1~5, 아래 6~10).
//   ⚠ 두 배치는 같은 데이터 · 같은 상태 규칙(stateOf)을 쓴다 — 배치를 바꿔도 경기 · 상태는 그대로다.
//
//   상태 다섯 가지(색만이 아니라 글자 · 명암 · 테두리 모양으로도 구분):
//     LIVE        진한 남색 코트 번호 칸 + 노란 LIVE 배지 · 남색 굵은 테두리. 선수명이 가장 크다.
//     다음 경기 대기  흰 카드 + 옅은 코발트 테두리 · '다음 경기 대기'. NEXT 가 실제로 있을 때만.
//     대기 중      회색 음영 카드 · '대기 중' / '배정된 경기 없음'.
//     운영 중지    카드 전체 회색 빗금 · 짙은 회색 '운영 중지' 배지(LIVE · NEXT 처럼 보이지 않는다).
//     미등록       점선 테두리 · 비어 있는 바탕 · '미등록'(운영 중지와 다르다 — DB 에 없는 자리).

import React from 'react';
import type { ArenaTeam } from '@/lib/tournaments/arenaTypes';
import type { CourtBoardCourt, CourtBoardMatch } from './signatureCourtBoardFixture';
import { fitTeamName } from './signatureModel';
import MatchElapsedClock from '../MatchElapsedClock';
import { SIG, SIG_FONT_BODY, SIG_FONT_DISPLAY, courtCode } from './signatureTheme';

export type CourtBoardLayout = '2x5' | '5x2';
/** 기본 = 2열 × 5행(왼쪽 1~5 · 오른쪽 6~10). 5열 × 2행도 정식 옵션(?layout=5x2). */
export const courtBoardLayoutOf = (v: string | null): CourtBoardLayout => (v === '5x2' ? '5x2' : '2x5');
export const COURT_BOARD_LAYOUTS: [CourtBoardLayout, string][] = [['2x5', '2열 × 5행'], ['5x2', '5열 × 2행']];
export const otherCourtBoardLayout = (l: CourtBoardLayout): CourtBoardLayout => (l === '2x5' ? '5x2' : '2x5');

/**
 * 키보드 배치 전환(전체화면 포함) — L 키 = 다른 배치, 2 = 2열 × 5행, 5 = 5열 × 2행.
 *   ⚠ 주소만 바꾼다(페이지가 router.replace) — 조회 상태 · 경기 데이터는 그대로 남는다.
 */
export function useCourtBoardLayoutKeys(layout: CourtBoardLayout, onChange: (l: CourtBoardLayout) => void) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const next = e.key === 'l' || e.key === 'L' ? otherCourtBoardLayout(layout)
        : e.key === '2' ? '2x5' : e.key === '5' ? '5x2' : null;
      if (next && next !== layout) onChange(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, onChange]);
}

type CardState = 'live' | 'ready' | 'empty' | 'closed' | 'unregistered';

const stateOf = (c: CourtBoardCourt): CardState =>
  c.registered === false ? 'unregistered' : !c.active ? 'closed' : c.now ? 'live' : c.next ? 'ready' : 'empty';

const CHIP: Record<CardState, { label: string; bg: string; fg: string; border: string; dashed?: boolean }> = {
  live: { label: 'LIVE', bg: SIG.live, fg: SIG.liveInk, border: SIG.live },
  ready: { label: '다음 경기 대기', bg: '#FFFFFF', fg: SIG.royal, border: SIG.royal },
  empty: { label: '대기 중', bg: '#E1DDD5', fg: SIG.inkSoft, border: '#CEC8BC' },
  closed: { label: '운영 중지', bg: '#5E6A7E', fg: '#FFFFFF', border: '#5E6A7E' },
  unregistered: { label: '미등록', bg: 'transparent', fg: SIG.muted, border: '#AFA899', dashed: true },
};

/** 상태별 카드 · 코트 번호 칸 바탕. */
const LOOK: Record<CardState, { card: string; badge: string; border: string; number: string }> = {
  live: { card: 'rgba(255, 255, 255, 0.97)', badge: SIG.navy, border: `2px solid ${SIG.navy}`, number: '#FFFFFF' },
  ready: { card: 'rgba(255, 255, 255, 0.97)', badge: '#E8EEF8', border: '2px solid #B7C6E1', number: SIG.navy },
  empty: { card: '#EDEAE4', badge: '#E1DDD5', border: '2px solid #D6D0C5', number: SIG.muted },
  closed: {
    card: 'repeating-linear-gradient(135deg, #E2DFD9 0 14px, #DAD7D0 14px 28px)', badge: '#D2CEC6',
    border: '2px solid #C8C3B9', number: SIG.faint,
  },
  unregistered: { card: 'rgba(250, 249, 246, 0.6)', badge: 'transparent', border: '2px dashed #BDB6A8', number: SIG.faint },
};

const namesOf = (t: ArenaTeam): string[] => {
  const n = [t.player1Name, t.player2Name].filter((s) => s.trim() !== '');
  return n.length > 0 ? n : [t.teamNo !== null ? `${t.teamNo}번 팀` : '—'];
};

/** 팀 이름 칸 — 한 줄 → 작게 한 줄 → 선수별 두 줄(축약 없음). */
function TeamName({ team, width, height, base, min, align, kind }: {
  team: ArenaTeam; width: number; height: number; base: number; min: number;
  align: 'left' | 'center' | 'right'; kind: 'now' | 'next';
}) {
  const stackMax = Math.min(base, Math.floor(((height - 4) / 2.12) * 2) / 2);
  const fit = fitTeamName(namesOf(team), width, { base, min, stackMax });
  return (
    <div data-cb-name={kind} style={{
      width, height, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
      fontSize: fit.fontSize, fontWeight: kind === 'now' ? 900 : 800, lineHeight: fit.lines.length > 1 ? 1.06 : 1.12,
      letterSpacing: '-0.02em', color: kind === 'now' ? SIG.ink : SIG.inkSoft, opacity: team.withdrawn ? 0.45 : 1,
      textAlign: align,
    }}>
      {fit.lines.map((l, i) => (
        <span key={i} style={{ maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</span>
      ))}
    </div>
  );
}

const Vs = ({ size, width }: { size: number; width?: number }) => (
  <span style={{
    width, flexShrink: 0, textAlign: 'center', fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontWeight: 800,
    fontSize: size, letterSpacing: '0.12em', color: SIG.faint, lineHeight: 1,
  }}>
    VS
  </span>
);

function Chip({ state, size = 'md' }: { state: CardState; size?: 'md' | 'lg' }) {
  const c = CHIP[state];
  const live = state === 'live';
  return (
    <span data-cb-chip={state} style={{
      height: size === 'lg' ? 30 : 26, display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: size === 'lg' ? '0 12px' : '0 9px', borderRadius: 5, boxSizing: 'border-box', whiteSpace: 'nowrap',
      background: c.bg, border: `1.5px ${c.dashed ? 'dashed' : 'solid'} ${c.border}`, color: c.fg,
      fontFamily: live ? SIG_FONT_DISPLAY : SIG_FONT_BODY, fontStyle: live ? 'italic' : 'normal',
      fontSize: live ? (size === 'lg' ? 18 : 16) : 13.5, fontWeight: live ? 900 : 800, letterSpacing: live ? '0.06em' : 0,
    }}>
      {live && <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: SIG.liveInk }} />}
      {c.label}
    </span>
  );
}

/**
 * NOW PLAYING 줄 오른쪽 끝의 작은 경과 시간(타이머 1단계).
 *   시작 전 = '시작 대기'(조용한 글자) · 시작 후 = MM:SS / H:MM:SS(서버 시작 시각 기준).
 *   ⚠ 카드 배치 · 높이를 바꾸지 않는다 — 기존 라벨 줄(높이 22 · 24) 안에서만 그린다.
 *   ⚠ timer 가 없으면(Demo · 타이머 미지원 서버) 아무 것도 그리지 않는다.
 */
function NowTimer({ timer }: { timer: NonNullable<CourtBoardMatch['timer']> }) {
  if (timer.startMs === null) {
    return (
      <span data-cb-timer="waiting" style={{
        marginLeft: 'auto', flexShrink: 0, fontSize: 13.5, fontWeight: 800, color: SIG.muted, whiteSpace: 'nowrap',
      }}>
        시작 대기
      </span>
    );
  }
  return (
    <span data-cb-timer="running" style={{
      marginLeft: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap',
    }}>
      <span style={{ fontFamily: SIG_FONT_DISPLAY, fontSize: 11, fontWeight: 900, letterSpacing: '0.16em', color: SIG.muted }}>
        TIME
      </span>
      <MatchElapsedClock startMs={timer.startMs} offsetMs={timer.offsetMs} style={{
        fontFamily: SIG_FONT_DISPLAY, fontSize: 18, fontWeight: 900, color: SIG.navy, lineHeight: 1,
      }} />
    </span>
  );
}

const SectionLabel = ({ kind, meta, timer }: {
  kind: 'now' | 'next'; meta: string | null; timer?: CourtBoardMatch['timer'];
}) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
    <span style={{
      fontFamily: SIG_FONT_DISPLAY, fontSize: kind === 'now' ? 12.5 : 12, fontWeight: 900, letterSpacing: '0.16em',
      color: kind === 'now' ? SIG.navy : SIG.royal, whiteSpace: 'nowrap',
      padding: kind === 'next' ? '2px 7px' : 0, borderRadius: 4,
      background: kind === 'next' ? 'rgba(46, 90, 172, 0.1)' : 'transparent',
    }}>
      {kind === 'now' ? 'NOW PLAYING' : 'NEXT'}
    </span>
    {meta && (
      <span style={{ fontSize: 13.5, fontWeight: 800, color: SIG.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {meta}
      </span>
    )}
    {timer && <NowTimer timer={timer} />}
  </div>
);

/**
 * NEXT 구역 — TV 실물 검수 2차(10-16): NOW(흰 바탕 · 가장 큰 글자)와 별도 구역으로 보이게 아주 연한 블루그레이 바탕 + 위 경계선.
 *   반투명이라 상태별 카드 바탕(흰색 · 대기 중 회색) 위에서 같은 '한 단계 아래' 톤으로 보인다. LIVE 보다 눈에 띄지 않는다.
 *   카드 좌우 · 아래 끝까지 깔리고, 안쪽 글자 위치 · 높이는 이전과 같다(구분선 자리 = 경계선).
 *   '미정' 도 같은 구역 안에 낮은 강조로 둔다(바탕이 생긴 만큼 이전 SIG.faint 와 같은 대비가 되게 한 단계 진하게).
 */
const NEXT_FILL = 'rgba(70, 92, 130, 0.075)';
const NEXT_RULE = 'rgba(70, 92, 130, 0.24)';
const NEXT_UNDECIDED = '#8E97A7';

/** NOW 가 없을 때 · 운영 중지 · NEXT 미정 — 조용한 글자. */
const Quiet = ({ text, sub, size, tone = 'muted' }: { text: string; sub?: string; size: number; tone?: 'muted' | 'strong' }) => (
  <div data-cb-quiet={text} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
    <span style={{ fontSize: size, fontWeight: 800, color: tone === 'strong' ? SIG.inkSoft : SIG.muted, whiteSpace: 'nowrap' }}>{text}</span>
    {sub && <span style={{ fontSize: Math.round(size * 0.68), fontWeight: 700, color: SIG.muted, whiteSpace: 'nowrap' }}>{sub}</span>}
  </div>
);

/** NOW 자리가 비었을 때 문구 — 상태마다 다르다(다음 경기 대기 / 대기 중). */
const idleText = (state: CardState): { text: string; sub: string } =>
  state === 'ready' ? { text: '현재 경기 없음', sub: '다음 경기 대기' } : { text: '대기 중', sub: '배정된 경기 없음' };

/** 운영 중지 · 미등록 문구. */
const offText = (state: CardState): { text: string; sub: string } =>
  state === 'closed' ? { text: '운영 중지', sub: '사용하지 않는 코트' } : { text: '미등록', sub: '등록되지 않은 코트' };

function cardFrame(state: CardState): React.CSSProperties {
  const look = LOOK[state];
  return {
    position: 'relative', boxSizing: 'border-box', borderRadius: 12, overflow: 'hidden', display: 'flex',
    background: look.card, border: look.border,
    boxShadow: state === 'unregistered' ? 'none' : SIG.shadowCard,
  };
}

const dataOf = (c: CourtBoardCourt, state: CardState) => ({
  'data-court-card': c.courtNo,
  'data-court-state': state,
  'data-next-state': c.registered === false || !c.active ? 'none' : c.next ? 'assigned' : 'undecided',
  'data-cb-now': c.now ? `${namesOf(c.now.team1).join(' · ')} vs ${namesOf(c.now.team2).join(' · ')}` : '',
  'data-cb-next': c.next ? `${namesOf(c.next.team1).join(' · ')} vs ${namesOf(c.next.team2).join(' · ')}` : '',
});

const nowMeta = (c: CourtBoardCourt): string | null =>
  c.now ? [c.displayName, c.now.stageLabel].filter(Boolean).join(' · ') : c.displayName;

// ── 2열 × 5행: 가로 카드 ───────────────────────────────────────────────────

const ROW_BADGE_W = 156;
const ROW_NEXT_H = 60;

function RowCard({ court, width, height }: { court: CourtBoardCourt; width: number; height: number }) {
  const state = stateOf(court);
  const live = state === 'live';
  const contentW = width - ROW_BADGE_W - 4 - 36;
  const nowTeamsH = height - 4 - 20 - 22 - ROW_NEXT_H - 9;      // 테두리 · 위아래 여백 · 라벨 줄 · NEXT · 구분선
  const nowTeamW = (contentW - 56) / 2;
  const nextTeamW = (contentW - 70 - 44 - 16) / 2;
  return (
    <div {...dataOf(court, state)} style={{ ...cardFrame(state), width, height }}>
      {/* 코트 번호 칸 */}
      <div style={{
        width: ROW_BADGE_W, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
        background: LOOK[state].badge,
        borderRight: state === 'unregistered' ? '2px dashed #D6D0C4' : `1px solid ${live ? SIG.navy : 'rgba(20, 35, 74, 0.08)'}`,
        boxShadow: live ? `inset 0 -5px 0 ${SIG.live}` : 'none',
      }}>
        <span style={{
          fontFamily: SIG_FONT_DISPLAY, fontSize: 14, fontWeight: 900, letterSpacing: '0.24em',
          color: live ? '#C9D3E8' : SIG.muted, lineHeight: 1,
        }}>
          COURT
        </span>
        <span data-cb-court-no style={{
          fontFamily: SIG_FONT_DISPLAY, fontSize: 64, fontWeight: 900, lineHeight: 0.92, fontVariantNumeric: 'tabular-nums',
          color: LOOK[state].number,
        }}>
          {courtCode(court.courtNo)}
        </span>
        <Chip state={state} />
      </div>

      {/* NOW / NEXT */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '10px 18px' }}>
        {state === 'closed' || state === 'unregistered' ? (
          <Quiet {...offText(state)} size={28} tone="strong" />
        ) : (
          <>
            <div style={{ height: 22, flexShrink: 0 }}><SectionLabel kind="now" meta={nowMeta(court)} timer={court.now?.timer} /></div>
            {court.now ? (
              <div style={{ height: nowTeamsH, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <TeamName team={court.now.team1} width={nowTeamW} height={nowTeamsH} base={32} min={26} align="right" kind="now" />
                <Vs size={15} width={56} />
                <TeamName team={court.now.team2} width={nowTeamW} height={nowTeamsH} base={32} min={26} align="left" kind="now" />
              </div>
            ) : (
              <div style={{ height: nowTeamsH, flexShrink: 0, display: 'flex' }}>
                <Quiet {...idleText(state)} size={24} tone={state === 'ready' ? 'strong' : 'muted'} />
              </div>
            )}
            <div data-cb-next-panel style={{
              height: ROW_NEXT_H + 7, flexShrink: 0, boxSizing: 'border-box', margin: '4px -18px -10px', padding: '4px 18px 10px',
              background: NEXT_FILL, borderTop: `1px solid ${NEXT_RULE}`,
            }}>
              <div data-cb-next-area style={{ height: ROW_NEXT_H - 8, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 70, flexShrink: 0 }}><SectionLabel kind="next" meta={null} /></span>
                {court.next ? (
                  <>
                    <TeamName team={court.next.team1} width={nextTeamW} height={ROW_NEXT_H - 8} base={22} min={18} align="right" kind="next" />
                    <Vs size={12} width={44} />
                    <TeamName team={court.next.team2} width={nextTeamW} height={ROW_NEXT_H - 8} base={22} min={18} align="left" kind="next" />
                    <span style={{ flex: 1 }} />
                  </>
                ) : (
                  <span data-cb-undecided style={{ fontSize: 20, fontWeight: 800, color: NEXT_UNDECIDED }}>미정</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 5열 × 2행: 세로 카드 ───────────────────────────────────────────────────

function ColumnCard({ court, width, height }: { court: CourtBoardCourt; width: number; height: number }) {
  const state = stateOf(court);
  const live = state === 'live';
  const innerW = width - 4 - 28;
  // 세로 배분: 머리 64 · NOW 라벨 24 · 팀 · VS 24 · 팀 · 구분 17 · NEXT 라벨 24 · 팀 · vs 16 · 팀 · 여백
  const free = height - 4 - 64 - 24 - 24 - 17 - 24 - 16 - 22;
  const nowH = Math.floor(free * 0.31);
  const nextH = Math.floor((free - nowH * 2) / 2);
  return (
    <div {...dataOf(court, state)} style={{ ...cardFrame(state), width, height, flexDirection: 'column' }}>
      <div style={{
        height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px',
        background: LOOK[state].badge,
        boxShadow: live ? `inset 0 -4px 0 ${SIG.live}` : state === 'unregistered' ? 'none' : 'inset 0 -1px 0 rgba(20, 35, 74, 0.08)',
        borderBottom: state === 'unregistered' ? '2px dashed #D6D0C4' : 'none',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontFamily: SIG_FONT_DISPLAY, fontSize: 13, fontWeight: 900, letterSpacing: '0.2em', color: live ? '#C9D3E8' : SIG.muted }}>
            COURT
          </span>
          <span data-cb-court-no style={{
            fontFamily: SIG_FONT_DISPLAY, fontSize: 46, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
            color: LOOK[state].number,
          }}>
            {courtCode(court.courtNo)}
          </span>
        </span>
        <Chip state={state} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '8px 14px 12px' }}>
        {state === 'closed' || state === 'unregistered' ? (
          <Quiet {...offText(state)} size={28} tone="strong" />
        ) : (
          <>
            <div style={{ height: 24, flexShrink: 0 }}><SectionLabel kind="now" meta={nowMeta(court)} timer={court.now?.timer} /></div>
            {court.now ? (
              <>
                <TeamName team={court.now.team1} width={innerW} height={nowH} base={31} min={24} align="center" kind="now" />
                <div style={{ height: 24, flexShrink: 0, display: 'grid', placeItems: 'center' }}><Vs size={15} /></div>
                <TeamName team={court.now.team2} width={innerW} height={nowH} base={31} min={24} align="center" kind="now" />
              </>
            ) : (
              <div style={{ height: nowH * 2 + 24, flexShrink: 0, display: 'flex' }}>
                <Quiet {...idleText(state)} size={24} tone={state === 'ready' ? 'strong' : 'muted'} />
              </div>
            )}
            <div data-cb-next-panel style={{
              flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
              margin: '8px -14px -12px', padding: '8px 14px 12px', background: NEXT_FILL, borderTop: `1px solid ${NEXT_RULE}`,
            }}>
              <div style={{ height: 24, flexShrink: 0 }}>
                <SectionLabel kind="next" meta={court.next ? court.next.stageLabel : null} />
              </div>
              <div data-cb-next-area style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {court.next ? (
                  <>
                    <TeamName team={court.next.team1} width={innerW} height={nextH} base={22} min={18} align="center" kind="next" />
                    <div style={{ height: 16, flexShrink: 0, display: 'grid', placeItems: 'center' }}><Vs size={11} /></div>
                    <TeamName team={court.next.team2} width={innerW} height={nextH} base={22} min={18} align="center" kind="next" />
                  </>
                ) : (
                  <span data-cb-undecided style={{ alignSelf: 'center', fontSize: 20, fontWeight: 800, color: NEXT_UNDECIDED }}>미정</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 보드 ───────────────────────────────────────────────────────────────────

const GAP = 12;

export default function SignatureCourtBoard({ courts, layout, width, height }: {
  courts: CourtBoardCourt[]; layout: CourtBoardLayout; width: number; height: number;
}) {
  const cols = layout === '2x5' ? 2 : 5;
  const rows = layout === '2x5' ? 5 : 2;
  const cardW = (width - GAP * (cols - 1)) / cols;
  const cardH = (height - GAP * (rows - 1)) / rows;
  return (
    <section aria-label="코트 현황" data-court-board={layout} style={{
      width, height, display: 'grid', gap: GAP,
      gridTemplateColumns: `repeat(${cols}, ${cardW}px)`, gridTemplateRows: `repeat(${rows}, ${cardH}px)`,
      // 2x5 는 위→아래 먼저(왼쪽 열 1~5) — 목록처럼 읽힌다. 5x2 는 왼→오.
      gridAutoFlow: layout === '2x5' ? 'column' : 'row',
    }}>
      {courts.map((c) => (layout === '2x5'
        ? <RowCard key={c.courtNo} court={c} width={cardW} height={cardH} />
        : <ColumnCard key={c.courtNo} court={c} width={cardW} height={cardH} />))}
    </section>
  );
}

export type { CourtBoardMatch };
