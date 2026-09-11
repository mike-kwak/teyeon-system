'use client';

// 하단 고정 참가신청 바.
//   GlobalMain(단일 스크롤러)은 paddingBottom = --page-bottom-safe 를 갖는다. sticky bottom: 0 이면
//   바가 그 패딩 위(화면 하단에서 24px 뜬 위치)에 멈춰 '떠 있는' 모양이 된다.
//   공식 대회 사이트의 하단 바는 화면 끝에 붙어야 하므로 그 패딩만큼만 정확히 상쇄하고
//   (bottom: -var(--page-bottom-safe)), 잘림 방지용 safe-area 는 바 내부 패딩으로 다시 확보한다.
//   ⚠️ 토큰을 직접 재계산하지 말 것 — --page-bottom-safe 를 그대로 상쇄해야 BottomNav 정책이 바뀌어도 어긋나지 않는다.

import React from 'react';
import Link from 'next/link';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament, TournamentPublicStatus } from '@/lib/tournaments/types';
import { CTA_COPY, canApply, type RegistrationCtaState } from '@/lib/tournaments/publicService';

interface Props {
  event: OfficialTournament;
  status: TournamentPublicStatus | null;
  registerHref: string;
  /** 히어로 CTA 가 보이는 최상단에서는 숨긴다(중복 노출 방지). */
  shown: boolean;
  /** 서버 판정에서 온 CTA 상태. 'open' 이 아니면 신청 버튼을 두지 않는다. */
  ctaState: RegistrationCtaState;
}

export default function TournamentStickyBar({ event, status, registerHref, shown, ctaState }: Props) {
  const applyOk = canApply(ctaState);
  return (
    <div
      aria-hidden={!shown}
      style={{
        position: 'sticky',
        bottom: 'calc(-1 * var(--page-bottom-safe))',
        // 스크롤 최하단에서도 바가 화면 끝에 붙도록 스크롤러 하단 패딩을 흡수한다
        // (bottom 상쇄만 하면 마지막 위치에서 패딩 높이만큼 떠 보인다).
        marginBottom: 'calc(-1 * var(--page-bottom-safe))',
        zIndex: 30,
        width: '100%',
        backgroundColor: 'rgba(255,255,255,0.97)',
        backdropFilter: 'saturate(160%) blur(10px)',
        WebkitBackdropFilter: 'saturate(160%) blur(10px)',
        borderTop: `1px solid ${TT.line}`,
        opacity: shown ? 1 : 0,
        visibility: shown ? 'visible' : 'hidden',
        transform: shown ? 'none' : 'translateY(6px)',
        pointerEvents: shown ? 'auto' : 'none',
        transition: 'opacity .25s ease, transform .25s ease, visibility .25s',
      }}
    >
      <div
        className="tt-container tt-sticky-bar"
        style={{
          paddingTop: 10,
          paddingBottom: 'calc(12px + var(--safe-bottom))',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {status ? (
            <p
              style={{
                margin: 0,
                fontFamily: FONT_LABEL,
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: '0.04em',
                color: TT.ink,
                lineHeight: 1.35,
              }}
            >
              {status.appliedCount} / {status.targetCapacity} TEAMS
            </p>
          ) : (
            <p
              style={{
                margin: 0,
                fontSize: 12.5,
                fontWeight: 800,
                color: TT.ink,
                lineHeight: 1.35,
                wordBreak: 'keep-all',
              }}
            >
              {applyOk ? '참가 접수 진행 중' : CTA_COPY[ctaState].short}
            </p>
          )}
          <p
            style={{
              margin: '2px 0 0',
              fontSize: 11,
              fontWeight: 600,
              color: TT.muted,
              lineHeight: 1.4,
              wordBreak: 'keep-all',
            }}
          >
            {event.registrationCloseShort}
          </p>
        </div>

        {!applyOk ? (
          <span
            role="status"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 46,
              padding: '12px 18px',
              borderRadius: 9,
              backgroundColor: '#E9EEF2',
              border: `1px solid ${TT.line}`,
              color: TT.muted,
              fontSize: 14,
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            {CTA_COPY[ctaState].short}
          </span>
        ) : (
        <Link
          href={registerHref}
          tabIndex={shown ? undefined : -1}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 46,
            padding: '12px 18px',
            borderRadius: 9,
            backgroundColor: TT.teal,
            color: '#FFFFFF',
            fontSize: 14,
            fontWeight: 800,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          참가 신청하기
        </Link>
        )}
      </div>
    </div>
  );
}
