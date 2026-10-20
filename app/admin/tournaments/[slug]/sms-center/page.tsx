'use client';

export const dynamic = 'force-dynamic';

// Admin — 대회 문자 안내 센터(SMS NOTICE CENTER).
//
//   ⚠ 본부(CEO/ADMIN) 전용. 접근 판정은 서버(middleware) · admin layout · 이 페이지 · 각 RPC 내부에서 각각 검증한다.
//   ⚠ 문자를 직접 보내지 않는다 — 번호 · 문구를 복사해 운영진 휴대폰 문자 앱으로 보낸다.
//   ⚠ 참가 신청 원본 · 조편성 · DRAW 상태를 바꾸지 않는다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ClipboardList, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import SmsCenter from '@/components/tournaments/sms/SmsCenter';
import TestTournamentBanner from '@/components/tournaments/TestTournamentBanner';

const pill: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '6px 11px',
  borderRadius: 999, border: '1px solid #E2E8F0', background: '#fff', color: '#475569',
  fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap',
};

export default function AdminTournamentSmsCenterPage() {
  const params = useParams<{ slug: string }>();
  const { role } = useAuth();
  const slug = typeof params?.slug === 'string'
    ? params.slug
    : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);

  if (!isFullAdminRole(role)) {
    return (
      <div data-sms-state="role-denied" style={{ display: 'flex', gap: 9, padding: 15, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12 }}>
        <ShieldAlert size={17} color="#B91C1C" style={{ flexShrink: 0, marginTop: 1 }} />
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0F172A', lineHeight: 1.7 }}>
          이 화면은 CEO · ADMIN 만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Link href={event ? '/admin/teyeon-open' : `/admin/tournaments/${slug}/registrations`} data-sms-nav="back" style={pill}>
          <ChevronLeft size={15} strokeWidth={2.4} />{event ? 'TEYEON OPEN' : '신청 현황'}
        </Link>
        <Link href={`/admin/tournaments/${slug}/registrations`} data-sms-nav="registrations" style={pill}><ClipboardList size={14} />신청 현황(번호 수정)</Link>
      </div>
      <TestTournamentBanner slug={slug} style={{ marginBottom: 12 }} />
      <div style={{ marginBottom: 12 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8' }}>
          {event ? event.titleFull : slug} · SMS NOTICE CENTER
        </p>
        <h1 style={{ margin: '3px 0 0', fontSize: 22, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>대회 문자 안내 센터</h1>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          참가자 연락처 · 문자 템플릿 · 안내 링크 관리. 번호와 문구를 복사해 휴대폰 문자 앱으로 직접 보냅니다(자동 발송 없음).
        </p>
      </div>
      <SmsCenter slug={slug} />
    </div>
  );
}
