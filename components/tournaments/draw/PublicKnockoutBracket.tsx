'use client';

// 공개 본선 대진표 (Batch 4D-3 렌더러 + 4D-4 이동 · 확대 · 검색) — 관람 전용.
//
//   ⚠⚠ 대진을 계산하지 않는다. 서버가 준 topology 를 layoutBracket 이 좌표로 옮긴 결과를 그릴 뿐이다.
//     시드 · BYE 위치 · 대진 조합 · 진출자를 여기서 정하지 않는다.
//   ⚠ 글자를 줄여 억지로 한 화면에 넣지 않는다. 보이는 창(viewport)과 전체 면(surface)을 분리하고
//     면을 transform 으로 옮긴다. 가로 스크롤 주인을 둘로 만들지 않는다(창은 overflow hidden).
//   ⚠ 페이지 세로 스크롤을 빼앗지 않는다(touch-action: pan-y).
//   ⚠ 진행 중 경기에 가짜 점수를 만들지 않는다. 우승은 서버가 확정했을 때만 표시한다.
//   ⚠ 경로 강조는 '이 자리에서 이어지는 대진 경로' 다. 그 팀이 이긴다는 뜻이 아니다.

import React from 'react';
import { Minus, Plus, Maximize2, RotateCcw, Search, X as XIcon } from 'lucide-react';
import { TT, FONT_LABEL } from '@/components/tournaments/tournamentTheme';
import { layoutBracket, type BracketNode, type BracketSide } from '@/lib/tournaments/layoutBracket';
import { searchBracket, downstreamPath, type BracketSearchResult } from '@/lib/tournaments/bracketSearch';
import {
  PUBLIC_KNOCKOUT_STATUS_TEXT, type PublicKnockoutBracket, type PublicKnockoutMatch,
} from '@/lib/tournaments/publicKnockoutTypes';
import { useBracketInteraction } from './useBracketInteraction';

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
    return <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: TT.faint, lineHeight: 1.35 }}>미정</p>;
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

interface CardProps { node: BracketNode; on: boolean; dim: boolean }

function MatchCard({ node, on, dim }: CardProps) {
  const m = node.match;
  const tone = statusTone(m, node.bye);
  const done = m?.status === 'completed';
  const win1 = done && m?.winnerSide === 1;
  const win2 = done && m?.winnerSide === 2;
  const court = m?.status === 'playing' ? (m.courtName || (m.courtNo ? `${m.courtNo}번 코트` : '')) : '';
  const live = m?.status === 'playing';

  return (
    <div
      data-bracket-node={node.key}
      data-slot-a={node.a?.slotKey ?? ''}
      data-slot-b={node.b?.slotKey ?? ''}
      data-highlight={on ? '1' : undefined}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height,
        boxSizing: 'border-box',
        background: on ? TT.tealSoft : TT.surface,
        border: `${on ? 2 : 1}px solid ${on ? TT.teal : live ? TT.teal : TT.line}`,
        borderRadius: 11, padding: on ? '6px 8px' : '7px 9px',
        boxShadow: live ? '0 2px 10px rgba(14,140,128,0.14)' : '0 1px 2px rgba(15,23,42,0.05)',
        opacity: dim ? 0.38 : 1,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
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

function ChampionCard({ node, on, dim }: CardProps) {
  const c = node.champion;
  return (
    <div
      data-bracket-node={node.key}
      data-highlight={on ? '1' : undefined}
      style={{
        position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height,
        boxSizing: 'border-box', borderRadius: 11, padding: '9px 11px',
        background: c ? '#FFFDF5' : on ? TT.tealSoft : TT.surface,
        border: `${on ? 2 : 1}px solid ${on ? TT.teal : c ? '#EADFAE' : TT.line}`,
        opacity: dim ? 0.38 : 1,
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

const ctrlBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  minWidth: 42, minHeight: 42, padding: '0 10px', borderRadius: 10,
  border: `1px solid ${TT.line}`, background: TT.surface, color: TT.inkSoft,
  fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
};

export default function PublicKnockoutBracket({
  bracket, updatedAt,
}: { bracket: PublicKnockoutBracket; updatedAt?: number | null }) {
  const layout = React.useMemo(
    () => layoutBracket(bracket, { cardWidth: CARD_W, cardHeight: CARD_H }),
    [bracket],
  );

  const {
    viewportRef, transform, dragging, zoomBy, fit, reset, focusRect, handlers,
  } = useBracketInteraction({ w: layout.width, h: layout.height });

  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);

  const results = React.useMemo(
    () => searchBracket(bracket, layout, query),
    [bracket, layout, query],
  );
  const path = React.useMemo(
    () => (selected ? downstreamPath(layout, selected) : null),
    [layout, selected],
  );

  // 데이터가 갱신돼 선택한 카드가 사라지면 선택만 조용히 해제한다(이동 · 확대는 유지).
  React.useEffect(() => {
    if (selected && !layout.nodes.some((n) => n.key === selected)) setSelected(null);
  }, [layout, selected]);

  const pick = React.useCallback((r: BracketSearchResult) => {
    const node = layout.nodes.find((n) => n.key === r.nodeKey);
    if (!node) return;
    setSelected(node.key);
    focusRect(node);
  }, [layout, focusRect]);

  const clearSearch = React.useCallback(() => { setQuery(''); setSelected(null); }, []);

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
    <div className="tt-bracket-wide" onKeyDown={(e) => { if (e.key === 'Escape') clearSearch(); }}>
      {/* 요약 */}
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

      {/* 검색 */}
      <label style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 9, height: 46,
        boxSizing: 'border-box', padding: '0 6px 0 13px', background: TT.surface,
        border: '1px solid #DCE2EA', borderRadius: 12 }}>
        <Search size={17} color={TT.muted} strokeWidth={2.3} style={{ flexShrink: 0 }} />
        <input
          id="knockout-search"
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
          placeholder="선수명, 팀 번호, 1조 1위"
          aria-label="본선 대진에서 선수 · 팀 · 예선 순위 찾기"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent',
            fontFamily: 'inherit', fontSize: 16, color: TT.ink }}
        />
        {query && (
          <button type="button" onClick={clearSearch} aria-label="검색어 지우기"
            style={{ flexShrink: 0, width: 36, height: 36, border: 0, borderRadius: 8,
              background: 'transparent', cursor: 'pointer' }}>
            <XIcon size={16} color={TT.muted} />
          </button>
        )}
      </label>

      {/* 검색 결과 — 검색어가 있을 때만 */}
      {query.trim() !== '' && (
        <div style={{ marginTop: 7, background: TT.surface, border: `1px solid ${TT.line}`,
          borderRadius: 12, overflow: 'hidden' }}>
          {results.length === 0 ? (
            <p style={{ margin: 0, padding: '12px 13px', fontSize: 12.5, fontWeight: 600, color: TT.muted }}>
              찾는 선수 · 팀이 없습니다.
            </p>
          ) : results.slice(0, 8).map((r) => (
            <button key={`${r.nodeKey}:${r.slotKey}`} type="button" onClick={() => pick(r)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 13px',
                border: 0, borderTop: `1px solid ${TT.lineSoft}`, background:
                  selected === r.nodeKey ? TT.tealSoft : 'transparent',
                cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: TT.ink,
                lineHeight: 1.4, wordBreak: 'keep-all' }}>
                {r.title}
              </span>
              <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, fontWeight: 600, color: TT.muted }}>
                {r.subtitle ? `${r.subtitle} · ` : ''}{r.roundName}
                {r.matchNo != null ? ` · ${r.matchNo}번 경기` : ''} · {r.statusText}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* 조작 */}
      <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <button type="button" style={ctrlBtn} onClick={() => zoomBy(1 / 1.2)} aria-label="대진표 축소">
          <Minus size={15} />
        </button>
        <button type="button" style={ctrlBtn} onClick={() => zoomBy(1.2)} aria-label="대진표 확대">
          <Plus size={15} />
        </button>
        <button type="button" style={ctrlBtn} onClick={fit} aria-label="전체 대진 맞춤">
          <Maximize2 size={14} />맞춤
        </button>
        <button type="button" style={ctrlBtn} onClick={reset} aria-label="대진표 초기화">
          <RotateCcw size={14} />초기화
        </button>
        {selected && (
          <button type="button" style={{ ...ctrlBtn, color: TT.tealDeep, borderColor: TT.teal }}
            onClick={() => setSelected(null)} aria-label="경로 보기 해제">
            경로 해제
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: TT.subtle,
          fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      <p style={{ margin: '7px 2px 0', fontSize: 12, fontWeight: 600, color: TT.subtle,
        lineHeight: 1.6, wordBreak: 'keep-all' }}>
        끌어서 이동하고 두 손가락으로 확대할 수 있습니다. 아직 예선 결과가 반영되지 않은 자리는 ‘N조 M위’로 표시됩니다.
      </p>

      {/* ── 보이는 창 ─ 페이지 세로 스크롤은 그대로 두고(가로 이동만 가져간다) ── */}
      <div
        ref={viewportRef}
        role="region"
        aria-label="본선 대진표"
        tabIndex={0}
        {...handlers}
        style={{
          marginTop: 9, height: 'clamp(380px, 62vh, 720px)',
          borderRadius: 14, border: `1px solid ${TT.line}`, background: TT.surface,
          position: 'relative', overflow: 'hidden',
          touchAction: 'pan-y',                 // 세로 스크롤은 브라우저에게 남긴다
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        {/* ── 전체 대진 면 ─ 논리 크기 그대로. 축소하지 않는다. ── */}
        <div style={{
          position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height,
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          transformOrigin: '0 0',
        }}>
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
            {layout.connectors.map((c) => {
              const key = `${c.from}->${c.to}`;
              const on = path?.connectors.has(key) ?? false;
              return (
                <path key={key} d={c.path} fill="none" data-connector={key}
                  data-highlight={on ? '1' : undefined}
                  stroke={on ? TT.teal : TT.line} strokeWidth={on ? 2.5 : 1.5}
                  strokeLinejoin="round" opacity={path && !on ? 0.4 : 1} />
              );
            })}
          </svg>

          {layout.nodes.map((n) => {
            const on = path?.nodes.has(n.key) ?? false;
            const dim = !!path && !on;
            return n.kind === 'champion'
              ? <ChampionCard key={n.key} node={n} on={on} dim={dim} />
              : <MatchCard key={n.key} node={n} on={on} dim={dim} />;
          })}
        </div>
      </div>

      {path && (
        <p style={{ margin: '7px 2px 0', fontSize: 11.5, fontWeight: 600, color: TT.muted,
          lineHeight: 1.6, wordBreak: 'keep-all' }}>
          이 자리에서 이어지는 대진 경로입니다. 아직 치르지 않은 경기의 진출을 뜻하지 않습니다.
        </p>
      )}
      {updatedAt != null && (
        // ⚠ 과한 LIVE 장치를 만들지 않는다 — 언제 받은 내용인지만 한 줄로 남긴다.
        <p style={{ margin: '5px 2px 0', fontSize: 11, fontWeight: 600, color: TT.faint }}>
          {new Date(updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
        </p>
      )}
    </div>
  );
}
