'use client';

// Arena — 예선 조 순위 벽 (Batch 4E-2).
//
//   "TV 한 화면을 보면 전체 예선 판도가 보인다."
//   20개 조가 각자의 카드가 아니라 **하나의 벽**으로 읽혀야 한다 —
//   그래서 칸마다 테두리·그림자·둥근 모서리를 주지 않고, 머리카락 굵기 선으로만 나눈다.
//
//   ⚠ 순위를 여기서 계산하지 않는다. 서버가 준 rank 를 그대로 쓰고,
//     rank 가 null(동률 미확정)이면 '–' 로 둔다 — 임의 숫자를 만들지 않는다.
//   ⚠ 조별 진출 팀 수를 2 로 가정하지 않는다. 서버가 준 qualifyPerGroup 만 쓴다.
//   ⚠ 순위 글자·색 규칙은 Admin · 공개 화면과 같은 helper 를 쓴다(세 화면이 어긋나지 않게).

import React from 'react';
import {
  phaseOf, rankText, recordText, gameDiffView, teamName,
} from '@/components/tournaments/standings/presentation';
import { chooseGroupGrid } from '@/lib/tournaments/arenaGroupGrid';
import { ARENA, ARENA_FONT_LABEL } from './arenaTheme';
import type { ArenaGroup, ArenaStandingRow } from '@/lib/tournaments/arenaTypes';

/** 벽 바깥 여백. 보드 자체가 이미 면이라 여백만 둔다. */
const PAD = 22;

interface TeamRowProps {
  row: ArenaStandingRow;
  /** 조별 진출 팀 수(서버 값). 없으면 진출권 강조를 하지 않는다. */
  qualifyPerGroup: number | null;
  settled: boolean;
  compact: boolean;
}

function TeamRow({ row, qualifyPerGroup, settled, compact }: TeamRowProps) {
  const rank = rankText(row);
  const diff = gameDiffView(row);

  // 진출권 강조는 두 단계로만.
  //   · 서버가 확정한 QUALIFIED → 또렷하게(Teal)
  //   · 아직 진행 중이면 '현재 진출권 안' 정도만 진하게(색을 더 쓰지 않는다)
  const qualified = settled && row.qualificationStatus === 'QUALIFIED';
  const inQualifyZone = !qualified && qualifyPerGroup !== null
    && row.rank !== null && row.rank <= qualifyPerGroup;

  const rankColor = qualified ? ARENA.teal : rank === '–' ? ARENA.faint : ARENA.ink;
  const nameColor = qualified || inQualifyZone ? ARENA.ink : ARENA.inkSoft;

  return (
    <div style={{
      flex: 1,                                  // 칸 높이를 팀 줄들이 고르게 나눠 쓴다
      minHeight: 0,
      display: 'grid',
      gridTemplateColumns: `20px minmax(0, 1fr) auto`,
      alignItems: 'center',
      columnGap: 10,
      padding: compact ? '3px 0' : '5px 0',
      opacity: row.withdrawn ? 0.45 : 1,
    }}>
      <span style={{
        fontFamily: ARENA_FONT_LABEL, fontSize: compact ? 15 : 16, fontWeight: 700,
        color: rankColor, textAlign: 'center', fontVariantNumeric: 'tabular-nums',
      }}>
        {rank}
      </span>

      <span style={{
        fontSize: compact ? 14 : 15, fontWeight: qualified || inQualifyZone ? 700 : 600,
        color: nameColor, lineHeight: 1.3,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: compact ? 12 : 13, fontWeight: 700,
          color: ARENA.faint, marginRight: 6,
        }}>
          {row.teamNo}
        </span>
        {teamName(row)}
      </span>

      <span style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        fontFamily: ARENA_FONT_LABEL, fontSize: compact ? 12 : 13, fontWeight: 600,
        color: ARENA.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        <span>{row.played === 0 ? '0-0' : `${row.wins}-${row.losses}`}</span>
        <span style={{ color: diff ? ARENA.muted : ARENA.faint, minWidth: 24, textAlign: 'right' }}>
          {diff ? diff.text : '·'}
        </span>
      </span>
    </div>
  );
}

function GroupCell({
  group, qualifyPerGroup, compact, borderRight, borderBottom,
}: {
  group: ArenaGroup; qualifyPerGroup: number | null; compact: boolean;
  borderRight: boolean; borderBottom: boolean;
}) {
  const phase = phaseOf(group);
  const settled = phase === 'FINAL' || phase === 'AGE_CHECK';

  // 미확정 상태는 화면을 방해하지 않는 작은 글자 하나로만.
  const note = phase === 'AGE_CHECK' ? '순위 확인 중'
    : phase === 'NOT_STARTED' ? '경기 전'
    : phase === 'FINAL' ? null
    : `${group.completedMatches}/${group.expectedMatches}`;

  return (
    <div style={{
      minWidth: 0,
      padding: compact ? '10px 16px 8px' : '14px 18px 12px',
      borderRightWidth: borderRight ? 1 : 0,
      borderBottomWidth: borderBottom ? 1 : 0,
      borderRightStyle: 'solid',
      borderBottomStyle: 'solid',
      // 구획선 — 가로·세로 모두 같은 굵기·같은 색으로 한 장의 현황판처럼 나눈다.
      //   카드처럼 보이지 않도록 배경·그림자·둥근 모서리는 주지 않는다.
      borderRightColor: ARENA.wallLine,
      borderBottomColor: ARENA.wallLine,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginBottom: compact ? 4 : 7,
      }}>
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: compact ? 15 : 17, fontWeight: 700,
          letterSpacing: '0.02em', color: ARENA.ink,
        }}>
          {group.groupNo}조
        </span>
        {note && (
          <span style={{
            fontFamily: ARENA_FONT_LABEL, fontSize: 11, fontWeight: 600,
            color: phase === 'AGE_CHECK' ? ARENA.teal : ARENA.faint,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {note}
          </span>
        )}
      </div>

      {/* 팀 줄이 칸 높이를 나눠 쓴다 — 칸 하나만 억지로 늘리지 않고 줄 간격으로 채운다. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {group.rows.map((r) => (
          <TeamRow key={r.teamNo} row={r} qualifyPerGroup={qualifyPerGroup}
            settled={settled} compact={compact} />
        ))}
      </div>
    </div>
  );
}

export interface ArenaGroupWallProps {
  groups: ArenaGroup[];
  qualifyPerGroup: number | null;
  /** 보드 안쪽 크기(1920 캔버스 좌표). 화면을 재지 않고 계산만으로 결정한다. */
  width: number;
  height: number;
}

export default function ArenaGroupWall({
  groups, qualifyPerGroup, width, height,
}: ArenaGroupWallProps) {
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;

  const grid = chooseGroupGrid({ count: groups.length, width: innerW, height: innerH, gap: 0 });
  // 칸이 낮아지면(조가 많아지면) 줄 간격·글자를 함께 줄인다 — 칸 높이만 늘려 때우지 않는다.
  const compact = grid.cellHeight > 0 && grid.cellHeight < 180;

  if (groups.length === 0) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: ARENA.muted }}>
          예선 조가 아직 없습니다.
        </span>
      </div>
    );
  }

  return (
    <div data-arena-board="preliminary" style={{ height: '100%', padding: PAD }}>
      <div style={{
        height: '100%',
        display: 'grid',
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
      }}>
        {groups.map((g, i) => {
          const col = i % grid.columns;
          const rowIdx = Math.floor(i / grid.columns);
          return (
            <GroupCell
              key={g.groupNo}
              group={g}
              qualifyPerGroup={qualifyPerGroup}
              compact={compact}
              borderRight={col < grid.columns - 1}
              borderBottom={rowIdx < grid.rows - 1}
            />
          );
        })}
      </div>
    </div>
  );
}
