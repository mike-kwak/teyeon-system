'use client';

export const dynamic = 'force-dynamic';

// Signature Court Board — 보조 모니터 운영 연결 화면 (/tournaments/[slug]/signature/courts).
//
//   Court Board 디자인 그대로(기본 2열 × 5행 — 왼쪽 1~5 · 오른쪽 6~10), 데이터만 운영 경기 현황에서 받는다(읽기 전용).
//   ⚠ 조회 = 운영 Arena 와 같은 훅(useArenaData · mode=knockout): get_admin_match_board(코트 · 경기) +
//     get_admin_bracket(본선 라운드 이름 표시용). 순위는 읽지 않는다.
//   ⚠ NOW = 코트에서 지금 진행 중(playing)인 경기. 예선 · 순위결정전 · 본선을 저장된 stage 로 구분한다.
//   ⚠ NEXT = 운영 데이터에 없다 → 모든 코트 '미정'. 호명(calling) 경기 · 경기 순서로 추측하지 않는다(지정 기능은 후속 단계).
//   ⚠ 코트 상태 = 저장된 courts.status(active / disabled). 등록되지 않은 자리는 '미등록'.
//   ⚠ ?layout=2x5(기본 · TV 실물 검수 10-16) | 5x2(정식 옵션). 버튼 · 전체화면 버튼 · 키보드 L(2 · 5)로 전환.
//     배치는 주소만 바꾼다 — 조회 훅(useArenaData)은 다시 시작하지 않고 마지막 정상 데이터를 그대로 쓴다.

import React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { useArenaData } from '@/components/tournaments/arena/arenaView';
import { SignatureControlButton } from '@/components/tournaments/arena-signature/SignatureArenaShell';
import SignatureCourtBoard, {
  COURT_BOARD_LAYOUTS, courtBoardLayoutOf, useCourtBoardLayoutKeys,
} from '@/components/tournaments/arena-signature/SignatureCourtBoard';
import type { CourtBoardLayout } from '@/components/tournaments/arena-signature/SignatureCourtBoard';
import SignatureLiveFrame from '@/components/tournaments/arena-signature/SignatureLiveFrame';
import SignatureNotFound from '@/components/tournaments/arena-signature/SignatureNotFound';
import { courtBoardFromSnapshot, liveEventInfo } from '@/components/tournaments/arena-signature/signatureLiveAdapter';
import { SIG_BOARD_WIDTH, SIG_LAYOUT } from '@/components/tournaments/arena-signature/signatureTheme';

const BOARD_H = 1080 - SIG_LAYOUT.padTop - SIG_LAYOUT.padBottom - SIG_LAYOUT.headerHeight - SIG_LAYOUT.headerGap;

export default function SignatureCourtsLivePage() {
  return (
    <React.Suspense fallback={null}>
      <SignatureCourtsLiveView />
    </React.Suspense>
  );
}

function SignatureCourtsLiveView() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);
  const layout = courtBoardLayoutOf(search?.get('layout') ?? null);
  const state = useArenaData(event ? slug : '', 'knockout');

  const go = React.useCallback((l: CourtBoardLayout) => {
    router.replace(`/tournaments/${slug}/signature/courts?layout=${l}`, { scroll: false });
  }, [router, slug]);
  useCourtBoardLayoutKeys(layout, go);

  if (!event) return <SignatureNotFound />;

  const layoutButtons = COURT_BOARD_LAYOUTS.map(([l, label]) => (
    <SignatureControlButton key={l} active={l === layout} onClick={() => go(l)}>{label}</SignatureControlButton>
  ));

  return (
    <SignatureLiveFrame
      slug={slug} mode="knockout" state={state} noticeHeight={BOARD_H}
      event={liveEventInfo(event, { en: 'COURT BOARD', ko: '코트별 경기 안내' })} badge="SIGNATURE LIVE · 코트"
      courtPosition="bottom" showCourts={false}
      controls={layoutButtons} fullscreenControls={layoutButtons}
    >
      {(snapshot) => (
        <SignatureCourtBoard courts={courtBoardFromSnapshot(snapshot)} layout={layout} width={SIG_BOARD_WIDTH} height={BOARD_H} />
      )}
    </SignatureLiveFrame>
  );
}
