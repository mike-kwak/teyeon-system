'use client';

// PRIZE — 공식 요강 03 시상. 금액·부상(트로피/메달)을 원문 그대로 표기한다.

import React from 'react';
import { SectionHeading } from './TournamentSection';
import { won, wonNumber } from '@/lib/tournaments/format';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament } from '@/lib/tournaments/types';

export default function TournamentPrize({ event }: { event: OfficialTournament }) {
  return (
    <section>
      <SectionHeading id="tournament-prize" label="PRIZE" />

      {/* 총상금 */}
      <div
        style={{
          marginTop: 14,
          padding: '15px 16px',
          borderRadius: 12,
          backgroundColor: TT.tealSoft,
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontFamily: FONT_LABEL,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.16em',
            color: TT.tealDeep,
            whiteSpace: 'nowrap',
          }}
        >
          TOTAL PRIZE
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: TT.ink, lineHeight: 1.1 }}>
            {wonNumber(event.totalPrize)}
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: TT.ink }}>원</span>
        </span>
      </div>

      {/* 등위별 시상 */}
      <div style={{ marginTop: 6 }}>
        {event.prizes.map((p, i) => (
          <div
            key={p.rank}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 14,
              padding: '13px 0',
              borderBottom:
                i === event.prizes.length - 1 ? 'none' : `1px solid ${TT.lineSoft}`,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: TT.ink, whiteSpace: 'nowrap' }}>
                {p.rank}
              </span>
              <span
                style={{
                  fontFamily: FONT_LABEL,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  color: TT.subtle,
                  whiteSpace: 'nowrap',
                }}
              >
                {p.rankEn}
              </span>
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 800,
                color: TT.ink,
                textAlign: 'right',
                lineHeight: 1.55,
                wordBreak: 'keep-all',
                minWidth: 0,
              }}
            >
              {p.each ? `각 ${won(p.amount)}` : won(p.amount)}
              <span style={{ color: TT.muted, fontWeight: 700 }}> + {p.trophy}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
