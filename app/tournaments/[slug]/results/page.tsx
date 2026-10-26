'use client';

// /tournaments/[slug]/results — TEYEON OPEN 공식 결과 아카이브(회차별). 비로그인 공개 · 읽기 전용.
//   ⚠ 공개 승인된 확정 기록만 보인다(get_public_tournament_result). 확정 · 공개 전이면 '준비 중' 안내.
//   ⚠ 다른 회차는 위 회차 선택으로 이동한다(주소로 직접 접근 가능).

import React from 'react';
import { useParams } from 'next/navigation';
import { Trophy } from 'lucide-react';
import TournamentPublicHeader from '@/components/tournaments/TournamentPublicHeader';
import TournamentNavigation from '@/components/tournaments/TournamentNavigation';
import ResultArchiveView from '@/components/tournaments/results/ResultArchiveView';
import { TT } from '@/components/tournaments/tournamentTheme';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { buildHubNavItems } from '@/lib/tournaments/phase';
import { usePublicDrawPublished } from '@/components/tournaments/draw/publicDrawView';
import { fetchResultArchive, fetchResultEditions } from '@/lib/tournaments/resultArchiveService';
import type { ResultArchive, ResultEditionSummary } from '@/lib/tournaments/resultArchiveTypes';

type Load = { kind: 'loading' } | { kind: 'ok'; archive: ResultArchive } | { kind: 'none' } | { kind: 'error' };

function Notice({ title, desc }: { title: string; desc?: string }) {
  return (
    <div data-result-notice style={{ background: TT.surface, border: `1px solid ${TT.line}`, borderRadius: 14, padding: '28px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
      <Trophy size={26} color={TT.teal} strokeWidth={2} />
      <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: TT.ink, lineHeight: 1.5, wordBreak: 'keep-all' }}>{title}</p>
      {desc && <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: TT.muted, lineHeight: 1.65, wordBreak: 'keep-all' }}>{desc}</p>}
    </div>
  );
}

export default function TournamentResultsPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);
  const drawPublished = usePublicDrawPublished(event ? event.slug : '');
  const [load, setLoad] = React.useState<Load>({ kind: 'loading' });
  const [editions, setEditions] = React.useState<ResultEditionSummary[]>([]);

  React.useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoad({ kind: 'loading' });
    Promise.all([fetchResultArchive(slug), fetchResultEditions().catch(() => [] as ResultEditionSummary[])])
      .then(([a, e]) => { if (!alive) return; setEditions(e); setLoad(a ? { kind: 'ok', archive: a } : { kind: 'none' }); })
      .catch(() => { if (alive) setLoad({ kind: 'error' }); });
    return () => { alive = false; };
  }, [slug]);

  const year = load.kind === 'ok' ? (load.archive.tournament.eventDate ?? '').slice(0, 4) : '';
  const shortTag = event ? event.shortTag : year ? `${year} OPEN` : 'OPEN';

  return (
    <main style={{ width: '100%', minHeight: '100%', flexShrink: 0, backgroundColor: TT.bg }}>
      <TournamentPublicHeader shortTag={shortTag} backHref={event ? `/tournaments/${event.slug}` : '/tournaments/results'} />
      {event && <TournamentNavigation items={buildHubNavItems({ slug: event.slug, current: 'results', phase: 'finished', drawPublished })} defaultNote="대회 진행에 따라 순차 공개" />}
      <div className="tt-container" style={{ paddingTop: 18, paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        {load.kind === 'loading' && <Notice title="공식 결과를 불러오는 중…" />}
        {load.kind === 'error' && <Notice title="공식 결과를 불러오지 못했습니다." desc="잠시 후 다시 확인해 주세요." />}
        {load.kind === 'none' && <Notice title="공식 결과 준비 중입니다." desc="대회 운영진이 기록을 확인한 뒤 이 화면에 공식 결과를 공개합니다." />}
        {load.kind === 'ok' && <ResultArchiveView archive={load.archive} editions={editions} />}
      </div>
    </main>
  );
}
