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
import { renderDrawSheet, type SheetMeta } from '@/lib/tournaments/drawSheetCanvas';

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
  const [zoom, setZoom] = React.useState<number | null>(null);   // null = 화면 폭 맞춤
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
      const cv = renderDrawSheet(entries, { ...meta, generatedAt: `기준 ${stamp(now)}` }, 2, family);
      cv.toBlob((b) => {
        if (!alive || !b) return;
        blobRef.current = b;
        setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b); });
        setSize({ w: cv.width / 2, h: cv.height / 2 });
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

  const fit = size ? boxW / size.w : 0.25;
  const z = zoom ?? fit;
  const step = (d: number) => setZoom(Math.min(1.6, Math.max(fit, Math.round((z + d) * 100) / 100)));
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
          <button type="button" onClick={() => setZoom(null)} aria-label="화면에 맞춤" data-sheet-action="fit"><Maximize2 size={15} strokeWidth={2.4} /><span>맞춤</span></button>
          <button type="button" onClick={() => step(0.15)} aria-label="확대" data-sheet-action="zoom-in"><Plus size={16} strokeWidth={2.6} /></button>
          <span className="ds-pct" data-sheet-zoom>{Math.round(z * 100)}%</span>
        </div>
        <div className="ds-act">
          {canShare && <button type="button" onClick={() => void share()} data-sheet-action="share"><Share2 size={15} strokeWidth={2.4} />공유</button>}
          <button type="button" className="ds-save" onClick={save} disabled={!url} data-sheet-action="save"><Download size={15} strokeWidth={2.5} />이미지 저장</button>
        </div>
      </div>
      <div ref={boxRef} className="ds-view" data-sheet-view>
        {url && size ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${meta.title} 전체 조편성표`} data-sheet-img width={Math.round(size.w * z)} height={Math.round(size.h * z)}
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
.ds-pct { min-width: 44px; text-align: center; font-size: 12.5px; font-weight: 800; color: ${TT.muted}; font-variant-numeric: tabular-nums; }
.ds-act { display: inline-flex; gap: 6px; }
.ds-act .ds-save { background: ${TT.navy}; border-color: ${TT.navy}; color: #fff; }
.ds-act .ds-save:disabled { opacity: 0.5; }
.ds-view { overflow: auto; -webkit-overflow-scrolling: touch; touch-action: pan-x pan-y pinch-zoom; background: #fff; border: 1px solid ${TT.line}; border-radius: 12px; max-height: 72vh; }
.ds-loading { margin: 0; padding: 28px 14px; text-align: center; font-size: 13px; font-weight: 700; color: ${TT.muted}; }
.ds-msg { margin: 0; font-size: 12.5px; font-weight: 700; color: ${TT.tealDeep}; }
.ds-sr { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); clip: rect(0 0 0 0); white-space: nowrap; }
.ds-note { margin: 0; font-size: 12px; font-weight: 600; color: ${TT.muted}; line-height: 1.6; word-break: keep-all; }
      `}</style>
    </section>
  );
}
