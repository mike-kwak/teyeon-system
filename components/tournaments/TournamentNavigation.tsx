'use client';

// Tournament Hub 단계 네비게이션 — INFO / TEAMS / DRAW / LIVE / RESULTS.
//   준비중 메뉴를 '숨기지' 않는다. 대회 진행 단계에 따라 순차 공개되는 공식 대회 사이트처럼 보이도록,
//   비활성 항목을 눌러도 아무 일이 없지 않고 공개 시점 안내를 그 자리에서 보여준다.
//
//   참가신청(REGISTER)은 네비 항목이 아니라 히어로 CTA + 하단 고정 바로 제공한다(승인된 시안 기준).
//   320px 에서 5개 항목이 눌리지 않게 유지하기 위한 결정이기도 하다.

import React from 'react';
import Link from 'next/link';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { TournamentNavItem } from '@/lib/tournaments/types';

interface Props {
  items: TournamentNavItem[];
  /** 기본 안내 문구(선택된 준비중 항목이 없을 때). */
  defaultNote: string;
}

export default function TournamentNavigation({ items, defaultNote }: Props) {
  const [openedKey, setOpenedKey] = React.useState<string | null>(null);

  const opened = openedKey ? items.find((i) => i.key === openedKey) ?? null : null;
  const note = opened?.releaseNote ? `${opened.label} · ${opened.releaseNote}` : defaultNote;

  const labelStyle = (state: TournamentNavItem['state']): React.CSSProperties => ({
    fontFamily: FONT_LABEL,
    fontSize: 13,
    fontWeight: state === 'current' ? 800 : 700,
    letterSpacing: '0.08em',
    color: state === 'current' ? TT.ink : state === 'open' ? TT.inkSoft : TT.faint,
    lineHeight: 1,
    padding: '13px 1px 11px',
    margin: 0,
    background: 'none',
    border: 'none',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: state === 'current' ? TT.teal : 'transparent',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    cursor: state === 'pending' ? 'default' : 'pointer',
    WebkitTapHighlightColor: 'transparent',
  });

  return (
    <nav
      aria-label="대회 메뉴"
      style={{
        width: '100%',
        backgroundColor: TT.surface,
        borderBottom: `1px solid ${TT.line}`,
      }}
    >
      <div className="tt-container">
        <div
          className="tt-nav-row"
          style={{
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'space-between',
            gap: 10,
            overflowX: 'auto',
            scrollbarWidth: 'none',
          }}
        >
          {items.map((item) => {
            if (item.state === 'open' && item.href) {
              return (
                <Link key={item.key} href={item.href} style={labelStyle(item.state)}>
                  {item.label}
                </Link>
              );
            }
            if (item.state === 'current') {
              return (
                <span key={item.key} aria-current="page" style={labelStyle(item.state)}>
                  {item.label}
                </span>
              );
            }
            return (
              <button
                key={item.key}
                type="button"
                aria-disabled
                onClick={() => setOpenedKey((prev) => (prev === item.key ? null : item.key))}
                style={labelStyle(item.state)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <p
          style={{
            margin: 0,
            padding: '9px 0 11px',
            fontSize: 11.5,
            fontWeight: 600,
            color: opened ? TT.teal : TT.subtle,
            lineHeight: 1.5,
            wordBreak: 'keep-all',
          }}
        >
          {note}
        </p>
      </div>
    </nav>
  );
}
