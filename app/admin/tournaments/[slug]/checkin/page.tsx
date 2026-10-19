'use client';

export const dynamic = 'force-dynamic';

// Admin — 현장 팀 체크인 (현장 운영 1단계).
//
//   ⚠ 본부(CEO/ADMIN) 전용. 접근 판정은 기존 그대로 — 서버(middleware) · admin layout · 이 페이지 · RPC 내부에서 각각 검증한다.
//   ⚠ 공식 대회가 아니어도(리허설용 fixture 대회) 쓸 수 있다 — 표시 이름만 공식 대회 정보에서 가져온다.
//     테스트 대회(fixture-*)는 맨 위에 테스트 대회 띠가 나오고, Control Center 로 이동할 수 있다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert, Gauge } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import TeamCheckinBoard from '@/components/tournaments/checkin/TeamCheckinBoard';
import TestTournamentBanner from '@/components/tournaments/TestTournamentBanner';
import { isTestTournamentSlug } from '@/lib/tournaments/testTournament';

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '6px 11px',
  borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
  fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
};

export default function AdminTournamentCheckinPage() {
  const params = useParams<{ slug: string }>();
  const { role } = useAuth();
  const slug = typeof params?.slug === 'string'
    ? params.slug
    : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);
  const test = isTestTournamentSlug(slug);

  if (!isFullAdminRole(role)) {
    return (
      <div style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={17} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
          이 화면은 CEO · ADMIN 만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Link href={event ? '/admin/teyeon-open' : `/admin/tournaments/${slug}/teams`}
          data-checkin-nav="back" style={pill}>
          <ChevronLeft size={15} strokeWidth={2.4} />
          {event ? 'TEYEON OPEN' : '팀 관리'}
        </Link>
        {(event || test) && (
          <Link href={`/admin/tournaments/${slug}/control`} data-checkin-nav="control" style={pill}>
            <Gauge size={14} strokeWidth={2.4} />
            Control Center
          </Link>
        )}
      </div>

      <TestTournamentBanner slug={slug} style={{ marginBottom: 12 }} />

      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8' }}>
          {event ? event.titleFull : slug} · CHECK-IN
        </p>
        <h1 style={{ margin: '3px 0 0', fontSize: 22, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
          선수 체크인
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          복식 선수 두 명이 모두 도착한 것을 직접 확인한 뒤 팀을 체크인합니다.
        </p>
      </div>

      <TeamCheckinBoard slug={slug} />
    </div>
  );
}
