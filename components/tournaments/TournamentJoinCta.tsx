'use client';

// 하단 Deep Navy CTA 블록 — 스크롤 끝에서 다시 한 번 참가 신청으로 유도.
//   접수 현황 숫자는 서버 값이 있을 때만 노출한다(없으면 마감일만).

import React from 'react';
import Link from 'next/link';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament, TournamentPublicStatus } from '@/lib/tournaments/types';
import { CTA_COPY, canApply, type RegistrationCtaState } from '@/lib/tournaments/publicService';

interface Props {
  event: OfficialTournament;
  status: TournamentPublicStatus | null;
  registerHref: string;
  /** 서버 판정에서 온 CTA 상태. 'open' 이 아니면 신청 버튼을 두지 않는다. */
  ctaState: RegistrationCtaState;
  /** 'unknown' 일 때 사용자가 직접 다시 시도. */
  onRetry?: () => void;
}

/** 블록 헤드라인 — 상태별로 다르게 말한다(마감/준비중/확인불가를 뭉개지 않는다). */
const HEADLINE: Record<RegistrationCtaState, string> = {
  loading:     '참가 접수 상태를 확인하고 있습니다',
  open:        '참가 접수가 진행 중입니다',
  full:        '참가 접수가 마감되었습니다',
  closed:      '참가 접수가 마감되었습니다',
  unpublished: '참가 접수 준비 중입니다',
  unknown:     '참가 접수 상태를 확인할 수 없습니다',
};

export default function TournamentJoinCta({ event, status, registerHref, ctaState, onRetry }: Props) {
  const copy = CTA_COPY[ctaState];
  const applyOk = canApply(ctaState);
  const factLabel: React.CSSProperties = {
    margin: 0,
    fontSize: 11.5,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.5,
  };
  const factValue: React.CSSProperties = {
    margin: '2px 0 0',
    fontSize: 14.5,
    fontWeight: 800,
    color: '#FFFFFF',
    lineHeight: 1.5,
    wordBreak: 'keep-all',
  };

  return (
    <section
      style={{
        padding: '22px 20px 20px',
        borderRadius: 14,
        backgroundColor: TT.navy,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: FONT_LABEL,
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: '0.18em',
          color: TT.tealOnNavy,
        }}
      >
        JOIN THE TOURNAMENT
      </p>

      <p
        style={{
          margin: '11px 0 0',
          fontSize: 19,
          fontWeight: 900,
          color: '#FFFFFF',
          lineHeight: 1.45,
          wordBreak: 'keep-all',
        }}
      >
        {event.titleFull}
        <br />
        {HEADLINE[ctaState]}
      </p>

      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {status && (
          <div>
            <p style={factLabel}>현재 접수</p>
            <p style={factValue}>
              {status.appliedCount} / {status.targetCapacity} TEAMS
            </p>
          </div>
        )}
        <div>
          <p style={factLabel}>신청 마감</p>
          <p style={factValue}>{event.registrationCloseLabel}</p>
        </div>
      </div>

      {!applyOk ? (
        <div
          role="status"
          style={{
            marginTop: 20,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            width: '100%',
            minHeight: 54,
            padding: '13px 18px',
            borderRadius: 9,
            backgroundColor: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.16)',
            boxSizing: 'border-box',
          }}
        >
          <span style={{ fontSize: 15.5, fontWeight: 800, color: '#FFFFFF', textAlign: 'center', wordBreak: 'keep-all' }}>
            {copy.title}
          </span>
          {copy.sub && (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textAlign: 'center', wordBreak: 'keep-all' }}>
              {copy.sub}
            </span>
          )}
          {ctaState === 'unknown' && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                marginTop: 8, minHeight: 34, padding: '7px 14px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.22)', backgroundColor: 'transparent',
                color: TT.tealOnNavy, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 800,
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}
            >
              다시 시도
            </button>
          )}
        </div>
      ) : (
      <Link
        href={registerHref}
        style={{
          marginTop: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: 54,
          padding: '15px 18px',
          borderRadius: 9,
          backgroundColor: TT.tealOnNavy,
          color: TT.navy,
          fontSize: 15.5,
          fontWeight: 800,
          textDecoration: 'none',
          boxSizing: 'border-box',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        참가 신청하기
      </Link>
      )}

      <p
        style={{
          margin: '12px 0 0',
          textAlign: 'center',
          fontSize: 11.5,
          fontWeight: 600,
          color: 'rgba(255,255,255,0.5)',
          lineHeight: 1.6,
          wordBreak: 'keep-all',
        }}
      >
        {applyOk
          ? 'TEYEON 회원가입 없이 신청할 수 있습니다'
          : ctaState === 'full' || ctaState === 'closed'
            ? '추가 접수 및 참가 관련 문의는 대회 운영본부로 문의해 주세요'
            : ''}
      </p>
    </section>
  );
}
