'use client';

// TOURNAMENT INFO — 공식 요강 01 대회 정보를 표기만 한다(가공·요약 금지).

import React from 'react';
import { SectionHeading, DataRow } from './TournamentSection';
import { won } from '@/lib/tournaments/format';
import type { OfficialTournament } from '@/lib/tournaments/types';

export default function TournamentInfo({ event }: { event: OfficialTournament }) {
  return (
    <section>
      <SectionHeading id="tournament-info" label="TOURNAMENT INFO" />
      <DataRow label="DATE" value={event.eventDateShort} />
      <DataRow label="START" value={event.startTimeLabel} />
      <DataRow label="VENUE" value={event.venueName} />
      <DataRow label="ENTRY" value={`${won(event.entryFee)} / TEAM`} />
      <DataRow label="BALL" value={event.ballName} />
      <DataRow label="FORMAT" value="복식 · 비랭킹" />
      <DataRow
        label="TEAMS"
        value={`${event.targetCapacity}팀 우선 · 최대 ${event.maxCapacity}팀`}
        last
      />
    </section>
  );
}
