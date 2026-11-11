// /club/report/[slug] — TEYEON KDK FINAL REPORT 공개 매거진(비로그인 · 카카오톡 링크 공유용).
//   /club/** 는 기존 공개 경로(BottomNav · GlobalHeader 숨김, 인증 정책 변경 없음). 검색 노출은 하지 않는다(noindex).
//   데이터: anon 공개 RPC(get_public_kdk_final_report) → allow-list 파서 → 표시. 상태 4종: ok · corrected · not_found · unavailable.

import { cache } from 'react';
import type { Metadata } from 'next';
import FinalReportMagazine from '@/components/kdk/finalReport/FinalReportMagazine';
import FinalReportStateCard from '@/components/kdk/finalReport/FinalReportStateCard';
import { FINAL_REPORT_SITE_URL, fetchPublicFinalReport, finalReportPublicPath, officialResultPath } from '@/lib/kdk/finalReportPublicService';
import { reportMetaDescription, reportMetaTitle } from '@/lib/kdk/finalReport/finalReportView';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

// 같은 요청 안에서 메타데이터와 본문이 공개 RPC 를 한 번만 부르도록.
const load = cache((slug: string) => fetchPublicFinalReport(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await load(slug);
  const title = res.state === 'ok' ? reportMetaTitle(res.payload) : 'TEYEON · THE FINAL STORY';
  const description = res.state === 'ok' ? reportMetaDescription(res.payload) : 'TEYEON KDK 공식 결과 리포트';
  return {
    metadataBase: new URL(FINAL_REPORT_SITE_URL),
    title,
    description,
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
    openGraph: {
      type: 'article',
      siteName: 'TEYEON',
      title,
      description,
      url: finalReportPublicPath(slug),
      images: [{ url: '/teyeon_logo_gold.png', width: 1024, height: 1024, alt: 'TEYEON' }],
    },
    twitter: { card: 'summary', title, description, images: ['/teyeon_logo_gold.png'] },
  };
}

export default async function FinalReportPublicPage({ params }: Props) {
  const { slug } = await params;
  const res = await load(slug);
  if (res.state === 'ok') {
    return <FinalReportMagazine payload={res.payload} officialHref={res.officialSessionId ? officialResultPath(res.officialSessionId) : null} />;
  }
  if (res.state === 'corrected') {
    return <FinalReportStateCard kind="corrected" title={res.title} date={res.date} officialHref={res.officialSessionId ? officialResultPath(res.officialSessionId) : null} />;
  }
  return <FinalReportStateCard kind={res.state} retryHref={finalReportPublicPath(slug)} />;
}
