'use client';

// Hub 첫 화면(QR 진입 직후) — 승인된 Claude Design 시안 기준.
//   대회명 · 성격 · 일시 · 장소 · 참가신청 CTA 가 스크롤 없이 보이는 것이 목표.
//   워드마크는 시안대로 'TEYEON' / 'OPEN' 두 줄로 고정한다(320px 에서도 잘리지 않도록 줄바꿈을 우연에 맡기지 않음).

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament } from '@/lib/tournaments/types';
import { CTA_COPY, canApply, type RegistrationCtaState } from '@/lib/tournaments/publicService';

interface Props {
  event: OfficialTournament;
  registerHref: string;
  /** 요강 섹션 앵커(#id). */
  regulationsHref: string;
  /** 서버 판정에서 온 CTA 상태. 'open' 이 아니면 신청 버튼을 두지 않는다. */
  ctaState: RegistrationCtaState;
  /** 'unknown'(상태 확인 실패)일 때 사용자가 직접 다시 시도. */
  onRetry?: () => void;
}

/**
 * 정원 만석으로 접수가 닫힌 상태의 CTA 자리.
 *   신청 버튼을 그대로 두면 사용자가 폼을 전부 작성한 뒤에야 만석을 알게 된다.
 *   ⚠ 표시 전용이다. 접수 가능 여부 판정은 서버(get_public_tournament.isRegistrationOpen)가 하고,
 *      최종 차단은 submit RPC 의 TOURNAMENT_FULL 이 한다. 여기서 판정 로직을 만들지 않는다.
 */
function ClosedCta({ state, onRetry }: { state: RegistrationCtaState; onRetry?: () => void }) {
  const copy = CTA_COPY[state];
  return (
    <div
      role="status"
      style={{
        marginTop: 22,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        width: '100%',
        minHeight: 56,
        padding: '13px 18px',
        borderRadius: 9,
        backgroundColor: '#E9EEF2',
        border: `1px solid ${TT.line}`,
        color: TT.muted,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: 15.5, fontWeight: 800, color: TT.inkSoft, wordBreak: 'keep-all', textAlign: 'center' }}>
        {copy.title}
      </span>
      {copy.sub && (
        <span style={{ fontSize: 12, fontWeight: 600, wordBreak: 'keep-all', textAlign: 'center' }}>
          {copy.sub}
        </span>
      )}
      {state === 'unknown' && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 6, minHeight: 34, padding: '7px 14px', borderRadius: 8,
            border: `1px solid ${TT.line}`, backgroundColor: TT.surface, color: TT.teal,
            fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800, cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          다시 시도
        </button>
      )}
    </div>
  );
}

export default function TournamentHero({ event, registerHref, regulationsHref, ctaState, onRetry }: Props) {
  return (
    <section style={{ padding: '22px 0 4px' }}>
      {/* eyebrow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ width: 18, height: 2, backgroundColor: TT.teal, flexShrink: 0 }} />
        <span
          style={{
            fontFamily: FONT_LABEL,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.18em',
            color: TT.teal,
          }}
        >
          TEYEON TENNIS CLUB
        </span>
      </div>

      {/* wordmark */}
      <p
        className="tt-hero-year"
        style={{
          margin: 0,
          fontWeight: 800,
          letterSpacing: '-0.01em',
          color: TT.faint,
          lineHeight: 1.05,
        }}
      >
        {event.year}
      </p>
      <h1
        className="tt-hero-word"
        style={{
          margin: '2px 0 0',
          fontWeight: 900,
          letterSpacing: '-0.035em',
          color: TT.ink,
          lineHeight: 0.94,
        }}
      >
        {/* 모바일은 두 줄(가독성 우선), 태블릿 이상은 한 줄 — tournamentShell.css 가 전환한다. */}
        {event.wordmark.map((line) => (
          <span key={line} className="tt-hero-word-part">
            {line}
          </span>
        ))}
      </h1>

      <p
        style={{
          margin: '16px 0 0',
          fontSize: 16,
          fontWeight: 800,
          color: TT.ink,
          lineHeight: 1.45,
          wordBreak: 'keep-all',
        }}
      >
        {event.subtitleKo}
      </p>
      <p
        style={{
          margin: '5px 0 0',
          fontFamily: FONT_LABEL,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.13em',
          color: TT.subtle,
          lineHeight: 1.5,
          wordBreak: 'keep-all',
        }}
      >
        {event.subtitleEn}
      </p>

      {/* 일시 · 장소 */}
      <div
        style={{
          margin: '20px 0 0',
          paddingLeft: 12,
          borderLeft: `3px solid ${TT.teal}`,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 15.5,
            fontWeight: 800,
            color: TT.ink,
            lineHeight: 1.45,
            wordBreak: 'keep-all',
          }}
        >
          {event.eventDateLabel} · {event.startTimeLabel}
        </p>
        <p
          style={{
            margin: '3px 0 0',
            fontSize: 13.5,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.5,
            wordBreak: 'keep-all',
          }}
        >
          {event.venueName}
        </p>
      </div>

      {/* CTA */}
      <div className="tt-cta-group">
      {!canApply(ctaState) ? <ClosedCta state={ctaState} onRetry={onRetry} /> : (
      <Link
        href={registerHref}
        style={{
          marginTop: 22,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          minHeight: 56,
          padding: '15px 18px',
          borderRadius: 9,
          backgroundColor: TT.teal,
          color: '#FFFFFF',
          fontSize: 15.5,
          fontWeight: 800,
          textDecoration: 'none',
          boxSizing: 'border-box',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        참가 신청하기
        <ArrowRight size={17} strokeWidth={2.4} />
      </Link>
      )}

      <a
        href={regulationsHref}
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: 50,
          padding: '13px 18px',
          borderRadius: 9,
          backgroundColor: TT.surface,
          border: `1px solid ${TT.line}`,
          color: TT.inkSoft,
          fontSize: 14,
          fontWeight: 700,
          textDecoration: 'none',
          boxSizing: 'border-box',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        대회 요강 자세히 보기
      </a>
      </div>
    </section>
  );
}
