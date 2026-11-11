// TEYEON KDK FINAL REPORT — OG 이미지(1200×630) 레이아웃(P4). next/og ImageResponse(satori)용 JSX — 서버에서만 그린다.
//   satori 규칙: 자식이 둘 이상인 div 는 display:flex 필수 · 외부 폰트/이미지 요청 없음(폰트 · 로고는 route 가 넘긴다).
//   내용은 OgView(공개 발행본에서 만든 값)만 쓴다. 중립 이미지는 세션 · 이름 없이 브랜드만.

import React from 'react';
import { FRV, type OgView } from '@/lib/kdk/finalReport/finalReportView';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_FONT = 'TEYEON OG';
/** TOP3 이름 글자 크기 — 한글 기준 칸 폭(약 250px)에 한 줄로 들어가게. */
const ogNameSize = (name: string): number => { const n = [...name].length; return n <= 6 ? 30 : n <= 8 ? 26 : 22; };

export default function FinalReportOgImage({ view, crest }: { view: OgView; crest: string }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: OG_FONT, color: FRV.onNavy,
      backgroundColor: FRV.navyDeep,
      backgroundImage: `radial-gradient(circle at 88% 8%, rgba(227,199,126,0.20) 0%, rgba(227,199,126,0) 42%), linear-gradient(160deg, ${FRV.navy} 0%, ${FRV.navyDeep} 100%)`,
      padding: '52px 64px 44px',
    }}>
      {/* 머리: 브랜드 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 26, letterSpacing: 9, color: FRV.goldSoft }}>TEYEON</span>
          <span style={{ width: 1, height: 22, background: 'rgba(227,199,126,0.4)', margin: '0 18px' }} />
          <span style={{ fontSize: 18, letterSpacing: 4, color: 'rgba(244,241,232,0.7)' }}>KDK FINAL REPORT</span>
        </div>
        <span style={{ fontSize: 16, letterSpacing: 3, color: 'rgba(244,241,232,0.55)' }}>OFFICIAL RESULT</span>
      </div>

      {/* 본문: 제목 + 문장(왼쪽) · 방패 로고(오른쪽) */}
      <div style={{ display: 'flex', flex: 1, marginTop: 30 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', width: 64, height: 3, background: FRV.gold }} />
          <span style={{ marginTop: 22, fontSize: 86, lineHeight: 1, letterSpacing: -1, color: '#FFFFFF' }}>THE FINAL STORY</span>
          {view.kind === 'report' ? (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 22 }}>
              <span style={{ fontSize: 40, lineHeight: 1.2, color: FRV.onNavy }}>{view.title}</span>
              {view.date ? <span style={{ marginTop: 8, fontSize: 26, color: 'rgba(244,241,232,0.68)' }}>{view.date}</span> : null}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26 }}>
              <span style={{ fontSize: 38, lineHeight: 1.25, color: FRV.onNavy }}>TEYEON KDK 공식 결과 리포트</span>
              <span style={{ marginTop: 10, fontSize: 24, color: 'rgba(244,241,232,0.62)' }}>공식 확정 기록 기준 경기 결과 매거진</span>
            </div>
          )}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={crest} width={view.kind === 'report' ? 186 : 236} height={view.kind === 'report' ? 200 : 254}
          style={{ marginLeft: 36, marginTop: view.kind === 'report' ? 0 : 6, objectFit: 'contain' }} />
      </div>

      {/* TOP3(발행본만) — 공식 순서 그대로 */}
      {view.kind === 'report' && view.top3.length > 0 ? (
        <div style={{ display: 'flex', marginTop: 18 }}>
          {view.top3.map((p, i) => (
            <div key={p.rank} style={{
              display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, marginLeft: i ? 14 : 0, padding: '14px 18px', borderRadius: 18,
              background: i === 0 ? 'rgba(227,199,126,0.16)' : 'rgba(255,255,255,0.06)',
              border: i === 0 ? '2px solid rgba(227,199,126,0.7)' : '1px solid rgba(227,199,126,0.25)',
            }}>
              <span style={{ fontSize: 46, lineHeight: 1, color: i === 0 ? FRV.goldSoft : 'rgba(244,241,232,0.8)', width: 40, flexShrink: 0 }}>{p.rank}</span>
              <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 12, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                <span style={{ fontSize: 14, letterSpacing: 3, color: FRV.goldSoft }}>{p.label}</span>
                {/* 한 줄 고정(긴 이름은 글자 크기를 줄이고, 그래도 넘치면 말줄임) — 순위 숫자와 겹치지 않게 */}
                <span style={{ marginTop: 4, fontSize: ogNameSize(p.name), lineHeight: 1.15, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 바닥 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
        <span style={{ fontSize: 20, letterSpacing: 2, color: 'rgba(244,241,232,0.78)' }}>TEYEON Tennis Club</span>
        <span style={{ fontSize: 17, color: 'rgba(244,241,232,0.5)' }}>공식 확정 기록 기준</span>
      </div>
    </div>
  );
}
