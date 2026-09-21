'use client';

export const dynamic = 'force-dynamic';

// Admin — 순위결정전 상세 (Batch 3C-2).
//   /admin/tournaments/[slug]/standings/placement
//   ⚠ CEO·ADMIN 전용. 일반 예선 standings 와 섞지 않는다. 두 팀 모두 본선 진출.

import React from 'react';
import { useParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import StandingsPlacementDetail from '@/components/tournaments/StandingsPlacementDetail';

export default function AdminTournamentPlacementPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string' ? params.slug
      : Array.isArray(params?.slug) ? params!.slug[0] : '';

  const { role } = useAuth();
  if (!isFullAdminRole(role)) {
    return (
      <div style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={18} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0F172A', lineHeight: 1.6 }}>
          이 메뉴는 CEO·ADMIN 전용입니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <StandingsPlacementDetail slug={slug} />
    </div>
  );
}
