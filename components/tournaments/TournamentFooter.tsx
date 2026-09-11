'use client';

// 공식 대회 사이트 푸터 — 주최/주관 · 후원 · 대회 운영본부.
//   브랜드 표기는 TEYEON / TEYEON TENNIS CLUB 만 사용한다.
//   장소·기관명의 '아산'(아산시 강변 테니스장 / 아산시 테니스 협회)은 그대로 유지한다.
//   개인 연락처는 여기 두지 않는다(요강 07 CONTACT 블록에서만 노출).

import React from 'react';
import Image from 'next/image';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament } from '@/lib/tournaments/types';

const label: React.CSSProperties = {
  margin: 0,
  fontFamily: FONT_LABEL,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.18em',
  color: TT.subtle,
};

export default function TournamentFooter({ event }: { event: OfficialTournament }) {
  return (
    <footer style={{ paddingTop: 26, paddingBottom: 4 }}>
      <div style={{ height: 1, backgroundColor: TT.line, marginBottom: 22 }} />

      <p style={label}>HOSTED BY</p>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ width: 38, height: 38, flexShrink: 0, display: 'inline-flex' }}>
          <Image
            src="/logos/teyeon-logo-current.png"
            alt="TEYEON TENNIS CLUB"
            width={38}
            height={38}
            style={{ objectFit: 'contain', width: 38, height: 'auto' }}
          />
        </span>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: FONT_LABEL,
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: TT.ink,
              lineHeight: 1.3,
            }}
          >
            {event.organizerName}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: FONT_LABEL,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.18em',
              color: TT.subtle,
              lineHeight: 1.4,
            }}
          >
            SINCE 2024
          </span>
        </span>
      </div>

      <p style={{ ...label, marginTop: 22 }}>SUPPORTED BY</p>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 13.5,
          fontWeight: 700,
          color: TT.inkSoft,
          lineHeight: 1.5,
          wordBreak: 'keep-all',
        }}
      >
        {event.sponsorName}
      </p>

      <p style={{ ...label, marginTop: 22 }}>CONTACT</p>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 13.5,
          fontWeight: 700,
          color: TT.inkSoft,
          lineHeight: 1.5,
          wordBreak: 'keep-all',
        }}
      >
        대회 운영본부 · TEYEON Tennis Club
      </p>

      <p
        style={{
          margin: '26px 0 0',
          fontSize: 11,
          fontWeight: 600,
          color: TT.subtle,
          lineHeight: 1.7,
          wordBreak: 'keep-all',
        }}
      >
        © 2026 TEYEON Tennis Club. Official Tournament Site.
      </p>
    </footer>
  );
}
