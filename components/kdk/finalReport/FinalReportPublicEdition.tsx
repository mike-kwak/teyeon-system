// TEYEON KDK FINAL REPORT — 공개용 리포트(MAINT-002 · 비로그인 · 비회원 · 인스타그램/카카오톡 공유 링크).
//   COVER(브랜드 · 세션 · 참가/경기 집계 · 안전한 문구) → THE DAY IN NUMBERS(개인 식별 없는 집계, V4.1 판만) → 회원 전용 안내(한 곳) → CLOSING.
//   입력은 공개 뷰(FinalReportPublicView)뿐 — 순위 · TOP3 · 우승자 · 개인 승패/득실 · 주요 경기 · 개인 기록 문장은 받을 자리가 없다.
//   훅 · 상태 없음(서버/클라이언트 어디서 그려도 같은 결과). 회원 안내 영역은 FinalReportReader 가 notice 로 넘긴다.

import React from 'react';
import FinalReportShareButtons from './FinalReportShareButtons';
import type { ShareData } from '@/lib/kdk/finalReport/finalReportShare';
import { PUBLIC_NUMBER_TEXT, type FinalReportPublicView } from '@/lib/kdk/finalReport/finalReportPublicView';
import { CLOSING_DEFAULT, FRV, FRV_DISPLAY, FRV_SERIF, formatReportDate } from '@/lib/kdk/finalReport/finalReportView';

const wrap: React.CSSProperties = { width: '100%', maxWidth: 480, margin: '0 auto', boxSizing: 'border-box' };
const text: React.CSSProperties = { overflowWrap: 'anywhere', wordBreak: 'keep-all' };
const LOGO = '/logos/teyeon-logo-transparent-512.png';

export default function FinalReportPublicEdition({ view, share, notice }: {
  view: FinalReportPublicView;
  share: ShareData | null;
  /** 회원 전용 안내(로그인 · 확인 상태). 한 곳에만 둔다. */
  notice: React.ReactNode;
}) {
  const s = view.session;
  return (
    <main data-fr="public-edition" data-fr-access="public"
      style={{ minHeight: '100dvh', width: '100%', background: FRV.bg, color: FRV.ink, overflowX: 'hidden', boxSizing: 'border-box' }}>
      {/* ── COVER ── */}
      <header data-fr="cover" style={{
        width: '100%', color: FRV.onNavy, position: 'relative', overflow: 'hidden',
        background: `radial-gradient(120% 70% at 85% 0%, rgba(227,199,126,0.16) 0%, rgba(227,199,126,0) 55%), linear-gradient(180deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 22px)', paddingBottom: 34,
      }}>
        <div style={{ ...wrap, padding: '0 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO} alt="" width={30} height={30} style={{ width: 30, height: 30, objectFit: 'contain', flexShrink: 0 }} />
              <span style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 15, letterSpacing: '0.32em', color: FRV.goldSoft }}>TEYEON</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.16em', color: FRV.onNavySub, whiteSpace: 'nowrap' }}>
              KDK FINAL REPORT{view.vol ? ` · VOL.${String(view.vol).padStart(2, '0')}` : ''}
            </span>
          </div>

          <div style={{ marginTop: 44, height: 1, width: 44, background: FRV.gold }} />
          <p style={{ margin: '14px 0 0', fontSize: 11, fontWeight: 800, letterSpacing: '0.24em', color: FRV.goldSoft }}>OFFICIAL RESULT</p>
          <h1 style={{ margin: '8px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 'clamp(34px, 10.5vw, 46px)', lineHeight: 1.04, letterSpacing: '-0.01em', color: '#FFFFFF' }}>
            THE FINAL<br />STORY
          </h1>
          <p style={{ ...text, margin: '18px 0 0', fontSize: 19, fontWeight: 800, lineHeight: 1.35, color: FRV.onNavy }}>{s.title || 'TEYEON KDK'}</p>
          {s.date && <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 600, color: FRV.onNavySub }}>{formatReportDate(s.date)}</p>}

          <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', border: `1px solid ${FRV.navyLine}`, borderRadius: 14 }}>
            <CoverStat label="참가" value={String(s.participantCount)} unit="명" />
            <CoverStat label="경기" value={String(s.matchCount)} unit="경기" divider />
            <CoverStat label="기록" value="공식" unit="확정" divider />
          </div>

          {view.headline && (
            <p data-fr="headline" style={{ ...text, margin: '22px 0 0', fontFamily: FRV_SERIF, fontSize: 20, fontWeight: 700, lineHeight: 1.35, color: '#FFFFFF' }}>{view.headline}</p>
          )}
          {view.opening && (
            <p data-fr="opening" style={{ ...text, margin: '18px 0 0', paddingLeft: 12, borderLeft: `2px solid ${FRV.gold}`, fontFamily: FRV_SERIF, fontSize: 15.5, lineHeight: 1.6, color: FRV.onNavy }}>
              {view.opening}
            </p>
          )}
          {share && <div style={{ marginTop: 24 }}><FinalReportShareButtons data={share} variant="cover" /></div>}
        </div>
      </header>

      <div style={{ ...wrap, padding: '0 16px' }}>
        {/* ── THE DAY IN NUMBERS(V4.1 판 집계만 — 개인 식별 없음) ── */}
        {view.numbers.length > 0 && (
          <section data-fr="public-numbers" aria-labelledby="fr-public-numbers-h" style={{ paddingTop: 34 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: FRV.goldInk }}>THE DAY</span>
              <span style={{ flex: 1, height: 1, background: FRV.line }} />
            </div>
            <h2 id="fr-public-numbers-h" style={{ margin: '8px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 26, lineHeight: 1.15, letterSpacing: '-0.01em', color: FRV.ink }}>
              IN NUMBERS
            </h2>
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {view.numbers.map((n) => (
                <div key={n.kind} data-fr="public-number" style={{ minWidth: 0, padding: '14px 14px 13px', borderRadius: 16, background: FRV.surface, border: `1px solid ${FRV.line}` }}>
                  <div style={{ fontFamily: FRV_DISPLAY, fontSize: 32, fontWeight: 700, lineHeight: 1, color: FRV.ink }}>{n.value}</div>
                  <div style={{ ...text, marginTop: 8, fontSize: 13.5, fontWeight: 900, color: FRV.ink }}>{PUBLIC_NUMBER_TEXT[n.kind].label}</div>
                  <div style={{ ...text, marginTop: 2, fontSize: 11.5, fontWeight: 600, lineHeight: 1.45, color: FRV.muted }}>{PUBLIC_NUMBER_TEXT[n.kind].sub}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 회원 전용 안내(한 곳) ── */}
        <div style={{ paddingTop: 30 }}>{notice}</div>
      </div>

      {/* ── CLOSING ── */}
      <footer data-fr="closing" style={{
        marginTop: 40, width: '100%', color: FRV.onNavy, background: `linear-gradient(180deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
        paddingTop: 34, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 34px)',
      }}>
        <div style={{ ...wrap, padding: '0 20px', textAlign: 'center' }}>
          <div style={{ margin: '0 auto', height: 1, width: 44, background: FRV.gold }} />
          <p style={{ margin: '14px 0 0', fontSize: 11, fontWeight: 800, letterSpacing: '0.24em', color: FRV.goldSoft }}>CLOSING</p>
          <h2 style={{ ...text, margin: '8px 0 0', fontFamily: FRV_SERIF, fontWeight: 700, fontSize: 28, lineHeight: 1.15, color: '#FFFFFF' }}>{view.closingTitle || 'UNTIL NEXT MATCH'}</h2>
          <p data-fr={view.closing ? 'closing-text' : 'closing-default'}
            style={{ ...text, margin: '14px auto 0', maxWidth: 360, fontFamily: FRV_SERIF, fontSize: 15.5, lineHeight: 1.62, color: view.closing ? FRV.onNavy : FRV.onNavySub }}>
            {view.closing || CLOSING_DEFAULT}
          </p>
          {view.next && (
            <p data-fr="next-kdk" style={{ margin: '16px 0 0', fontSize: 12.5, fontWeight: 700, color: FRV.goldSoft, letterSpacing: '0.04em' }}>
              NEXT KDK · {formatReportDate(view.next.date)}{view.next.startTime ? ` ${view.next.startTime}` : ''}
            </p>
          )}
          {share && (
            <div style={{ marginTop: 22, textAlign: 'left' }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: FRV.goldSoft, textAlign: 'center' }}>SHARE THE STORY</p>
              <FinalReportShareButtons data={share} variant="closing" />
            </div>
          )}
          <p style={{ margin: '14px 0 0', fontSize: 11.5, fontWeight: 600, lineHeight: 1.55, color: FRV.onNavySub }}>TEYEON KDK 공식 확정 기록 기준입니다.</p>
          <div style={{ marginTop: 26, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO} alt="" width={26} height={26} style={{ width: 26, height: 26, objectFit: 'contain' }} />
            <span style={{ fontFamily: FRV_DISPLAY, fontWeight: 700, fontSize: 13, letterSpacing: '0.32em', color: FRV.goldSoft }}>TEYEON</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function CoverStat({ label, value, unit, divider }: { label: string; value: string; unit: string; divider?: boolean }) {
  return (
    <div style={{ padding: '12px 6px', textAlign: 'center', borderLeft: divider ? `1px solid ${FRV.navyLine}` : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: FRV.onNavySub }}>{label}</div>
      <div style={{ marginTop: 3, whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: FRV_DISPLAY, fontSize: 22, fontWeight: 700, color: '#FFFFFF' }}>{value}</span>
        <span style={{ marginLeft: 2, fontSize: 11, fontWeight: 700, color: FRV.goldSoft }}>{unit}</span>
      </div>
    </div>
  );
}
