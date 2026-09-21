'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 조 상세 (Batch 3C-2).
//   /admin/tournaments/[slug]/standings/[groupNo]
//   ⚠ CEO·ADMIN 전용. 순위·진출·동률은 서버 standings 값을 그대로 보여준다.
//   ⚠ 순위결정전은 정적 경로 standings/placement 가 먼저 매칭된다(이 경로로 오지 않는다).

import React from 'react';
import { useParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import StandingsGroupDetail from '@/components/tournaments/StandingsGroupDetail';

export default function AdminTournamentGroupDetailPage() {
  const params = useParams<{ slug: string; groupNo: string }>();
  const pick = (v: string | string[] | undefined) => (typeof v === 'string' ? v : Array.isArray(v) ? v[0] : '');
  const slug = pick(params?.slug);
  const groupNo = Number(pick(params?.groupNo));

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
      {Number.isInteger(groupNo) && groupNo >= 1
        ? <StandingsGroupDetail slug={slug} groupNo={groupNo} />
        : <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#64748B' }}>잘못된 조 번호입니다.</p>}
    </div>
  );
}
