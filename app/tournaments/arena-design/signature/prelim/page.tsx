'use client';

// Arena TV — Signature 예선 디자인 Demo (/tournaments/arena-design/signature/prelim).
//
//   본선 Signature V6 의 브랜딩 · 디자인 시스템으로 예선 조 순위 화면을 그린다(독립 Demo).
//   ⚠ 데이터는 가명 · 가상 fixture 뿐이다(signaturePrelimFixture — 20조 중반 · 종료는 기존 Demo fixture 그대로).
//     운영 Arena 의 조회 훅(useArenaData)과 운영 서비스를 import 하지 않는다 → 운영 RPC 가 불릴 경로가 없다.
//   ⚠ 상위 경로(arena-design)의 layout 이 글꼴 · noindex 를 붙이고, analytics 제외도 상위 prefix 로 적용된다.
//   ⚠ 운영 예선 Arena · 기존 Demo · 본선 Signature 화면은 건드리지 않는다.
//   ⚠ 이 화면은 관리자 전광판 메뉴의 '테스트 화면'이기도 하다 — 캔버스에 DEMO · TEST DATA 를 작게 표시한다.
//   ⚠ 주소에 상태를 남긴다 — 새로고침해도 같은 화면이다.
//       ?view=focus(기본 · 코트 미포함: 코트 줄 숨김) | courts(코트 포함) — 본선 Signature 와 같은 이름 · 같은 주소.
//         예전 주소 ?view=groups · ?view=semifinal 은 코트 미포함으로 열린다(링크 호환).
//       ?scene=early | mid(기본) | done
//       ?groups=16 — 48팀(16조) · ?pairs=N — 마지막 N개 조를 2팀 조로(조당 2~3팀 확인용, 버튼 없음)
//       ?size=4 — 예전 검토용(실제 대회 요구사항 아님 · 정식 지원 대상 아님)

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SignatureArenaShell, { SignatureControlButton } from '@/components/tournaments/arena-signature/SignatureArenaShell';
import type { SignatureEventInfo } from '@/components/tournaments/arena-signature/SignatureHeader';
import SignatureGroupWall from '@/components/tournaments/arena-signature/SignatureGroupWall';
import {
  SIGNATURE_VIEW_LABEL, SIGNATURE_VIEW_ORDER, SIG_BOARD_WIDTH, SIG_LAYOUT, viewModeOf,
} from '@/components/tournaments/arena-signature/signatureTheme';
import type { SignatureViewMode } from '@/components/tournaments/arena-signature/signatureTheme';
import {
  SIGNATURE_PRELIM_SCENES, buildSignaturePrelimSnapshot, prelimSceneOf,
} from '@/components/tournaments/arena-signature/signaturePrelimFixture';
import type { SignaturePrelimScene } from '@/components/tournaments/arena-signature/signaturePrelimFixture';

const PRELIM_PATH = '/tournaments/arena-design/signature/prelim';

/** 머리말 대회 정보 — 본선 Signature 와 같은 고정값 + 예선 단계 표시. */
const EVENT: SignatureEventInfo = {
  year: '2026',
  tagline: 'NON-RANKING DOUBLES TOURNAMENT',
  date: '2026. 10. 25 (SUN)',
  venue: '아산시 강변 테니스장',
  stage: { en: 'PRELIMINARY ROUND', ko: '예선 조별 리그' },
};

/** 조 벽 높이 — 코트 포함: 머리말 아래 ~ 코트 줄 위(794) / 코트 미포함: 머리말 아래 ~ 바닥(954). */
const wallHeight = (view: SignatureViewMode): number =>
  1080 - SIG_LAYOUT.padTop - SIG_LAYOUT.padBottom - SIG_LAYOUT.headerHeight - SIG_LAYOUT.headerGap
  - (view === 'courts' ? SIG_LAYOUT.courtHeight + SIG_LAYOUT.courtGap : 0);

export default function SignaturePrelimPage() {
  return (
    <React.Suspense fallback={null}>
      <SignaturePrelimView />
    </React.Suspense>
  );
}

function SignaturePrelimView() {
  const search = useSearchParams();
  const router = useRouter();

  const view = viewModeOf(search?.get('view') ?? null, 'focus');
  const scene = prelimSceneOf(search?.get('scene') ?? null);
  const groups = search?.get('groups') === '16' ? 16 : 20;
  const size = search?.get('size') === '4' ? 4 : 3;
  const pairsRaw = Number(search?.get('pairs') ?? 0);
  const pairs = Number.isInteger(pairsRaw) && pairsRaw > 0 && size === 3 ? Math.min(pairsRaw, groups) : 0;

  const snapshot = React.useMemo(
    () => buildSignaturePrelimSnapshot({ scene, groups, size, pairs }),
    [scene, groups, size, pairs],
  );

  const go = React.useCallback((v: SignatureViewMode, s: SignaturePrelimScene) => {
    // 표시 모드는 언제나 새 주소(view=courts | view=focus)로 남긴다. 기본 장면(중반)만 생략한다.
    const q = new URLSearchParams();
    if (s !== 'mid') q.set('scene', s);
    q.set('view', v);
    if (groups === 16) q.set('groups', '16');
    if (pairs > 0) q.set('pairs', String(pairs));
    if (size === 4) q.set('size', '4');
    const qs = q.toString();
    router.replace(`${PRELIM_PATH}${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [router, groups, size, pairs]);

  const controls = (
    <>
      {SIGNATURE_PRELIM_SCENES.map((s) => (
        <SignatureControlButton key={s.id} active={s.id === scene} onClick={() => go(view, s.id)}>
          {s.label}
        </SignatureControlButton>
      ))}
      <span aria-hidden style={{ width: 1, height: 22, background: '#C9D5EA', margin: '0 2px' }} />
      {SIGNATURE_VIEW_ORDER.map((v) => (
        <SignatureControlButton key={v} active={v === view} onClick={() => go(v, scene)}>
          {SIGNATURE_VIEW_LABEL[v]}
        </SignatureControlButton>
      ))}
    </>
  );

  return (
    <SignatureArenaShell snapshot={snapshot} event={EVENT} badge="SIGNATURE PRELIM DEMO" controls={controls} testMark
      courtPosition="bottom" viewMode={view}>
      <div data-prelim-view={view} style={{ width: SIG_BOARD_WIDTH, height: wallHeight(view) }}>
        <SignatureGroupWall groups={snapshot.groups} courts={snapshot.courts}
          width={SIG_BOARD_WIDTH} height={wallHeight(view)} />
      </div>
    </SignatureArenaShell>
  );
}
