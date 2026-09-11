'use client';

export const dynamic = 'force-dynamic';

// /admin/tournaments/[slug] — 실질 화면은 신청 목록이므로 그대로 넘긴다.
//   중간 요약 페이지를 따로 두면 모바일에서 불필요한 한 단계가 늘어난다.

import React from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function AdminTournamentDetailRedirect() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

  React.useEffect(() => {
    if (slug) router.replace(`/admin/tournaments/${slug}/registrations`);
  }, [slug, router]);

  return (
    <p style={{ margin: 0, padding: '28px 0', textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: '#94A3B8' }}>
      이동 중…
    </p>
  );
}
