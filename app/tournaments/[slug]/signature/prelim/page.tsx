'use client';

export const dynamic = 'force-dynamic';

// Signature Arena — 예선 운영 연결 화면 (/tournaments/[slug]/signature/prelim).
//
//   예선 Signature V1 디자인 그대로, 데이터만 운영 Arena 와 같은 경로로 받는다(읽기 전용).
//   ⚠ 조회 = 운영 Arena 와 같은 훅(useArenaData · mode=preliminary): get_admin_match_board + get_preliminary_standings.
//   ⚠ 순위 · 승패 · 득실 · 진출 · 동률 상태는 서버 값 그대로다(정규화만). 조 수 · 조 크기(2~3팀)도 서버 데이터를 따른다.
//   ⚠ LIVE 코트 = 그 코트에서 지금 진행 중인 예선 경기의 조 번호(순위결정전 · 호명은 보이지 않는다).
//   ⚠ 표시 모드 ?view=focus(기본 · 코트 미포함) | courts(코트 포함). 예전 주소 groups · semifinal 도 열린다. 자동 전환 없음.
//   ⚠ 기존 운영 Arena(/tournaments/[slug]/arena)는 그대로다 — 이 화면은 병행 검증용 별도 경로다.

import React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { useArenaData } from '@/components/tournaments/arena/arenaView';
import { SignatureControlButton } from '@/components/tournaments/arena-signature/SignatureArenaShell';
import SignatureGroupWall from '@/components/tournaments/arena-signature/SignatureGroupWall';
import SignatureLiveFrame from '@/components/tournaments/arena-signature/SignatureLiveFrame';
import SignatureNotFound from '@/components/tournaments/arena-signature/SignatureNotFound';
import { liveEventInfo } from '@/components/tournaments/arena-signature/signatureLiveAdapter';
import {
  SIGNATURE_VIEW_LABEL, SIGNATURE_VIEW_ORDER, SIG_BOARD_WIDTH, SIG_LAYOUT, viewModeOf,
} from '@/components/tournaments/arena-signature/signatureTheme';
import type { SignatureViewMode } from '@/components/tournaments/arena-signature/signatureTheme';

/** 조 벽 높이 — 코트 포함: 794 / 코트 미포함: 954(Demo 와 같은 배분). */
const wallHeight = (view: SignatureViewMode): number =>
  1080 - SIG_LAYOUT.padTop - SIG_LAYOUT.padBottom - SIG_LAYOUT.headerHeight - SIG_LAYOUT.headerGap
  - (view === 'courts' ? SIG_LAYOUT.courtHeight + SIG_LAYOUT.courtGap : 0);

export default function SignaturePrelimLivePage() {
  return (
    <React.Suspense fallback={null}>
      <SignaturePrelimLiveView />
    </React.Suspense>
  );
}

function SignaturePrelimLiveView() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);
  const view = viewModeOf(search?.get('view') ?? null, 'focus');
  const state = useArenaData(event ? slug : '', 'preliminary');

  const go = React.useCallback((v: SignatureViewMode) => {
    router.replace(`/tournaments/${slug}/signature/prelim?view=${v}`, { scroll: false });
  }, [router, slug]);

  if (!event) return <SignatureNotFound />;

  return (
    <SignatureLiveFrame
      slug={slug} mode="preliminary" state={state} noticeHeight={wallHeight(view)}
      event={liveEventInfo(event, { en: 'PRELIMINARY ROUND', ko: '예선 조별 리그' })} badge="SIGNATURE LIVE · 예선"
      courtPosition="bottom" viewMode={view} showCourts={view === 'courts'}
      controls={SIGNATURE_VIEW_ORDER.map((v) => (
        <SignatureControlButton key={v} active={v === view} onClick={() => go(v)}>
          {SIGNATURE_VIEW_LABEL[v]}
        </SignatureControlButton>
      ))}
    >
      {(snapshot) => (
        <div data-prelim-view={view} style={{ width: SIG_BOARD_WIDTH, height: wallHeight(view) }}>
          {/* 공개 1조(내부 순위결정전) → 2조 → … → 18조 */}
          <SignatureGroupWall groups={[...(snapshot.placementGroups ?? []), ...snapshot.groups]} courts={snapshot.courts} width={SIG_BOARD_WIDTH} height={wallHeight(view)} />
        </div>
      )}
    </SignatureLiveFrame>
  );
}
