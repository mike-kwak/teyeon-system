'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 조별 일정(출전 신고 안내 · 조별 순서 · 예정 코트).
//
//   ⚠ 본부(CEO/ADMIN) 전용. 접근 판정은 서버(middleware) · admin layout · 이 페이지 · RPC 내부에서 각각 검증한다.
//   ⚠ 저장은 조편성 잠금 · DRAW 공개 상태를 바꾸지 않는다. 테스트 대회(fixture-*)에서도 쓸 수 있다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, Eye, Network, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import GroupScheduleEditor from '@/components/tournaments/schedule/GroupScheduleEditor';
import TestTournamentBanner from '@/components/tournaments/TestTournamentBanner';

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '6px 11px',
  borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
  fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
};

export default function AdminTournamentSchedulePage() {
  const params = useParams<{ slug: string }>();
  const { role } = useAuth();
  const slug = typeof params?.slug === 'string'
    ? params.slug
    : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);

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
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Link href={event ? '/admin/teyeon-open' : `/admin/tournaments/${slug}/teams`} data-sched-nav="back" style={pill}>
          <ChevronLeft size={15} strokeWidth={2.4} />{event ? 'TEYEON OPEN' : '팀 관리'}
        </Link>
        <Link href={`/admin/tournaments/${slug}/groups`} data-sched-nav="groups" style={pill}><Network size={14} />예선 조 편성</Link>
        <Link href={`/admin/tournaments/${slug}/draw-preview`} data-sched-nav="preview" style={pill}><Eye size={14} />참가자 화면 미리보기</Link>
      </div>
      <TestTournamentBanner slug={slug} style={{ marginBottom: 12 }} />
      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8' }}>
          {event ? event.titleFull : slug} · SCHEDULE
        </p>
        <h1 style={{ margin: '3px 0 0', fontSize: 22, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>조별 일정 · 출전 신고</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          조마다 첫 번째 / 두 번째 조와 예정 코트를 지정하고, 모든 조 공통 출전 신고 안내를 설정합니다. 실제 코트는 Control Center 에서 경기를 투입할 때 정해집니다.
        </p>
      </div>
      <GroupScheduleEditor slug={slug} />
    </div>
  );
}
