'use client';

// Admin — 공식 결과 아카이브(검증 · 확정 · 공개 · 정정 · 시상 사진 · 영상). CEO · ADMIN 전용.
//   ⚠ 경기 · 대진 · 점수는 여기서 바꾸지 않는다. 확정은 관리자가 검증을 보고 직접 누를 때만.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Award, ChevronLeft, ShieldAlert, Trophy } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import ResultAdminBoard from '@/components/tournaments/results/ResultAdminBoard';

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '6px 11px',
  borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
  fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
};

export default function AdminTournamentResultsPage() {
  const params = useParams<{ slug: string }>();
  const { role } = useAuth();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);

  if (!isFullAdminRole(role)) {
    return (
      <div style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={17} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>이 화면은 CEO · ADMIN 만 사용할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Link href={event ? '/admin/teyeon-open' : `/admin/tournaments/${slug}/bracket`} style={pill}>
          <ChevronLeft size={15} strokeWidth={2.4} />{event ? 'TEYEON OPEN' : '본선 대진'}
        </Link>
        <Link href={`/admin/tournaments/${slug}/bracket`} style={pill}><Trophy size={14} strokeWidth={2.4} /> 본선 대진</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Award size={18} color="#0E8C80" strokeWidth={2.4} />
        <div>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0F172A' }}>공식 결과 아카이브</p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B' }}>{event ? event.titleFull : slug}</p>
        </div>
      </div>
      <ResultAdminBoard slug={slug} />
    </div>
  );
}
