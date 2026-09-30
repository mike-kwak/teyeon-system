'use client';

// 공개 본선 대진표 렌더러 (Batch 4D-3) — 참가자 · 관람객 · read-only.
//
//   ⚠⚠ 대진을 계산하지 않는다. 서버가 준 topology 를 layoutBracket 이 좌표로 옮긴 결과를 그릴 뿐이다.
//     시드 · BYE 위치 · 대진 조합을 여기서 정하지 않는다.
//   ⚠ 모바일에서 글자를 줄여 억지로 한 화면에 넣지 않는다.
//     '전체 대진 면(surface)' 과 '보이는 창(viewport)' 을 분리하고, 좁으면 창 안에서만 가로로 움직인다.
//     (4D-4 에서 이 구조 위에 pan/zoom 을 얹는다 — 지금은 스크롤 fallback 만.)
//   ⚠ 진행 중 경기에 가짜 점수를 만들지 않는다. 우승은 서버가 확정했을 때만 표시한다.
//   ⚠ 새 디자인 시스템을 만들지 않는다 — 공개 Hub 토큰(TT)을 그대로 쓴다.

import React from 'react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import { layoutBracket, type BracketNode, type BracketSide } from '@/lib/tournaments/layoutBracket';
import {
  PUBLIC_KNOCKOUT_STATUS_TEXT, type PublicKnockoutBracket, type PublicKnockoutMatch,
} from '@/lib/tournaments/publicKnockoutTypes';

const CARD_W = 208;
const CARD_H = 78;

/** 경기 상태별 색. 진행 중만 강조하고 나머지는 차분하게 둔다. */
const statusTone = (m: PublicKnockoutMatch | null, bye: boolean): { label: string; color: string; bg: string } => {
  if (bye) return { label: '부전승 진출', color: '#B45309', bg: '#FFFBEB' };
  if (!m) return { label: '대기', color: TT.subtle, bg: TT.lineSoft };
  switch (m.status) {
    case 'playing':   return { label: '경기 중', color: TT.teal, bg: TT.tealSoft };
    case 'calling':   return { label: '호출 중', color: TT.tealDeep, bg: TT.tealSoft };
    case 'completed': return { label: '종료', color: '#047857', bg: '#ECFDF5' };
    default:          return { label: PUBLIC_KNOCKOUT_STATUS_TEXT.waiting, color: TT.muted, bg: TT.lineSoft };
  }
};

/** 카드 한쪽 줄. 이름은 줄이지 않고 두 줄까지 보여 준다(첫 글자 잘림 방지). */
function SideRow({ side, winner, dim }: { side: BracketSide | null; winner: boolean; dim: boolean }) {
  if (!side) {
    return (
      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: TT.faint, lineHeight: 1.35 }}>미정</p>
    );
  }
  const muted = side.kind === 'tbd' || side.kind === 'bye';
  return (
    <div style={{ minWidth: 0 }}>
      {/* 반영된 자리의 출처는 작은 보조 라벨로 남긴다 — 팀명이 주 표시다. */}
      {side.source && (
        <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 10, fontWeight: 700,
          letterSpacing: '0.04em', color: TT.subtle, lineHeight: 1.2 }}>
          {side.source}
        </p>
      )}
      <p style={{
        margin: 0, fontSize: 12.5, lineHeight: 1.35,
        fontWeight: winner ? 800 : muted ? 600 : 700,
        color: muted ? TT.subtle : dim ? TT.muted : winner ? TT.tealDeep : TT.ink,
        wordBreak: 'keep-all', overflowWrap: 'anywhere',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {side.teamNo != null && (
          <span style={{ color: TT.subtle, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {side.teamNo}.{' '}
          </span>
        )}
        {side.primary}
        {side.withdrawn && <span style={{ color: '#B91C1C', fontWeight: 700 }}> (기권)</span>}
      </p>
    </div>
  );
}

function MatchCard({ node }: { node: BracketNode }) {
  const m = node.match;
  const tone = statusTone(m, node.bye);
  const done = m?.status === 'completed';
  const win1 = done && m?.winnerSide === 1;
  const win2 = done && m?.winnerSide === 2;
  const court = m?.status === 'playing' ? (m.courtName || (m.courtNo ? `${m.courtNo}번 코트` : '')) : '';

  return (
    <div
      data-bracket-node={node.key}
      data-slot-a={node.a?.slotKey ?? ''}
      data-slot-b={node.b?.slotKey ?? ''}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height,
        boxSizing: 'border-box', background: TT.surface,
        border: `1px solid ${m?.status === 'playing' ? TT.teal : TT.line}`,
        borderRadius: 11, padding: '7px 9px',
        boxShadow: m?.status === 'playing' ? '0 2px 10px rgba(14,140,128,0.14)' : '0 1px 2px rgba(15,23,42,0.05)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
      {/* 머리: 경기 번호 · 상태 · 코트 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span style={{ fontFamily: FONT_LABEL, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
          color: TT.subtle, whiteSpace: 'nowrap' }}>
          {m ? `MATCH ${String(m.matchNo).padStart(2, '0')}` : 'MATCH –'}
        </span>
        <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 800, padding: '1.5px 6px', borderRadius: 999,
          background: tone.bg, color: tone.color, whiteSpace: 'nowrap' }}>
          {tone.label}
        </span>
        {court && (
          <span style={{ minWidth: 0, fontSize: 9.5, fontWeight: 700, color: TT.teal,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {court}
          </span>
        )}
      </div>

      {/* 두 참가자 · 점수는 종료일 때만 */}
      {[{ s: node.a, w: win1, sc: done ? m?.score1 : null },
        { s: node.b, w: win2, sc: done ? m?.score2 : null }].map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SideRow side={row.s} winner={row.w} dim={done && !row.w} />
          </div>
          {row.sc != null && (
            <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
              color: row.w ? TT.tealDeep : TT.subtle }}>
              {row.sc}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ChampionCard({ node }: { node: BracketNode }) {
  const c = node.champion;
  return (
    <div
      data-bracket-node={node.key}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height,
        boxSizing: 'border-box', borderRadius: 11, padding: '9px 11px',
        background: c ? '#FFFDF5' : TT.surface,
        border: `1px solid ${c ? '#EADFAE' : TT.line}`,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3,
      }}
    >
      <p style={{ margin: 0, fontFamily: FONT_LABEL, fontSize: 9.5, fontWeight: 700,
        letterSpacing: '0.12em', color: c ? '#9A7B22' : TT.subtle }}>
        CHAMPION
      </p>
      {c ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: TT.ink, lineHeight: 1.35,
          wordBreak: 'keep-all', overflowWrap: 'anywhere',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          <span style={{ color: TT.subtle, fontWeight: 700 }}>{c.teamNo}. </span>{c.primary}
        </p>
      ) : (
        // ⚠ 본선이 끝나기 전에는 우승자를 만들어 표시하지 않는다.
        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: TT.faint, lineHeight: 1.35 }}>
          아직 정해지지 않았습니다
        </p>
      )}
    </div>
  );
}

export default function PublicKnockoutBracket({ bracket }: { bracket: PublicKnockoutBracket }) {
  const layout = React.useMemo(
    () => layoutBracket(bracket, { cardWidth: CARD_W, cardHeight: CARD_H }),
    [bracket],
  );

  if (layout.empty) {
    return (
      <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14,
        padding: '26px 18px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: TT.ink, lineHeight: 1.5 }}>
          본선 대진이 아직 준비 중입니다.
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65 }}>
          대진이 채워지면 이곳에 표시됩니다.
        </p>
      </div>
    );
  }

  const live = bracket.matches.filter((m) => m.status === 'playing').length;
  const done = bracket.matches.filter((m) => m.status === 'completed').length;

  return (
    // ⚠ 넓은 화면에서만 본문 폭을 넘어 펼친다(tt-bracket-wide). 모바일은 그대로다.
    <div className="tt-bracket-wide">
      {/* 요약 — 대진 규모와 진행 상황 */}
      <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14,
        padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline',
        justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: TT.muted, wordBreak: 'keep-all' }}>
          {bracket.bracketTitle ?? '본선 토너먼트'} · {layout.columns.length}개 라운드
        </span>
        <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 600, color: TT.muted }}>
          {live > 0 && <strong style={{ color: TT.teal, fontWeight: 800 }}>진행 중 {live} · </strong>}
          경기 <strong style={{ fontSize: 16, fontWeight: 800, color: TT.ink,
            fontVariantNumeric: 'tabular-nums' }}>{done}</strong> / {bracket.matches.length}
        </span>
      </div>

      <p style={{ margin: '8px 2px 0', fontSize: 12, fontWeight: 600, color: TT.subtle,
        lineHeight: 1.6, wordBreak: 'keep-all' }}>
        좌우로 밀어서 전체 대진을 볼 수 있습니다. 아직 예선 결과가 반영되지 않은 자리는 ‘N조 M위’로 표시됩니다.
      </p>

      {/* ── 보이는 창(viewport) ─ 페이지가 아니라 이 안에서만 가로로 움직인다 ── */}
      <div
        role="region"
        aria-label="본선 대진표"
        tabIndex={0}
        style={{
          marginTop: 9, borderRadius: 14, border: `1px solid ${TT.line}`, background: TT.surface,
          overflowX: 'auto', overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain',
        }}
      >
        {/* ── 전체 대진 면(surface) ─ 논리 크기 그대로. 축소하지 않는다. ── */}
        <div style={{ position: 'relative', width: layout.width, height: layout.height, minWidth: '100%' }}>
          {/* 라운드 이름 */}
          {layout.columns.map((c) => (
            <div key={c.roundNo} style={{ position: 'absolute', left: c.x, top: 10, width: c.width,
              textAlign: 'center' }}>
              <span style={{
                display: 'inline-block', maxWidth: '100%', padding: '3px 9px', borderRadius: 999,
                background: c.isFinal ? '#FFFDF5' : TT.tint,
                color: c.isFinal ? '#9A7B22' : TT.inkSoft,
                fontFamily: FONT_LABEL, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {c.name}
              </span>
            </div>
          ))}

          {/* 연결선 — 카드 아래에 깔아 글자를 가리지 않게 한다 */}
          <svg width={layout.width} height={layout.height} aria-hidden="true"
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
            {layout.connectors.map((c) => (
              <path key={`${c.from}->${c.to}`} d={c.path} fill="none"
                stroke={TT.line} strokeWidth={1.5} strokeLinejoin="round" />
            ))}
          </svg>

          {layout.nodes.map((n) => (
            n.kind === 'champion'
              ? <ChampionCard key={n.key} node={n} />
              : <MatchCard key={n.key} node={n} />
          ))}
        </div>
      </div>
    </div>
  );
}
