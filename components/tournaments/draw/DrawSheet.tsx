'use client';

// 전체 조편성표(가로형 공식 표) — 확대 · 이동 보기 + 이미지 저장 · 공유.
//
//   ⚠ 표는 drawSheetCanvas 가 그린 PNG 한 장이다 — 화면에 보이는 그림 = 저장되는 그림.
//   ⚠ 입력 entries 는 모바일 대진표와 같은 것(PrelimDrawViews 가 한 번 만든다).
//   ⚠ 저장 · 공유한 이미지는 그 시점 기준이다. 선수 교체 · 코트 변경 후에는 다시 저장해야 한다(화면에 안내).

import React from 'react';
import { Download, Minus, Plus, Maximize2, Share2 } from 'lucide-react';
import { TT } from '@/components/tournaments/tournamentTheme';
import type { DrawEntry } from '@/lib/tournaments/officialDrawModel';
import { renderDrawSheet, type SheetMeta, type SheetRowBox } from '@/lib/tournaments/drawSheetCanvas';

/** 휴대폰에서 처음 열 때의 배율 — 화면 맞춤이 이보다 작으면 이 배율(선수 이름 약 14px)로 연다. */
const READ_ZOOM = 0.62;
/** 가장 크게(버튼 · 손가락 공통). 가장 작게는 화면 폭 맞춤. */
const MAX_ZOOM = 2;

const pad2 = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export default function DrawSheet({ entries, meta, fileBase }: {
  entries: DrawEntry[];
  meta: Omit<SheetMeta, 'generatedAt'>;
  /** 저장 파일 이름 앞부분(예: '2026-teyeon-open'). */
  fileBase: string;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  // null = 처음 배율(휴대폰은 READ_ZOOM, 넓은 화면은 맞춤). 'fit' = 화면 폭 맞춤. 숫자 = 사용자가 고른 배율.
  const [zoom, setZoom] = React.useState<number | 'fit' | null>(null);
  const [rowBoxes, setRowBoxes] = React.useState<SheetRowBox[]>([]);
  const [jump, setJump] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);
  const [canShare, setCanShare] = React.useState(false);
  const blobRef = React.useRef<Blob | null>(null);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = React.useState(360);
  const generatedRef = React.useRef('');

  // 데이터가 바뀌면 다시 그린다(글꼴 로드 후 — 화면 글꼴 그대로).
  React.useEffect(() => {
    let alive = true;
    const run = async () => {
      try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* 글꼴 대기 실패해도 그린다 */ }
      const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
      const now = new Date(); generatedRef.current = stamp(now);
      const out = renderDrawSheet(entries, { ...meta, generatedAt: `기준 ${stamp(now)}` }, 2, family);
      const cv = out.canvas;
      cv.toBlob((b) => {
        if (!alive || !b) return;
        blobRef.current = b;
        setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
        setSize({ w: out.width, h: out.height });
        setRowBoxes(out.rows);
        try { setCanShare(typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([b], 'x.png', { type: 'image/png' })] })); } catch { setCanShare(false); }
      }, 'image/png');
    };
    void run();
    return () => { alive = false; };
  }, [entries, meta]);
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  React.useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // 보기 창 높이 = 실제로 보이는 화면 높이의 72%(px). ⚠ CSS 72vh 만 믿지 않는다 — 일부 인앱 · WebView 는 vh 를 실제 화면보다 훨씬 크게 잡아,
  //   기본 배율에서 보기 창이 표 높이만큼 늘어나 버린다(표 아래는 화면 밖으로 잘리는데 세로로 움직일 거리가 0 이 되던 원인).
  React.useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const vv = window.visualViewport;
    const apply = () => {
      // innerHeight · visualViewport 까지 크게 주는 WebView 가 있어, 기기 화면 높이(screen.height)도 상한으로 함께 쓴다.
      const h = Math.min(window.innerHeight || Infinity, vv?.height || Infinity, window.screen?.height || Infinity);
      if (Number.isFinite(h) && h > 0) el.style.maxHeight = `${Math.max(260, Math.round(h * 0.72))}px`;
    };
    apply();
    window.addEventListener('resize', apply); vv?.addEventListener('resize', apply);
    return () => { window.removeEventListener('resize', apply); vv?.removeEventListener('resize', apply); };
  }, []);

  const fit = size ? boxW / size.w : 0.25;
  const z = zoom === 'fit' ? fit : zoom ?? (fit < READ_ZOOM ? READ_ZOOM : fit);

  // ── 배율 · 이동 — 버튼과 손가락 제스처가 같은 zoom 상태를 쓴다 ──
  //   배율을 바꿀 때 기준점(anchor: 보기 창 안 위치 ax · ay 에 있던 표 위 점 cx · cy)을 남기면, 다시 그린 뒤 그 점이 같은 자리에 오도록 스크롤한다.
  const zRef = React.useRef(z); zRef.current = z;
  const fitRef = React.useRef(fit); fitRef.current = fit;
  const sizeRef = React.useRef(size); sizeRef.current = size;
  const pctRef = React.useRef<HTMLSpanElement | null>(null);
  const anchorRef = React.useRef<{ cx: number; cy: number; ax: number; ay: number } | null>(null);
  const clampZ = (v: number, lo: number) => Math.min(MAX_ZOOM, Math.max(lo, v));
  const zoomAt = (nz: number, ax?: number, ay?: number) => {
    const v = boxRef.current;
    if (v) {
      const px = ax ?? v.clientWidth / 2; const py = ay ?? v.clientHeight / 2; const cur = zRef.current;
      anchorRef.current = { cx: (v.scrollLeft + px) / cur, cy: (v.scrollTop + py) / cur, ax: px, ay: py };
    }
    setZoom(nz);
  };
  React.useLayoutEffect(() => {
    const a = anchorRef.current; const v = boxRef.current;
    if (!a || !v) return;
    anchorRef.current = null;
    v.scrollLeft = a.cx * z - a.ax; v.scrollTop = a.cy * z - a.ay;
  }, [z]);
  // 배율 글자 — React 가 그리지 않는 안쪽 span 에만 쓴다(제스처 중에도 같은 곳을 직접 갱신 · React 텍스트 노드와 충돌 없음).
  React.useLayoutEffect(() => { if (pctRef.current) pctRef.current.textContent = `${Math.round(z * 100)}%`; }, [z]);
  const step = (d: number) => zoomAt(clampZ(Math.round((z + d) * 100) / 100, fit));
  const fitAll = () => {
    const v = boxRef.current;
    if (v) anchorRef.current = { cx: 0, cy: (v.scrollTop + v.clientHeight / 2) / zRef.current, ax: 0, ay: v.clientHeight / 2 };
    setZoom('fit');
  };

  // 손가락 제스처(Pointer Events) — 두 손가락 = 가운데 점 기준 확대 · 축소(+ 이동), 한 손가락 = 상하좌우 이동(관성 · 표 끝에서 멈춤, 페이지는 움직이지 않음).
  //   ⚠ 페이지 viewport 확대는 열지 않는다(layout 의 userScalable: false 유지) — 이 표 영역만 직접 처리한다(.ds-view touch-action: none).
  //   ⚠ 제스처 중에는 이미지 크기만 직접 바꾸고(매 프레임 React 렌더 없음), 손을 떼면 zoom 상태에 반영한다.
  //   마우스는 브라우저 기본 스크롤 그대로(Ctrl + 휠 · 트랙패드 핀치는 커서 기준 확대).
  React.useEffect(() => {
    const v = boxRef.current; if (!v) return;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d0: number; z0: number; cx: number; cy: number } | null = null;
    let live = 0; let lastT = 0; let vx = 0; let vy = 0; let raf = 0;
    // 이동 위치는 소수까지 따로 기억한다 — scrollLeft/Top 은 브라우저가 반올림해서, 매 이동마다 읽어 쓰면 오차가 쌓여 손가락보다 앞서 간다.
    let tx = 0; let ty = 0;
    const syncPos = () => { tx = v.scrollLeft; ty = v.scrollTop; };
    // 손가락 이동만큼 표만 민다. 표 끝에 닿으면 거기서 멈춘다 — 페이지로 넘기지 않는다(표와 페이지가 같이 움직이던 원인).
    const panBy = (dx: number, dy: number) => {
      const maxX = Math.max(0, v.scrollWidth - v.clientWidth); const maxY = Math.max(0, v.scrollHeight - v.clientHeight);
      tx = Math.min(maxX, Math.max(0, tx - dx));
      ty = Math.min(maxY, Math.max(0, ty - dy));
      v.scrollLeft = tx; v.scrollTop = ty;
    };
    const paint = (nz: number) => {
      const s = sizeRef.current; const im = v.querySelector('img');
      if (s && im) { im.style.width = `${Math.round(s.w * nz)}px`; im.style.height = `${Math.round(s.h * nz)}px`; }
      if (pctRef.current) pctRef.current.textContent = `${Math.round(nz * 100)}%`;
    };
    const two = () => { const [a, b] = [...pts.values()]; return { a, b, d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
    const startPinch = () => {
      const { d, mx, my } = two(); const r = v.getBoundingClientRect(); const z0 = zRef.current;
      pinch = { d0: d, z0, cx: (v.scrollLeft + mx - r.left) / z0, cy: (v.scrollTop + my - r.top) / z0 };
      live = z0;
    };
    const commit = () => {
      if (live && Math.abs(live - zRef.current) > 0.0005) {
        anchorRef.current = { cx: v.scrollLeft / live, cy: v.scrollTop / live, ax: 0, ay: 0 };
        zRef.current = live;          // 다시 그리기 전에 다음 제스처가 와도 이 배율에서 이어지게
        setZoom(live);
      }
      live = 0;
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !sizeRef.current) return;
      cancelAnimationFrame(raf);
      try { v.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastT = e.timeStamp; vx = 0; vy = 0; syncPos();
      if (pts.size === 2) startPinch();
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId); if (!p) return;
      e.preventDefault();
      if (pinch && pts.size >= 2) {
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const { d, mx, my } = two(); const r = v.getBoundingClientRect();
        const nz = clampZ((pinch.z0 * d) / pinch.d0, fitRef.current);
        live = nz; paint(nz);
        v.scrollLeft = pinch.cx * nz - (mx - r.left); v.scrollTop = pinch.cy * nz - (my - r.top);
        return;
      }
      const dx = e.clientX - p.x; const dy = e.clientY - p.y; const dt = Math.max(1, e.timeStamp - lastT);
      vx = dx / dt; vy = dy / dt; lastT = e.timeStamp;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      panBy(dx, dy);
    };
    const up = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pinch) { if (pts.size < 2) { pinch = null; commit(); vx = 0; vy = 0; lastT = e.timeStamp; syncPos(); } return; }
      // 관성 — 손을 떼기 직전에 움직이고 있었을 때만
      if (pts.size === 0 && e.timeStamp - lastT < 80 && (Math.abs(vx) > 0.05 || Math.abs(vy) > 0.05)) {
        let fx = vx * 16; let fy = vy * 16;
        const tick = () => { panBy(fx, fy); fx *= 0.94; fy *= 0.94; if (Math.abs(fx) > 0.3 || Math.abs(fy) > 0.3) raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !sizeRef.current) return;   // Ctrl + 휠 · 트랙패드 핀치만 — 보통 휠은 기본 스크롤
      e.preventDefault();
      const r = v.getBoundingClientRect(); const cur = zRef.current;
      const nz = clampZ(cur * Math.exp(-e.deltaY * 0.01), fitRef.current);
      anchorRef.current = { cx: (v.scrollLeft + e.clientX - r.left) / cur, cy: (v.scrollTop + e.clientY - r.top) / cur, ax: e.clientX - r.left, ay: e.clientY - r.top };
      zRef.current = nz; setZoom(nz);
    };
    const block = (e: Event) => e.preventDefault();   // iOS Safari — 표 위 두 손가락이 페이지 전체 확대로 가지 않게
    // touch-action 을 무시하는 브라우저(일부 인앱 · 구형 WebView)에서도 표 위 손가락이 페이지를 끌지 않게. touchstart 는 막지 않는다(누르기 · 길게 누르기 유지).
    const holdTouch = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    v.addEventListener('touchmove', holdTouch, { passive: false });
    v.addEventListener('pointerdown', down);
    v.addEventListener('pointermove', move, { passive: false });
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', wheel, { passive: false });
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) v.addEventListener(t, block, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('touchmove', holdTouch);
      v.removeEventListener('pointerdown', down); v.removeEventListener('pointermove', move);
      v.removeEventListener('pointerup', up); v.removeEventListener('pointercancel', up);
      v.removeEventListener('wheel', wheel);
      for (const t of ['gesturestart', 'gesturechange', 'gestureend']) v.removeEventListener(t, block);
    };
  }, []);
  // 조 이동 — 그 조 행이 보기 창 맨 위에 오도록(가로는 맨 왼쪽: 조 · 코트 · 차수 · 신고가 보이게).
  const goRow = (key: string) => {
    setJump(key);
    const b = rowBoxes.find((r) => r.key === key); const v = boxRef.current;
    if (!b || !v) return;
    v.scrollTo({ top: Math.max(0, Math.round(b.y * z) - 8), left: 0, behavior: 'smooth' });
  };
  const fileName = `${fileBase}-예선조편성표-${generatedRef.current.replace(/[-: ]/g, '').slice(0, 12)}.png`;

  const save = () => {
    if (!blobRef.current || !url) return;
    const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
    setMsg('이미지를 저장했습니다. 휴대폰에서는 길게 눌러 사진에 저장할 수도 있습니다.');
  };
  const share = async () => {
    if (!blobRef.current) return;
    try {
      await navigator.share({ files: [new File([blobRef.current], fileName, { type: 'image/png' })], title: meta.title });
    } catch { /* 사용자가 닫음 */ }
  };

  return (
    <section className="ds-wrap" data-sheet>
      <div className="ds-bar">
        <div className="ds-zoom" role="group" aria-label="확대 · 축소">
          <button type="button" onClick={() => step(-0.15)} aria-label="축소" data-sheet-action="zoom-out"><Minus size={16} strokeWidth={2.6} /></button>
          <button type="button" onClick={fitAll} aria-label="화면에 맞춤" data-sheet-action="fit"><Maximize2 size={15} strokeWidth={2.4} /><span>맞춤</span></button>
          <button type="button" onClick={() => step(0.15)} aria-label="확대" data-sheet-action="zoom-in"><Plus size={16} strokeWidth={2.6} /></button>
          <span className="ds-pct" aria-live="polite"><span ref={pctRef} data-sheet-zoom /></span>
        </div>
        <div className="ds-act">
          {canShare && <button type="button" onClick={() => void share()} data-sheet-action="share"><Share2 size={15} strokeWidth={2.4} />공유</button>}
          <button type="button" className="ds-save" onClick={save} disabled={!url} data-sheet-action="save"><Download size={15} strokeWidth={2.5} />이미지 저장</button>
        </div>
      </div>
      {rowBoxes.length > 0 && (
        <label className="ds-jump">
          <span>조 이동</span>
          <select value={jump} onChange={(ev) => goRow(ev.target.value)} data-sheet-jump aria-label="조편성표에서 조로 이동">
            <option value="" disabled>조 선택</option>
            {rowBoxes.map((r) => <option key={r.key} value={r.key}>{r.court !== null ? `${r.court}번 코트 · ` : ''}{r.label}</option>)}
          </select>
          <small>표 위에서 두 손가락으로 확대 · 축소, 한 손가락으로 밀어 옆 팀을 볼 수 있습니다</small>
        </label>
      )}
      <div ref={boxRef} className="ds-view" data-sheet-view>
        {url && size ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${meta.title} 전체 조편성표`} data-sheet-img draggable={false} width={Math.round(size.w * z)} height={Math.round(size.h * z)}
            style={{ width: Math.round(size.w * z), height: Math.round(size.h * z), maxWidth: 'none', display: 'block' }} />
        ) : <p className="ds-loading">조편성표를 만드는 중…</p>}
      </div>
      {/* 이미지와 같은 내용의 표(화면 읽기 프로그램용 · 눈에는 안 보임). */}
      <div className="ds-sr"><table data-sheet-table>
        <caption>{meta.title}</caption>
        <thead><tr><th>조</th><th>코트</th><th>차수</th><th>신고 마감</th><th>팀</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.key} data-sheet-row={e.key}>
              <td>{e.label}</td><td>{e.courtNo ?? ''}</td><td>{e.sessionNo ? `${e.sessionNo}차` : ''}</td><td>{e.checkinDeadline ?? ''}</td>
              <td>{e.teams.map((t, i) => (
                <span key={t.teamNo} data-sheet-team={t.teamNo}>{i > 0 ? ' / ' : ''}{t.player1Name}{t.club1 ? `(${t.club1})` : ''} · {t.player2Name}{t.club2 ? `(${t.club2})` : ''}</span>
              ))}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {msg && <p className="ds-msg" role="status">{msg}</p>}
      <p className="ds-note" data-sheet-note>
        저장 · 공유한 이미지는 저장한 시점 기준입니다. 선수 교체나 코트 변경이 있으면 이미지가 자동으로 바뀌지 않으니 다시 저장해 주세요. 실제 코트와 진행 상황은 모바일 대진표가 기준입니다.
      </p>
      <style>{`
.ds-wrap { position: relative; display: flex; flex-direction: column; gap: 10px; }
.ds-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.ds-zoom { display: inline-flex; align-items: center; gap: 4px; }
.ds-zoom button, .ds-act button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 40px; min-height: 40px; padding: 0 10px;
  border: 1px solid ${TT.line}; border-radius: 10px; background: #fff; color: ${TT.inkSoft}; font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer; }
.ds-pct { min-width: 52px; padding: 0 6px; text-align: center; font-size: 15px; font-weight: 900; color: ${TT.ink}; font-variant-numeric: tabular-nums; }
.ds-jump { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; font-weight: 800; color: ${TT.inkSoft}; }
.ds-jump select { min-height: 40px; padding: 0 10px; border: 1px solid ${TT.line}; border-radius: 10px; background: #fff; font-family: inherit; font-size: 15px; font-weight: 800; color: ${TT.ink}; }
.ds-jump small { flex-basis: 100%; font-size: 12px; font-weight: 600; color: ${TT.muted}; }
.ds-act { display: inline-flex; gap: 6px; }
.ds-act .ds-save { background: ${TT.navy}; border-color: ${TT.navy}; color: #fff; }
.ds-act .ds-save:disabled { opacity: 0.5; }
.ds-view { overflow: auto; touch-action: none; overscroll-behavior: contain; -webkit-user-select: none; user-select: none; background: #fff; border: 1px solid ${TT.line}; border-radius: 12px; max-height: 72vh; }
.ds-loading { margin: 0; padding: 28px 14px; text-align: center; font-size: 13px; font-weight: 700; color: ${TT.muted}; }
.ds-msg { margin: 0; font-size: 12.5px; font-weight: 700; color: ${TT.tealDeep}; }
.ds-sr { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); clip: rect(0 0 0 0); white-space: nowrap; }
.ds-note { margin: 0; font-size: 12px; font-weight: 600; color: ${TT.muted}; line-height: 1.6; word-break: keep-all; }
      `}</style>
    </section>
  );
}
