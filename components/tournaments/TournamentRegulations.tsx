'use client';

// 공식 요강 05 참가 자격 / 페어 요건 · 02 참가 신청 · 06 촬영/중계 및 안전 · 07 대회 문의.
//
//   ⛔ 이 컴포넌트의 텍스트는 전부 lib/tournaments/officialInfo.ts(요강 원문)에서만 온다.
//      여기서 문구를 새로 쓰거나, 요약해 의미를 바꾸거나, 예외 기준을 추측해 채우지 않는다.

import React from 'react';
import { Phone } from 'lucide-react';
import { SectionHeading } from './TournamentSection';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament } from '@/lib/tournaments/types';

const Num = ({ n }: { n: number }) => (
  <span
    style={{
      flexShrink: 0,
      width: 20,
      height: 20,
      marginTop: 1,
      borderRadius: '50%',
      backgroundColor: TT.tealSoft,
      color: TT.tealDeep,
      fontSize: 11,
      fontWeight: 800,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    {n}
  </span>
);

const Bullet = ({ children }: { children: React.ReactNode }) => (
  <li
    style={{
      display: 'flex',
      gap: 8,
      fontSize: 12.5,
      fontWeight: 600,
      color: TT.inkSoft,
      lineHeight: 1.7,
      wordBreak: 'keep-all',
    }}
  >
    <span style={{ flexShrink: 0, color: TT.subtle }}>·</span>
    <span style={{ minWidth: 0 }}>{children}</span>
  </li>
);

const cardStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '15px 16px',
  borderRadius: 12,
  backgroundColor: TT.surface,
  border: `1px solid ${TT.line}`,
};

const cardLabelStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: FONT_LABEL,
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.16em',
  color: TT.teal,
};

const listStyle: React.CSSProperties = {
  margin: '11px 0 0',
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
};

export default function TournamentRegulations({ event }: { event: OfficialTournament }) {
  return (
    <section>
      <SectionHeading id="tournament-regulations" label="ELIGIBILITY" />

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 14.5,
          fontWeight: 800,
          color: TT.ink,
          lineHeight: 1.5,
          wordBreak: 'keep-all',
        }}
      >
        참가 자격 · 페어 요건
      </p>

      <ol style={{ margin: '12px 0 0', padding: 0, listStyle: 'none' }}>
        {event.eligibility.map((rule, i) => (
          <li
            key={rule.text}
            style={{
              display: 'flex',
              gap: 10,
              padding: i === 0 ? '0 0 12px' : '12px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${TT.lineSoft}`,
            }}
          >
            <Num n={i + 1} />
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 700,
                  color: TT.ink,
                  lineHeight: 1.65,
                  wordBreak: 'keep-all',
                }}
              >
                {rule.text}
              </span>
              {rule.note && (
                <span
                  style={{
                    display: 'block',
                    marginTop: 4,
                    fontSize: 12,
                    fontWeight: 600,
                    color: TT.muted,
                    lineHeight: 1.6,
                    wordBreak: 'keep-all',
                  }}
                >
                  {rule.note}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {/* 참가 신청 안내(요강 02) */}
      <div style={{ ...cardStyle, marginTop: 18 }}>
        <p style={cardLabelStyle}>REGISTRATION</p>
        <ul style={listStyle}>
          {event.registrationNotes.map((n) => (
            <Bullet key={n}>{n}</Bullet>
          ))}
        </ul>
      </div>

      {/* 촬영 · 중계 및 안전 안내(요강 06) — 법률 문구를 확대하거나 새 동의 내용을 추가하지 않는다. */}
      <div style={cardStyle}>
        <p style={cardLabelStyle}>NOTICE</p>
        <p
          style={{
            margin: '11px 0 0',
            paddingLeft: 11,
            borderLeft: `3px solid ${TT.tealSoft}`,
            fontSize: 12.5,
            fontWeight: 700,
            color: TT.ink,
            lineHeight: 1.75,
            wordBreak: 'keep-all',
          }}
        >
          {event.mediaNotice}
        </p>
        <ul style={{ ...listStyle, marginTop: 12 }}>
          {event.safetyNotes.map((n) => (
            <Bullet key={n}>{n}</Bullet>
          ))}
        </ul>
      </div>

      {/* 대회 문의(요강 07) */}
      <div style={{ ...cardStyle, paddingBottom: 6 }}>
        <p style={cardLabelStyle}>CONTACT</p>
        <p
          style={{
            margin: '9px 0 0',
            fontSize: 12,
            fontWeight: 600,
            color: TT.muted,
            lineHeight: 1.6,
            wordBreak: 'keep-all',
          }}
        >
          {event.contactCaption}
        </p>

        <div style={{ marginTop: 11 }}>
          {event.contacts.map((c, i) => (
            <a
              key={c.phone}
              href={`tel:${c.phone.replace(/[^0-9]/g, '')}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${TT.lineSoft}`,
                textDecoration: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  minWidth: 26,
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: c.primary ? TT.teal : TT.subtle,
                }}
              >
                {c.role}
              </span>
              <span style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: TT.ink }}>
                {c.name}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 800,
                  color: TT.teal,
                  whiteSpace: 'nowrap',
                }}
              >
                <Phone size={13} strokeWidth={2.4} />
                {c.phone}
              </span>
            </a>
          ))}
        </div>
      </div>

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 12,
          fontWeight: 600,
          color: TT.subtle,
          lineHeight: 1.7,
          wordBreak: 'keep-all',
        }}
      >
        {event.discretionNote}
      </p>
    </section>
  );
}
