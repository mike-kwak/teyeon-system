'use client';

// 공개 DRAW — MY MATCH (/tournaments/[slug]/draw/my).
//   로그인 없이 내 팀을 고르면 예선 · 본선 경기 상태와 실제 투입된 코트 번호를 보여 준다.
//   데이터는 공개 RPC(get_public_preliminary_draw · get_public_knockout_bracket)만 쓴다.

import React from 'react';
import { useParams } from 'next/navigation';
import { DrawNotFound, useDrawEvent } from '@/components/tournaments/draw/PublicDrawShell';
import MyMatchApp from '@/components/tournaments/draw/MyMatchApp';

export default function TournamentMyMatchPage() {
  const params = useParams<{ slug: string }>();
  const { event } = useDrawEvent(params?.slug);
  if (!event) return <DrawNotFound />;
  return <MyMatchApp event={event} />;
}
