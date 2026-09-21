'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 조별리그 메인 (Batch 3C-2). 조를 누르면 standings/[groupNo] 상세로 간다.
//
//   ⚠ Public 순위 화면이 아니다. CEO·ADMIN 전용.
//   ⚠ 표시 데이터는 hosted_tournament_teams 스냅샷뿐이다(접수 PII 미표시).
//   ⚠ 순위·진출 판정을 화면에서 계산하지 않는다. 서버 값을 그대로 보여준다.
//   ⚠ 본선(knockout) · 대진표는 이 화면 범위가 아니다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import StandingsBoard from '@/components/tournaments/StandingsBoard';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';

export default function AdminTournamentStandingsPage() {
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
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Link
          href={`/admin/tournaments/${slug}/matches`}
          aria-label="경기 운영"
          style={{
            width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', textDecoration: 'none', flexShrink: 0,
          }}
        >
          <ChevronLeft size={16} />
        </Link>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: '#0B7A70', wordBreak: 'break-all' }}>
            {event ? event.titleFull : slug}
            {slug.startsWith('fixture-') ? ' · FIXTURE' : ''}
          </p>
          <h1 style={{ margin: '2px 0 0', fontSize: 22, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.3 }}>
            예선 조별리그
          </h1>
        </div>
      </div>

      <StandingsBoard slug={slug} />

      <p style={{ margin: '12px 2px 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
        순위는 승률 → 게임 득실로만 정합니다. 그래도 같으면 현장에서 합산연령을 확인한 뒤
        순서만 기록합니다. 나이·생년월일은 저장하지 않습니다.
      </p>
    </div>
  );
}
