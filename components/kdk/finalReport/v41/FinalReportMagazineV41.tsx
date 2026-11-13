'use client';

// TEYEON FINAL REPORT V4.1 — 8장 스포츠 매거진(edition 3 공개본 전용 · 가로 슬라이드).
//   01 COVER · 02 THE PODIUM · 03 HIDDEN HEROES · 04 MATCH OF THE DAY · 05 RIVALRY 또는 BY THE NUMBERS ·
//   06 FINAL STANDINGS · 07 PENALTY SETTLEMENT(회원 전용) · 08 CLOSING
//
//   ⚠ 표시만 한다: 순위 · 승패 · 점수 · 기록 문장은 공개본 그대로(재계산 · 재정렬 없음, 공식 순위 저장 순서).
//   ⚠ 07 정산은 이 공개본에 없다. 로그인 회원이 그 장을 열 때만 서버(회원 판정)에 요청한다(PenaltyChapter).
//   ⚠ 글꼴: Pretendard(OFL · 자체 호스팅 동적 부분 집합) → Noto Sans KR → 시스템. Calibri 원본은 쓰지 않는다.
//   조작: 가로 스와이프(세로 우세 제스처 무시) · ← → 키 · 하단 화살표. 장 이동은 history 를 쌓지 않고 ?ch= 만 바꾼다.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FinalReportShareButtons from '../FinalReportShareButtons';
import PenaltyChapter from './PenaltyChapter';
import type { ShareData } from '@/lib/kdk/finalReport/finalReportShare';
import type { FinalReportPublicPayload, PublicFeatured, PublicStanding } from '@/lib/kdk/finalReport/finalReportModel';
import type { V41Public } from '@/lib/kdk/finalReport/v41/publicV41';
import { CLOSING_DEFAULT, formatDiff, heroIndex, matchFallbackLine } from '@/lib/kdk/finalReport/finalReportView';

const C = {
  navy: '#0B2340', deep: '#06142A', gold: '#D9B45A', goldText: '#A8842E', goldRule: '#C9A955', teal: '#0E8A9C', ivory: '#FBF9F4', warm: '#F6F1E8',
  silver: '#A3B0BB', bronze: '#B8875A', ink: '#0B2340', sub: '#5B6B79', muted: '#7A8A98', line: '#EEF2F5', paleNavy: '#8FA6BA', onNavy: '#C9D6E2',
};
export const V41_FONT = "'Pretendard Variable', Pretendard, 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";
const LOGO = '/logos/teyeon-logo-transparent.png';
const FONT_CSS = '/fonts/pretendard/pretendardvariable-dynamic-subset.css';
const V41_SPREAD_MIN = 980;   // 이 폭 이상이면 PC 2쪽 펼침
const V41_SPREAD_W = 940;     // 470 × 2(디자인 V4.1 PC)
const V41_SINGLE_MAX = 480;   // 1쪽 최대 폭(태블릿 · 좁은 PC)

type ChapterId = 'cover' | 'podium' | 'heroes' | 'match' | 'rivalry' | 'numbers' | 'standings' | 'penalty' | 'closing';
interface ChapterDef { id: ChapterId; label: string; dark: boolean }
const LABEL: Record<ChapterId, string> = {
  cover: 'COVER', podium: 'THE PODIUM', heroes: 'HIDDEN HEROES', match: 'MATCH OF THE DAY', rivalry: 'RIVALRY',
  numbers: 'BY THE NUMBERS', standings: 'FINAL STANDINGS', penalty: 'PENALTY SETTLEMENT', closing: 'CLOSING',
};
const DARK = new Set<ChapterId>(['cover', 'rivalry', 'numbers', 'closing']);

const dotDate = (d: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.replace(/-/g, '.') : d);
const plainName = (n: string): string => n.replace(/\s*\(G\)\s*$/i, '').trim();
const pad2 = (n: number): string => String(n).padStart(2, '0');
const nameSize = (n: string, big: [string, string, string, string]): string => {
  const len = [...plainName(n)].length;
  return len <= 3 ? big[0] : len <= 5 ? big[1] : len <= 9 ? big[2] : big[3];
};
const weekday = (d: string): string => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) ? ['일', '월', '화', '수', '목', '금', '토'][new Date(t).getUTCDay()] : '';
};

export default function FinalReportMagazineV41({ payload, share, reportSlug }: {
  payload: FinalReportPublicPayload; share: ShareData | null; reportSlug: string | null;
}) {
  const v = payload.v41 as V41Public;
  const motd = payload.featured.length ? payload.featured[heroIndex(payload.featured)] : null;
  const chapters = useMemo<ChapterDef[]>(() => {
    const ids: ChapterId[] = ['cover', 'podium'];
    if (v.heroes.length || v.mentions.length) ids.push('heroes');
    if (motd) ids.push('match');
    ids.push(v.rivalry ? 'rivalry' : 'numbers', 'standings', 'penalty', 'closing');
    return ids.map((id) => ({ id, label: LABEL[id], dark: DARK.has(id) }));
  }, [v, motd]);
  const N = chapters.length;

  const rootRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [rootW, setRootW] = useState(0);
  const [page, setPage] = useState(0);
  const [, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [reduced, setReduced] = useState(false);
  const [ready, setReady] = useState(false); // 첫 표시(깊은 링크 · 로그인 복귀)는 애니메이션 없이 바로 그 장
  // 폭 규칙(디자인 V4.1): 980px 이상 = 2쪽 펼침(470 × 2) · 그보다 좁으면 1쪽(최대 480px, 모바일은 화면 폭).
  const frameW = rootW >= V41_SPREAD_MIN ? V41_SPREAD_W : Math.min(rootW, V41_SINGLE_MAX);
  const perView = frameW >= 900 ? 2 : 1;
  const pw = frameW ? frameW / perView : 0;
  const start = perView === 2 ? page - (page % 2) : page;
  const shown = perView === 2 ? [start, Math.min(start + 1, N - 1)] : [page];

  useEffect(() => {
    const el = rootRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setRootW(el.clientWidth));
    ro.observe(el); setRootW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    try { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { setReduced(false); }
    // 로그인 후 돌아오기 · 공유된 장 링크: ?ch=<id>
    try {
      const ch = new URLSearchParams(window.location.search).get('ch');
      const i = chapters.findIndex((c) => c.id === ch);
      if (i > 0) setPage(i);
      setTimeout(() => setReady(true), 50);
    } catch { /* ignore */ }
  }, [chapters]);

  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(N - 1, n));
    setPage(next);
    setVisited((s) => (s.has(next) ? s : new Set([...s, next])));
    try {
      const u = new URL(window.location.href);
      if (next === 0) u.searchParams.delete('ch'); else u.searchParams.set('ch', chapters[next].id);
      window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
    } catch { /* ignore */ }
  }, [N, chapters]);
  const step = perView;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(start + step); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(start - step); }
  };
  const t0 = useRef<{ x: number; y: number } | null>(null);
  const onTS = (e: React.TouchEvent) => { const t = e.touches[0]; t0.current = { x: t.clientX, y: t.clientY }; };
  const onTE = (e: React.TouchEvent) => {
    if (!t0.current) return;
    const t = e.changedTouches[0]; const dx = t.clientX - t0.current.x; const dy = t.clientY - t0.current.y; t0.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? start + step : start - step);
  };

  const cur = chapters[perView === 2 ? Math.min(start + 1, N - 1) : page];
  const dark = cur.dark;
  const current = chapters[page];
  const vol = v.vol != null ? pad2(v.vol) : null;


  const render = (c: ChapterDef, i: number) => {
    const active = shown.includes(i);
    switch (c.id) {
      case 'cover': return <Cover payload={payload} vol={vol} />;
      case 'podium': return <Podium payload={payload} />;
      case 'heroes': return <Heroes v={v} no={i + 1} />;
      case 'match': return <MatchOfTheDay m={motd as PublicFeatured} no={i + 1} standings={payload.standings} />;
      case 'rivalry': return <Rivalry v={v} no={i + 1} />;
      case 'numbers': return <Numbers v={v} no={i + 1} />;
      case 'standings': return <Standings rows={payload.standings} no={i + 1} />;
      case 'penalty': return <PenaltyChapter no={i + 1} slug={reportSlug} active={active} sessionDate={payload.session.date} />;
      case 'closing': return <Closing payload={payload} v={v} vol={vol} share={share} onRestart={() => go(0)} />;
    }
  };

  return (
    // 공개 페이지: 앱 공용 셸(450px)을 바꾸지 않고, V4.1 화면만 뷰포트 전체를 덮는다(position: fixed) — v1/v2 화면 무영향.
    // 편집기 미리보기(reportSlug 없음): 모달 안 고정 높이 상자.
    <main ref={rootRef} data-fr="magazine" data-v41="root" data-v41-layout={perView === 2 ? 'spread' : 'single'}
      style={reportSlug
        ? { position: 'fixed', inset: 0, zIndex: 40, width: '100%', background: 'radial-gradient(120% 90% at 50% 0%, #0E2A4C 0%, #06142A 60%, #040C18 100%)', fontFamily: V41_FONT, overflow: 'hidden' }
        : { position: 'relative', width: '100%', height: 'min(740px, 78dvh)', background: C.deep, fontFamily: V41_FONT, overflow: 'hidden' }}>
      {/* React 19: 문서 head 로 올라가는 스타일시트(이 화면에서만 Pretendard 로드) */}
      <link rel="stylesheet" href={FONT_CSS} precedence="default" />
      <div
        ref={frameRef} data-v41="frame" tabIndex={0} onKeyDown={onKey} onTouchStart={onTS} onTouchEnd={onTE}
        role="region" aria-roledescription="carousel" aria-label={`TEYEON FINAL REPORT ${payload.session.title}`}
        style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: frameW || '100%', transform: 'translateX(-50%)', overflow: 'hidden', outline: 'none', touchAction: 'pan-y',
          boxShadow: frameW && frameW < rootW ? '0 22px 60px rgba(0,0,0,0.45)' : 'none' }}
      >
        <div data-v41="track" style={{ position: 'absolute', top: 0, left: 0, height: '100%', display: 'flex', width: pw ? pw * N : `${N * 100}%`,
          transform: `translateX(${-(pw || 0) * start}px)`, transition: reduced || !ready ? 'none' : 'transform 380ms cubic-bezier(0.22,0.8,0.24,1)' }}>
          {chapters.map((c, i) => {
            const on = shown.includes(i);
            return (
              <section key={c.id} data-ch={c.id} data-active={on ? '1' : '0'} role="group" aria-roledescription="slide"
                aria-label={`${i + 1} / ${N} ${c.label}`} aria-hidden={!on} inert={!on}
                style={{ width: pw || '100vw', height: '100%', flex: 'none', position: 'relative', overflow: 'hidden', containerType: 'size' } as React.CSSProperties}>
                {render(c, i)}
              </section>
            );
          })}
        </div>
        {perView === 2 && <div aria-hidden style={{ position: 'absolute', left: pw - 14, top: 0, bottom: 0, width: 28, zIndex: 2, pointerEvents: 'none',
          background: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.16) 50%, rgba(0,0,0,0) 100%)' }} />}
        <div aria-hidden data-v41="progress" style={{ position: 'absolute', left: 16, right: 16, top: 'calc(env(safe-area-inset-top, 0px) + 12px)', display: 'flex', gap: 4, zIndex: 3, pointerEvents: 'none' }}>
          {chapters.map((c, i) => (
            <div key={c.id} style={{ flex: 1, height: 3, borderRadius: 2,
              background: i <= (perView === 2 ? Math.min(start + 1, N - 1) : page) ? (dark ? C.gold : C.navy) : (dark ? 'rgba(255,255,255,0.22)' : 'rgba(11,35,64,0.14)') }} />
          ))}
        </div>
        <nav data-v41="nav" aria-label="리포트 장 이동" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, boxSizing: 'border-box',
          height: 'calc(60px + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 14, paddingRight: 14,
          display: 'flex', alignItems: 'center', gap: 10, background: dark ? 'rgba(6,20,41,0.92)' : 'rgba(255,255,255,0.94)', borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : '#E3E9EF'}` }}>
          <button type="button" data-v41="prev" aria-label="이전 장" onClick={() => go(start - step)} disabled={start <= 0} style={navBtn(dark, start <= 0)}>←</button>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }} aria-live="polite">
            <div data-v41="counter" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: dark ? C.gold : C.goldText }}>
              {perView === 2 ? `${start + 1}–${Math.min(start + 2, N)} / ${N}` : `${page + 1} / ${N}`}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: dark ? '#FFFFFF' : C.navy, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{current.label}</div>
          </div>
          <button type="button" data-v41="next" aria-label="다음 장" onClick={() => go(start + step)} disabled={start + step >= N} style={navBtn(dark, start + step >= N)}>→</button>
        </nav>
      </div>
    </main>
  );
}

function navBtn(dark: boolean, off: boolean): React.CSSProperties {
  return { width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, border: 'none', background: 'transparent',
    color: dark ? '#FFFFFF' : C.navy, opacity: off ? 0.25 : 1, cursor: off ? 'default' : 'pointer', fontFamily: 'inherit' };
}
// 장 제목: Pretendard 는 Calibri 보다 넓어 원본 자간(0.3em)이면 320~390px 에서 두 줄이 된다 → 크기 · 자간을 줄이고 한 줄 고정.
const kicker = (color: string): React.CSSProperties => ({ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.2em', color, whiteSpace: 'nowrap' });
const wrapText: React.CSSProperties = { wordBreak: 'keep-all', overflowWrap: 'anywhere' };
/** 장 안 세로 스크롤 영역. 아래 여백 = 하단 내비(60px) + 여유 + safe-area — 마지막 줄이 내비에 가리지 않게.
 *  ⚠ padding 축약 속성과 함께 쓰면 아래 여백이 덮이므로 위 · 좌우 여백도 여기서 따로 받는다. */
const scroller = (top: string, side: string, bottom = 84): React.CSSProperties => ({
  flex: 1, minHeight: 0, overflowY: 'auto', touchAction: 'pan-y', overscrollBehavior: 'contain',
  paddingTop: top, paddingLeft: side, paddingRight: side, paddingBottom: `calc(${bottom}px + env(safe-area-inset-bottom, 0px))`,
});
const GuestTag = ({ on, size = '3.2cqw' }: { on: boolean; size?: string }) => (on ? <span data-v41="g" style={{ fontSize: size, fontWeight: 700, color: '#8A99A6', marginLeft: '1cqw' }}>(G)</span> : null);

// ── 01 COVER ──────────────────────────────────────────────────────────────
function Cover({ payload, vol }: { payload: FinalReportPublicPayload; vol: string | null }) {
  const ch = payload.podium[0];
  const name = ch ? plainName(ch.name) : '';
  return (
    <div data-v41="cover" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(170deg, #0E2A4C 0%, #0B2340 45%, #061529 100%)', color: '#FFFFFF' }}>
      <div aria-hidden style={{ position: 'absolute', left: '9cqw', right: '9cqw', top: '16cqh', bottom: '12cqh', border: '1.5px solid rgba(217,180,90,0.16)' }} />
      <div aria-hidden style={{ position: 'absolute', left: '20cqw', right: '20cqw', top: '16cqh', bottom: '12cqh', borderLeft: '1px solid rgba(217,180,90,0.10)', borderRight: '1px solid rgba(217,180,90,0.10)' }} />
      <div aria-hidden style={{ position: 'absolute', left: '9cqw', right: '9cqw', top: '52cqh', borderTop: '1.5px solid rgba(217,180,90,0.22)' }} />
      <div aria-hidden style={{ position: 'absolute', right: '-8cqw', top: '6cqh', fontSize: '92cqw', fontWeight: 800, lineHeight: 0.8, letterSpacing: '-0.06em', color: 'transparent', WebkitTextStroke: '1.5px rgba(217,180,90,0.30)' }}>01</div>
      <div aria-hidden style={{ position: 'absolute', right: '3.2cqw', top: '19cqh', writingMode: 'vertical-rl', fontSize: '2.6cqw', fontWeight: 700, letterSpacing: '0.42em', color: 'rgba(217,180,90,0.6)' }}>
        OFFICIAL RECORD · TEYEON KDK{vol ? ` · VOL.${vol}` : ''}
      </div>
      <div style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: 'calc(env(safe-area-inset-top, 0px) + 7.5cqh)', display: 'flex', alignItems: 'center', gap: '3cqw' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} alt="Team TEYEON" style={{ width: '13cqw', height: '13cqw', objectFit: 'contain' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '3.3cqw', fontWeight: 700, letterSpacing: '0.28em', color: C.gold }}>TEYEON</div>
          <div style={{ fontSize: '5.4cqw', fontWeight: 800, letterSpacing: '0.06em', lineHeight: 1.05 }}>FINAL REPORT</div>
        </div>
        {vol && <div data-v41="vol" style={{ textAlign: 'right' }}><div style={{ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.16em', color: C.paleNavy }}>VOL.</div><div style={{ fontSize: '7cqw', fontWeight: 800, color: C.gold, lineHeight: 1 }}>{vol}</div></div>}
      </div>
      <div style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: '34cqh', bottom: 'calc(9cqh + 64px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '3cqh' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2.5cqw' }}><div style={{ width: '9cqw', height: 3, background: C.gold }} /><div style={{ fontSize: '4cqw', fontWeight: 700, letterSpacing: '0.36em', color: C.gold }}>CHAMPION</div></div>
          <h1 data-v41="champion" style={{ margin: '2.4cqh 0 0', fontSize: nameSize(name, ['26cqw', '19cqw', '12cqw', '9cqw']), fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.03em', ...wrapText }}>
            {name}<GuestTag on={!!ch?.guest} size="5cqw" />
          </h1>
          {payload.headline && <p data-v41="headline" style={{ margin: '2.4cqh 0 0', fontSize: '5cqw', color: C.onNavy, lineHeight: 1.45, textWrap: 'pretty', ...wrapText } as React.CSSProperties}>{payload.headline}</p>}
        </div>
        {ch && (
          <div style={{ display: 'flex', alignItems: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '2.2cqh' }}>
            <div style={{ flex: 1 }}><div data-v41="cover-rec" style={{ fontSize: '11cqw', fontWeight: 800, color: C.gold, lineHeight: 1.05 }}>{ch.wins}-{ch.losses}</div><div style={{ marginTop: '0.8cqh', fontSize: '2.9cqw', fontWeight: 700, letterSpacing: '0.2em', color: C.paleNavy }}>W – L</div></div>
            <div style={{ flex: 1, borderLeft: '1px solid rgba(255,255,255,0.14)', paddingLeft: '4cqw' }}><div style={{ fontSize: '11cqw', fontWeight: 800, lineHeight: 1.05 }}>{formatDiff(ch.diff)}</div><div style={{ marginTop: '0.8cqh', fontSize: '2.9cqw', fontWeight: 700, letterSpacing: '0.2em', color: C.paleNavy }}>GAME DIFF</div></div>
            <div style={{ textAlign: 'right', maxWidth: '34cqw' }}><div style={{ fontSize: '3.6cqw', fontWeight: 700 }}>{dotDate(payload.session.date)}</div><div style={{ marginTop: '0.6cqh', fontSize: '3.2cqw', color: C.paleNavy, ...wrapText }}>{payload.session.title}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 02 PODIUM ─────────────────────────────────────────────────────────────
function Podium({ payload }: { payload: FinalReportPublicPayload }) {
  const [ch, ...runners] = payload.podium;
  const date = dotDate(payload.session.date);
  if (!ch) return null;
  // 운영진 스토리가 있을 때만 문장을 보인다(없으면 위 승패 · 득실과 같은 기록을 되풀이하지 않음).
  const story = (p: typeof ch) => p.story || null;
  return (
    <div data-v41="podium" style={{ position: 'absolute', inset: 0, background: C.ivory }}>
      <div style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: 'calc(env(safe-area-inset-top, 0px) + 7cqh)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={kicker(C.goldText)}>02 · THE PODIUM</div><div style={{ fontSize: '3cqw', color: '#B3A68A' }}>{date}</div>
      </div>
      <div aria-hidden style={{ position: 'absolute', left: '-4cqw', top: '10cqh', fontSize: '74cqw', fontWeight: 800, lineHeight: 0.82, color: '#EFE6D2', letterSpacing: '-0.06em' }}>1</div>
      <div data-vscroll="1" style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: '15cqh', bottom: 'calc(2cqh + 62px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '3cqh', overflowY: 'auto', touchAction: 'pan-y' }}>
        <div style={{ flex: 'none', paddingTop: '6cqh', position: 'relative' }}>
          <div style={{ fontSize: '3.4cqw', fontWeight: 700, letterSpacing: '0.3em', color: C.goldText }}>GOLD · 1ST</div>
          <div data-v41="podium-1" style={{ marginTop: '1.2cqh', fontSize: nameSize(ch.name, ['19cqw', '15cqw', '10cqw', '8cqw']), fontWeight: 800, color: C.navy, lineHeight: 1.05, letterSpacing: '-0.03em', ...wrapText }}>
            {plainName(ch.name)}<GuestTag on={ch.guest} size="4cqw" />
          </div>
          <div style={{ marginTop: '1.6cqh', display: 'flex', gap: '4cqw', alignItems: 'baseline' }}>
            <div style={{ fontSize: '7cqw', fontWeight: 800, color: C.goldRule }}>{ch.wins}-{ch.losses}</div>
            <div style={{ fontSize: '5cqw', fontWeight: 700, color: C.navy }}>득실 {formatDiff(ch.diff)}</div>
          </div>
          {story(ch) && <p data-v41="podium-story" style={{ margin: '1.6cqh 0 0', fontSize: '4.1cqw', color: '#4A5866', lineHeight: 1.55, maxWidth: '82cqw', ...wrapText }}>{story(ch)}</p>}
        </div>
        <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '5cqw' }}>
          {runners.map((p, i) => {
            const medal = i === 0 ? C.silver : C.bronze;
            return (
              <div key={p.rank} data-v41={`podium-${p.rank}`} style={{ borderTop: `3px solid ${medal}`, paddingTop: '2cqh', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '2cqw' }}>
                  <div style={{ fontSize: '15cqw', fontWeight: 800, color: medal, lineHeight: 0.9 }}>{p.rank}</div>
                  <div style={{ fontSize: '2.9cqw', fontWeight: 700, letterSpacing: '0.2em', color: i === 0 ? C.muted : '#9A6E45' }}>{i === 0 ? 'SILVER' : 'BRONZE'}</div>
                </div>
                <div style={{ marginTop: '1.2cqh', fontSize: '6.4cqw', fontWeight: 800, color: C.navy, lineHeight: 1.15, ...wrapText }}>{plainName(p.name)}<GuestTag on={p.guest} /></div>
                <div style={{ marginTop: '0.8cqh', fontSize: '4cqw', fontWeight: 700, color: C.sub }}>{p.wins}-{p.losses} · {formatDiff(p.diff)}</div>
                {story(p) && <p data-v41="podium-story" style={{ margin: '1cqh 0 0', fontSize: '3.4cqw', color: '#6B7885', lineHeight: 1.5, ...wrapText }}>{story(p)}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 03 HIDDEN HEROES ──────────────────────────────────────────────────────
function Heroes({ v, no }: { v: V41Public; no: number }) {
  return (
    <div data-v41="heroes" style={{ position: 'absolute', inset: 0, background: C.warm, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 7cqh) 7cqw 0', flex: 'none' }}>
        <div style={kicker(C.goldText)}>{pad2(no)} · BEYOND THE PODIUM</div>
        <div style={{ marginTop: '1cqh', fontSize: '10cqw', fontWeight: 800, color: C.navy, lineHeight: 1.05, letterSpacing: '-0.02em' }}>Hidden Heroes</div>
        <div style={{ marginTop: '1cqh', fontSize: '3.8cqw', color: '#6B7885' }}>시상대 밖에서도, 기록은 남습니다.</div>
      </div>
      <div data-vscroll="1" style={scroller('2.4cqh', '7cqw')}>
        {v.heroes.map((h, i) => (
          <article key={i} data-v41="hero" style={{ position: 'relative', padding: '2.4cqh 0 2.2cqh', borderTop: '1px solid #DCCFB6' }}>
            <div aria-hidden style={{ position: 'absolute', right: 0, top: '1cqh', fontSize: '18cqw', fontWeight: 800, color: '#EBE1CE', lineHeight: 1, letterSpacing: '-0.04em' }}>{h.stat}</div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '2cqw', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '3.4cqw', fontWeight: 700, letterSpacing: '0.24em', color: C.navy }}>{h.title}</div>
              <div data-v41="source" style={{ fontSize: '2.7cqw', fontWeight: 700, padding: '2px 6px', borderRadius: 2,
                color: h.source === 'archive' ? '#8A5A12' : C.teal, background: h.source === 'archive' ? '#F7E9CF' : '#E2F1F3' }}>{h.source === 'archive' ? '공식 기록 검증' : '오늘 기록'}</div>
            </div>
            <div style={{ position: 'relative', marginTop: '1.2cqh', display: 'flex', alignItems: 'baseline', gap: '3cqw', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '8.2cqw', fontWeight: 800, color: C.navy, lineHeight: 1.1, ...wrapText }}>{plainName(h.name)}<GuestTag on={/\(G\)\s*$/.test(h.name)} /></div>
              <div style={{ fontSize: '6.2cqw', fontWeight: 800, color: C.goldRule, whiteSpace: 'nowrap' }}>{h.stat}</div>
            </div>
            <div style={{ position: 'relative', marginTop: '1cqh', fontSize: '4cqw', fontWeight: 700, color: '#33434F', lineHeight: 1.4, ...wrapText }}>{h.head}</div>
            <div style={{ position: 'relative', marginTop: '0.6cqh', fontSize: '3.6cqw', color: '#6B7885', lineHeight: 1.55, ...wrapText }}>{h.line}</div>
          </article>
        ))}
        {v.mentions.length > 0 && (
          <div style={{ borderTop: '1px solid #DCCFB6', paddingTop: '1.8cqh' }}>
            <div style={{ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.2em', color: C.goldText }}>ALSO ON THE RECORD</div>
            {v.mentions.map((m, i) => (
              <div key={i} data-v41="mention" style={{ marginTop: '1.2cqh', display: 'flex', gap: '3cqw', alignItems: 'baseline' }}>
                <div style={{ fontSize: '4.4cqw', fontWeight: 800, color: C.navy, maxWidth: '40cqw', ...wrapText }}>{m.name}</div>
                <div style={{ flex: 1, fontSize: '3.6cqw', color: '#6B7885', lineHeight: 1.45, ...wrapText }}>{m.line}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 04 MATCH OF THE DAY ───────────────────────────────────────────────────
function MatchOfTheDay({ m, no, standings }: { m: PublicFeatured; no: number; standings: PublicStanding[] }) {
  const aWin = m.score1 >= m.score2;
  const win = aWin ? m.teamA : m.teamB; const lose = aWin ? m.teamB : m.teamA;
  const ws = aWin ? m.score1 : m.score2; const ls = aWin ? m.score2 : m.score1;
  const draw = m.score1 === m.score2;
  const meta = [m.round != null ? `ROUND ${m.round}` : '', m.court != null ? `COURT ${m.court}` : ''].filter(Boolean).join(' · ');
  const title = m.review || m.note || matchFallbackLine(m);
  // 운영진 리뷰가 없을 때 빈 공간 대신: 이 경기에 나온 네 선수의 오늘 공식 기록(공개본 순위표 값 그대로).
  const byName = new Map(standings.map((s) => [plainName(s.name), s]));
  const players = draw ? [] : [...win.map((n) => ({ n, side: 'W' as const })), ...lose.map((n) => ({ n, side: 'L' as const }))]
    .map((p) => ({ ...p, s: byName.get(plainName(p.n)) })).filter((p) => !!p.s);
  return (
    <div data-v41="match" style={{ position: 'absolute', inset: 0, background: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', background: C.navy, position: 'relative', overflow: 'hidden', padding: 'calc(env(safe-area-inset-top, 0px) + 7cqh) 7cqw 3cqh', clipPath: 'polygon(0 0, 100% 0, 100% 88%, 0 100%)' }}>
        <div aria-hidden style={{ position: 'absolute', right: '-6cqw', bottom: '-4cqh', fontSize: '62cqw', fontWeight: 800, color: 'rgba(217,180,90,0.10)', lineHeight: 0.8 }}>{ws}</div>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2cqw' }}>
          <div style={kicker(C.gold)}>{pad2(no)} · MATCH OF THE DAY</div>
          <div style={{ fontSize: '2.6cqw', fontWeight: 700, letterSpacing: '0.06em', color: C.paleNavy, whiteSpace: 'nowrap' }}>{meta}</div>
        </div>
        <div style={{ position: 'relative', marginTop: '2.6cqh', display: 'flex', alignItems: 'center', gap: '4cqw' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.24em', color: C.gold }}>{draw ? 'TEAM' : 'WINNER'}</div>
            <div data-v41="motd-win" style={{ marginTop: '0.8cqh', fontSize: '6.2cqw', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.25, ...wrapText }}>{win.join(' · ')}</div>
          </div>
          <div style={{ fontSize: '28cqw', fontWeight: 800, color: '#FFFFFF', lineHeight: 0.9, letterSpacing: '-0.04em' }}>{ws}</div>
        </div>
        <div style={{ position: 'relative', margin: '2.2cqh 0 3.4cqh', display: 'flex', alignItems: 'center', gap: '3cqw' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.18)' }} />
          <div style={{ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.3em', color: C.paleNavy }}>{Math.abs(ws - ls) === 1 ? 'ONE GAME APART' : ls === 0 && ws > 0 ? 'CLEAN SHEET' : 'FINAL'}</div>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.18)' }} />
        </div>
      </div>
      <div style={{ flex: 'none', padding: '0.6cqh 7cqw 0', display: 'flex', alignItems: 'center', gap: '4cqw' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '3cqw', fontWeight: 700, letterSpacing: '0.24em', color: '#A3B0BB' }}>{draw ? 'TEAM' : 'RUNNER'}</div>
          <div style={{ marginTop: '0.8cqh', fontSize: '5.4cqw', fontWeight: 600, color: '#7A8A98', lineHeight: 1.25, ...wrapText }}>{lose.join(' · ')}</div>
        </div>
        <div style={{ fontSize: '20cqw', fontWeight: 800, color: '#D3DAE1', lineHeight: 0.9, letterSpacing: '-0.04em' }}>{ls}</div>
      </div>
      <div data-vscroll="1" style={scroller('2.8cqh', '7cqw')}>
        <div data-v41="motd-title" style={{ fontSize: '6cqw', fontWeight: 800, color: C.navy, lineHeight: 1.3, textWrap: 'pretty', ...wrapText } as React.CSSProperties}>{title}</div>
        <div style={{ marginTop: '2.2cqh', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', borderTop: `2px solid ${C.navy}` }}>
          {[{ v: `${m.score1}:${m.score2}`, l: '최종 스코어' }, { v: String(m.score1 + m.score2), l: '총 게임 수' }, { v: String(Math.abs(m.score1 - m.score2)), l: '점수 차' }].map((k) => (
            <div key={k.l} style={{ paddingTop: '1.4cqh' }}><div style={{ fontSize: '7cqw', fontWeight: 800, color: C.navy, lineHeight: 1.05 }}>{k.v}</div><div style={{ marginTop: '0.6cqh', fontSize: '3cqw', color: C.muted }}>{k.l}</div></div>
          ))}
        </div>
        {!m.review && players.length > 0 && (
          <div data-v41="motd-players" style={{ marginTop: '3.2cqh' }}>
            <div style={{ fontSize: '2.9cqw', fontWeight: 700, letterSpacing: '0.18em', color: C.goldText }}>THE FOUR · 오늘 공식 기록</div>
            {players.map(({ n, side, s }) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '2cqw', minHeight: '9cqw', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ width: '5cqw', fontSize: '2.8cqw', fontWeight: 800, color: side === 'W' ? C.goldRule : '#A3B0BB' }}>{side}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: '3.9cqw', fontWeight: 700, color: C.navy, ...wrapText }}>{plainName(n)}<GuestTag on={!!s?.guest} size="2.8cqw" /></span>
                <span style={{ fontSize: '3.4cqw', fontWeight: 600, color: C.sub, whiteSpace: 'nowrap' }}>{s?.rank}위 · {s?.wins}-{s?.losses} · {formatDiff(s?.diff ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 05 RIVALRY ────────────────────────────────────────────────────────────
function Rivalry({ v, no }: { v: V41Public; no: number }) {
  const r = v.rivalry!;
  return (
    <div data-v41="rivalry" style={{ position: 'absolute', inset: 0, background: '#050F1E', color: '#FFFFFF' }}>
      <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '48cqh', background: 'linear-gradient(180deg, #0B1A2E 0%, #0A1626 100%)', clipPath: 'polygon(0 0, 100% 0, 100% 82%, 0 100%)' }} />
      <div style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: 'calc(env(safe-area-inset-top, 0px) + 7cqh)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={kicker(C.gold)}>{pad2(no)} · RIVALRY</div>
        <div style={{ fontSize: '2.7cqw', fontWeight: 700, color: '#06142A', background: C.gold, padding: '2px 6px', borderRadius: 2 }}>공식 기록 검증</div>
      </div>
      <div style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: '13cqh' }}>
        <div style={{ fontSize: '3.4cqw', fontWeight: 700, letterSpacing: '0.36em', color: '#56708A' }}>BEFORE</div>
        <div data-v41="rival-before" style={{ marginTop: '1cqh', fontSize: '26cqw', fontWeight: 800, color: '#2A4060', lineHeight: 0.9, letterSpacing: '-0.04em' }}>{r.priorWins}–{r.priorLosses}</div>
        <div style={{ marginTop: '1.2cqh', fontSize: '3.8cqw', fontWeight: 700, letterSpacing: '0.2em', color: '#56708A' }}>{r.priorWins} WIN / {r.priorLosses} LOSS{r.priorLosses === 1 ? '' : 'ES'}</div>
        <div aria-hidden style={{ marginTop: '1.4cqh', display: 'flex', gap: '1.5cqw' }}>
          {r.recent.map((x, i) => <div key={i} style={{ width: '8cqw', height: '1.2cqh', background: x === 'W' ? C.gold : '#2A4060' }} />)}
        </div>
      </div>
      <div style={{ position: 'absolute', left: '7cqw', right: '7cqw', top: '46cqh', bottom: 'calc(60px + 2.5cqh + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflowY: 'auto' }}>
        <div>
          <div style={{ fontSize: '3.4cqw', fontWeight: 700, letterSpacing: '0.36em', color: C.gold }}>TODAY</div>
          <div style={{ marginTop: '0.6cqh', fontSize: '15cqw', fontWeight: 800, color: C.gold, lineHeight: 1, letterSpacing: '-0.02em' }}>VICTORY</div>
          <div style={{ marginTop: '1.6cqh', display: 'flex', alignItems: 'center', gap: '4cqw' }}>
            <div style={{ fontSize: '11cqw', fontWeight: 800, lineHeight: 1 }}>{r.scoreWin}<span style={{ color: '#56708A' }}> : </span>{r.scoreLose}</div>
            <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid rgba(255,255,255,0.16)', paddingLeft: '4cqw' }}>
              <div data-v41="rival-winner" style={{ fontSize: '5.2cqw', fontWeight: 800, ...wrapText }}>{r.winner}</div>
              <div style={{ fontSize: '3.4cqw', color: C.paleNavy, ...wrapText }}>vs {r.loser}</div>
            </div>
          </div>
          <div style={{ marginTop: '2cqh', fontSize: '5.2cqw', fontWeight: 800, lineHeight: 1.35, ...wrapText }}>{r.title}</div>
          <div style={{ marginTop: '1cqh', fontSize: '3.6cqw', color: C.paleNavy, lineHeight: 1.6, ...wrapText }}>{r.line}</div>
        </div>
      </div>
    </div>
  );
}

// ── 05 BY THE NUMBERS(라이벌이 없을 때) ────────────────────────────────────
function Numbers({ v, no }: { v: V41Public; no: number }) {
  const color = ['#FFFFFF', '#4FC3D2', '#FFFFFF', C.gold];
  return (
    <div data-v41="numbers" style={{ position: 'absolute', inset: 0, background: C.navy, display: 'flex', flexDirection: 'column', color: '#FFFFFF' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 7cqh) 7cqw 0' }}>
        <div style={kicker('#4FC3D2')}>{pad2(no)} · BY THE NUMBERS</div>
        <div style={{ marginTop: '1cqh', fontSize: '9cqw', fontWeight: 800, lineHeight: 1.1 }}>오늘의 기록</div>
        <div style={{ marginTop: '1cqh', display: 'inline-block', fontSize: '2.7cqw', fontWeight: 700, color: C.navy, background: '#4FC3D2', padding: '2px 6px', borderRadius: 2 }}>공식 경기 기록 기준</div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gridTemplateRows: 'repeat(2, minmax(0,1fr))',
        margin: '3cqh 7cqw calc(64px + 4cqh + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        {v.numbers.map((n, i) => (
          <div key={n.kind} data-v41="number" style={{ padding: `2.4cqh 0 0 ${i % 2 ? '5cqw' : '0'}`, borderLeft: i % 2 ? '1px solid rgba(255,255,255,0.12)' : 'none', borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.12)' : 'none', minWidth: 0 }}>
            <div style={{ fontSize: '15cqw', fontWeight: 800, color: color[i], lineHeight: 0.95 }}>{n.value}</div>
            <div style={{ marginTop: '1cqh', fontSize: '3.6cqw', fontWeight: 700, color: C.onNavy }}>{n.label}</div>
            <div style={{ marginTop: '0.4cqh', fontSize: '3.2cqw', color: C.paleNavy, lineHeight: 1.4, ...wrapText }}>{n.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 06 FINAL STANDINGS ────────────────────────────────────────────────────
function Standings({ rows, no }: { rows: PublicStanding[]; no: number }) {
  const guests = rows.filter((r) => r.guest).length;
  return (
    <div data-v41="standings" style={{ position: 'absolute', inset: 0, background: '#FFFFFF', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 7cqh) 6cqw 0', flex: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={kicker(C.teal)}>{pad2(no)} · FINAL STANDINGS</div>
          <div style={{ fontSize: '3cqw', color: C.muted }}>{rows.length}명{guests ? ` · G ${guests}` : ''}</div>
        </div>
        <div style={{ marginTop: '1cqh', fontSize: '8cqw', fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>공식 최종 순위</div>
        <div style={{ marginTop: '2cqh', display: 'flex', fontSize: '3cqw', fontWeight: 700, color: C.muted, paddingBottom: '1cqh', borderBottom: `2px solid ${C.navy}` }}>
          <div style={{ width: '10cqw' }}>#</div><div style={{ flex: 1 }}>선수</div><div style={{ width: '14cqw', textAlign: 'right' }}>W–L</div><div style={{ width: '13cqw', textAlign: 'right' }}>득실</div>
        </div>
      </div>
      <div data-vscroll="1" data-v41="standings-list" style={scroller('0px', '6cqw', 80)}>
        {rows.map((r, i) => (
          <div key={`${r.rank}-${r.name}`} data-fr="standing-row" style={{ minHeight: '11cqw', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.line}`, background: i < 3 ? C.ivory : 'transparent' }}>
            <div style={{ width: '10cqw', fontSize: '4.4cqw', fontWeight: 800, color: i === 0 ? C.goldRule : i === 1 ? '#8A99A6' : i === 2 ? C.bronze : '#B4C0CB' }}>{r.rank}</div>
            <div style={{ flex: 1, minWidth: 0, padding: '1cqh 0', fontSize: '4.2cqw', fontWeight: i < 3 ? 800 : 600, color: C.navy, lineHeight: 1.25, ...wrapText }}>{plainName(r.name)}<GuestTag on={r.guest} size="3cqw" /></div>
            <div style={{ width: '14cqw', textAlign: 'right', fontSize: '4.2cqw', fontWeight: 800, color: C.navy }}>{r.wins}-{r.losses}</div>
            <div style={{ width: '13cqw', textAlign: 'right', fontSize: '3.9cqw', fontWeight: 600, color: '#33434F' }}>{formatDiff(r.diff)}</div>
          </div>
        ))}
        <div style={{ paddingTop: '2cqh', fontSize: '3cqw', color: C.muted, lineHeight: 1.5 }}>공식 Archive 순위 그대로 표시합니다 · (G) 게스트</div>
      </div>
    </div>
  );
}

// ── 08 CLOSING ────────────────────────────────────────────────────────────
function Closing({ payload, v, vol, share, onRestart }: { payload: FinalReportPublicPayload; v: V41Public; vol: string | null; share: ShareData | null; onRestart: () => void }) {
  const next = v.next;
  return (
    <div data-v41="closing" style={{ position: 'absolute', inset: 0, background: C.navy, color: '#FFFFFF', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
      padding: 'calc(env(safe-area-inset-top, 0px) + 9cqh) 7cqw calc(64px + 3cqh + env(safe-area-inset-bottom, 0px))' }}>
      {/* 장식 테두리 = 위쪽 콘텐츠의 틀(흐름 배치) — 아래 NEXT KDK · 버튼 영역과 겹치지 않는다 */}
      <div data-v41="closing-frame" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', margin: '0 2cqw 2.4cqh', border: '1px solid rgba(217,180,90,0.12)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3cqh 4cqw', textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO} alt="Team TEYEON" style={{ width: '20cqw', height: '20cqw', objectFit: 'contain', flex: 'none' }} />
        <div style={{ marginTop: '2.6cqh', fontSize: '8.2cqw', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.01em' }}>Every Match<br />Has a Story.</div>
        <div style={{ marginTop: '1.2cqh', fontSize: '3.8cqw', color: C.paleNavy }}>모든 경기에는 이야기가 있다</div>
        <div style={{ marginTop: '2.2cqh', fontSize: '3.2cqw', fontWeight: 700, letterSpacing: '0.24em', color: C.gold }}>{vol ? `VOL.${vol} · ` : ''}{dotDate(payload.session.date)}</div>
        <div data-v41="closing-note" style={{ marginTop: '2.8cqh', fontSize: '4cqw', color: C.onNavy, lineHeight: 1.6, ...wrapText }}>
          {payload.closing ? <>“{payload.closing}”<div style={{ marginTop: '0.8cqh', fontSize: '3.2cqw', color: '#56708A' }}>— TEYEON 운영진</div></> : CLOSING_DEFAULT}
        </div>
      </div>
      <div data-v41="closing-actions" style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: '1.4cqh' }}>
        {next ? (
          <div data-v41="next-kdk" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.4cqh 0', borderTop: '1px solid rgba(255,255,255,0.14)' }}>
            <div style={{ fontSize: '3.2cqw', fontWeight: 700, letterSpacing: '0.22em', color: C.paleNavy }}>NEXT KDK</div>
            <div style={{ fontSize: '4.4cqw', fontWeight: 800 }}>{dotDate(next.date).slice(5)} ({weekday(next.date)}){next.startTime ? ` ${next.startTime}` : ''} 정모</div>
          </div>
        ) : (
          // 확정 · 취소 여부를 확인할 수 없는 일정은 날짜로 못 박지 않고, 최신 클럽 일정으로 안내한다.
          <a data-v41="next-schedule" href="/club/schedule" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.4cqh 0', borderTop: '1px solid rgba(255,255,255,0.14)', color: '#FFFFFF', textDecoration: 'none' }}>
            <span style={{ fontSize: '3.2cqw', fontWeight: 700, letterSpacing: '0.22em', color: C.paleNavy }}>NEXT KDK</span>
            <span style={{ fontSize: '4cqw', fontWeight: 800 }}>클럽 일정에서 확인 →</span>
          </a>
        )}
        {share && <div data-v41="share"><FinalReportShareButtons data={share} variant="closing" /></div>}
        <button type="button" data-v41="restart" onClick={onRestart} style={{ height: '10cqw', maxHeight: 44, minHeight: 40, color: C.onNavy, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3.8cqw', fontWeight: 600, borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>표지로 돌아가기</button>
      </div>
    </div>
  );
}
