'use client';

// 본선 대진표 이동 · 확대 상태 (Batch 4D-4).
//
//   ⚠ 배치 계산(layoutBracket)은 이 상태를 모른다. 여기서는 좌표 변환만 다룬다.
//     interaction state = scale · translate · dragging · 그리고 그걸 바꾸는 동작뿐이다.
//   ⚠ 데이터가 갱신돼도(45초 갱신) 이 상태는 그대로 살아 있어야 한다 —
//     그래서 bracket 데이터가 아니라 '표면 크기' 만 인자로 받는다.
//   ⚠ 페이지 세로 스크롤을 빼앗지 않는다. 가로 이동과 두 손가락 확대만 가져간다
//     (viewport 에 touch-action: pan-y 를 건다 — 세로 스크롤은 브라우저가 계속 처리).

import React from 'react';

/** 손으로 줄일 수 있는 기본 하한(작은 대진에서 지나치게 작아지지 않게). */
export const MIN_SCALE = 0.45;
export const MAX_SCALE = 1.6;
/**
 * 전체보기 절대 하한. 64자리급 대진은 0.45 로는 화면에 다 들어오지 않는다 —
 * '전체 구조 한번 보기' 가 되려면 기본 하한 아래로 내려갈 수 있어야 한다.
 */
export const OVERVIEW_MIN_SCALE = 0.12;
/** 검색 이동 시 최소한 이 배율까지는 키워 글자가 읽히게 한다. */
export const READABLE_SCALE = 0.9;

export interface BracketTransform {
  scale: number;
  x: number;
  y: number;
}

interface Size { w: number; h: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * 한 축의 이동 범위.
 *   - 표면이 화면보다 크면: 가장자리 카드를 가운데로 끌어올 수 있게 화면 절반만큼 여유를 준다.
 *   - 표면이 화면보다 작으면: 이미 전부 보이므로 화면 안에 붙여 둔다(밖으로 밀어낼 이유가 없다).
 */
function axisRange(view: number, span: number): { lo: number; hi: number } {
  if (span <= view) return { lo: 0, hi: view - span };
  const slack = view * 0.5;                 // 가장자리 카드를 중앙까지 끌어올 여유
  return { lo: view - span - slack, hi: slack };
}

/** 이동 범위 — 표면을 화면 밖으로 날려 보내지 못하게 한다. */
function clampTranslate(x: number, y: number, scale: number, view: Size, surface: Size): { x: number; y: number } {
  const rx = axisRange(view.w, surface.w * scale);
  const ry = axisRange(view.h, surface.h * scale);
  return { x: clamp(x, rx.lo, rx.hi), y: clamp(y, ry.lo, ry.hi) };
}

/** 전체가 화면에 들어가는 배율(가장자리 여백 8px 감안). */
function fitScaleOf(view: Size, surface: Size): number {
  if (!view.w || !view.h || !surface.w || !surface.h) return 1;
  return Math.min(view.w / (surface.w + 16), view.h / (surface.h + 16), 1);
}

/**
 * 축소 하한 — 기본은 0.45 지만, 그 배율로도 전체가 안 들어오는 큰 대진에서는
 * '맞춤' 배율까지 내려갈 수 있게 한다(그 아래로는 못 내려간다).
 */
function minScaleOf(view: Size, surface: Size): number {
  return clamp(Math.min(MIN_SCALE, fitScaleOf(view, surface)), OVERVIEW_MIN_SCALE, MIN_SCALE);
}

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export function useBracketInteraction(surface: Size) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = React.useState<BracketTransform>({ scale: 1, x: 12, y: 0 });
  const [dragging, setDragging] = React.useState(false);

  // 최신 값을 이벤트 핸들러에서 읽기 위한 ref(핸들러 재생성 없이 안정 동작).
  const tRef = React.useRef(transform);
  tRef.current = transform;
  const surfaceRef = React.useRef(surface);
  surfaceRef.current = surface;

  const viewSize = React.useCallback((): Size => {
    const el = viewportRef.current;
    return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 };
  }, []);

  const apply = React.useCallback((next: BracketTransform) => {
    const view = viewSize();
    const s = clamp(next.scale, minScaleOf(view, surfaceRef.current), MAX_SCALE);
    const p = clampTranslate(next.x, next.y, s, view, surfaceRef.current);
    setTransform({ scale: s, x: p.x, y: p.y });
  }, [viewSize]);

  /** 뷰포트 한 점을 기준으로 배율만 바꾼다(그 점이 제자리에 머문다). */
  const zoomAt = React.useCallback((factor: number, cx: number, cy: number) => {
    const cur = tRef.current;
    const next = clamp(cur.scale * factor, minScaleOf(viewSize(), surfaceRef.current), MAX_SCALE);
    if (next === cur.scale) return;
    const k = next / cur.scale;
    apply({ scale: next, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k });
  }, [apply, viewSize]);

  /** 버튼 확대/축소 — 보이는 화면의 가운데를 기준으로. */
  const zoomBy = React.useCallback((factor: number) => {
    const view = viewSize();
    zoomAt(factor, view.w / 2, view.h / 2);
  }, [viewSize, zoomAt]);

  /** 전체 대진이 한눈에 들어오도록(overview). 글자가 작아지는 것은 허용한다. */
  const fit = React.useCallback(() => {
    const view = viewSize();
    const sf = surfaceRef.current;
    if (view.w === 0 || sf.w === 0) return;
    // ⚠ 여기서는 기본 하한(0.45)에 걸리면 안 된다 — 큰 대진은 그보다 작아야 전체가 들어온다.
    const s = clamp(fitScaleOf(view, sf), OVERVIEW_MIN_SCALE, 1);
    apply({ scale: s, x: (view.w - sf.w * s) / 2, y: (view.h - sf.h * s) / 2 });
  }, [apply, viewSize]);

  /** 읽기 좋은 기본 상태(배율 1, 왼쪽 위). ⚠ 맞춤(fit)과 다른 기능이다. */
  const reset = React.useCallback(() => {
    apply({ scale: 1, x: 12, y: 0 });
  }, [apply]);

  /** 특정 카드를 화면 가운데로. 필요하면 읽을 수 있는 배율까지 키운다. */
  const focusRect = React.useCallback((rect: { x: number; y: number; width: number; height: number }) => {
    const view = viewSize();
    if (view.w === 0) return;
    const cur = tRef.current;
    const scale = clamp(Math.max(cur.scale, READABLE_SCALE),
      minScaleOf(view, surfaceRef.current), MAX_SCALE);
    const targetX = view.w / 2 - (rect.x + rect.width / 2) * scale;
    const targetY = view.h / 2 - (rect.y + rect.height / 2) * scale;
    const end = clampTranslate(targetX, targetY, scale, view, surfaceRef.current);

    if (prefersReducedMotion()) {
      setTransform({ scale, x: end.x, y: end.y });
      return;
    }
    // 짧은 보간 — 어디로 갔는지 눈으로 따라갈 수 있을 정도만.
    const from = { ...cur };
    const t0 = performance.now();
    const DUR = 260;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / DUR);
      const e = 1 - Math.pow(1 - p, 3);
      setTransform({
        scale: from.scale + (scale - from.scale) * e,
        x: from.x + (end.x - from.x) * e,
        y: from.y + (end.y - from.y) * e,
      });
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [viewSize]);

  // ── 포인터: 한 손가락 이동 / 두 손가락 확대 ────────────────────────────────
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const panStart = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = React.useRef<{ dist: number; scale: number; cx: number; cy: number;
                                    tx: number; ty: number } | null>(null);

  const localPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const el = viewportRef.current;
    const r = el?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (!el) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* 캡처 실패는 무시 — 이동은 계속 동작한다 */ }

    if (pointers.current.size === 1) {
      const p = localPoint(e);
      panStart.current = { x: p.x, y: p.y, tx: tRef.current.x, ty: tRef.current.y };
      pinchStart.current = null;
      setDragging(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = el.getBoundingClientRect();
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: tRef.current.scale,
        cx: (a.x + b.x) / 2 - r.left,
        cy: (a.y + b.y) / 2 - r.top,
        tx: tRef.current.x, ty: tRef.current.y,
      };
      panStart.current = null;   // 두 손가락이면 이동 기준을 버린다
    }
  }, []);

  const onPointerMove = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const st = pinchStart.current;
      const next = clamp(st.scale * (dist / st.dist),
        minScaleOf(viewSize(), surfaceRef.current), MAX_SCALE);
      const k = next / st.scale;
      // 두 손가락 가운데가 제자리에 머물도록 이동값을 같이 보정한다(화면이 튀지 않게).
      apply({ scale: next, x: st.cx - (st.cx - st.tx) * k, y: st.cy - (st.cy - st.ty) * k });
      return;
    }

    if (panStart.current) {
      const p = localPoint(e);
      apply({
        scale: tRef.current.scale,
        x: panStart.current.tx + (p.x - panStart.current.x),
        y: panStart.current.ty + (p.y - panStart.current.y),
      });
    }
  }, [apply, viewSize]);

  const endPointer = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    pointers.current.delete(e.pointerId);
    try { el?.releasePointerCapture(e.pointerId); } catch { /* 이미 해제된 경우 무시 */ }

    if (pointers.current.size === 1) {
      // 한 손가락이 빠졌으면 남은 손가락으로 '이동'을 이어 간다(멈춤 상태로 굳지 않게).
      const [only] = [...pointers.current.entries()];
      const r = el?.getBoundingClientRect();
      panStart.current = {
        x: only[1].x - (r?.left ?? 0), y: only[1].y - (r?.top ?? 0),
        tx: tRef.current.x, ty: tRef.current.y,
      };
      pinchStart.current = null;
      setDragging(true);
    } else if (pointers.current.size === 0) {
      panStart.current = null;
      pinchStart.current = null;
      setDragging(false);
    }
  }, []);

  /** 데스크톱: ctrl(또는 ⌘) + 휠만 확대. 일반 휠은 페이지 스크롤로 넘긴다. */
  const onWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const p = { x: e.clientX, y: e.clientY };
    const r = viewportRef.current?.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.08 : 1 / 1.08, p.x - (r?.left ?? 0), p.y - (r?.top ?? 0));
  }, [zoomAt]);

  // 창 크기가 바뀌면 범위를 다시 맞춘다(화면 밖으로 밀려나 있지 않게).
  React.useEffect(() => {
    const onResize = () => apply(tRef.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [apply]);

  return {
    viewportRef,
    transform,
    dragging,
    zoomBy,
    fit,
    reset,
    focusRect,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onWheel,
    },
  };
}
