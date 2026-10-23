'use client';

export const dynamic = 'force-dynamic';

// Admin — LIVE 모니터 (Phase 1).
//
//   ⚠ 이 화면은 '조회 전용'이다. 송출 시작/종료는 현장 송출 앱에서 하고, 여기서는 상태만 본다.
//     Live Input 생성·삭제·키 회전 같은 쓰기 동작은 Phase 1 범위가 아니다.
//   ⚠ Provider 가 주지 않는 값(bitrate / 해상도 / stream health)을 임의로 만들어 표시하지 않는다.
//   ⚠ 기존 Admin 화면(신청 목록 등)은 건드리지 않는다. LIVE 는 별도 route 로만 붙는다.
//     Provider 가 죽어도 이 페이지만 'UNAVAILABLE' 이고 운영 화면은 영향받지 않는다.

import React from 'react';
import Link from 'next/link';
import { ChevronLeft, ShieldAlert, Radio } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import TournamentLivePanel from '@/components/tournaments/TournamentLivePanel';
import LiveMatchAdminPanel from '@/components/tournaments/live/LiveMatchAdminPanel';
import LiveReplayAdminPanel from '@/components/tournaments/live/LiveReplayAdminPanel';
import LiveSourceAdminPanel from '@/components/tournaments/live/LiveSourceAdminPanel';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';

export default function AdminTournamentLivePage() {
  const params = useParams<{ slug: string }>();
  const slug =
    typeof params?.slug === 'string'
      ? params.slug
      : Array.isArray(params?.slug)
        ? params!.slug[0]
        : '';

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
          href={`/admin/tournaments/${slug}/registrations`}
          aria-label="신청 목록"
          style={{
            width: 30, height: 30, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: '#475569', textDecoration: 'none', flexShrink: 0,
          }}
        >
          <ChevronLeft size={16} />
        </Link>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 900, color: '#0F172A' }}>
            <Radio size={15} strokeWidth={2.4} color="#0E8C80" />
            LIVE 모니터
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B' }}>
            {event ? event.titleFull : slug}
          </p>
        </div>
      </div>

      {/* 영상 소스(YouTube 기본 · Cloudflare 백업) · YouTube 방송 주소 — 시청자 화면이 어떤 플레이어를 보여 줄지. 실제 송출 전환은 현장 앱에서. */}
      <div style={{ marginBottom: 12 }}>
        <LiveSourceAdminPanel slug={slug} />
      </div>

      {/* 중계 경기 지정(자동 · 예외 수동) — 영상 송출과 별개. 관제 화면 상단의 패널과 같은 컴포넌트다. */}
      <div style={{ marginBottom: 12 }}>
        <LiveMatchAdminPanel slug={slug} defaultOpen />
      </div>

      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 15 }}>
        <TournamentLivePanel slug={slug} showProviderDetail />
      </div>

      {/* 녹화 ↔ 경기 구간(경기별 다시보기) — 확정한 구간만 시청자에게 공개된다. 원본 녹화 · 원본 다시보기 목록은 그대로. */}
      <div style={{ marginTop: 12 }}>
        <LiveReplayAdminPanel slug={slug} />
      </div>

      <p style={{ margin: '12px 2px 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
        영상 LIVE 상태는 경기 진행 상태와 별개입니다. 송출이 끊겨도 대진·코트·경기 결과 운영에는 영향이 없습니다.
      </p>
    </div>
  );
}
