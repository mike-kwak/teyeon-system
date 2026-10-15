'use client';

// Arena TV — Signature 디자인 프로토타입 (/tournaments/arena-design/signature).
//
//   기준 이미지(블루 · 화이트 스포츠 전광판)를 실제 1920×1080 화면으로 재현해 평가하는 경로다. 본선 화면만 다룬다.
//   ⚠ 데이터는 기존 Demo 의 가명 · 가상 fixture(lib/tournaments/arenaDemoFixture)뿐이다.
//     운영 Arena 의 조회 훅(useArenaData)과 운영 서비스(match · standings · bracket)를 import 하지 않는다
//     → 이 화면에서는 운영 RPC 가 호출될 경로 자체가 없다(읽기 · 쓰기 모두).
//   ⚠ 상위 경로(arena-design)의 layout 이 글꼴 · noindex 를 붙인다. analytics 제외도 상위 경로 prefix 로 적용된다.
//   ⚠ 운영 Arena · 기존 Demo · Autumn Ivory 화면은 건드리지 않는다.
//   ⚠ 이 화면은 관리자 전광판 메뉴의 '테스트 화면'이기도 하다 — 캔버스에 DEMO · TEST DATA 를 작게 표시한다.
//   ⚠ 장면 · 참가 팀 수 · 코트 위치는 주소(?scene= · ?teams= · ?courtPosition=)에 남긴다 — 새로고침해도 같은 화면이 뜬다.
//   ⚠ 운영진 리뷰 확정: 코트 현황은 대진 아래(기본값). ?courtPosition=top 은 이전 배치(코트 상단) 비교용이다.
//   ⚠ 표시 모드 ?view=focus(코트 미포함 · 기본 — TV 실물 검수 10-16) | courts(코트 포함 — 대진 아래 코트 줄).
//     예전 주소 ?view=semifinal 은 코트 미포함으로, ?view=full 은 코트 포함으로 열린다(링크 호환).
//     운영진이 버튼으로만 바꾼다 — 경기 단계와 무관하고, 자동으로 바꾸지 않는다. 경기 데이터 · DB 는 건드리지 않는다.

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SignatureArenaShell, { SignatureControlButton } from '@/components/tournaments/arena-signature/SignatureArenaShell';
import type { SignatureEventInfo } from '@/components/tournaments/arena-signature/SignatureHeader';
import SignatureKnockoutBoard from '@/components/tournaments/arena-signature/SignatureKnockoutBoard';
import {
  SIGNATURE_VIEW_LABEL, SIGNATURE_VIEW_ORDER, SIG_BOARD_WIDTH, courtPositionOf, viewModeOf,
} from '@/components/tournaments/arena-signature/signatureTheme';
import type { SignatureCourtPosition, SignatureViewMode } from '@/components/tournaments/arena-signature/signatureTheme';
import { ARENA_DEMO_SCENES, arenaDemoSceneOf, buildArenaDemoSnapshot } from '@/lib/tournaments/arenaDemoFixture';
import type { ArenaDemoKnockoutTeams, ArenaDemoScene } from '@/lib/tournaments/arenaDemoFixture';

const SIGNATURE_PATH = '/tournaments/arena-design/signature';

/**
 * 머리말 대회 정보 — 공식 포스터에 공개된 값(디자인 확인용 고정값).
 *   ⚠ 운영 Arena 스냅샷에는 날짜 · 장소가 없다. 실제 적용 때는 데이터 출처를 따로 정해야 한다.
 */
const EVENT: SignatureEventInfo = {
  year: '2026',
  tagline: 'NON-RANKING DOUBLES TOURNAMENT',
  date: '2026. 10. 25 (SUN)',
  venue: '아산시 강변 테니스장',
};

const teamsOf = (v: string | null): ArenaDemoKnockoutTeams => (v === '40' ? 40 : 36);

// ⚠ useSearchParams 는 Suspense 경계 안에서만 쓴다(정적 경로라 build 가 미리 그린다).
export default function ArenaSignaturePage() {
  return (
    <React.Suspense fallback={null}>
      <ArenaSignatureView />
    </React.Suspense>
  );
}

function ArenaSignatureView() {
  const search = useSearchParams();
  const router = useRouter();

  const scene = arenaDemoSceneOf('knockout', search?.get('scene') ?? null);
  const teams = teamsOf(search?.get('teams') ?? null);
  const courtPosition = courtPositionOf(search?.get('courtPosition') ?? null);
  const viewMode = viewModeOf(search?.get('view') ?? null, 'focus');

  const snapshot = React.useMemo(
    () => buildArenaDemoSnapshot('knockout', scene, { knockoutTeams: teams }),
    [scene, teams],
  );

  const go = React.useCallback((s: ArenaDemoScene, t: ArenaDemoKnockoutTeams, c: SignatureCourtPosition, v: SignatureViewMode) => {
    // 표시 모드는 언제나 새 주소(view=courts | view=focus)로 남긴다. 코트 위치 기본값(하단)만 생략한다.
    const extra = `${c === 'top' ? '&courtPosition=top' : ''}&view=${v}`;
    router.replace(`${SIGNATURE_PATH}?scene=${s}&teams=${t}${extra}`, { scroll: false });
  }, [router]);

  const controls = (
    <>
      {ARENA_DEMO_SCENES.knockout.map((s) => (
        <SignatureControlButton key={s.id} active={s.id === scene} onClick={() => go(s.id, teams, courtPosition, viewMode)}>
          {s.label}
        </SignatureControlButton>
      ))}
      <span aria-hidden style={{ width: 1, height: 22, background: '#C9D5EA', margin: '0 2px' }} />
      {([36, 40] as const).map((t) => (
        <SignatureControlButton key={t} active={t === teams} onClick={() => go(scene, t, courtPosition, viewMode)}>
          {t}팀
        </SignatureControlButton>
      ))}
      <span aria-hidden style={{ width: 1, height: 22, background: '#C9D5EA', margin: '0 2px' }} />
      {([['bottom', '코트 하단(확정)'], ['top', '코트 상단(이전)']] as const).map(([c, label]) => (
        <SignatureControlButton key={c} active={c === courtPosition} onClick={() => go(scene, teams, c, viewMode)}>
          {label}
        </SignatureControlButton>
      ))}
      <span aria-hidden style={{ width: 1, height: 22, background: '#C9D5EA', margin: '0 2px' }} />
      {SIGNATURE_VIEW_ORDER.map((v) => (
        <SignatureControlButton key={v} active={v === viewMode} onClick={() => go(scene, teams, courtPosition, v)}>
          {SIGNATURE_VIEW_LABEL[v]}
        </SignatureControlButton>
      ))}
    </>
  );

  return (
    <SignatureArenaShell snapshot={snapshot} event={EVENT} badge="SIGNATURE DEMO" controls={controls} testMark
      courtPosition={courtPosition} viewMode={viewMode}>
      <SignatureKnockoutBoard bracket={snapshot.bracket} width={SIG_BOARD_WIDTH} viewMode={viewMode} />
    </SignatureArenaShell>
  );
}
