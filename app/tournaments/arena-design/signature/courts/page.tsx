'use client';

// Arena TV — Signature Court Board 디자인 Demo (/tournaments/arena-design/signature/courts).
//
//   보조 모니터(회장님 태블릿 → 외부 모니터)에 띄울 코트 전용 전광판. 코트 1~10 의 NOW PLAYING · NEXT.
//   ⚠ 데이터는 가명 · 가상 fixture 뿐이다(signatureCourtBoardFixture). NEXT 는 운영 시스템에 없는 정보라
//     디자인 확인용 가상 값이며, 없으면 '미정'으로 보인다. 운영 RPC · Supabase · Realtime 을 쓰지 않는다.
//   ⚠ 본선 · 예선 Signature 화면과 같은 Shell · Header · 배경을 import 해서 쓴다(그 파일들은 고치지 않는다).
//     코트 스트립은 쓰지 않는다(showCourts=false) — 이 화면 자체가 코트 현황이다.
//   ⚠ 주소에 상태를 남긴다 — 새로고침해도 같은 화면이다.
//       ?layout=2x5(기본 · 2열 × 5행 — 왼쪽 1~5 · 오른쪽 6~10 · TV 실물 검수 10-16) | 5x2(5열 × 2행 · 정식 옵션)
//     배치 전환: 조작 줄 버튼 · 전체화면에서는 움직임이 있을 때 나타나는 버튼 · 키보드 L(2 · 5).
//   ⚠ 이 화면은 '테스트 화면'이기도 하다(관리자 전광판 메뉴 → 테스트 화면 열기) — DEMO · TEST DATA 표시.
//       ?scene=mixed(기본 · 상태 혼합) | busy(전 코트 진행) | quiet(경기 전)

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SignatureArenaShell, { SignatureControlButton } from '@/components/tournaments/arena-signature/SignatureArenaShell';
import type { SignatureEventInfo } from '@/components/tournaments/arena-signature/SignatureHeader';
import SignatureCourtBoard, {
  COURT_BOARD_LAYOUTS, courtBoardLayoutOf, useCourtBoardLayoutKeys,
} from '@/components/tournaments/arena-signature/SignatureCourtBoard';
import type { CourtBoardLayout } from '@/components/tournaments/arena-signature/SignatureCourtBoard';
import {
  COURT_BOARD_SCENES, buildCourtBoard, courtBoardSceneOf,
} from '@/components/tournaments/arena-signature/signatureCourtBoardFixture';
import type { CourtBoardScene } from '@/components/tournaments/arena-signature/signatureCourtBoardFixture';
import { SIG_BOARD_WIDTH, SIG_LAYOUT } from '@/components/tournaments/arena-signature/signatureTheme';
import type { ArenaSnapshot } from '@/lib/tournaments/arenaTypes';

const COURTS_PATH = '/tournaments/arena-design/signature/courts';

const EVENT: SignatureEventInfo = {
  year: '2026',
  tagline: 'NON-RANKING DOUBLES TOURNAMENT',
  date: '2026. 10. 25 (SUN)',
  venue: '아산시 강변 테니스장',
  stage: { en: 'COURT BOARD', ko: '코트별 경기 안내' },
};

/** 보드 높이 — 머리말 아래 ~ 바닥(954). */
const BOARD_H = 1080 - SIG_LAYOUT.padTop - SIG_LAYOUT.padBottom - SIG_LAYOUT.headerHeight - SIG_LAYOUT.headerGap;

/** Shell 이 요구하는 스냅샷 모양(코트 스트립을 쓰지 않으므로 비워 둔다). */
const EMPTY_SNAPSHOT: ArenaSnapshot = {
  slug: 'arena-signature-courts', mode: 'preliminary', tournamentTitle: null,
  courts: [], groups: [], qualifyPerGroup: null, bracket: null,
};

export default function SignatureCourtBoardPage() {
  return (
    <React.Suspense fallback={null}>
      <SignatureCourtBoardView />
    </React.Suspense>
  );
}

function SignatureCourtBoardView() {
  const search = useSearchParams();
  const router = useRouter();
  const layout = courtBoardLayoutOf(search?.get('layout') ?? null);
  const scene = courtBoardSceneOf(search?.get('scene') ?? null);
  const courts = React.useMemo(() => buildCourtBoard(scene), [scene]);

  const go = React.useCallback((l: CourtBoardLayout, s: CourtBoardScene) => {
    router.replace(`${COURTS_PATH}?layout=${l}&scene=${s}`, { scroll: false });
  }, [router]);
  const setLayout = React.useCallback((l: CourtBoardLayout) => go(l, scene), [go, scene]);
  useCourtBoardLayoutKeys(layout, setLayout);

  const layoutButtons = COURT_BOARD_LAYOUTS.map(([l, label]) => (
    <SignatureControlButton key={l} active={l === layout} onClick={() => setLayout(l)}>
      {label}
    </SignatureControlButton>
  ));

  const controls = (
    <>
      {COURT_BOARD_SCENES.map((s) => (
        <SignatureControlButton key={s.id} active={s.id === scene} onClick={() => go(layout, s.id)}>
          {s.label}
        </SignatureControlButton>
      ))}
      <span aria-hidden style={{ width: 1, height: 22, background: '#C9D5EA', margin: '0 2px' }} />
      {layoutButtons}
    </>
  );

  return (
    <SignatureArenaShell snapshot={EMPTY_SNAPSHOT} event={EVENT} badge="SIGNATURE COURT DEMO" controls={controls}
      courtPosition="bottom" showCourts={false} testMark fullscreenControls={layoutButtons}>
      <SignatureCourtBoard courts={courts} layout={layout} width={SIG_BOARD_WIDTH} height={BOARD_H} />
    </SignatureArenaShell>
  );
}
