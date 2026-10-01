'use client';

// Arena 본문 자리 (Batch 4E-1).
//
//   ⚠ 이 단계에서는 내용을 만들지 않는다. 다음 단계가 들어올 '높이가 고정된 빈 자리'다.
//     · 예선 → 4E-2 조 순위 벽
//     · 본선 → 4E-3 중앙 수렴 대진표
//   개발용 설명 카드를 두지 않는다 — 실제 보드 높이를 그대로 눈으로 확인하기 위해서다.

import React from 'react';
import { ARENA, ARENA_FONT_LABEL } from './arenaTheme';
import type { ArenaMode } from '@/lib/tournaments/arenaTypes';

export default function ArenaBoardPlaceholder({ mode }: { mode: ArenaMode }) {
  return (
    <div
      data-arena-board={mode}
      style={{
        height: '100%', display: 'grid', placeItems: 'center',
      }}
    >
      <span style={{
        fontFamily: ARENA_FONT_LABEL, fontSize: 13, fontWeight: 700, letterSpacing: '0.18em',
        color: ARENA.faint,
      }}>
        {mode === 'preliminary' ? 'GROUP STANDINGS' : 'KNOCKOUT BRACKET'}
      </span>
    </div>
  );
}
