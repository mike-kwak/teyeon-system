// TEYEON KDK FINAL REPORT — 공개 화면의 ok 외 상태(corrected · not_found · unavailable).
//   corrected: 공식 기록이 정정되어 발행본 수치를 더 이상 보여 주지 않는다(제목 · 날짜 · 공식 결과 링크만).

import React from 'react';
import Link from 'next/link';
import PublicHeader from '@/components/club/PublicHeader';
import { FRV, FRV_SERIF, formatDiff, formatReportDate } from '@/lib/kdk/finalReport/finalReportView';
import type { OfficialResultSummary } from '@/lib/kdk/finalReportPublicService';

export type FinalReportStateKind = 'corrected' | 'not_found' | 'unavailable';

const COPY: Record<FinalReportStateKind, { kicker: string; title: string; body: string }> = {
  corrected: {
    kicker: 'RECORD UPDATED',
    title: '공식 기록이 정정되었습니다',
    body: '운영진이 정정된 기록으로 내용을 다시 확인한 뒤 리포트를 새로 발행합니다. 아래는 현재 공식 기록입니다.',
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

export default function FinalReportStateCard({ kind, title, date, officialHref, retryHref, official }: {
  kind: FinalReportStateKind;
  title?: string;
  date?: string;
  officialHref?: string | null;
  retryHref?: string;
  /** 정정 안내(A안): 서버가 고른 공식 순위 · 완료 경기(정산 없음). 없으면 안내와 새로고침만. */
  official?: OfficialResultSummary | null;
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
              {(kind === 'unavailable' || kind === 'corrected') && retryHref && (
                <a data-fr="retry" href={retryHref} style={btn(!officialHref)}>{kind === 'corrected' ? '새로고침' : '다시 불러오기'}</a>
              )}
              <Link href="/club" style={btn(false)}>TEYEON 둘러보기</Link>
            </div>
          </div>
        </section>
        {kind === 'corrected' && official && <OfficialRecord official={official} />}
        {kind === 'corrected' && !official && (
          <p data-fr="official-missing" style={{ margin: '14px 4px 0', fontSize: 13, fontWeight: 600, lineHeight: 1.6, color: FRV.sub, wordBreak: 'keep-all' }}>
            공식 기록을 지금 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
          </p>
        )}
      </div>
    </main>
  );
}

/** 정정된 공식 기록(순위 저장 순서 그대로 · 완료 경기 점수). 정산 · 계좌 정보는 서버에서 이미 제외. */
function OfficialRecord({ official }: { official: OfficialResultSummary }) {
  return (
    <section data-fr="official-record" style={{ marginTop: 14, borderRadius: 20, overflow: 'hidden', background: FRV.surface, border: `1px solid ${FRV.line}` }}>
      <div style={{ padding: '16px 16px 6px' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.22em', color: FRV.goldInk }}>OFFICIAL RECORD</p>
        <h2 style={{ margin: '6px 0 0', fontSize: 17, fontWeight: 900, color: FRV.ink }}>공식 최종 순위</h2>
      </div>
      <div style={{ padding: '0 16px 12px' }}>
        {official.standings.map((s) => (
          <div key={`${s.rank}-${s.name}`} data-fr="official-row" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 38, borderBottom: `1px solid ${FRV.line}`, fontSize: 14 }}>
            <span style={{ width: 26, fontWeight: 900, color: FRV.navy }}>{s.rank}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 700, color: FRV.ink, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{s.name}</span>
            <span style={{ width: 44, textAlign: 'right', fontWeight: 800, color: FRV.ink }}>{s.wins}-{s.losses}</span>
            <span style={{ width: 40, textAlign: 'right', fontWeight: 700, color: FRV.sub }}>{formatDiff(s.diff)}</span>
          </div>
        ))}
      </div>
      {official.matches.length > 0 && (
        <details data-fr="official-matches" style={{ padding: '0 16px 14px' }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 800, color: FRV.navy, padding: '6px 0' }}>완료 경기 {official.matches.length}개 보기</summary>
          {official.matches.map((m, i) => (
            <div key={i} data-fr="official-match" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${FRV.line}`, fontSize: 13 }}>
              <span style={{ width: 40, color: FRV.sub, fontWeight: 700 }}>{m.round != null ? `R${m.round}` : ''}</span>
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'keep-all', overflowWrap: 'anywhere', color: FRV.ink }}>{m.teamA.join(' · ')} <b>{m.score1}:{m.score2}</b> {m.teamB.join(' · ')}</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 13, fontSize: 14, fontWeight: 900, textDecoration: 'none',
    background: primary ? FRV.navy : FRV.surface, color: primary ? FRV.goldSoft : FRV.ink, border: `1px solid ${primary ? FRV.navy : FRV.line}`,
  };
}
