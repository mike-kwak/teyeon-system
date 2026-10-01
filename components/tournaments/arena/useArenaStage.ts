'use client';

// Arena 화면 맞춤 · 전체화면 (Batch 4E-1).
//
//   1920×1080 설계 캔버스를 실제 화면에 'contain' 으로 맞춘다
//   (scale = min(w/1920, h/1080)) — 어떤 화면비에서도 잘리지 않는다.
//   ⚠ KDK 전광판에서 검증된 방식과 같은 계산이지만, 그 파일을 수정하거나 가져오지 않는다.
//   ⚠ 전체화면은 실패해도 화면이 깨지지 않아야 한다 — 실패하면 그냥 일반 화면으로 남는다.

import React from 'react';
import { ARENA_CANVAS } from './arenaTheme';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const fsElement = (): Element | null => {
  if (typeof document === 'undefined') return null;
  const d = document as FsDocument;
  return document.fullscreenElement || d.webkitFullscreenElement || null;
};

export interface ArenaStage {
  /** 전체화면 대상이 되는 바깥 요소. */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** 1920×1080 캔버스에 적용할 배율. */
  scale: number;
  isFullscreen: boolean;
  /** 이 브라우저에서 전체화면을 쓸 수 있는가(안 되면 버튼을 숨긴다). */
  canFullscreen: boolean;
  toggleFullscreen: () => void;
}

export function useArenaStage(): ArenaStage {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [canFullscreen, setCanFullscreen] = React.useState(false);

  // 화면 크기에 맞춰 배율 계산. 전체화면 전환 시 resize 가 늦는 환경이 있어 함께 듣는다.
  React.useEffect(() => {
    const calc = () => {
      const w = window.innerWidth / ARENA_CANVAS.width;
      const h = window.innerHeight / ARENA_CANVAS.height;
      const s = Math.min(w, h);
      setScale(Number.isFinite(s) && s > 0 ? s : 1);
    };
    calc();
    window.addEventListener('resize', calc);
    document.addEventListener('fullscreenchange', calc);
    document.addEventListener('webkitfullscreenchange', calc);
    return () => {
      window.removeEventListener('resize', calc);
      document.removeEventListener('fullscreenchange', calc);
      document.removeEventListener('webkitfullscreenchange', calc);
    };
  }, []);

  React.useEffect(() => {
    const d = document as FsDocument;
    const el = rootRef.current as FsElement | null;
    setCanFullscreen(Boolean(
      document.fullscreenEnabled || d.webkitFullscreenEnabled
      || el?.requestFullscreen || el?.webkitRequestFullscreen,
    ));

    const onChange = () => setIsFullscreen(fsElement() !== null);
    onChange();
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    const root = rootRef.current as FsElement | null;
    const d = document as FsDocument;
    void (async () => {
      try {
        if (fsElement()) {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
          return;
        }
        if (!root) return;
        if (root.requestFullscreen) await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
      } catch {
        // 전체화면 실패는 화면을 깨뜨리지 않는다 — 일반 화면 그대로 둔다.
      }
    })();
  }, []);

  return { rootRef, scale, isFullscreen, canFullscreen, toggleFullscreen };
}
