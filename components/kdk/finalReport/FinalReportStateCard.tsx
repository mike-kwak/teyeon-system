// TEYEON KDK FINAL REPORT — 공개 화면의 ok 외 상태(corrected · not_found · unavailable).
//   corrected: 공식 기록이 정정되어 발행본 수치를 더 이상 보여 주지 않는다(제목 · 날짜 · 공식 결과 링크만).

import React from 'react';
import Link from 'next/link';
import PublicHeader from '@/components/club/PublicHeader';
import { FRV, FRV_SERIF, formatReportDate } from '@/lib/kdk/finalReport/finalReportView';

export type FinalReportStateKind = 'corrected' | 'not_found' | 'unavailable';

const COPY: Record<FinalReportStateKind, { kicker: string; title: string; body: string }> = {
  corrected: {
    kicker: 'RECORD UPDATED',
    title: '공식 기록이 정정되었습니다',
    body: '운영진이 정정된 기록으로 내용을 다시 확인한 뒤 리포트를 새로 발행합니다. 최신 순위와 점수는 공식 결과에서 확인해 주세요.',
  },
  not_found: {
    kicker: 'FINAL REPORT',
    title: '공개된 리포트가 없습니다',
    body: '링크가 잘못되었거나 운영진이 공개를 중단한 리포트입니다.',
  },
  unavailable: {
    kicker: 'FINAL REPORT',
    title: '잠시 후 다시 시도해 주세요',
    body: '리포트를 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 열어 주세요.',
  },
};

export default function FinalReportStateCard({ kind, title, date, officialHref, retryHref }: {
  kind: FinalReportStateKind;
  title?: string;
  date?: string;
  officialHref?: string | null;
  retryHref?: string;
}) {
  const c = COPY[kind];
  return (
    <main data-fr={`state-${kind}`} style={{ minHeight: '100dvh', width: '100%', background: FRV.bg, color: FRV.ink, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)', boxSizing: 'border-box' }}>
      <PublicHeader />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 0', boxSizing: 'border-box' }}>
        <section style={{ borderRadius: 20, overflow: 'hidden', background: FRV.surface, border: `1px solid ${FRV.line}`, boxShadow: '0 1px 2px rgba(18,35,58,0.05)' }}>
          <div style={{ background: `linear-gradient(180deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`, padding: '20px 18px 18px', color: FRV.onNavy }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: FRV.goldSoft }}>{c.kicker}</p>
            <h1 style={{ margin: '8px 0 0', fontFamily: FRV_SERIF, fontSize: 22, fontWeight: 700, lineHeight: 1.3, color: '#FFFFFF', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{c.title}</h1>
            {kind === 'corrected' && (title || date) && (
              <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 700, color: FRV.onNavySub, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
                {[title, date ? formatReportDate(date) : ''].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div style={{ padding: '16px 18px 18px' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.6, color: FRV.sub, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{c.body}</p>
            <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
              {officialHref && (
                <Link data-fr="official-link" href={officialHref} style={btn(true)}>공식 KDK 결과 보기</Link>
              )}
              {kind === 'unavailable' && retryHref && (
                <a data-fr="retry" href={retryHref} style={btn(!officialHref)}>다시 불러오기</a>
              )}
              <Link href="/club" style={btn(false)}>TEYEON 둘러보기</Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 13, fontSize: 14, fontWeight: 900, textDecoration: 'none',
    background: primary ? FRV.navy : FRV.surface, color: primary ? FRV.goldSoft : FRV.ink, border: `1px solid ${primary ? FRV.navy : FRV.line}`,
  };
}
