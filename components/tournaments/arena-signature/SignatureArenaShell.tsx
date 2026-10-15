'use client';

// Signature — 화면 틀 (/tournaments/arena-design/signature 전용).
//
//   [장식 레이어(경기장 · 보호막 · 바닥 글자)] 위에 [머리말 → 코트 10개 → 리본 + 대진] 정보 레이어를 올린다.
//   ⚠ 1920×1080 캔버스 · contain 배율 · 전체화면은 운영 Arena 의 useArenaStage 를 그대로 쓴다(수정하지 않는다).
//   ⚠ 전체화면에서는 조작 버튼을 숨긴다 — TV 에는 보드만 보인다.
//     fullscreenControls 를 주면(Court Board 배치 전환) 전체화면에서도 조작할 수 있다 — 평소엔 숨어 있고,
//     마우스를 움직이거나 화면을 터치하거나 키를 누를 때만 오른쪽 아래에 잠깐(3초) 나타난다. 전광판 내용을 계속 가리지 않는다.
//   ⚠ testMark = 테스트 화면(가상 fixture) 표시 'DEMO · TEST DATA' — 캔버스 안 오른쪽 위 작은 글자(전체화면에서도 보인다).
//     실전(운영 연결) 화면은 이 값을 주지 않는다.

import React from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useArenaStage } from '@/components/tournaments/arena/useArenaStage';
import type { ArenaSnapshot } from '@/lib/tournaments/arenaTypes';
import SignatureBackdrop from './SignatureBackdrop';
import SignatureCourtStrip from './SignatureCourtStrip';
import SignatureHeader from './SignatureHeader';
import type { SignatureEventInfo } from './SignatureHeader';
import { SIG, SIG_FONT_BODY, SIG_LAYOUT, SIG_VIEW_TRANSITION_MS } from './signatureTheme';
import type { SignatureCourtPosition, SignatureViewMode } from './signatureTheme';

/**
 * 코트 줄 접기 — 열림: 높이 160(줄 150 + 틈 10) · 닫힘: 0 으로 부드럽게 접고, 다 접히면 화면에서 뺀다.
 *   ⚠ 대진은 이 상자의 높이를 따라 움직이지 않는다(대진은 모드가 바뀌는 순간 새 좌표로 놓인다).
 */
function CourtDock({ open, position, children }: { open: boolean; position: SignatureCourtPosition; children: React.ReactNode }) {
  const full = SIG_LAYOUT.courtHeight + SIG_LAYOUT.courtGap;
  const [mounted, setMounted] = React.useState(open);
  const [expanded, setExpanded] = React.useState(open);
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      // 높이 0 으로 한 번 그린 뒤 펼친다(전환이 보이도록).
      let id2 = 0;
      const id1 = requestAnimationFrame(() => { id2 = requestAnimationFrame(() => setExpanded(true)); });
      return () => { cancelAnimationFrame(id1); cancelAnimationFrame(id2); };
    }
    setExpanded(false);
    const t = window.setTimeout(() => setMounted(false), SIG_VIEW_TRANSITION_MS + 60);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!mounted) return null;
  const gap = <div style={{ height: SIG_LAYOUT.courtGap, flexShrink: 0 }} />;
  return (
    <div data-sig-court-dock={expanded ? 'open' : 'closed'} data-sig-motion="dock" aria-hidden={!open} style={{
      height: expanded ? full : 0, opacity: expanded ? 1 : 0, overflow: 'hidden', flexShrink: 0,
      display: 'flex', flexDirection: 'column', justifyContent: position === 'bottom' ? 'flex-start' : 'flex-end',
      transform: expanded ? 'none' : `translateY(${position === 'bottom' ? 24 : -24}px)`,
      transition: `height ${SIG_VIEW_TRANSITION_MS}ms cubic-bezier(.4,0,.2,1), opacity ${SIG_VIEW_TRANSITION_MS * 0.7}ms ease, transform ${SIG_VIEW_TRANSITION_MS}ms cubic-bezier(.4,0,.2,1)`,
    }}>
      {position === 'bottom' && gap}
      <div style={{ height: SIG_LAYOUT.courtHeight, flexShrink: 0 }}>{children}</div>
      {position === 'top' && gap}
    </div>
  );
}

/** 전환 효과 — 줌 · 회전 없이 투명도 · 높이만. 움직임 줄이기 설정이면 즉시 바뀐다. */
const MOTION_CSS = `
@keyframes sigBoardSettle { from { opacity: 0.35; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  [data-sig-motion] { transition: none !important; animation: none !important; }
}
/* 갱신 지연(운영 연결 화면) — LIVE 노랑을 회색으로 낮춘다. 오래된 경기를 '지금 진행 중'처럼 보이지 않게. */
[data-live-stale="1"] [data-sig-live],
[data-live-stale="1"] [data-sig-court-tab="live"],
[data-live-stale="1"] [data-prelim-live],
[data-live-stale="1"] [data-cb-chip="live"],
[data-live-stale="1"] [data-prelim-group]:not([data-live-courts=""]) > span:first-child { filter: grayscale(1); opacity: 0.55; }
/* LIVE 코트 칸(노랑 줄 · 바탕)은 색만 뺀다 — 이름은 그대로 읽힌다. */
[data-live-stale="1"] [data-sig-court][data-court-state="live"],
[data-live-stale="1"] [data-court-card][data-court-state="live"] > :first-child { filter: grayscale(1); }`;

function ControlButton({ active, onClick, children, label }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; label?: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={active} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 8,
      border: `1px solid ${active ? SIG.navy : '#C9D5EA'}`,
      background: active ? SIG.navy : '#FFFFFF', color: active ? '#FFFFFF' : SIG.inkSoft,
      fontFamily: SIG_FONT_BODY, fontSize: 14, fontWeight: 700, cursor: 'pointer',
    }}>
      {children}
    </button>
  );
}
export { ControlButton as SignatureControlButton };

export interface SignatureArenaShellProps {
  snapshot: ArenaSnapshot;
  event: SignatureEventInfo;
  /** 조작 줄에 붙는 표식(전체화면에서는 숨는다). */
  badge?: string;
  /** 조작 줄 버튼(전체화면에서는 숨는다). */
  controls?: React.ReactNode;
  /** 코트 현황 위치 — 기본 bottom(운영진 확정안: 대진 아래 방송 스트립). top 은 이전 배치(비교용). */
  courtPosition?: SignatureCourtPosition;
  /** 표시 모드 — courts = 코트 포함 · focus = 코트 미포함(코트 줄을 접는다). */
  viewMode?: SignatureViewMode;
  /** 코트 줄을 보일지 직접 정한다. 없으면 viewMode 를 따른다(courts 이면 보인다). */
  showCourts?: boolean;
  /** 캔버스 오른쪽 위 연결 상태 표시(운영 연결 화면 전용 — Demo 는 쓰지 않는다). 전체화면에서도 보인다. */
  statusSlot?: React.ReactNode;
  /**
   * 갱신이 밀려 화면이 과거 값인가(운영 연결 화면 전용).
   *   true 면 LIVE 표시(노랑)를 회색으로 낮춰, 오래된 경기를 '지금 진행 중'처럼 보이지 않게 한다.
   */
  stale?: boolean;
  /** 테스트 화면(가상 fixture) 표시. 실전 화면은 주지 않는다. */
  testMark?: boolean;
  /** 전체화면에서도 쓸 조작(평소 숨김 · 움직임이 있을 때만 잠깐 보인다). */
  fullscreenControls?: React.ReactNode;
  children: React.ReactNode;
}

/** 테스트 화면 표시 — 제목 · 선수명을 가리지 않는 캔버스 오른쪽 위 여백(머리말 위 4~22px)에 작게. */
export const SIG_TEST_MARK = 'DEMO · TEST DATA';
function TestMark() {
  return (
    <div data-sig-test-mark="1" aria-label="테스트 데이터 화면" style={{
      position: 'absolute', top: 4, right: 24, zIndex: 5, height: 18, display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '0 9px', borderRadius: 4, background: 'rgba(20, 35, 74, 0.07)', border: '1px solid rgba(20, 35, 74, 0.14)',
      fontFamily: 'var(--font-ivory-display), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.18em',
      color: SIG.inkSoft, whiteSpace: 'nowrap', pointerEvents: 'none',
    }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: SIG.muted }} />
      {SIG_TEST_MARK}
    </div>
  );
}

/** 전체화면 조작 — 움직임이 있을 때만 3초 보인다. */
function useWakeful(enabled: boolean, ms = 3000): boolean {
  const [awake, setAwake] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) { setAwake(false); return; }
    let t = 0;
    const wake = () => { setAwake(true); window.clearTimeout(t); t = window.setTimeout(() => setAwake(false), ms); };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => { window.clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, wake)); };
  }, [enabled, ms]);
  return awake;
}

export default function SignatureArenaShell({
  snapshot, event, badge, controls, courtPosition = 'bottom', viewMode = 'courts', showCourts, statusSlot, stale = false,
  testMark = false, fullscreenControls, children,
}: SignatureArenaShellProps) {
  const stage = useArenaStage();
  const fsControls = Boolean(fullscreenControls) && stage.isFullscreen;
  const awake = useWakeful(fsControls);
  const bottom = courtPosition === 'bottom';
  const courts = (
    <CourtDock open={showCourts ?? viewMode === 'courts'} position={courtPosition}>
      <SignatureCourtStrip courts={snapshot.courts} bracket={snapshot.bracket} variant={bottom ? 'strip' : 'cards'} />
    </CourtDock>
  );

  return (
    <div ref={stage.rootRef} style={{
      position: 'fixed', inset: 0, background: SIG.letterbox, overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SIG_FONT_BODY,
    }}>
      <style>{MOTION_CSS}</style>
      <div data-arena-canvas="signature" data-court-position={courtPosition} data-view-mode={viewMode}
        data-live-stale={stale ? '1' : undefined} style={{
        position: 'relative', width: 1920, height: 1080, flexShrink: 0,
        transform: `scale(${stage.scale})`, transformOrigin: 'center center',
        background: SIG.bg, overflow: 'hidden',
      }}>
        <SignatureBackdrop courtPosition={courtPosition} />
        {testMark && <TestMark />}
        {statusSlot && (
          <div data-sig-status-slot="1" style={{ position: 'absolute', top: 6, right: 24, zIndex: 5 }}>{statusSlot}</div>
        )}

        {/* 정보 레이어 */}
        <div style={{
          position: 'relative', height: '100%', boxSizing: 'border-box',
          padding: `${SIG_LAYOUT.padTop}px ${SIG_LAYOUT.padX}px ${SIG_LAYOUT.padBottom}px`,
          display: 'flex', flexDirection: 'column',
        }}>
          <SignatureHeader event={event} />
          <div style={{ height: SIG_LAYOUT.headerGap, flexShrink: 0 }} />
          {/* A안: 코트 → 대진 / B안: 대진 → 코트. 높이 합계가 같아 대진 크기 · 좌표는 그대로다. */}
          {!bottom && courts}
          {/* ⚠ 앱 공통 CSS 가 main 에 회색 바탕을 준다 — 경기장 배경이 보이도록 투명으로 둔다. */}
          <main style={{ flex: 1, minHeight: 0, background: 'transparent' }}>{children}</main>
          {bottom && courts}
        </div>
      </div>

      {!stage.isFullscreen && (
        <div style={{
          position: 'fixed', right: 16, bottom: 16, zIndex: 10, display: 'flex', alignItems: 'center', gap: 8,
          padding: 8, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1px solid #C9D5EA',
          boxShadow: SIG.shadowCard,
        }}>
          {badge && (
            <span data-arena-badge={badge} style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', color: SIG.royal, padding: '0 6px',
            }}>
              {badge}
            </span>
          )}
          {controls}
          {stage.canFullscreen && (
            <ControlButton onClick={stage.toggleFullscreen} label="전체화면">
              <Maximize2 size={15} strokeWidth={2.4} />전체화면
            </ControlButton>
          )}
        </div>
      )}

      {fsControls && (
        <div data-sig-fs-controls={awake ? 'shown' : 'hidden'} aria-hidden={!awake} style={{
          position: 'fixed', right: 12, bottom: 12, zIndex: 11, display: 'flex', alignItems: 'center', gap: 8,
          padding: 8, borderRadius: 12, background: 'rgba(255,255,255,0.95)', border: '1px solid #C9D5EA',
          boxShadow: SIG.shadowCard, opacity: awake ? 1 : 0, pointerEvents: awake ? 'auto' : 'none',
          transition: 'opacity 220ms ease',
        }}>
          {fullscreenControls}
          <ControlButton onClick={stage.toggleFullscreen} label="전체화면 해제">
            <Minimize2 size={15} strokeWidth={2.4} />해제
          </ControlButton>
        </div>
      )}

      {stage.isFullscreen && stage.canFullscreen && !fsControls && (
        <button type="button" onClick={stage.toggleFullscreen} aria-label="전체화면 해제" style={{
          position: 'fixed', right: 10, bottom: 10, zIndex: 10, width: 30, height: 30, display: 'grid',
          placeItems: 'center', borderRadius: 8, border: 'none', background: 'transparent',
          color: '#FFFFFF', opacity: 0.35, cursor: 'pointer',
        }}>
          <Minimize2 size={15} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}
