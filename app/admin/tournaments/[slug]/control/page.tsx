'use client';

export const dynamic = 'force-dynamic';

// Admin — 대회 당일 관제 (Batch 4F-1 · 조작 4F-3).
//
//   ⚠ 호명 · 투입 · 점수 · 완료를 이 화면에서 한다(기존 운영 service 를 그대로 부른다 — ControlCenter 참고).
//   ⚠ 새 RPC · 새 테이블 · 새 권한을 만들지 않는다. 기존 운영 RPC 3개만 읽는다.
//   ⚠ 접근 판정은 기존 그대로 — 서버(middleware) · admin layout · 이 페이지 · RPC 내부에서 각각 검증한다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import ControlCenter from '@/components/tournaments/control/ControlCenter';

export default function AdminTournamentControlPage() {
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

  if (!event) {
    return (
      <div style={{ maxWidth: 1560, margin: '0 auto' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#475569' }}>
          대회를 찾을 수 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1560, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Link
          href={`/admin/tournaments/${slug}/teams`}
          aria-label="팀 관리"
          style={{
            width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', textDecoration: 'none', flexShrink: 0,
          }}
        >
          <ChevronLeft size={16} strokeWidth={2.4} />
        </Link>
        {/* ⚠ 운영 화면에 slug 를 그대로 띄우지 않는다. 표시용 이름은 이미 들고 있는 대회 정보에서 쓴다
            (새 조회를 더하지 않는다). slug 는 경로 식별용으로만 남는다. */}
        <p style={{
          margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: '#94A3B8',
        }}>
          {event.titleFull}
        </p>
      </div>

      <ControlCenter slug={slug} event={event} />
    </div>
  );
}
