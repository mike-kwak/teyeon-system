'use client';

// Arena — 상단 코트 줄 (Batch 4E-1).
//
//   코트 10개를 **항상 한 줄**로 보여 준다(2×5 · 좌우 레일 · 하단 레일을 쓰지 않는다).
//   ⚠ 보여 주는 것은 '지금 하고 있는 경기(NOW)' 뿐이다.
//     '다음 경기(NEXT)'를 만들지 않는다 — 저장된 데이터에 그런 개념이 없다.
//     CALLING 은 코트를 점유하지 않으므로 코트 줄에 올리지 않는다.
//   ⚠ 진행 중 점수를 추측해 쓰지 않는다. 팀과 코트만 보여 준다.

import React from 'react';
import { ARENA, ARENA_FONT_LABEL, ARENA_LAYOUT } from './arenaTheme';
import type { ArenaCourt, ArenaTeam } from '@/lib/tournaments/arenaTypes';

/** 화면에 늘 같은 자리를 지키는 코트 수. 데이터가 모자라도 칸은 비워 둔다. */
export const ARENA_COURT_COUNT = 10;

const teamLabel = (t: ArenaTeam): string => {
  const names = [t.player1Name, t.player2Name].filter((s) => s.trim() !== '');
  return names.length > 0 ? names.join(' · ') : (t.teamNo !== null ? `${t.teamNo}번 팀` : '—');
};

/** 두 줄까지 보여 주고 넘치면 말줄임 — 이름이 길어도 칸 높이가 흔들리지 않게. */
const clamp2: React.CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
  overflow: 'hidden',
  wordBreak: 'keep-all',
  overflowWrap: 'anywhere',
};

function TeamLine({ team, live }: { team: ArenaTeam; live: boolean }) {
  return (
    <div style={{
      fontSize: 17,
      lineHeight: 1.24,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      color: live ? ARENA.onStrip : ARENA.onStripMuted,
      ...clamp2,
    }}>
      {team.teamNo !== null && (
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: 14, fontWeight: 700,
          color: live ? ARENA.live : ARENA.onStripMuted, marginRight: 6,
        }}>
          {team.teamNo}
        </span>
      )}
      {teamLabel(team)}
    </div>
  );
}

function CourtCell({ court, divider }: { court: ArenaCourt | null; divider: boolean }) {
  const playing = court?.now ?? null;
  const live = playing !== null;

  return (
    <div style={{
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,                                   // 긴 이름이 칸을 밀어내지 못하게
      padding: '12px 14px 13px',
      borderRadius: 10,
      background: live ? ARENA.stripSoft : 'transparent',
      // ⚠ shorthand(border)와 longhand 를 섞지 않는다(React 경고 + 덮어쓰기 사고).
      borderWidth: 1,
      borderStyle: 'solid',
      borderTopColor: live ? ARENA.stripLine : 'transparent',
      borderRightColor: live ? ARENA.stripLine : 'transparent',
      borderBottomColor: live ? ARENA.stripLine : 'transparent',
      // 빈 코트끼리 한 덩어리로 보이지 않게 아주 옅은 경계만 둔다.
      borderLeftColor: live || divider ? ARENA.stripLine : 'transparent',
    }}>
      {/* 진행 중 표시 — 왼쪽 세로 막대 하나로만. */}
      {live && (
        <span style={{
          position: 'absolute', left: 0, top: 12, bottom: 12, width: 3,
          borderRadius: 2, background: ARENA.live,
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: 15, fontWeight: 700, letterSpacing: '0.08em',
          color: live ? ARENA.onStrip : ARENA.onStripMuted,
        }}>
          COURT {court ? court.courtNo : '—'}
        </span>
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
          color: live ? ARENA.live : ARENA.onStripMuted,
          opacity: live ? 1 : 0.75,
        }}>
          {live ? 'PLAYING' : court && !court.active ? 'CLOSED' : 'EMPTY'}
        </span>
      </div>

      {live ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <TeamLine team={playing.team1} live />
          <span style={{
            fontFamily: ARENA_FONT_LABEL, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.12em', color: ARENA.onStripMuted,
          }}>
            VS
          </span>
          <TeamLine team={playing.team2} live />
        </div>
      ) : (
        <div style={{ fontSize: 14, fontWeight: 600, color: ARENA.onStripMuted, opacity: 0.6 }}>
          경기 없음
        </div>
      )}
    </div>
  );
}

/**
 * 코트 줄.
 *   ⚠ 데이터가 갱신돼도 칸이 다시 만들어지지 않도록 코트 번호를 key 로 고정한다(깜빡임 방지).
 */
export default function ArenaCourtStrip({ courts }: { courts: ArenaCourt[] }) {
  // 1~10 자리를 늘 같은 순서로 둔다. 서버에 없는 번호는 빈 칸으로 남긴다.
  const byNo = new Map<number, ArenaCourt>();
  courts.forEach((c) => byNo.set(c.courtNo, c));
  const extra = courts
    .filter((c) => c.courtNo > ARENA_COURT_COUNT)
    .sort((a, b) => a.courtNo - b.courtNo);

  const cells: Array<{ key: number; court: ArenaCourt | null }> = [];
  for (let n = 1; n <= ARENA_COURT_COUNT; n += 1) {
    cells.push({ key: n, court: byNo.get(n) ?? null });
  }
  // 11번 이상 코트가 있으면 뒤쪽 빈 칸을 차례로 채운다(줄 수는 늘리지 않는다).
  extra.forEach((c) => {
    const slot = cells.find((x) => x.court === null);
    if (slot) { slot.court = c; slot.key = c.courtNo; }
  });

  return (
    <section
      aria-label="코트 현황"
      style={{
        height: ARENA_LAYOUT.stripHeight,
        background: ARENA.strip,
        borderRadius: 14,
        padding: '10px 12px',
        display: 'grid',
        gridTemplateColumns: `repeat(${ARENA_COURT_COUNT}, minmax(0, 1fr))`,
        columnGap: 4,
        alignItems: 'stretch',
      }}
    >
      {cells.map((c, i) => (
        <CourtCell key={c.key} court={c.court} divider={i > 0 && (cells[i - 1].court?.now ?? null) === null} />
      ))}
    </section>
  );
}
