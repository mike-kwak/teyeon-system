'use client';

// Arena — 화면 틀 (Batch 4E-1 · 단계별 배치 확정 4G).
//
//   1920×1080 캔버스를 그린 뒤 화면 크기에 맞춰 통째로 줄인다(contain).
//
//   ⚠ 코트 배치가 단계에 따라 다르다. 이것이 확정된 구조이며, 하나로 다시 합치지 않는다.
//     예선 — 머리말 → [ 왼쪽 코트 레일 2×5 | 조 순위 벽 ]
//            현장에서 '지금 어느 코트가 도는지' 와 '전체 판도' 를 나란히 본다.
//     본선 — 머리말 → 코트 줄 1×10 → 대진표(full-width)
//            대진은 좌우로 펼쳐져야 하므로 코트를 위로 올리고 아래 폭을 전부 내준다.
//   ⚠ 전체화면에서는 조작 버튼을 숨긴다 — TV 에는 보드만 보인다.
//   ⚠ 배경 갱신 중에 화면을 비우거나 로딩으로 되돌리지 않는다.

import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import ArenaCourtStrip from './ArenaCourtStrip';
import ArenaCourtRail from './ArenaCourtRail';
import { useArenaStage } from './useArenaStage';
import {
  ARENA, ARENA_CANVAS, ARENA_FONT_BODY, ARENA_FONT_LABEL, ARENA_LAYOUT, ARENA_RAIL_WIDTH,
  arenaBoardHeight, arenaPrelimBoardHeight,
} from './arenaTheme';
import type { ArenaMode, ArenaState } from '@/lib/tournaments/arenaTypes';

const MODE_LABEL: Record<ArenaMode, string> = {
  preliminary: '예선',
  knockout: '본선',
};

function ControlButton({
  active, onClick, children, label,
}: { active?: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 34, padding: '0 14px',
        borderRadius: 8,
        border: `1px solid ${active ? ARENA.teal : ARENA.line}`,
        background: active ? ARENA.teal : ARENA.surface,
        color: active ? '#FFFFFF' : ARENA.inkSoft,
        fontFamily: ARENA_FONT_LABEL, fontSize: 14, fontWeight: 700, letterSpacing: '0.02em',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** 머리말 — 브랜드와 대회, 그리고 지금 보고 있는 화면이 무엇인지까지만. */
function ArenaHeader({
  title, mode, updatedAt, stale,
}: { title: string; mode: ArenaMode; updatedAt: number | null; stale: boolean }) {
  const time = updatedAt === null ? null : new Date(updatedAt);
  return (
    <header style={{
      height: ARENA_LAYOUT.headerHeight,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, minWidth: 0 }}>
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: 17, fontWeight: 700, letterSpacing: '0.22em',
          color: ARENA.muted, whiteSpace: 'nowrap',
        }}>
          TEYEON TENNIS CLUB
        </span>
        <h1 style={{
          margin: 0, fontFamily: ARENA_FONT_LABEL, fontSize: 34, fontWeight: 700,
          letterSpacing: '0.04em', color: ARENA.ink, whiteSpace: 'nowrap',
        }}>
          {title}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        {/* 갱신이 밀린 상태는 아주 작게만 — TV 화면을 방해하지 않는다. */}
        {stale && (
          <span style={{ fontSize: 12, fontWeight: 600, color: ARENA.faint }}>
            갱신 지연
          </span>
        )}
        {time && (
          <span style={{
            fontFamily: ARENA_FONT_LABEL, fontSize: 13, fontWeight: 600, color: ARENA.faint,
          }}>
            {String(time.getHours()).padStart(2, '0')}:{String(time.getMinutes()).padStart(2, '0')}
          </span>
        )}
        <span style={{
          fontFamily: ARENA_FONT_LABEL, fontSize: 15, fontWeight: 700, letterSpacing: '0.14em',
          color: ARENA.teal, padding: '5px 12px',
          border: `1px solid ${ARENA.line}`, borderRadius: 8, background: ARENA.surface,
        }}>
          {MODE_LABEL[mode]}
        </span>
      </div>
    </header>
  );
}

/** 안내 — 권한 없음 · 첫 조회 실패처럼 보여 줄 데이터가 없을 때만. */
function ArenaNotice({ title, desc }: { title: string; desc?: string }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center',
    }}>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: ARENA.inkSoft }}>{title}</p>
      {desc && <p style={{ margin: 0, fontSize: 15, fontWeight: 500, color: ARENA.muted }}>{desc}</p>}
    </div>
  );
}

/** 본문 상자 — 두 모드가 같은 면·테두리를 쓴다(모드마다 다르게 보이지 않게). */
const boardBox: React.CSSProperties = {
  minHeight: 0,
  background: ARENA.surface,
  border: `1px solid ${ARENA.line}`,
  borderRadius: 14,
  overflow: 'hidden',
};

export interface ArenaShellProps {
  title: string;
  mode: ArenaMode;
  onModeChange: (mode: ArenaMode) => void;
  state: ArenaState;
  /** 본문(Main Board). 4E-2 · 4E-3 이 여기에 들어온다. */
  children: React.ReactNode;
}

export default function ArenaShell({
  title, mode, onModeChange, state, children,
}: ArenaShellProps) {
  const stage = useArenaStage();
  const snapshot = state.snapshot;

  // 보여 줄 데이터가 하나도 없을 때만 안내로 바꾼다. 배경 갱신 실패는 여기 오지 않는다.
  const notice = !snapshot
    ? (!state.authorized
        ? { title: '운영자 로그인이 필요합니다.', desc: '운영 계정으로 로그인한 뒤 이 화면을 다시 열어 주세요.' }
        : state.failed
          ? { title: '대회 정보를 불러오지 못했습니다.', desc: '잠시 후 자동으로 다시 시도합니다.' }
          : { title: '불러오는 중…' })
    : null;

  return (
    <div
      ref={stage.rootRef}
      style={{
        position: 'fixed', inset: 0, background: ARENA.bg, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: ARENA_FONT_BODY,
      }}
    >
      {/* 1920×1080 캔버스 — 화면 크기에 맞춰 통째로 축소/확대한다.
          ⚠ data-arena-canvas 는 측정용 표식이다(화면에 영향을 주지 않는다).
            코트 영역의 부모로 캔버스를 추정하면 모드마다 다른 것을 재게 된다. */}
      <div data-arena-canvas={mode} style={{
        width: ARENA_CANVAS.width,
        height: ARENA_CANVAS.height,
        transform: `scale(${stage.scale})`,
        transformOrigin: 'center center',
        flexShrink: 0,
        background: ARENA.bg,
        padding: `${ARENA_LAYOUT.padY}px ${ARENA_LAYOUT.padX}px`,
        display: 'flex', flexDirection: 'column', gap: ARENA_LAYOUT.gap,
      }}>
        <ArenaHeader title={title} mode={mode} updatedAt={state.updatedAt} stale={state.stale} />

        {/* 코트는 데이터가 없어도 자리를 지킨다(높이가 흔들리지 않게). */}
        {mode === 'preliminary' ? (
          <div style={{
            height: arenaPrelimBoardHeight(),
            minHeight: 0,
            display: 'flex',
            gap: ARENA_LAYOUT.gap,
          }}>
            <div style={{ width: ARENA_RAIL_WIDTH, flexShrink: 0 }}>
              <ArenaCourtRail courts={snapshot ? snapshot.courts : []} />
            </div>
            <main style={{ ...boardBox, flex: 1, minWidth: 0 }}>
              {notice ? <ArenaNotice title={notice.title} desc={notice.desc} /> : children}
            </main>
          </div>
        ) : (
          <>
            <ArenaCourtStrip courts={snapshot ? snapshot.courts : []} />
            <main style={{ ...boardBox, height: arenaBoardHeight() }}>
              {notice ? <ArenaNotice title={notice.title} desc={notice.desc} /> : children}
            </main>
          </>
        )}
      </div>

      {/* 조작 — 전체화면에서는 보이지 않는다. */}
      {!stage.isFullscreen && (
        <div style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 8, borderRadius: 12,
          background: 'rgba(255,255,255,0.92)', border: `1px solid ${ARENA.line}`,
        }}>
          <ControlButton active={mode === 'preliminary'} onClick={() => onModeChange('preliminary')}>
            예선
          </ControlButton>
          <ControlButton active={mode === 'knockout'} onClick={() => onModeChange('knockout')}>
            본선
          </ControlButton>
          {stage.canFullscreen && (
            <ControlButton onClick={stage.toggleFullscreen} label="전체화면">
              <Maximize2 size={15} strokeWidth={2.4} />
              전체화면
            </ControlButton>
          )}
        </div>
      )}

      {/* 전체화면에서 빠져나올 방법은 ESC 지만, 되돌리기 버튼이 전혀 없으면 곤란하므로
          아주 작은 해제 버튼만 모서리에 둔다(보드 영역을 가리지 않는다). */}
      {stage.isFullscreen && stage.canFullscreen && (
        <button
          type="button"
          onClick={stage.toggleFullscreen}
          aria-label="전체화면 해제"
          style={{
            position: 'fixed', right: 10, bottom: 10, zIndex: 10,
            width: 30, height: 30, display: 'grid', placeItems: 'center',
            borderRadius: 8, border: 'none', background: 'transparent',
            color: ARENA.faint, opacity: 0.35, cursor: 'pointer',
          }}
        >
          <Minimize2 size={15} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
