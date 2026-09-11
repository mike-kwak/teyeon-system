'use client';

// TOURNAMENT FORMAT — 공식 요강 04 경기 방법.
//   요강에 없는 새로운 경기규정을 만들지 않는다.
//   '합산연령' 은 요강 표기 그대로 두고, 어느 쪽이 우선인지에 대한 설명을 붙이지 않는다(미확정).

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { SectionHeading, KoDataRow } from './TournamentSection';
import { TT, FONT_LABEL } from './tournamentTheme';
import type { OfficialTournament, TournamentFormatStage } from '@/lib/tournaments/types';

function StageCard({ stage }: { stage: TournamentFormatStage }) {
  const navy = stage.tone === 'navy';
  return (
    <div
      style={{
        padding: '16px 17px 17px',
        borderRadius: 12,
        backgroundColor: navy ? TT.navy : TT.tealSoft,
        border: navy ? 'none' : `1px solid ${TT.line}`,
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: FONT_LABEL,
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: '0.16em',
          color: navy ? TT.tealOnNavy : TT.tealDeep,
          lineHeight: 1.4,
          wordBreak: 'keep-all',
        }}
      >
        {stage.eyebrow}
      </p>
      <p
        style={{
          margin: '9px 0 0',
          fontSize: 17,
          fontWeight: 900,
          color: navy ? '#FFFFFF' : TT.ink,
          lineHeight: 1.4,
          wordBreak: 'keep-all',
        }}
      >
        {stage.title}
      </p>
      <p
        style={{
          margin: '8px 0 0',
          fontSize: 12.5,
          fontWeight: 600,
          color: navy ? 'rgba(255,255,255,0.72)' : TT.muted,
          lineHeight: 1.65,
          wordBreak: 'keep-all',
        }}
      >
        {stage.description}
      </p>
    </div>
  );
}

export default function TournamentFormat({
  event,
  regulationsHref,
}: {
  event: OfficialTournament;
  regulationsHref: string;
}) {
  return (
    <section>
      <SectionHeading id="tournament-format" label="TOURNAMENT FORMAT" ruleColor={TT.teal} />

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {event.formatStages.map((s) => (
          <StageCard key={s.eyebrow} stage={s} />
        ))}
      </div>

      <div style={{ marginTop: 6 }}>
        <KoDataRow label="경기 방식" value={event.matchRule} />
        <KoDataRow label="예선 순위" value={event.groupRankRule} />
        <KoDataRow label="조 편성" value={event.drawRule} last />
      </div>

      <p
        style={{
          margin: '14px 0 0',
          fontSize: 12,
          fontWeight: 600,
          color: TT.subtle,
          lineHeight: 1.65,
          wordBreak: 'keep-all',
        }}
      >
        {event.formatCaption}
      </p>

      <a
        href={regulationsHref}
        style={{
          marginTop: 14,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 800,
          color: TT.teal,
          textDecoration: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        참가 자격 · 대회 요강 확인
        <ArrowRight size={15} strokeWidth={2.4} />
      </a>
    </section>
  );
}
