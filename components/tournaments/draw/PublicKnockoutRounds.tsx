'use client';

// 공개 본선 — 라운드별 보기(모바일 기본). 관람 전용.
//
//   휴대폰 한 손으로 '내 경기'를 확대 없이 읽게 한다: 라운드 탭 → 화면 폭 경기 카드.
//   ⚠⚠ 대진을 계산하지 않는다. 전체 대진표와 같은 layoutBracket 결과(서버 topology 의 좌표)를 라운드별로 나열할 뿐이다.
//     BYE 는 서버가 저장한 slot_type = 'bye' 자리만(BracketSide.kind === 'bye'), 경기 · 승자를 만들지 않는다.
//   ⚠ 진행 중 경기에 가짜 점수를 만들지 않는다. 코트는 서버가 진행 중일 때만 준다.
//   ⚠ '다음 경기' 는 승자가 들어갈 자리(targetSlotKey)를 받는 다음 카드를 가리킬 뿐이다 — 진출을 뜻하지 않는다.

import React from 'react';
import { ArrowRight, Radio } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import type { BracketLayout, BracketNode, BracketSide } from '@/lib/tournaments/layoutBracket';
import { courtText, statusTone, WIN_ROW_BG, WIN_ROW_RING } from './knockoutStatus';

/** 라운드 탭에 쓰는 열(경기 열만 — 우승 자리 열은 결과 카드로 따로 보여 준다). */
export function matchColumns(layout: BracketLayout) {
  return layout.columns.filter((c) => !c.isFinal);
}

/**
 * 처음 보여 줄 라운드 — 지금 경기가 있는 라운드(진행 · 호출 → 대기 중 경기) → 없으면 마지막 경기 라운드.
 *   ⚠ 표시 선택일 뿐이다. 라운드 진행 상태를 판정하지 않는다.
 */
export function defaultRound(layout: BracketLayout): number {
  const cols = matchColumns(layout);
  const nodes = layout.nodes.filter((n) => n.kind === 'match');
  const live = nodes.filter((n) => n.match && (n.match.status === 'playing' || n.match.status === 'calling'));
  if (live.length) return Math.min(...live.map((n) => n.roundNo));
  const waiting = nodes.filter((n) => n.match && n.match.status === 'waiting');
  if (waiting.length) return Math.min(...waiting.map((n) => n.roundNo));
  const played = nodes.filter((n) => n.match);
  if (played.length) return Math.max(...played.map((n) => n.roundNo));
  return cols[0]?.roundNo ?? 1;
}

function TeamLine({ side, winner, dim, score }: {
  side: BracketSide | null; winner: boolean; dim: boolean; score: number | null;
}) {
  const kind = side?.kind ?? 'tbd';
  if (kind === 'bye') {
    return (
      <div data-ko-row="bye" style={{
        display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '0 10px', borderRadius: 8,
        background: '#F1F2F4', border: '1px dashed #CBD2DB',
      }}>
        <span style={{ fontFamily: FONT_LABEL, fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: '#7E8898' }}>BYE</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: TT.subtle }}>상대 없음 · 부전승</span>
      </div>
    );
  }
  const muted = kind === 'tbd' || kind === 'qualifier';
  return (
    <div data-ko-row={kind} data-ko-win={winner ? '1' : undefined} style={{
      display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, padding: '0 2px', minWidth: 0,
      // 승리 줄: 좌우로 6px 넓힌 사각형(글자 위치는 그대로 — 음수 여백만큼 안쪽 여백을 더한다)
      ...(winner ? { margin: '0 -6px', padding: '0 8px', borderRadius: 9, background: WIN_ROW_BG, boxShadow: WIN_ROW_RING } : null),
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {side?.source && (
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: TT.subtle, lineHeight: 1.3 }}>{side.source}</p>
        )}
        <p style={{
          margin: 0, fontSize: 15, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'anywhere',
          fontWeight: winner ? 800 : muted ? 600 : 700,
          color: muted ? TT.subtle : dim ? TT.muted : winner ? TT.tealDeep : TT.ink,
        }}>
          {side ? side.primary : '미정'}
          {side?.withdrawn && <span style={{ color: '#B91C1C', fontWeight: 700 }}> (기권)</span>}
        </p>
      </div>
      {score != null && (
        <span style={{ flexShrink: 0, minWidth: 22, textAlign: 'right', fontSize: 20, fontWeight: 900,
          fontVariantNumeric: 'tabular-nums', color: winner ? TT.tealDeep : TT.subtle }}>
          {score}
        </span>
      )}
    </div>
  );
}

/**
 * 부전승 칸 — 한 경기 카드 안에 [진출 팀 / BYE] 두 자리로 보여 준다(상대 자리가 비어 있음을 대진 구조로).
 *   ⚠ 표시만 바꾼다. 팀은 서버가 저장한 자리 그대로(bye 가 아닌 쪽), 승자 · 경기를 만들지 않는다.
 */
function ByeCard({ node, next, highlight }: { node: BracketNode; next: { label: string } | null; highlight: boolean }) {
  const team = node.a?.kind === 'bye' ? node.b : node.a;
  const tone = statusTone(null, true);
  return (
    <article data-ko-card={node.key} data-ko-status="bye" data-highlight={highlight ? '1' : undefined}
      style={{
        background: highlight ? TT.tealSoft : TT.surface, borderRadius: 14, padding: '11px 13px 10px',
        border: `${highlight ? 2 : 1}px solid ${highlight ? TT.teal : TT.line}`, scrollMarginTop: 90,
        boxShadow: '0 1px 2px rgba(15,23,42,0.05)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: tone.bg, color: tone.color, whiteSpace: 'nowrap' }}>
          {tone.label}
        </span>
      </header>
      <div data-ko-bye-team>
        <TeamLine side={team} winner={false} dim={false} score={null} />
      </div>
      <div data-ko-row="bye" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 9,
        background: '#F1F2F4', border: '1px dashed #CBD2DB',
      }}>
        <span style={{ fontFamily: FONT_LABEL, fontSize: 18, fontWeight: 800, letterSpacing: '0.2em', color: '#7E8898', paddingLeft: '0.2em' }}>
          BYE
        </span>
      </div>
      {next && (
        <p style={{ margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: TT.subtle, wordBreak: 'keep-all' }}>
          <ArrowRight size={13} strokeWidth={2.4} style={{ flexShrink: 0 }} />
          진출 → {next.label}
        </p>
      )}
    </article>
  );
}

function RoundCard({ node, next, highlight }: {
  node: BracketNode; next: { label: string } | null; highlight: boolean;
}) {
  if (node.bye) return <ByeCard node={node} next={next} highlight={highlight} />;
  const m = node.match;
  const tone = statusTone(m, node.bye);
  const court = courtText(m);
  const done = m?.status === 'completed';
  const live = m?.status === 'playing';
  const win1 = done && m?.winnerSide === 1;
  const win2 = done && m?.winnerSide === 2;
  return (
    <article data-ko-card={node.key} data-ko-status={node.bye ? 'bye' : m ? m.status : 'none'}
      data-highlight={highlight ? '1' : undefined}
      style={{
        background: highlight ? TT.tealSoft : TT.surface, borderRadius: 14, padding: '11px 13px 10px',
        border: `${highlight || live ? 2 : 1}px solid ${highlight ? TT.teal : live ? TT.teal : TT.line}`,
        boxShadow: live ? '0 2px 10px rgba(14,140,128,0.14)' : '0 1px 2px rgba(15,23,42,0.05)',
        display: 'flex', flexDirection: 'column', gap: 6, scrollMarginTop: 90,
      }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: TT.subtle }}>
          {m ? `MATCH ${String(m.matchNo).padStart(2, '0')}` : '경기 전'}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: tone.bg, color: tone.color,
          display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          {live && <Radio size={12} strokeWidth={2.6} />}{tone.label}
        </span>
        {court && (
          <span data-ko-court style={{ fontSize: 12.5, fontWeight: 800, color: TT.tealDeep, whiteSpace: 'nowrap' }}>{court}</span>
        )}
      </header>
      <TeamLine side={node.a} winner={win1} dim={done && !win1} score={done ? m?.score1 ?? null : null} />
      <div aria-hidden style={{ height: 1, background: TT.lineSoft }} />
      <TeamLine side={node.b} winner={win2} dim={done && !win2} score={done ? m?.score2 ?? null : null} />
      {next && (
        <p style={{ margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: TT.subtle, wordBreak: 'keep-all' }}>
          <ArrowRight size={13} strokeWidth={2.4} style={{ flexShrink: 0 }} />
          승자 → {next.label}
        </p>
      )}
    </article>
  );
}

export default function PublicKnockoutRounds({
  layout, round, onRound, highlight,
}: {
  layout: BracketLayout;
  round: number;
  onRound: (r: number) => void;
  /** 검색에서 고른 카드(있으면 강조 · 화면으로 스크롤). */
  highlight: string | null;
}) {
  const cols = matchColumns(layout);
  const nodes = layout.nodes.filter((n) => n.kind === 'match' && n.roundNo === round).sort((a, z) => a.y - z.y);
  const champion = layout.nodes.find((n) => n.kind === 'champion') ?? null;
  const isLastRound = cols.length > 0 && round === cols[cols.length - 1].roundNo;

  // 승자가 들어갈 자리를 받는 다음 카드 — 서버 연결(targetSlotKey)을 그대로 따라간다.
  const nextOf = React.useCallback((n: BracketNode): { label: string } | null => {
    const to = layout.nodes.find((x) => x.kind === 'match' && (x.a?.slotKey === n.targetSlotKey || x.b?.slotKey === n.targetSlotKey));
    if (to) {
      const name = layout.columns.find((c) => c.roundNo === to.roundNo)?.name ?? '';
      return { label: to.match ? `${name} MATCH ${String(to.match.matchNo).padStart(2, '0')}` : name };
    }
    if (champion && champion.targetSlotKey === n.targetSlotKey) return { label: '우승' };
    return null;
  }, [layout, champion]);

  const counts = React.useMemo(() => {
    const out = new Map<number, { live: number; total: number }>();
    layout.nodes.filter((n) => n.kind === 'match').forEach((n) => {
      const c = out.get(n.roundNo) ?? { live: 0, total: 0 };
      c.total += 1;
      if (n.match?.status === 'playing') c.live += 1;
      out.set(n.roundNo, c);
    });
    return out;
  }, [layout]);

  // 검색으로 고른 카드가 이 라운드에 있으면 화면으로 데려온다.
  React.useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector(`[data-ko-card="${CSS.escape(highlight)}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight, round]);

  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  // 고른 라운드 탭이 탭 줄 안에서 보이게(64강 · 32강 … 가로로 길 때).
  //   ⚠ scrollIntoView 를 쓰지 않는다 — 페이지 세로 스크롤까지 움직여 검색으로 고른 카드로 가는 스크롤을 끊는다.
  //     탭 줄의 가로 위치만 바꾼다.
  React.useEffect(() => {
    const strip = tabsRef.current;
    const el = strip?.querySelector('[aria-selected="true"]') as HTMLElement | null;
    if (!strip || !el) return;
    const left = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
    strip.scrollLeft = Math.max(0, left);
  }, [round]);

  const byes = nodes.filter((n) => n.bye).length;
  // 부전승 칸이 많은 첫 라운드(40팀 → 32칸 중 24칸)에서 실제 경기만 볼 수 있게. ⚠ 표시만 줄인다(데이터 · 대진 불변).
  const [hideByes, setHideByes] = React.useState(false);
  const shown = hideByes ? nodes.filter((n) => !n.bye || n.key === highlight) : nodes;

  return (
    <div data-ko-rounds style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* 라운드 탭 — 탭 줄만 가로로 넘긴다(페이지 가로 스크롤 없음) */}
      <div ref={tabsRef} role="tablist" aria-label="라운드" className="tt-ko-tabs" style={{
        display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 1px 4px', margin: '0 -1px',
        scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
      }}>
        {cols.map((c) => {
          const on = c.roundNo === round;
          const n = counts.get(c.roundNo);
          return (
            <button key={c.roundNo} type="button" role="tab" aria-selected={on} data-ko-tab={c.roundNo}
              onClick={() => onRound(c.roundNo)}
              style={{
                flexShrink: 0, minHeight: 42, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? TT.ink : TT.line}`, background: on ? TT.ink : TT.surface,
                color: on ? '#fff' : TT.inkSoft, fontFamily: 'inherit', fontSize: 14, fontWeight: on ? 800 : 700,
                display: 'inline-flex', alignItems: 'center', gap: 6, WebkitTapHighlightColor: 'transparent',
              }}>
              {c.name}
              {n && n.live > 0 && (
                <span aria-label={`진행 중 ${n.live}`} style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#5EEAD4' : TT.teal }} />
              )}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 2px' }}>
        <p style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: TT.muted, wordBreak: 'keep-all' }}>
          {layout.columns.find((c) => c.roundNo === round)?.name ?? ''} · 대진 {nodes.length}개
          {byes > 0 ? ` (경기 ${nodes.length - byes} · 부전승 ${byes})` : ''}
        </p>
        {byes > 0 && (
          <button type="button" aria-pressed={hideByes} data-ko-hide-byes onClick={() => setHideByes((v) => !v)}
            style={{
              minHeight: 36, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${hideByes ? TT.teal : TT.line}`, background: hideByes ? TT.tealSoft : TT.surface,
              color: hideByes ? TT.tealDeep : TT.inkSoft, fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
            }}>
            {hideByes ? '부전승 보기' : '부전승 숨기기'}
          </button>
        )}
      </div>

      {nodes.length === 0 ? (
        <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '22px 16px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: TT.muted }}>이 라운드는 아직 대진이 채워지지 않았습니다.</p>
        </div>
      ) : (
        <div className="tt-ko-list">
          {shown.map((n) => <RoundCard key={n.key} node={n} next={nextOf(n)} highlight={highlight === n.key} />)}
        </div>
      )}

      {isLastRound && champion && (
        <div data-ko-champion style={{
          borderRadius: 14, padding: '12px 14px', background: champion.champion ? '#FFFDF5' : TT.surface,
          border: `1px solid ${champion.champion ? '#EADFAE' : TT.line}`,
        }}>
          <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: champion.champion ? '#9A7B22' : TT.subtle }}>
            CHAMPION
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 800, color: champion.champion ? TT.ink : TT.faint, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
            {champion.champion
              ? champion.champion.primary
              : '아직 정해지지 않았습니다'}
          </p>
        </div>
      )}

      <style>{`
        .tt-ko-tabs::-webkit-scrollbar { display: none; }
        .tt-ko-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
        @media (min-width: 700px) { .tt-ko-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (min-width: 1100px) { .tt-ko-list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      `}</style>
    </div>
  );
}
