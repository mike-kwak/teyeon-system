'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 대진표 미리보기(조 목록). 공개 상태를 바꾸지 않는다.

import React from 'react';
import { useParams } from 'next/navigation';
import DrawPreview from '@/components/tournaments/draw/DrawPreview';

export default function AdminDrawPreviewPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  return <DrawPreview slug={slug} view="list" />;
}
