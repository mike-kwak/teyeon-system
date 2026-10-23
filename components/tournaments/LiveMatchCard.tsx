'use client';

// LIVE 화면 — 지금 중계 경기 카드(단계 · 경기 번호 · 코트 · 두 팀 선수 이름).
//
//   ⚠ 점수는 표시하지 않는다(실시간 점수 연동은 범위 밖).
//   ⚠ 받은 값만 그린다. 경기 정보를 지어내지 않는다 — 경기가 없으면 '다음 경기 준비 중'.
//   ⚠ 긴 이름은 줄바꿈한다(가로 넘침 없음). 글자를 줄여 억지로 한 줄에 넣지 않는다.

import React from 'react';
import { MapPin } from 'lucide-react';
import { TT, FONT_LABEL } from './tournamentTheme';
import { liveCourtLabel } from '@/lib/tournaments/liveMatch';
import type { LiveMatchInfo, LiveMatchTeam } from '@/lib/tournaments/liveTypes';

const box: React.CSSProperties = {
  padding: '13px 15px',
  borderRadius: 12,
  backgroundColor: TT.surface,
  border: `1px solid ${TT.line}`,
  minWidth: 0,
};

function TeamLine({ team, side }: { team: LiveMatchTeam; side: 'A' | 'B' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, minWidth: 0 }}>
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          fontFamily: FONT_LABEL,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.08em',
          color: TT.subtle,
        }}
      >
        {side}
      </span>
      <p
        data-live-team={side}
        style={{
          margin: 0,
          minWidth: 0,
          fontSize: 16,
          fontWeight: 800,
          color: TT.ink,
          lineHeight: 1.45,
          wordBreak: 'keep-all',
          overflowWrap: 'anywhere',
        }}
      >
        {team.player1Name} · {team.player2Name}
      </p>
    </div>
  );
}

export default function LiveMatchCard({ match }: { match: LiveMatchInfo | null }) {
  if (!match) {
    return (
      <div data-live-match="idle" style={{ ...box, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: TT.subtle, flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: TT.muted, lineHeight: 1.6 }}>
          다음 경기 준비 중
        </p>
      </div>
    );
  }

  const court = liveCourtLabel(match);
  const head = [match.stageLabel, match.matchNo !== null ? `${match.matchNo}경기` : null].filter(Boolean).join(' · ');

  return (
    <section data-live-match="on" aria-label="지금 중계 경기" style={box}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '4px 10px' }}>
        <p
          style={{
            margin: 0,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 800,
            color: TT.teal,
            lineHeight: 1.5,
            wordBreak: 'keep-all',
          }}
        >
          {head}
        </p>
        {court && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 700,
              color: TT.muted,
              wordBreak: 'keep-all',
            }}
          >
            <MapPin size={12} strokeWidth={2.4} style={{ flexShrink: 0 }} />
            {court}
          </span>
        )}
      </div>
      <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <TeamLine team={match.team1} side="A" />
        <p style={{ margin: '0 0 0 20px', fontFamily: FONT_LABEL, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.14em', color: TT.faint }}>
          VS
        </p>
        <TeamLine team={match.team2} side="B" />
      </div>
    </section>
  );
}
