'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 대진표 미리보기(조 상세). 공개 상태를 바꾸지 않는다.

import React from 'react';
import { useParams } from 'next/navigation';
import DrawPreview from '@/components/tournaments/draw/DrawPreview';

export default function AdminDrawPreviewGroupPage() {
  const params = useParams<{ slug: string; groupNo: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const n = Number(typeof params?.groupNo === 'string' ? params.groupNo : '');
  return <DrawPreview slug={slug} view="group" groupNo={Number.isInteger(n) ? n : -1} />;
}
