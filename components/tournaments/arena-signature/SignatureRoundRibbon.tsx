'use client';

// Signature — 라운드 리본 (/tournaments/arena-design/signature 전용).
//
//   열 좌표를 그대로 쓰는 이어진 리본. V4: 파란 면을 없애고 흰 조각 + 아래 밑줄로 위계를 준다
//   (바깥 64강 = Navy 밑줄 4px · 참가/BYE 수, 안쪽 = Cobalt 밑줄 3px).
//   가운데(결승 열 위)는 '결승 · FINAL' 판이다 — 머리말과 겹치는 대회명은 다시 쓰지 않는다.
//   ⚠ 첫 라운드의 참가 · BYE 수는 저장된 자리에서 센다(지어내지 않는다).

import React from 'react';
import type { ArenaBracket } from '@/lib/tournaments/arenaTypes';
import type { SignatureGeometry } from './signatureModel';
import { SIG, SIG_COLUMNS, SIG_FONT_DISPLAY, SIG_LAYOUT } from './signatureTheme';

const SLANT = 12;

export default function SignatureRoundRibbon({ geometry, bracket }: { geometry: SignatureGeometry; bracket: ArenaBracket }) {
  const firstRound = Math.min(...bracket.slots.map((s) => s.roundNo));
  const first = bracket.slots.filter((s) => s.roundNo === firstRound);
  const byes = first.filter((s) => s.kind === 'bye').length;
  const entries = first.length - byes;
  const h = SIG_LAYOUT.ribbonHeight;
  const g = SIG_COLUMNS.gap;

  return (
    <>
      {geometry.columns.map((col) => {
        const center = col.column === 0;
        const outer = col.column === geometry.maxColumn;
        const label = col.roundName ?? '';
        if (center) {
          return (
            <div key="center" data-sig-round="결승" style={{
              position: 'absolute', left: col.x - g + 2, width: col.width + 2 * g - 4, top: 0, height: h,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              background: SIG.goldSoft, borderRadius: 6, border: `1.5px solid ${SIG.gold}`, boxSizing: 'border-box',
            }}>
              <span style={{ fontSize: 21, fontWeight: 900, color: SIG.navy, letterSpacing: '-0.01em', lineHeight: 1 }}>결승</span>
              <span style={{
                fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontWeight: 800, fontSize: 12, letterSpacing: '0.3em',
                color: SIG.goldDeep, lineHeight: 1,
              }}>
                FINAL
              </span>
            </div>
          );
        }
        const left = col.side === 'left';
        // 조각이 열 사이 틈을 반씩 덮어 리본이 이어져 보이게 한다. 사선은 가운데를 향해 기운다.
        const x = col.x - g / 2 + 1;
        const w = col.width + g - 2;
        const clip = left
          ? `polygon(${SLANT}px 0, 100% 0, calc(100% - ${SLANT}px) 100%, 0 100%)`
          : `polygon(0 0, calc(100% - ${SLANT}px) 0, 100% 100%, ${SLANT}px 100%)`;
        const sub = outer && byes > 0 ? `${entries}팀 + ${byes} BYE` : null;
        return (
          <div key={`${col.side}:${col.column}`} data-sig-round={label} style={{
            position: 'absolute', left: x, width: w, top: 0, height: h, clipPath: clip,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255, 255, 255, 0.94)',
            boxShadow: `inset 0 ${outer ? -4 : -3}px 0 ${outer ? SIG.navy : SIG.royal}`,
          }}>
            <span style={{
              fontSize: 20, fontWeight: 900, lineHeight: 1.02, color: SIG.navy, letterSpacing: '-0.01em',
            }}>
              {label}
            </span>
            {sub && (
              <span style={{ fontSize: 11.5, fontWeight: 800, lineHeight: 1.1, color: SIG.muted, whiteSpace: 'nowrap' }}>
                {sub}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}
