// /club/report/[slug]/og — FINAL REPORT OG 이미지(1200×630 PNG · 카카오톡 · 메신저 미리보기용, P4).
//   데이터: 공개 페이지와 같은 anon 공개 조회(fetchPublicFinalReport → 공개 RPC → allow-list 파서)만. service_role 미사용.
//   · state ok(발행 · 공식 · 기록 지문 일치)일 때만 세션명 · 날짜 · TOP3. 정정 · 비공개 · 없음 · 조회 실패 → 중립 이미지.
//   · ?v=판 번호는 캐시 구분용 — 읽지 않는다(항상 현재 발행본을 다시 조회 · 검증).
//   · 그리기 실패 시 정적 로고로 302(공개 페이지 자체에는 영향 없음).

import React from 'react';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import FinalReportOgImage, { OG_FONT, OG_SIZE } from '@/components/kdk/finalReport/FinalReportOgImage';
import { fetchPublicFinalReport } from '@/lib/kdk/finalReportPublicService';
import { ogViewOf, type OgView } from '@/lib/kdk/finalReport/finalReportView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Assets = { font: Buffer; crest: string };
let assets: Promise<Assets> | null = null;
function loadAssets(): Promise<Assets> {
  if (!assets) {
    const dir = join(process.cwd(), 'assets', 'final-report');
    assets = Promise.all([readFile(join(dir, 'NotoSansKR-ExtraBold-subset.ttf')), readFile(join(dir, 'teyeon-crest-og.png'))])
      .then(([font, crest]) => ({ font, crest: `data:image/png;base64,${crest.toString('base64')}` }))
      .catch((e) => { assets = null; throw e; });
  }
  return assets;
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let view: OgView = { kind: 'neutral' };
  try { view = ogViewOf(await fetchPublicFinalReport(slug)); } catch { view = { kind: 'neutral' }; }
  try {
    const a = await loadAssets();
    const img = new ImageResponse(<FinalReportOgImage view={view} crest={a.crest} />, {
      ...OG_SIZE,
      fonts: [{ name: OG_FONT, data: a.font, weight: 800, style: 'normal' }],
    });
    // 스트림 안에서 나는 오류도 여기서 잡도록 끝까지 그린 뒤 돌려준다.
    const body = await img.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        // 비공개 · 정정이 오래 남지 않도록 CDN 캐시는 짧게(판 번호 쿼리로 재발행 때는 새 주소).
        'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30',
        'x-fr-og': view.kind,
      },
    });
  } catch (e) {
    // 서버 로그에는 오류 종류만(이름 · 토큰 · 세션 정보 없음).
    console.error('[final-report og] render failed:', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
    return new Response(null, { status: 302, headers: { location: new URL('/teyeon_logo_gold.png', req.url).toString(), 'cache-control': 'no-store', 'x-fr-og': 'fallback' } });
  }
}
