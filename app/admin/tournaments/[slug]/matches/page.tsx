'use client';

export const dynamic = 'force-dynamic';

// Admin — 예선 경기 운영 (Batch 3C-1).
//
//   ⚠ 최종 Control Center 디자인이 아니다. Batch 3A 경기 엔진을 실제 계정으로 검증하고
//     현장에서 경기를 돌려 보기 위한 최소 운영 화면이다.
//   ⚠ 표시 데이터는 hosted_tournament_teams 스냅샷뿐이다(접수 PII 미표시).
//   ⚠ Standings / 합산연령 / 본선은 이 화면 범위가 아니다.

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ChevronLeft, ShieldAlert, Swords } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isFullAdminRole } from '@/lib/admin/adminAccess';
import MatchOpsBoard from '@/components/tournaments/MatchOpsBoard';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';

export default function AdminTournamentMatchesPage() {
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
          href={`/admin/tournaments/${slug}/groups`}
          aria-label="예선 조편성"
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
            <Swords size={15} strokeWidth={2.4} color="#0E8C80" />
            예선 경기 운영
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, color: '#64748B', wordBreak: 'break-all' }}>
            {event ? event.titleFull : slug}
            {slug.startsWith('fixture-') ? ' · FIXTURE' : ''}
          </p>
        </div>
      </div>

      <MatchOpsBoard slug={slug} />

      <p style={{ margin: '12px 2px 0', fontSize: 11.5, fontWeight: 600, color: '#94A3B8', lineHeight: 1.7, wordBreak: 'keep-all' }}>
        기권·노쇼는 별도 상태 없이 상대팀 6:0 승리로 입력합니다. “취소”는 공식 결과가 없는 경기를 뜻합니다.
        순위 계산과 합산연령 확인은 다음 단계에서 붙습니다.
      </p>
    </div>
  );
}
