'use client';

// Arena — 예선 왼쪽 코트 레일 (Batch 4G).
//
//   코트 10개를 **2열 × 5행** 세로 레일로 보여 준다. **예선 전용**이다.
//   본선은 상단 1×10 줄(ArenaCourtStrip)을 그대로 쓴다 —
//   두 모드가 서로 다른 코트 배치를 쓰는 것이 확정된 구조다. 다시 합치지 않는다.
//
//   ⚠ 카드를 새로 만들지 않는다. ArenaCourtStrip 의 CourtCell 을 그대로 가져다 쓴다.
//     색·테두리·타이포를 여기서 다시 정하지 않는다(디자인 재설계 금지).
//   ⚠ 자리 배정도 arenaCourtSlots 하나만 쓴다 — 두 모드에서 코트 순서가 달라지면 안 된다.
//   ⚠ 보여 주는 것은 '지금 하고 있는 경기(NOW)' 뿐이다.
//     다음 경기(NEXT)를 추론하지 않고, 진행 중 점수를 쓰지 않고, CALLING 을 올리지 않는다.

import React from 'react';
import { ARENA } from './arenaTheme';
import { ARENA_COURT_COUNT, CourtCell, arenaCourtSlots } from './ArenaCourtStrip';
import type { ArenaCourt } from '@/lib/tournaments/arenaTypes';

/** 레일 격자 — 2열 × 5행 고정. 코트 수가 모자라도 칸은 비워 둔다. */
const RAIL_COLUMNS = 2;
const RAIL_ROWS = ARENA_COURT_COUNT / RAIL_COLUMNS;

export default function ArenaCourtRail({ courts }: { courts: ArenaCourt[] }) {
  const cells = arenaCourtSlots(courts);

  return (
    <section
      aria-label="코트 현황"
      data-arena-rail={`${RAIL_COLUMNS}x${RAIL_ROWS}`}
      style={{
        height: '100%',
        background: ARENA.strip,
        borderRadius: 14,
        padding: '10px 12px',
        display: 'grid',
        gridTemplateColumns: `repeat(${RAIL_COLUMNS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${RAIL_ROWS}, minmax(0, 1fr))`,
        columnGap: 4,
        rowGap: 8,
        alignItems: 'stretch',
      }}
    >
      {cells.map((c, i) => (
        <CourtCell
          key={c.key}
          court={c.court}
          // 왼쪽 세로 구분선은 오른쪽 열에만 — 빈 코트끼리 한 덩어리로 보이지 않게 한다.
          //   (상단 줄에서 '앞 칸이 비어 있으면 선을 둔다' 와 같은 규칙을 열 기준으로 적용한다.)
          divider={i % RAIL_COLUMNS > 0 && (cells[i - 1].court?.now ?? null) === null}
        />
      ))}
    </section>
  );
}
