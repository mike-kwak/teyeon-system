'use client';

export const dynamic = 'force-dynamic';

// Admin — 현장 운영자 승인 · 회수 (현장 운영 3단계).
//
//   ⚠ 본부(CEO/ADMIN) 전용. 접근 판정은 기존 그대로 — 서버(middleware) · admin layout · 이 페이지 · RPC 내부.
//   ⚠ 테스트 대회(fixture-*)에서도 쓸 수 있다(리허설용). 화면 맨 위에 테스트 대회 띠가 나온다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert, Gauge, UserCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { isTestTournamentSlug } from '@/lib/tournaments/testTournament';
import StaffAdminBoard from '@/components/tournaments/staff/StaffAdminBoard';
import TestTournamentBanner from '@/components/tournaments/TestTournamentBanner';

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '6px 11px',
  borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
  fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
};

export default function AdminTournamentStaffPage() {
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
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Link href={event ? '/admin/teyeon-open' : `/admin/tournaments/${slug}/teams`} data-staff-nav="back" style={pill}>
          <ChevronLeft size={15} strokeWidth={2.4} />
          {event ? 'TEYEON OPEN' : '팀 관리'}
        </Link>
        {(event || test) && (
          <Link href={`/admin/tournaments/${slug}/control`} data-staff-nav="control" style={pill}>
            <Gauge size={14} strokeWidth={2.4} /> Control Center
          </Link>
        )}
        <Link href={`/admin/tournaments/${slug}/checkin`} data-staff-nav="checkin" style={pill}>
          <UserCheck size={14} strokeWidth={2.4} /> 선수 체크인
        </Link>
      </div>

      <TestTournamentBanner slug={slug} style={{ marginBottom: 12 }} />

      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8' }}>
          {event ? event.titleFull : slug} · FIELD STAFF
        </p>
        <h1 style={{ margin: '3px 0 0', fontSize: 22, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
          현장 운영자
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          임원진 · 외부 도우미 모두 같은 '현장 운영자' 입니다. 승인한 사람은 이 대회에서만 예선 · 본선 경기 시작 · 점수 입력 · 완료를 할 수 있습니다.
        </p>
      </div>

      <StaffAdminBoard slug={slug} />
    </div>
  );
}
