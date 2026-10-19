'use client';

// 현장 운영자 — 휴대폰 운영 화면 (현장 운영 4단계).
//   로그인(카카오) → 권한 요청 → 본부 승인 → 경기 시작 · 예선 점수 입력.
//   ⚠ 권한은 서버가 판정한다. 이 화면은 서버가 준 상태만 보여 준다.

import React from 'react';
import { useParams } from 'next/navigation';
import StaffApp from '@/components/tournaments/staff/StaffApp';

export default function TournamentStaffPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string'
    ? params.slug
    : Array.isArray(params?.slug) ? params!.slug[0] : '';
  return <StaffApp slug={slug} />;
}
