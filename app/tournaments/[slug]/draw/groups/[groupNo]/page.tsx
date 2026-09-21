'use client';

// 공개 DRAW — 조 상세 (/tournaments/[slug]/draw/groups/[groupNo]). 직접 링크 가능.

import React from 'react';
import { useParams } from 'next/navigation';
import {
  DrawNotFound, DrawNotPublished, PublicDrawShell, useDrawEvent,
} from '@/components/tournaments/draw/PublicDrawShell';
import PublicGroupDetail from '@/components/tournaments/draw/PublicGroupDetail';
import { usePublicDraw } from '@/components/tournaments/draw/publicDrawView';

export default function TournamentDrawGroupPage() {
  const params = useParams<{ slug: string; groupNo: string }>();
  const { slug, event } = useDrawEvent(params?.slug);
  const raw = typeof params?.groupNo === 'string' ? params.groupNo : '';
  const groupNo = Number(raw);
  const { draw, loading } = usePublicDraw(event ? event.slug : '');

  if (!event) return <DrawNotFound />;

  return (
    <PublicDrawShell event={event} published={!!draw}>
      {draw ? (
        <PublicGroupDetail slug={slug} draw={draw} groupNo={Number.isInteger(groupNo) ? groupNo : -1} />
      ) : (
        <DrawNotPublished hubHref={`/tournaments/${event.slug}`} loading={loading} />
      )}
    </PublicDrawShell>
  );
}
