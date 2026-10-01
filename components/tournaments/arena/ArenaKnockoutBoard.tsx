'use client';

// Arena — 중앙 수렴형 본선 보드 (Batch 4E-3).
//
//   LEFT BRACKET → CENTER FINAL ← RIGHT BRACKET
//   16:9 TV 에서 시선이 가운데 결승으로 모이도록 양쪽 가지를 마주 보게 놓는다.
//
//   ⚠ 배치는 4E-0 의 layoutMirroredBracket() 결과를 **그대로** 쓴다.
//     여기서 자리를 옮기거나, 없는 경기를 만들거나, 좌우를 맞추려고 보정하지 않는다.
//   ⚠ 승자를 예측하지 않는다. 우승은 저장된 우승 자리에 팀이 올라왔을 때만 보여 준다.
//   ⚠ TV 화면이다 — 끌기 · 확대 · 검색을 두지 않는다. 한 화면에 전부 담고 끝낸다.
//   ⚠ 색은 두 가지 뿐이다. 진행 중 = TEYEON Aqua, 결승·우승 = 절제된 Soft Gold.

import React from 'react';
import { layoutMirroredBracket } from '@/lib/tournaments/layoutMirroredBracket';
import type {
  MirroredLayout, MirroredNode, MirroredNodeFeeder,
} from '@/lib/tournaments/layoutMirroredBracket';
import { ARENA, ARENA_FONT_LABEL } from './arenaTheme';
import type { ArenaBracket, ArenaKnockoutMatch, ArenaSlot } from '@/lib/tournaments/arenaTypes';

/** 라운드 이름 줄 높이(배치 좌표계). */
const HEADER_H = 26;
const PAD = 18;

/**
 * 배치 치수.
 *   바깥 라운드는 촘촘하게, 가운데 결승은 크게. 40팀 규모가 1920 한 화면에 들어가도록 잡았다.
 */
const LAYOUT_OPTIONS = {
  cardWidth: 138,
  cardHeight: 38,
  compactHeight: 26,
  rowGap: 5,
  columnGap: 12,
  padding: 8,
  finalWidth: 270,
  finalHeight: 110,
  championHeight: 100,
  championGap: 16,
};

/**
 * 작은 대진(8자리 등)은 화면이 남아 돈다 — 그만큼 키워 TV 에서 읽히게 한다.
 * 다만 한없이 키우면 카드 몇 장이 화면을 차지하므로 상한을 둔다.
 */
const MAX_BOARD_SCALE = 1.6;

/** 가운데로 갈수록 정보를 더 보여 준다. */
type Density = 'far' | 'mid' | 'final';
const densityOf = (node: MirroredNode): Density =>
  node.column === 0 ? 'final' : node.column <= 2 ? 'mid' : 'far';

// ⚠ 두 줄 + 여백이 칸 높이(cardHeight 38 · finalHeight 110) 안에 반드시 들어가야 한다.
//    넘치면 글자가 잘리거나 옆 칸을 침범한다.
const FONT: Record<Density, { name: number; meta: number; score: number }> = {
  // 바깥 라운드는 팀 번호를 빼서 생긴 폭만큼 이름을 키운다(글자를 더 줄이지 않는다).
  far: { name: 12, meta: 9, score: 12 },
  mid: { name: 12, meta: 9, score: 13 },
  final: { name: 17, meta: 11, score: 22 },
};

const teamLabel = (slot: ArenaSlot): string => {
  if (!slot.team) return '';
  const names = [slot.team.player1Name, slot.team.player2Name].filter((s) => s.trim() !== '');
  return names.length > 0 ? names.join(' · ') : `${slot.team.teamNo ?? ''}번 팀`;
};

/** 경기에서 이 자리(1/2번) 쪽 점수. 경기가 없으면 null. */
function sideOf(match: ArenaKnockoutMatch | null, index: number): {
  score: number | null; winner: boolean;
} {
  if (!match || match.status !== 'completed') return { score: null, winner: false };
  const score = index === 0 ? match.score1 : match.score2;
  const other = index === 0 ? match.score2 : match.score1;
  const winner = score !== null && other !== null && score > other;
  return { score, winner };
}

/** 자리 한 줄 — 팀 · 예선 통과 예정 · 승자 대기 · 부전승.
 *   ⚠ 줄 높이가 칸 높이를 넘지 않게 한다. 넘치면 옆 칸과 겹쳐 보인다.
 *   ⚠ 진행 중 경기는 점수가 없으므로 그 자리에 코트를 적는다(높이를 더 쓰지 않는다).
 */
function FeederRow({
  feeder, index, match, density, mirrored,
}: {
  feeder: MirroredNodeFeeder; index: number; match: ArenaKnockoutMatch | null;
  density: Density; mirrored: boolean;
}) {
  const slot = feeder.slot;
  const f = FONT[density];
  const { score, winner } = sideOf(match, index);
  const playing = match?.status === 'playing';

  // 자리 종류를 뭉개지 않는다 — 예선 대기 / 승자 대기 / 부전승은 서로 다른 상태다.
  const isTeam = slot.team !== null;
  const main = isTeam ? teamLabel(slot)
    : slot.kind === 'qualifier' ? (slot.sourceLabel ?? '예선 진출')
    : slot.kind === 'bye' ? '부전승'
    : '승자 대기';

  const tone = isTeam
    ? (winner ? ARENA.ink : playing ? ARENA.ink : ARENA.inkSoft)
    : slot.kind === 'bye' ? ARENA.faint
    : ARENA.muted;

  // 진행 중 경기의 코트는 둘째 줄 끝(점수 자리)에 작게 붙인다.
  //   ⚠ 결승은 머리말에 이미 코트를 적으므로 여기서는 쓰지 않는다(중복 금지).
  const courtTag = playing && index === 1 && match && density !== 'final'
    ? (match.courtName ?? (match.courtNo !== null ? `COURT ${match.courtNo}` : null))
    : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0,
      lineHeight: 1.15,
      flexDirection: mirrored ? 'row-reverse' : 'row',
      opacity: slot.team?.withdrawn ? 0.45 : 1,
    }}>
      {/* 팀 번호는 보조 정보다 — 바깥 라운드에서는 빼고 그 폭을 팀명에 준다. */}
      {isTeam && density !== 'far' && slot.team?.teamNo !== null && (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: f.meta, fontWeight: 700,
          color: ARENA.faint, flexShrink: 0,
        }}>
          {slot.team?.teamNo}
        </span>
      )}

      <span style={{
        flex: 1, minWidth: 0,
        fontSize: f.name,
        fontWeight: winner ? 800 : isTeam ? 600 : 500,
        color: tone,
        fontStyle: isTeam ? 'normal' : 'italic',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        textAlign: mirrored ? 'right' : 'left',
      }}>
        {main}
      </span>

      {/* 예선 결과가 반영돼도 출처는 지우지 않는다. */}
      {isTeam && slot.sourceLabel && density !== 'far' && (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: f.meta, fontWeight: 600,
          color: ARENA.faint, flexShrink: 0,
        }}>
          {slot.sourceLabel}
        </span>
      )}

      {score !== null && (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: f.score, fontWeight: winner ? 800 : 600,
          color: winner ? ARENA.ink : ARENA.muted,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          minWidth: density === 'final' ? 24 : 14,
          textAlign: mirrored ? 'left' : 'right',
        }}>
          {score}
        </span>
      )}

      {courtTag && (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: f.meta, fontWeight: 700,
          letterSpacing: '0.06em', color: ARENA.teal, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {courtTag}
        </span>
      )}
    </div>
  );
}

function MatchCard({ node }: { node: MirroredNode }) {
  const density = densityOf(node);
  const f = FONT[density];
  const match = node.match;
  const playing = match?.status === 'playing';
  const isFinal = density === 'final';
  const mirrored = node.side === 'right';

  // 부전승처럼 경기가 없는 칸은 낮고 조용하게.
  const quiet = node.compact;
  // 공급 자리에 팀이 하나도 없고 전부 부전승이면 — 아직 아무도 오지 않은 구간이다.
  //   줄을 두 개 적어 봐야 '부전승 / 부전승' 이 반복될 뿐이라 한 줄로 줄인다.
  //   ⚠ 칸과 연결선 자체는 그대로 둔다(구조를 지운 것이 아니다).
  const allBye = node.feeders.length > 0
    && node.feeders.every((f) => f.slot.kind === 'bye');
  /** 한쪽만 부전승 — 올라가는 자리 하나만 보여 준다(칸이 낮아 두 줄이 들어가지 않는다). */
  const byeAdvance = quiet && !allBye;
  const advancing = byeAdvance
    ? node.feeders.find((f) => f.slot.kind !== 'bye') ?? null
    : null;

  return (
    <div
      data-knockout-node={node.key}
      data-side={node.side}
      data-column={node.column}
      data-status={match ? match.status : 'none'}
      style={{
        position: 'absolute',
        left: node.x, top: node.y, width: node.width, height: node.height,
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        gap: isFinal ? 8 : 2,
        padding: isFinal ? '10px 18px' : '2px 8px',
        overflow: 'hidden',                 // 내용이 칸 밖으로 새어 옆 칸과 겹치지 않게
        background: isFinal ? ARENA.goldSoft : playing ? '#E9F7F4' : ARENA.surface,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: isFinal ? ARENA.gold : playing ? ARENA.teal : ARENA.boardLine,
        borderRadius: isFinal ? 10 : 5,
        borderLeftWidth: playing && !isFinal && !mirrored ? 3 : 1,
        borderRightWidth: playing && !isFinal && mirrored ? 3 : 1,
        borderLeftColor: playing && !mirrored ? ARENA.teal : isFinal ? ARENA.gold : playing ? ARENA.teal : ARENA.boardLine,
        borderRightColor: playing && mirrored ? ARENA.teal : isFinal ? ARENA.gold : playing ? ARENA.teal : ARENA.boardLine,
      }}
    >
      {/* 머리말은 결승에만 둔다 — 다른 칸은 두 줄만으로 높이를 지켜야 한다.
          진행 중은 Aqua 테두리·바탕과 둘째 줄의 코트 표시로 알린다. */}
      {isFinal && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
        }}>
          <span style={{
            fontFamily: ARENA_FONT_LABEL, fontSize: 13, fontWeight: 700,
            letterSpacing: '0.2em', color: ARENA.gold,
          }}>
            FINAL
          </span>
          {playing && match && (match.courtName || match.courtNo !== null) && (
            <span style={{
              fontFamily: ARENA_FONT_LABEL, fontSize: 12, fontWeight: 700,
              color: ARENA.teal, whiteSpace: 'nowrap',
            }}>
              {match.courtName ?? `COURT ${match.courtNo}`}
            </span>
          )}
        </div>
      )}

      {allBye ? (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: f.meta, fontWeight: 600,
          color: ARENA.faint, textAlign: mirrored ? 'right' : 'left',
        }}>
          부전승
        </span>
      ) : byeAdvance && advancing ? (
        // 한쪽이 부전승이면 '이 팀이 경기 없이 올라간다' 는 한 줄이면 충분하다.
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0,
          flexDirection: mirrored ? 'row-reverse' : 'row',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FeederRow feeder={advancing} index={0} match={null} density={density} mirrored={mirrored} />
          </div>
          <span style={{
            fontFamily: ARENA_FONT_LABEL, fontSize: f.meta, fontWeight: 600,
            color: ARENA.faint, flexShrink: 0,
          }}>
            부전승
          </span>
        </div>
      ) : (
        node.feeders.map((feeder, i) => (
          <FeederRow key={feeder.slot.id} feeder={feeder} index={i}
            match={match} density={density} mirrored={mirrored} />
        ))
      )}
    </div>
  );
}

/** 우승 — 저장된 우승 자리에 팀이 올라온 뒤에만 나온다. */
function ChampionPanel({ layout }: { layout: MirroredLayout }) {
  const c = layout.champion;
  if (!c || !c.decided || !c.team) return null;
  const names = [c.team.player1Name, c.team.player2Name].filter((s) => s.trim() !== '').join(' · ');
  return (
    <div
      data-knockout-champion="1"
      style={{
        position: 'absolute', left: c.x, top: c.y, width: c.width, height: c.height,
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 5, padding: '10px 16px',
        background: ARENA.surface,
        border: `1px solid ${ARENA.gold}`,
        borderRadius: 10,
        overflow: 'hidden',                 // 긴 이름이 패널 밖으로 새지 않게
      }}
    >
      <span style={{
        fontFamily: ARENA_FONT_LABEL, fontSize: 12, fontWeight: 700, lineHeight: 1.2,
        letterSpacing: '0.24em', color: ARENA.gold,
      }}>
        CHAMPION
      </span>
      <span style={{
        fontSize: 19, fontWeight: 800, color: ARENA.ink, textAlign: 'center', lineHeight: 1.25,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
      }}>
        {names}
      </span>
      {c.team.teamNo !== null && (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: 11, fontWeight: 700,
          lineHeight: 1.2, color: ARENA.faint,
        }}>
          TEAM {c.team.teamNo}
        </span>
      )}
    </div>
  );
}

export interface ArenaKnockoutBoardProps {
  bracket: ArenaBracket | null;
  /** 보드 안쪽 크기(1920 캔버스 좌표). */
  width: number;
  height: number;
}

export default function ArenaKnockoutBoard({ bracket, width, height }: ArenaKnockoutBoardProps) {
  // 구조가 그대로면 다시 계산하지 않는다(점수·상태만 바뀌어도 좌표는 그대로다).
  const layout = React.useMemo(
    () => layoutMirroredBracket(bracket, LAYOUT_OPTIONS),
    [bracket],
  );

  if (!bracket || layout.empty) {
    return (
      <div data-arena-board="knockout" style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: ARENA.muted }}>
          본선 대진이 아직 없습니다.
        </span>
      </div>
    );
  }

  const contentW = layout.width;
  const contentH = layout.height + HEADER_H;
  const scale = Math.min(
    (width - PAD * 2) / contentW,
    (height - PAD * 2) / contentH,
    MAX_BOARD_SCALE,
  );

  return (
    <div data-arena-board="knockout" style={{
      height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden',
    }}>
      <div style={{
        width: contentW, height: contentH,
        transform: `scale(${scale})`, transformOrigin: 'center center',
        position: 'relative', flexShrink: 0,
      }}>
        {/* 라운드 이름 — 가로 위치는 배치가 알려 준 열 좌표를 그대로 쓴다. */}
        {layout.columns.map((col) => (
          <div
            key={`${col.side}:${col.column}`}
            style={{
              position: 'absolute', left: col.x, top: 0, width: col.width, height: HEADER_H,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: ARENA_FONT_LABEL, fontSize: 12, fontWeight: 700,
              letterSpacing: '0.14em',
              // 라운드 이름도 한 단계만 또렷하게. 결승은 Gold 그대로.
              color: col.column === 0 ? ARENA.gold : ARENA.muted,
              whiteSpace: 'nowrap', overflow: 'hidden',
            }}
          >
            {col.roundName ?? ''}
          </div>
        ))}

        <div style={{ position: 'absolute', left: 0, top: HEADER_H, width: contentW, height: layout.height }}>
          {/* 연결선은 카드 아래에 깔린다 — 글자 위를 지나가지 않는다. */}
          <svg
            width={contentW} height={layout.height}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
            aria-hidden
          >
            {layout.connectors.map((c) => (
              <path
                key={`${c.fromNodeKey}->${c.toNodeKey}`}
                d={c.path}
                fill="none"
                stroke={ARENA.boardLine}
                strokeWidth={1.5}
              />
            ))}
          </svg>

          {layout.nodes.map((n) => <MatchCard key={n.key} node={n} />)}
          <ChampionPanel layout={layout} />
        </div>
      </div>
    </div>
  );
}
