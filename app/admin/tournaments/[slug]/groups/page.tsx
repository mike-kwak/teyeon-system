'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 조편성 (Batch 2B).
//
//   ⚠ 경기이사가 실제 대회 준비에 쓰는 운영 화면이다. 일반 회원용이 아니다.
//     PC/노트북 사용성을 우선하되 모바일에서도 조작이 가능해야 한다.
//   ⚠ 시스템은 조를 자동으로 짜지 않는다. 모든 배치는 경기이사가 직접 한다.
//   ⚠ 표시 데이터는 hosted_tournament_teams 스냅샷뿐이다(접수 PII 미표시).

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert, LayoutList } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import GroupAssignBoard from '@/components/tournaments/GroupAssignBoard';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';

export default function AdminTournamentGroupsPage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string' ? params.slug
      : Array.isArray(params?.slug) ? params!.slug[0] : '';

  const { role } = useAuth();
  const allowed = isFullAdminRole(role);
  const event = getOfficialTournament(slug);

  if (!allowed) {
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
    // 조 카드가 여러 열로 펼쳐지므로 다른 Admin 화면(880px)보다 넓게 쓴다.
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link
          href={`/admin/tournaments/${slug}/teams`}
          aria-label="팀 관리"
          style={{
            width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', textDecoration: 'none', flexShrink: 0,
          }}
        >
          <ChevronLeft size={16} />
        </Link>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 900, color: '#0F172A' }}>
            <LayoutList size={15} strokeWidth={2.4} color="#0E8C80" />
            예선 조편성
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', wordBreak: 'break-all' }}>
            {event ? event.titleFull : slug}
            {slug.startsWith('fixture-') ? ' · FIXTURE' : ''}
          </p>
        </div>
      </div>

      <GroupAssignBoard slug={slug} />

      <p style={{ margin: '12px 2px 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
        조 편성은 경기이사가 결정합니다. 시스템은 입력된 배치를 저장하고 구조가 올바른지 검사할 뿐,
        조를 자동으로 구성하거나 팀을 자동으로 배치하지 않습니다.
      </p>
    </div>
  );
}
