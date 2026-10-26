'use client';

// /tournaments/results — TEYEON OPEN 역대 공식 결과 입구. 공개된 회차 중 최신 회차로 보낸다(없으면 준비 중).

import React from 'react';
import { useRouter } from 'next/navigation';
import { Trophy } from 'lucide-react';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import { TT } from '@/components/tournaments/tournamentTheme';
import { fetchResultEditions } from '@/lib/tournaments/resultArchiveService';

export default function TournamentResultsIndexPage() {
  const router = useRouter();
  const [state, setState] = React.useState<'loading' | 'none' | 'error'>('loading');
  React.useEffect(() => {
    let alive = true;
    fetchResultEditions()
      .then((e) => { if (!alive) return; if (e.length) router.replace(`/tournaments/${e[0].slug}/results`); else setState('none'); })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [router]);
  return (
    <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg }}>
      <TournamentPublicHeader shortTag="RESULTS" />
      <div className="tt-container" style={{ paddingTop: 24 }}>
        <div style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '28px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <Trophy size={26} color={TT.teal} strokeWidth={2} />
          <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink }}>
            {state === 'loading' ? '공식 결과를 여는 중…' : state === 'error' ? '공식 결과를 불러오지 못했습니다.' : '공개된 공식 결과가 아직 없습니다.'}
          </p>
        </div>
      </div>
    </main>
  );
}
