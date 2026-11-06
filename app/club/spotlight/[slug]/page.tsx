// /club/spotlight/[slug] — MATCH SPOTLIGHT 공개 페이지(비로그인 · 앱 설치 불필요).
//   /club/** 는 기존 공개 경로(AuthGuard 예외 · BottomNav 숨김) — 인증 정책 변경 없음.
//   데이터: anon 공개 RPC(published 만) → allow-list 파서 → 표시. 생성 전·비공개·draft 는 동일한 안내만 노출.

import type { Metadata } from 'next';
import PublicHeader from '@/components/club/PublicHeader';
import SpotlightView from '@/components/kdk/spotlight/SpotlightView';
import { fetchPublicSpotlight, SPOTLIGHT_SITE_URL, spotlightPublicPath } from '@/lib/kdk/spotlightPublicService';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await fetchPublicSpotlight(slug);
  const title = res.state === 'ok'
    ? `TODAY'S SPOTLIGHT · ${res.payload.title || 'TEYEON KDK'}`
    : "TEYEON · TODAY'S SPOTLIGHT";
  const description = res.state === 'ok'
    ? `${res.payload.date ? `${res.payload.date} · ` : ''}오늘의 주목 경기 ${res.payload.items.length}선 — 공식 KDK 기록 기반 관전 포인트`
    : 'TEYEON 오늘의 주목 경기';
  return {
    metadataBase: new URL(SPOTLIGHT_SITE_URL),
    title,
    description,
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    openGraph: {
      type: 'website',
      siteName: 'TEYEON',
      title,
      description,
      url: spotlightPublicPath(slug),
      images: [{ url: '/teyeon_logo_gold.png', width: 1024, height: 1024, alt: 'TEYEON' }],
    },
    twitter: { card: 'summary', title, description, images: ['/teyeon_logo_gold.png'] },
  };
}

export default async function SpotlightPublicPage({ params }: Props) {
  const { slug } = await params;
  const res = await fetchPublicSpotlight(slug);

  return (
    <main style={{ minHeight: '100dvh', width: '100%', background: '#F4F8FC', color: '#0F2747', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)', boxSizing: 'border-box' }}>
      <PublicHeader />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '16px 16px 0', boxSizing: 'border-box' }}>
        <header style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.18em', color: '#0D9488' }}>TODAY&apos;S SPOTLIGHT</div>
          <h1 style={{ margin: '4px 0 2px', fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>
            오늘의 주목 경기
          </h1>
          {res.state === 'ok' && (
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#5B6B80', overflowWrap: 'anywhere', wordBreak: 'keep-all' }}>
              {[res.payload.title, res.payload.date].filter(Boolean).join(' · ')}
            </p>
          )}
        </header>

        {res.state === 'ok' ? (
          <SpotlightView payload={res.payload} />
        ) : (
          <div style={{ background: '#FFFFFF', borderRadius: 16, border: '1px solid rgba(15,39,71,0.09)', padding: '28px 18px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800 }}>
              {res.state === 'unavailable' ? '잠시 후 다시 시도해 주세요.' : '공개된 주목 경기가 없습니다.'}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, fontWeight: 600, color: '#94A3B8' }}>
              {res.state === 'unavailable' ? '정보를 불러오지 못했습니다.' : '운영진이 공개하면 이 링크에서 확인할 수 있습니다.'}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
