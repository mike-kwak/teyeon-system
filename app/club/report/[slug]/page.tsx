// /club/report/[slug] — TEYEON KDK FINAL REPORT 공개 매거진(비로그인 · 카카오톡 링크 공유용).
//   /club/** 는 기존 공개 경로(BottomNav · GlobalHeader 숨김, 인증 정책 변경 없음). 검색 노출은 하지 않는다(noindex).
//   데이터: anon 공개 RPC(get_public_kdk_final_report) → allow-list 파서 → 표시. 상태 4종: ok · corrected · not_found · unavailable.

import { cache } from 'react';
import type { Metadata } from 'next';
import FinalReportMagazine from '@/components/kdk/finalReport/FinalReportMagazine';
import FinalReportStateCard from '@/components/kdk/finalReport/FinalReportStateCard';
import {
  FINAL_REPORT_SITE_URL, fetchOfficialResultSummary, fetchPublicFinalReport, finalReportOgPath, finalReportPublicPath, finalReportSharePath, finalReportShareUrl,
} from '@/lib/kdk/finalReportPublicService';
import { reportMetaDescription, reportMetaTitle } from '@/lib/kdk/finalReport/finalReportView';
import { shareDataOf } from '@/lib/kdk/finalReport/finalReportShare';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

// 같은 요청 안에서 메타데이터와 본문이 공개 RPC 를 한 번만 부르도록.
const load = cache((slug: string) => fetchPublicFinalReport(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const res = await load(slug);
  const ok = res.state === 'ok';
  const title = ok ? reportMetaTitle(res.payload) : 'TEYEON · THE FINAL STORY';
  const description = ok ? reportMetaDescription(res.payload) : 'TEYEON KDK 공식 결과 리포트';
  // 판 번호(?v=)는 DB 의 현재 발행 판에서만 만든다(요청 쿼리를 믿지 않음). 정정 · 비공개 · 없음 → 판 번호 없는 중립 이미지.
  const revision = ok ? res.revision : null;
  const image = { url: finalReportOgPath(slug, revision), width: 1200, height: 630, alt: ok ? title : 'TEYEON KDK FINAL REPORT' };
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
      url: ok ? finalReportSharePath(slug, revision) : finalReportPublicPath(slug),
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

export default async function FinalReportPublicPage({ params }: Props) {
  const { slug } = await params;
  const res = await load(slug);
  if (res.state === 'ok') {
    // 공식 결과 상세(/club/kdk/[id])에는 공개 게스트 정산이 함께 있어 리포트에서 직접 연결하지 않는다(버튼 숨김 · 공개본 무변경).
    return <FinalReportMagazine payload={res.payload} officialHref={null} reportSlug={slug}
      share={shareDataOf(res.payload.session.title, finalReportShareUrl(slug, res.revision))} />;
  }
  if (res.state === 'corrected') {
    // 정정 안내(A안): 서버에서 공식 결과를 읽어 순위 · 완료 경기만 전달(정산 · 계좌 필드는 서버에서 버림).
    const official = res.officialSessionId ? await fetchOfficialResultSummary(res.officialSessionId) : null;
    return <FinalReportStateCard kind="corrected" title={res.title} date={res.date} official={official} retryHref={finalReportPublicPath(slug)} />;
  }
  return <FinalReportStateCard kind={res.state} retryHref={finalReportPublicPath(slug)} />;
}
