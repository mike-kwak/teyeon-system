'use client';

// Hub 공통 섹션 프리미티브 — 라벨 + 룰 + 데이터 행.
//   중요한 값은 절대 ellipsis 로 자르지 않는다. 폭이 부족하면 값이 아래로 wrap 된다.

import React from 'react';
import { TT, FONT_LABEL } from './tournamentTheme';

export function SectionHeading({
  label,
  ruleColor = TT.ink,
  id,
}: {
  label: string;
  ruleColor?: string;
  id?: string;
}) {
  return (
    // 앵커 이동 시 sticky 브랜드 헤더(약 51px)에 제목이 가리지 않도록 여백을 준다.
    //   단계 네비는 sticky 가 아니므로(스크롤과 함께 올라감) 그 높이는 더하지 않는다.
    <div id={id} style={{ scrollMarginTop: 68 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: FONT_LABEL,
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: '0.17em',
            color: TT.teal,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </h2>
        <span style={{ flex: 1, height: 1, backgroundColor: TT.line, minWidth: 12 }} />
      </div>
      <div style={{ marginTop: 10, height: 1.5, backgroundColor: ruleColor }} />
    </div>
  );
}

/** 라벨(좌) · 값(우) 행. 값이 길면 줄바꿈되고 잘리지 않는다. */
export function DataRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 14,
        padding: '13px 0',
        borderBottom: last ? 'none' : `1px solid ${TT.lineSoft}`,
      }}
    >
      <span
        style={{
          fontFamily: FONT_LABEL,
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: '0.14em',
          color: TT.subtle,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 800,
          color: TT.ink,
          textAlign: 'right',
          lineHeight: 1.55,
          wordBreak: 'keep-all',
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** 한국어 라벨을 쓰는 행(경기 방식 · 예선 순위 등). */
export function KoDataRow({
  label,
  value,
  last,
}: {
  label: string;
  value: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 14,
        padding: '13px 0',
        borderBottom: last ? 'none' : `1px solid ${TT.lineSoft}`,
      }}
    >
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 700,
          color: TT.muted,
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 800,
          color: TT.ink,
          textAlign: 'right',
          lineHeight: 1.6,
          wordBreak: 'keep-all',
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}
