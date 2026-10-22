'use client';

// 공개 DRAW — 예선 조별리그 메인 (/tournaments/[slug]/draw).
//   데이터는 공개 RPC get_public_preliminary_draw 하나만 쓴다(원본 테이블 접근 없음).

import React from 'react';
import { useParams } from 'next/navigation';
import {
  BackToHub, DrawHeading, DrawNotFound, DrawNotPublished, DrawStageTabs, PublicDrawShell, useDrawEvent,
} from '@/components/tournaments/draw/PublicDrawShell';
import PrelimDrawViews from '@/components/tournaments/draw/PrelimDrawViews';
import { MyMatchEntryLink } from '@/components/tournaments/draw/MyMatchApp';
import { usePublicGroupSchedule } from '@/components/tournaments/draw/PublicScheduleInfo';
import { usePublicDraw } from '@/components/tournaments/draw/publicDrawView';
import { PUBLIC_KNOCKOUT_ENABLED } from '@/lib/tournaments/publicKnockoutFlags';

export default function TournamentDrawPage() {
  const params = useParams<{ slug: string }>();
  const { slug, event } = useDrawEvent(params?.slug);
  const { draw, loading } = usePublicDraw(event ? event.slug : '');
  const schedule = usePublicGroupSchedule(event ? event.slug : '', !!draw);

  if (!event) return <DrawNotFound />;
  const hubHref = `/tournaments/${event.slug}`;

  return (
    <PublicDrawShell event={event} published={!!draw}>
      <DrawHeading title="예선 대진표" sub={event.titleFull} />
      <DrawStageTabs slug={event.slug} active="preliminary" knockoutOpen={PUBLIC_KNOCKOUT_ENABLED} />
      {draw && <MyMatchEntryLink slug={event.slug} />}
      {draw ? (
        <>
          <PrelimDrawViews slug={slug} draw={draw} schedule={schedule} />
          <BackToHub hubHref={hubHref} />
        </>
      ) : (
        <DrawNotPublished hubHref={hubHref} loading={loading} />
      )}
    </PublicDrawShell>
  );
}
