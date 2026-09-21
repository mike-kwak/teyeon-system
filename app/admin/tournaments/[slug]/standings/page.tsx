'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 순위 / 합산연령 확인 (Batch 3C-2).
//
//   ⚠ Public 순위 화면이 아니다. CEO·ADMIN 전용.
//   ⚠ 표시 데이터는 hosted_tournament_teams 스냅샷뿐이다(접수 PII 미표시).
//   ⚠ 순위·진출 판정을 화면에서 계산하지 않는다. 서버 값을 그대로 보여준다.
//   ⚠ 본선(knockout) · 대진표는 이 화면 범위가 아니다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert, ListOrdered } from 'lucide-react';
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
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 900, color: '#0F172A' }}>
            <ListOrdered size={15} strokeWidth={2.4} color="#0E8C80" />
            예선 순위
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', wordBreak: 'break-all' }}>
            {event ? event.titleFull : slug}
            {slug.startsWith('fixture-') ? ' · FIXTURE' : ''}
          </p>
        </div>
      </div>

      <StandingsBoard slug={slug} />

      <p style={{ margin: '12px 2px 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
        순위는 승률 → 게임 득실 두 단계로만 정합니다. 그래도 갈리지 않으면 시스템이 순위를 만들지 않고
        현장 합산연령 확인 결과를 기다립니다. 나이·생년월일은 저장하지 않으며 확정된 순서만 기록됩니다.
      </p>
    </div>
  );
}
