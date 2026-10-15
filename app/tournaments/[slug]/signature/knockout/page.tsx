'use client';

export const dynamic = 'force-dynamic';

// Signature Arena — 본선 운영 연결 화면 (/tournaments/[slug]/signature/knockout).
//
//   본선 Signature V6 디자인 그대로, 데이터만 운영 Arena 와 같은 경로로 받는다(읽기 전용).
//   ⚠ 조회 = 운영 Arena 와 같은 훅(useArenaData · mode=knockout): get_admin_match_board + get_admin_bracket,
//     10초 갱신 · 화면이 보일 때만 · 복귀 시 즉시 재조회 · 실패해도 마지막 정상 화면 유지.
//   ⚠ 권한 = 운영 Arena 와 같다(서버 RPC 가 CEO/ADMIN 만 데이터를 준다). 권한이 없으면 경기 정보를 보이지 않는다.
//   ⚠ 결과 · 승자 · 순위를 화면에서 계산하지 않는다(서버 값 → 정규화 → 기존 배치 함수).
//   ⚠ 표시 모드 ?view=focus(기본 · 코트 미포함 — TV 실물 검수 10-16: 메인 TV 옆에 코트 모니터가 붙는다) | courts(코트 포함).
//     예전 주소 semifinal · full 도 열린다. 운영진 수동 전환만 — 자동 전환 없음.
//   ⚠ 기존 운영 Arena(/tournaments/[slug]/arena)는 그대로다 — 이 화면은 병행 검증용 별도 경로다.

import React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { getOfficialTournament } from '@/lib/tournaments/officialInfo';
import { useArenaData } from '@/components/tournaments/arena/arenaView';
import { SignatureControlButton } from '@/components/tournaments/arena-signature/SignatureArenaShell';
import SignatureKnockoutBoard from '@/components/tournaments/arena-signature/SignatureKnockoutBoard';
import SignatureLiveFrame from '@/components/tournaments/arena-signature/SignatureLiveFrame';
import { liveEventInfo } from '@/components/tournaments/arena-signature/signatureLiveAdapter';
import {
  SIGNATURE_VIEW_LABEL, SIGNATURE_VIEW_ORDER, SIG_BOARD_WIDTH, SIG_LAYOUT, viewModeOf,
} from '@/components/tournaments/arena-signature/signatureTheme';
import type { SignatureViewMode } from '@/components/tournaments/arena-signature/signatureTheme';
import SignatureNotFound from '@/components/tournaments/arena-signature/SignatureNotFound';

export default function SignatureKnockoutLivePage() {
  return (
    <React.Suspense fallback={null}>
      <SignatureKnockoutLiveView />
    </React.Suspense>
  );
}

function SignatureKnockoutLiveView() {
  const params = useParams<{ slug: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const slug = typeof params?.slug === 'string' ? params.slug : Array.isArray(params?.slug) ? params!.slug[0] : '';
  const event = getOfficialTournament(slug);
  const viewMode = viewModeOf(search?.get('view') ?? null, 'focus');
  // ⚠ 알 수 없는 대회면 slug 를 비워 조회 자체를 하지 않는다(운영 Arena 와 같은 방식).
  const state = useArenaData(event ? slug : '', 'knockout');

  const go = React.useCallback((v: SignatureViewMode) => {
    router.replace(`/tournaments/${slug}/signature/knockout?view=${v}`, { scroll: false });
  }, [router, slug]);

  if (!event) return <SignatureNotFound />;

  const bodyH = 1080 - SIG_LAYOUT.padTop - SIG_LAYOUT.padBottom - SIG_LAYOUT.headerHeight - SIG_LAYOUT.headerGap
    - (viewMode === 'courts' ? SIG_LAYOUT.courtHeight + SIG_LAYOUT.courtGap : 0);

  return (
    <SignatureLiveFrame
      slug={slug} mode="knockout" state={state} noticeHeight={bodyH}
      event={liveEventInfo(event, undefined)} badge="SIGNATURE LIVE · 본선"
      courtPosition="bottom" viewMode={viewMode} showCourts={viewMode === 'courts'}
      controls={SIGNATURE_VIEW_ORDER.map((v) => (
        <SignatureControlButton key={v} active={v === viewMode} onClick={() => go(v)}>
          {SIGNATURE_VIEW_LABEL[v]}
        </SignatureControlButton>
      ))}
    >
      {(snapshot) => <SignatureKnockoutBoard bracket={snapshot.bracket} width={SIG_BOARD_WIDTH} viewMode={viewMode} />}
    </SignatureLiveFrame>
  );
}
