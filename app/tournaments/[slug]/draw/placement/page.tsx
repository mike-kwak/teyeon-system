'use client';

// 공개 DRAW — 순위결정전 상세 (/tournaments/[slug]/draw/placement).

import React from 'react';
import { useParams } from 'next/navigation';
import {
  DrawNotFound, DrawNotPublished, PublicDrawShell, useDrawEvent,
} from '@/components/tournaments/draw/PublicDrawShell';
import PublicPlacementDetail from '@/components/tournaments/draw/PublicPlacementDetail';
import { usePublicDraw } from '@/components/tournaments/draw/publicDrawView';

export default function TournamentDrawPlacementPage() {
  const params = useParams<{ slug: string }>();
  const { slug, event } = useDrawEvent(params?.slug);
  const { draw, loading } = usePublicDraw(event ? event.slug : '');

  if (!event) return <DrawNotFound />;

  return (
    <PublicDrawShell event={event} published={!!draw}>
      {draw ? (
        <PublicPlacementDetail slug={slug} draw={draw} />
      ) : (
        <DrawNotPublished hubHref={`/tournaments/${event.slug}`} loading={loading} />
      )}
    </PublicDrawShell>
  );
}
