// Signature — 머리말 (/tournaments/arena-design/signature 전용).
//
//   로고 · TEYEON OPEN 2026 · KNOCKOUT STAGE / 본선 토너먼트 · PLAY TOGETHER / GROW TOGETHER · 날짜 · 장소.
//   ⚠ 날짜 · 장소는 페이지가 넘겨준 고정값이다(운영 Arena 스냅샷에는 없다 — 실제 적용 때 출처를 따로 정한다).

import React from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import { SIG, SIG_FONT_DISPLAY, SIG_LAYOUT, SIG_MOTTO } from './signatureTheme';

const LOGO_SRC = '/logos/teyeon-logo-transparent.png';

export interface SignatureEventInfo {
  year: string;
  /** 영문 부제(대회 성격). */
  tagline: string;
  date: string;
  venue: string;
  /** 단계 표시(영문 · 한글). 없으면 본선(KNOCKOUT STAGE / 본선 토너먼트). */
  stage?: { en: string; ko: string };
}

/** 머리말 블록 사이의 비스듬한 구분선. */
const Slash = () => (
  <span aria-hidden style={{
    width: 2, height: 60, flexShrink: 0, background: 'rgba(29, 91, 216, 0.35)', transform: 'skewX(-18deg)',
  }} />
);

export default function SignatureHeader({ event }: { event: SignatureEventInfo }) {
  return (
    <header style={{
      height: SIG_LAYOUT.headerHeight, display: 'flex', alignItems: 'center', gap: 28, padding: '0 4px 0 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="TEYEON" width={84} height={84}
          style={{ width: 84, height: 84, objectFit: 'contain', filter: 'drop-shadow(0 3px 6px rgba(7,21,56,0.25))' }} />
        {/* 대회명(62px 그대로) 아래 클럽 모토 — 대회명 폭에 맞춰 양끝 정렬처럼 넓게 띄운다. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 7 }}>
          <h1 style={{
            margin: 0, fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 62, fontWeight: 900, lineHeight: 1,
            letterSpacing: '-0.015em', whiteSpace: 'nowrap',
          }}>
            <span style={{ color: SIG.navy }}>TEYEON </span>
            <span style={{ color: SIG.royal }}>OPEN</span>
          </h1>
          <span data-sig-motto="1" style={{
            display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 4,
            fontFamily: SIG_FONT_DISPLAY, fontSize: 14, fontWeight: 800, letterSpacing: '0.42em', lineHeight: 1,
            color: SIG.goldDeep, whiteSpace: 'nowrap',
          }}>
            <span aria-hidden style={{ width: 22, height: 2, background: SIG.gold, flexShrink: 0 }} />
            {SIG_MOTTO}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginLeft: 4 }}>
          <span style={{
            fontFamily: SIG_FONT_DISPLAY, fontSize: 34, fontWeight: 900, lineHeight: 0.95, color: SIG.navy,
            letterSpacing: '0.01em',
          }}>
            {event.year}
          </span>
          <span style={{
            fontFamily: SIG_FONT_DISPLAY, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.12em', color: SIG.inkSoft,
            whiteSpace: 'nowrap',
          }}>
            {event.tagline}
          </span>
        </div>
      </div>

      <Slash />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
        <span style={{
          fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 21, fontWeight: 800, letterSpacing: '0.05em',
          color: SIG.royal, lineHeight: 1.1,
        }}>
          {event.stage?.en ?? 'KNOCKOUT STAGE'}
        </span>
        <span style={{ fontSize: 25, fontWeight: 900, color: SIG.navy, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
          {event.stage?.ko ?? '본선 토너먼트'}
        </span>
      </div>

      <Slash />

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0,
        fontFamily: SIG_FONT_DISPLAY, fontStyle: 'italic', fontSize: 19, fontWeight: 800, letterSpacing: '0.04em',
        color: SIG.royal, lineHeight: 1.15,
      }}>
        <span>PLAY TOGETHER</span>
        <span>GROW TOGETHER</span>
      </div>

      <div style={{ flex: 1 }} />

      <Slash />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 26, fontWeight: 800, color: SIG.navy,
          letterSpacing: '-0.01em', lineHeight: 1,
        }}>
          <CalendarDays size={26} strokeWidth={2.3} color={SIG.navy} />
          {event.date}
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 21, fontWeight: 800, color: SIG.inkSoft,
          lineHeight: 1,
        }}>
          <MapPin size={25} strokeWidth={2.3} color={SIG.navy} />
          {event.venue}
        </span>
      </div>
    </header>
  );
}
