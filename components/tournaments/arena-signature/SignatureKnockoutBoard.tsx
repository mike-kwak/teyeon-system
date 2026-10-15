'use client';

// Signature — 본선 대진 보드 (/tournaments/arena-design/signature 전용).
//
//   [라운드 리본] 아래에 LEFT BRACKET → CENTER FINAL ← RIGHT BRACKET.
//   ⚠ 자리 · 연결 · BYE 칸 · 경기 매칭은 운영 Arena 와 같은 배치 함수(layoutMirroredBracket)의 결과다.
//     signatureModel 이 화면 좌표(열 폭 · 안쪽 칸 높이)만 다시 잡는다 — 자리를 옮기거나 경기를 만들지 않는다.
//   ⚠ 64강 · 32강은 '레인 판' 위에 경기마다 흰 경기 카드 한 장(외곽선 + 두 팀 사이 구분선)을 놓는다 — TV 실물 검수(10-16).
//     부전승 칸은 [팀 / BYE] 두 줄 카드다(BYE 는 상대가 없는 자리에). 그림자는 두지 않는다.
//     16강 이상은 팀마다 떨어진 알약으로 그린다. 오른쪽 가지는 점수 칸이 가운데를 향하도록 좌우를 뒤집는다.
//   ⚠ 점수는 끝난 경기에만 있다. 진행 중 경기는 점수 대신 노랑 LIVE 탭과 코트 번호를 보인다.
//   ⚠ V4: 승리 = 흰 칸 + 바깥쪽 Cobalt 줄 · Cobalt 점수 배지 · 굵은 글자(Navy 채움을 쓰지 않는다).
//     LIVE = Navy 칸 + Tennis Lime — 화면에서 가장 강한 표시는 LIVE 하나다.

import React from 'react';
import type { ArenaBracket, ArenaSlot } from '@/lib/tournaments/arenaTypes';
import { buildSignatureGeometry, fitTeamName, sideOf, teamNames } from './signatureModel';
import type { SigNode, SignatureGeometry } from './signatureModel';
import SignatureRoundRibbon from './SignatureRoundRibbon';
import { SignatureChampion, SignatureFinalAura, SignatureFinalBadge, SignatureTrophy } from './SignatureFinalStage';
import {
  SIG, SIG_FOCUS_BODY_HEIGHT, SIG_FOCUS_INNER_NODE_HEIGHT, SIG_FOCUS_TIERS, SIG_FONT_DISPLAY, SIG_LAYOUT, SIG_NAME_FLOOR,
  SIG_VIEW_TRANSITION_MS,
} from './signatureTheme';
import type { SignatureViewMode } from './signatureTheme';

/** 레인 줄 / 안쪽 알약 치수. */
const LANE = { padL: 10, padR: 6, chip: 26, chipH: 22, gap: 6, live: 40 };
const PILL = { padL: 8, padR: 4, chip: 24, chipH: 22, gap: 4, live: 34 };

/** 두 줄 이름이 줄 높이에 들어갈 최대 크기. */
const stackMaxFor = (rowH: number): number => Math.floor(((rowH - 2) / 2.12) * 2) / 2;

/** 부전승 카드 팀 줄 — 두 줄(줄 간격 1.04)이 하한 크기로 들어가면 그 최대 크기, 아니면 한 줄 전용(undefined). */
const byeStackMax = (rowH: number, base: number): number | undefined => {
  const size = Math.min(base, Math.floor((rowH / 2.08) * 2) / 2);
  return size >= SIG_NAME_FLOOR ? size : undefined;
};

type RowLook = 'win' | 'lose' | 'team' | 'ghost' | 'bye';

function lookOf(slot: ArenaSlot, winner: boolean, loser: boolean): RowLook {
  if (winner) return 'win';
  if (loser) return 'lose';
  if (slot.team) return 'team';
  if (slot.kind === 'qualifier') return 'team';
  if (slot.kind === 'bye') return 'bye';
  return 'ghost';
}

function NameLines({ names, width, base, min, stackMax, abbreviate, color, weight, italic, kind, rowHeight }: {
  names: string[]; width: number; base: number; min: number; stackMax?: number; abbreviate: boolean; rowHeight: number;
  color: string; weight: number; italic?: boolean; kind: string;
}) {
  const fit = fitTeamName(names, width, { base, min, stackMax, allowAbbreviation: abbreviate, rowHeight: abbreviate ? undefined : rowHeight });
  return (
    <span data-sig-name={kind} data-abbr={fit.abbreviated ? '1' : undefined} title={fit.abbreviated ? names.join(' · ') : undefined}
      style={{
        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        fontSize: fit.fontSize, fontWeight: weight, color, lineHeight: fit.lines.length > 1 ? 1.04 : 1.12,
        letterSpacing: '-0.015em', fontStyle: italic ? 'italic' : 'normal',
      }}>
      {fit.lines.map((l, i) => (
        <span key={i} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l}</span>
      ))}
    </span>
  );
}

/**
 * 한 팀 줄(레인) 또는 한 팀 알약(안쪽).
 *   레인(64강 · 32강) 줄은 경기 카드(MatchCard) 안에 들어간다 — 줄마다 테두리를 두지 않고 카드 외곽선 · 구분선이 경계를 맡는다.
 */
function TeamRow({ node, index, height, rowWidth, geometry }: {
  node: SigNode; index: number; height: number; rowWidth: number; geometry: SignatureGeometry;
}) {
  const slot = node.feeders[index].slot;
  const { score, winner, loser } = sideOf(node.match, index);
  const look = lookOf(slot, winner, loser);
  const mirrored = node.side === 'right';
  const d = node.lane ? LANE : PILL;
  // 진행 중이면 점수 칸이 없다(노랑 LIVE 탭이 따로 있다) — 그 폭을 이름에 준다.
  const playing = node.match?.status === 'playing';
  const nameWidth = rowWidth - d.padL - d.padR - (playing ? 0 : d.chip + d.gap);
  const names = slot.team ? teamNames(slot)
    : slot.kind === 'qualifier' ? [slot.sourceLabel ?? '예선 진출']
      : slot.kind === 'bye' ? ['BYE'] : [];
  const tier = geometry.tier;
  const base = node.lane ? tier.nameBase : 17;
  const min = node.lane ? tier.nameMin : 14.5;

  // V4: 승리는 Navy 채움 대신 흰 칸 + 바깥쪽 Cobalt 줄 + Cobalt 점수 배지 + 굵은 글자로 절제해 구분한다.
  const grouped = node.lane;
  const bg = look === 'win' ? '#F5F8FD'
    : look === 'bye' ? SIG.byeFill
      : look === 'ghost' ? (grouped ? SIG.tbdFill : SIG.ghost)
        : look === 'lose' ? (grouped ? '#FBFAF7' : 'rgba(255,255,255,0.86)')
          : SIG.white;
  const color = look === 'win' ? SIG.ink : look === 'lose' ? SIG.muted : look === 'bye' ? SIG.byeInk : SIG.ink;
  const edge = look === 'win' ? `inset ${mirrored ? -3 : 3}px 0 0 ${SIG.royal}` : null;
  const lift = node.inner && look !== 'ghost' ? SIG.shadowPill : null;
  const lined = grouped ? 'none'
    : look === 'ghost' ? `1px solid ${SIG.ghostBorder}` : look === 'win' ? 'none' : `1px solid ${SIG.lineSoft}`;

  return (
    <div data-sig-slot={slot.id} data-slot-kind={slot.kind} data-row-result={winner ? 'win' : loser ? 'lose' : 'none'}
      style={{
        height, boxSizing: 'border-box', display: 'flex', flexDirection: mirrored ? 'row-reverse' : 'row',
        alignItems: 'center', gap: d.gap,
        padding: mirrored ? `0 ${d.padL}px 0 ${d.padR}px` : `0 ${d.padR}px 0 ${d.padL}px`,
        background: bg, borderRadius: grouped ? 0 : 6,
        border: lined,
        boxShadow: [edge, lift].filter(Boolean).join(', ') || 'none',
        opacity: slot.team?.withdrawn ? 0.45 : 1,
      }}>
      {names.length > 0 ? (
        <NameLines names={names} width={nameWidth} base={base} min={min}
          // 두 줄 이름이 옆 칸 한 줄 이름보다 커지지 않게 — 기본 크기에서 멈춘다(코트 미포함의 높은 알약에서도 같은 글자 크기).
          stackMax={Math.min(stackMaxFor(height), base)} rowHeight={height}
          abbreviate={node.lane} color={color} weight={look === 'win' ? 900 : look === 'lose' ? 600 : 700}
          italic={slot.kind === 'qualifier'} kind={node.lane ? 'lane' : 'inner'} />
      ) : <span style={{ flex: 1 }} />}
      {score !== null && (
        <span style={{
          width: d.chip, height: d.chipH, flexShrink: 0, borderRadius: 4, display: 'grid', placeItems: 'center',
          background: winner ? SIG.royal : SIG.loserChip, color: winner ? '#FFFFFF' : SIG.muted,
          fontFamily: SIG_FONT_DISPLAY, fontSize: 15, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
        }}>
          {score}
        </span>
      )}
    </div>
  );
}

/** 진행 중 — Navy 세로 칸(두 팀에 걸침) + Tennis Lime 글자. 점수 대신 코트를 적는다. */
function LiveTab({ node, width }: { node: SigNode; width: number }) {
  const m = node.match!;
  return (
    <div data-sig-live="1" style={{
      width, flexShrink: 0, alignSelf: 'stretch', background: SIG.navy, borderRadius: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
      fontFamily: SIG_FONT_DISPLAY, boxShadow: `inset 0 -3px 0 ${SIG.live}`,
    }}>
      <span style={{ fontStyle: 'italic', fontSize: 11.5, fontWeight: 900, letterSpacing: '0.04em', color: SIG.live }}>LIVE</span>
      {m.courtNo !== null && <span style={{ fontSize: 14, fontWeight: 900, color: '#FFFFFF' }}>C{m.courtNo}</span>}
    </div>
  );
}

function MatchNode({ node, geometry }: { node: SigNode; geometry: SignatureGeometry }) {
  const match = node.match;
  const playing = match?.status === 'playing';
  const mirrored = node.side === 'right';
  const data = {
    'data-knockout-node': node.key,
    'data-side': node.side,
    'data-column': node.column,
    'data-status': match ? match.status : node.compact ? 'bye' : 'none',
    'data-target-slot': node.targetSlot.id,
  };
  const box: React.CSSProperties = {
    position: 'absolute', left: node.x, top: node.y, width: node.width, height: node.height, boxSizing: 'border-box',
  };

  // 부전승 칸 — TV 실물 검수(10-16): 'BYE' 를 팀 이름 옆 작은 배지가 아니라 '상대가 없는 자리' 에 둔다.
  //   [올라가는 팀]
  //   [BYE]          ← 중립 연회색 줄. 두 줄이 한 장의 경기 카드로 묶인다.
  //   ⚠ BYE 는 서버가 저장한 slot_type = 'bye' 자리에만 쓴다(빈 자리 · TBD 를 BYE 로 보지 않는다).
  //   ⚠ 자리 순서는 저장된 순서(position) 그대로 — 위 · 아래를 바꾸지 않는다. 승자를 새로 계산하지 않는다.
  //   ⚠ 칸 높이는 배치 함수가 준 부전승 칸 높이 그대로다(대진 좌표 · 연결선 불변). 안에서 팀 줄 / BYE 줄로 나눌 뿐이다.
  if (node.compact) {
    // BYE 줄은 짧은 한 단어라 낮게(11~14px) — 남는 높이를 팀 줄에 줘서 긴 이름이 두 줄로 끝까지 보이게 한다.
    const byeH = Math.min(14, Math.max(11, Math.round(node.height * 0.26)));
    const inner = node.height - 2;                       // 카드 외곽선 위아래 1px
    const byeCount = node.feeders.filter((f) => f.slot.kind === 'bye').length;
    // 팀 줄과 BYE 줄 사이에는 선을 두지 않는다 — BYE 줄의 회색 바탕이 경계다(그 1px 를 팀 줄 높이에 준다).
    const teamH = node.feeders.length - byeCount > 0
      ? (inner - byeH * byeCount) / (node.feeders.length - byeCount)
      : 0;
    const rowW = node.width - 2;
    const filled = node.feeders.some((f) => !!f.slot.team || f.slot.kind === 'qualifier');
    return (
      <div {...data} data-sig-bye="1" data-sig-match-card="bye" data-sig-raised={node.lane && filled ? '1' : '0'} style={{
        ...box, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRadius: 6, background: SIG.white,
        border: `1px solid ${node.lane && filled ? SIG.matchBorder : SIG.ghostBorder}`,
        boxShadow: node.lane && filled ? SIG.shadowMatch : 'none',
      }}>
        {node.feeders.map((f, i) => {
          const divider = i > 0 && f.slot.kind !== 'bye' && node.feeders[i - 1].slot.kind !== 'bye'
            ? <div aria-hidden style={{ height: 1, flexShrink: 0, background: SIG.matchDivider }} /> : null;
          if (f.slot.kind === 'bye') {
            return (
              <React.Fragment key={f.slot.id}>
                {divider}
                <div data-sig-slot={f.slot.id} data-slot-kind="bye" data-sig-bye-row="1" style={{
                  height: byeH, flexShrink: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
                  padding: `0 ${LANE.padR}px 0 ${LANE.padL}px`, background: SIG.byeFill,
                  fontFamily: SIG_FONT_DISPLAY, fontSize: Math.min(12.5, byeH - 1.5), fontWeight: 900,
                  letterSpacing: '0.14em', lineHeight: 1, color: SIG.byeInk,
                }}>
                  BYE
                </div>
              </React.Fragment>
            );
          }
          const names = teamNames(f.slot).length > 0 ? teamNames(f.slot)
            : f.slot.kind === 'qualifier' ? [f.slot.sourceLabel ?? '예선 진출'] : [];
          return (
            <React.Fragment key={f.slot.id}>
              {divider}
              <div data-sig-slot={f.slot.id} data-slot-kind={f.slot.kind} style={{
                height: teamH, flexShrink: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
                padding: `0 ${LANE.padR}px 0 ${LANE.padL}px`,
                background: names.length > 0 ? SIG.white : SIG.tbdFill,
                opacity: f.slot.team?.withdrawn ? 0.45 : 1,
              }}>
                {names.length > 0 ? (
                  <NameLines names={names} width={rowW - LANE.padL - LANE.padR} base={geometry.tier.nameBase}
                    // 두 줄(하한 12.5px × 줄 간격 1.04)이 들어가면 선수별 두 줄, 아니면 한 줄로만 맞춘다(하한까지 줄인 뒤 영문만 축약).
                    min={byeStackMax(teamH, geometry.tier.nameBase) !== undefined ? geometry.tier.nameMin : SIG_NAME_FLOOR}
                    stackMax={byeStackMax(teamH, geometry.tier.nameBase)}
                    rowHeight={teamH} abbreviate={node.lane}
                    color={SIG.ink} weight={700} italic={f.slot.kind === 'qualifier'} kind={node.lane ? 'lane' : 'inner'} />
                ) : <span style={{ flex: 1 }} />}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  const d = node.lane ? LANE : PILL;
  const n = Math.max(node.feeders.length, 1);
  const liveW = playing ? d.live : 0;
  const rowsW = node.width - (playing ? liveW + 3 : 0);

  // 64강 · 32강 — 같은 경기의 두 팀을 흰 경기 카드 한 장으로 묶는다(외곽선 + 두 팀 사이 1px 구분선).
  //   경기와 경기 사이는 어두워진 레인 판이 드러나 경계가 된다. 칸 크기 · 좌표는 그대로다.
  if (node.lane) {
    const rowH = (node.height - 2 - (n - 1)) / n;
    // 두 자리 모두 아직 비어 있는 경기(TBD)는 그림자 없이 옅은 외곽선만 — 실제 경기 카드처럼 떠 보이지 않게.
    const filled = node.feeders.some((f) => !!f.slot.team || f.slot.kind === 'qualifier');
    return (
      <div {...data} style={{
        ...box, display: 'flex', flexDirection: mirrored ? 'row-reverse' : 'row', gap: playing ? 3 : 0,
        borderRadius: 6,
        outline: playing ? `2px solid ${SIG.navy}` : 'none', outlineOffset: playing ? 1 : 0,
      }}>
        <div data-sig-match-card="match" data-sig-raised={filled ? '1' : '0'} style={{
          width: rowsW, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          borderRadius: 6, background: SIG.white, border: `1px solid ${filled ? SIG.matchBorder : SIG.ghostBorder}`,
          boxShadow: filled ? SIG.shadowMatch : 'none',
        }}>
          {node.feeders.map((f, i) => (
            <React.Fragment key={f.slot.id}>
              {i > 0 && <div aria-hidden data-sig-pair-divider="1" style={{ height: 1, flexShrink: 0, background: SIG.matchDivider }} />}
              <TeamRow node={node} index={i} height={rowH} rowWidth={rowsW - 2} geometry={geometry} />
            </React.Fragment>
          ))}
        </div>
        {playing && <LiveTab node={node} width={liveW} />}
      </div>
    );
  }

  const gap = 8;
  const rowH = (node.height - gap * (n - 1)) / n;

  return (
    <div {...data} style={{
      ...box, display: 'flex', flexDirection: mirrored ? 'row-reverse' : 'row', gap: playing ? 3 : 0,
      borderRadius: 6,
      outline: playing ? `2px solid ${SIG.navy}` : 'none', outlineOffset: playing ? 1 : 0,
    }}>
      <div style={{ width: rowsW, display: 'flex', flexDirection: 'column', gap }}>
        {node.feeders.map((f, i) => (
          <TeamRow key={f.slot.id} node={node} index={i} height={rowH} rowWidth={rowsW} geometry={geometry} />
        ))}
      </div>
      {playing && <LiveTab node={node} width={liveW} />}
    </div>
  );
}

export interface SignatureKnockoutBoardProps {
  bracket: ArenaBracket | null;
  width: number;
  /** courts = 코트 포함(본문 744) · focus = 코트 미포함(본문 904, 세로만 넓힌다). */
  viewMode?: SignatureViewMode;
}

export default function SignatureKnockoutBoard({ bracket, width, viewMode = 'courts' }: SignatureKnockoutBoardProps) {
  const focus = viewMode === 'focus';
  const geometry = React.useMemo(() => buildSignatureGeometry(bracket, focus
    ? { bodyHeight: SIG_FOCUS_BODY_HEIGHT, tiers: SIG_FOCUS_TIERS, innerNodeHeight: SIG_FOCUS_INNER_NODE_HEIGHT }
    : {}), [bracket, focus]);
  const bodyH = focus ? SIG_FOCUS_BODY_HEIGHT : SIG_LAYOUT.bodyHeight;
  // 자리잡기 페이드는 '모드를 바꿨을 때만' — 처음 열 때(새로고침 포함)는 바로 완성된 화면을 보인다.
  const [switched, setSwitched] = React.useState(false);
  const firstMode = React.useRef(viewMode);
  if (!switched && viewMode !== firstMode.current) setSwitched(true);
  const head = SIG_LAYOUT.ribbonHeight + SIG_LAYOUT.ribbonGap;

  if (!bracket || geometry.empty) {
    return (
      <div data-arena-board="knockout" style={{ width, height: head + bodyH, display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 20, fontWeight: 800, color: SIG.muted }}>본선 대진이 아직 없습니다.</span>
      </div>
    );
  }

  // ⚠ 키우지 않는다(배율 1 이 설계 기준). 넘칠 때만 줄인다.
  const scale = Math.min(1, width / geometry.width, bodyH / geometry.height);
  const innerH = (head + bodyH) / scale;
  const bodyTop = head + (bodyH / scale - geometry.height) / 2;

  return (
    <div data-arena-board="knockout" data-board-scale={scale.toFixed(3)} data-board-tier={geometry.tier.id}
      data-view-mode={viewMode}
      style={{ position: 'relative', width, height: head + bodyH }}>
      {/* ⚠ 모드가 바뀌면 칸들은 처음부터 새 최종 좌표에 놓인다. 상자 전체만 옅게 나타나므로(투명도만)
           전환 중에도 이름 · 점수 · 연결선이 서로 어긋나지 않는다. */}
      <div key={viewMode} data-sig-motion="settle" style={{
        position: 'absolute', left: (width - geometry.width) / 2, top: 0, width: geometry.width, height: innerH,
        transform: `scale(${scale})`, transformOrigin: 'top center',
        animation: switched ? `sigBoardSettle ${SIG_VIEW_TRANSITION_MS}ms ease-out both` : 'none',
      }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: geometry.width, height: SIG_LAYOUT.ribbonHeight }}>
          <SignatureRoundRibbon geometry={geometry} bracket={bracket} />
        </div>

        <div style={{ position: 'absolute', left: 0, top: bodyTop, width: geometry.width, height: geometry.height }}>
          {geometry.lanes.map((l, i) => (
            <div key={i} aria-hidden data-sig-lane="1" style={{
              position: 'absolute', left: l.x, top: l.y, width: l.width, height: l.height, borderRadius: 10,
              background: SIG.lane, border: `1px solid ${SIG.laneBorder}`, boxSizing: 'border-box',
              boxShadow: '0 2px 10px rgba(20, 35, 74, 0.06)',
            }} />
          ))}
          <svg width={geometry.width} height={geometry.height} aria-hidden
            style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
            {/* 흰 띠를 먼저 깔고 그 위에 선을 그린다 — 관중석 · 코트 위에서도 대비가 남는다. */}
            {geometry.connectors.map((c) => (
              <path key={`halo:${c.key}`} d={c.path} fill="none" stroke={SIG.connectorHalo}
                strokeWidth={c.advanced ? 6 : 4.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {geometry.connectors.map((c) => (
              <path key={c.key} d={c.path} fill="none" data-connector-done={c.advanced ? '1' : '0'}
                data-from={c.fromNodeKey} data-to={c.toNodeKey}
                stroke={c.advanced ? SIG.royal : SIG.connectorIdle} strokeWidth={c.advanced ? 2.6 : 1.6}
                strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </svg>
          {geometry.final && geometry.trophy && <SignatureFinalAura final={geometry.final} trophy={geometry.trophy} />}
          {geometry.trophy && <SignatureTrophy rect={geometry.trophy} />}
          {geometry.nodes.filter((n) => n.column !== 0).map((n) => <MatchNode key={n.key} node={n} geometry={geometry} />)}
          {geometry.final && <SignatureFinalBadge node={geometry.final} />}
          {geometry.champion && geometry.champion.team && (
            <SignatureChampion rect={geometry.champion} team={geometry.champion.team} />
          )}
        </div>
      </div>
    </div>
  );
}
