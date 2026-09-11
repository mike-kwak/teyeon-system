'use client';

// 공개 Tournament Hub 상단 브랜드 헤더.
//   회원용 GlobalHeader 와 분리 — 로그인 상태 / 프로필 / CEO 배지 노출 금지(/club PublicHeader 와 동일 원칙).
//   브랜드 표기는 TEYEON / TEYEON TENNIS CLUB 만 사용한다("ASAN TEYEON" 등 지역 결합 표기 금지).

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import './tournamentShell.css';

interface Props {
  /** 헤더 우측 짧은 표기(예: '2026 OPEN'). */
  shortTag: string;
  /** 지정하면 로고 자리에 뒤로 가기(하위 화면 — 참가신청 등). Hub 홈에서는 미지정. */
  backHref?: string;
}

export default function TournamentPublicHeader({ shortTag, backHref }: Props) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        width: '100%',
        backgroundColor: 'rgba(255,255,255,0.96)',
        backdropFilter: 'saturate(160%) blur(10px)',
        WebkitBackdropFilter: 'saturate(160%) blur(10px)',
        borderBottom: `1px solid ${TT.line}`,
      }}
    >
      <div
        className="tt-container"
        style={{
          paddingTop: 10,
          paddingBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {backHref ? (
          <Link
            href={backHref}
            aria-label="대회 정보로 돌아가기"
            style={{
              width: 32,
              height: 32,
              flexShrink: 0,
              borderRadius: '50%',
              border: `1px solid ${TT.line}`,
              backgroundColor: TT.surface,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: TT.inkSoft,
              textDecoration: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <ChevronLeft size={17} strokeWidth={2.3} />
          </Link>
        ) : (
          <span
            style={{
              width: 30,
              height: 30,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              src="/logos/teyeon-logo-current.png"
              alt="TEYEON TENNIS CLUB"
              width={30}
              height={30}
              priority
              style={{ objectFit: 'contain', width: 30, height: 'auto' }}
            />
          </span>
        )}

        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span
            style={{
              fontFamily: FONT_LABEL,
              fontSize: 15,
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: TT.ink,
              lineHeight: 1.15,
            }}
          >
            TEYEON
          </span>
          <span
            style={{
              fontFamily: FONT_LABEL,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.17em',
              color: TT.muted,
              lineHeight: 1.3,
            }}
          >
            TENNIS CLUB
          </span>
        </span>

        <span
          style={{
            marginLeft: 'auto',
            fontFamily: FONT_LABEL,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.14em',
            color: TT.teal,
            whiteSpace: 'nowrap',
          }}
        >
          {shortTag}
        </span>
      </div>
    </header>
  );
}
