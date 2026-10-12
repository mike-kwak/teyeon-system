'use client';

// Arena TV — Demo (/tournaments/arena-demo).
//
//   실제 TV 에서 예선 · 본선 전광판의 디자인과 가독성을 점검하는 화면이다.
//   ⚠ 데이터는 가명 · 가상 fixture(lib/tournaments/arenaDemoFixture)뿐이다.
//     운영 Arena 의 조회 훅(useArenaData)과 운영 서비스(match · standings · bracket)를 import 하지 않는다.
//     → 이 화면에서는 운영 RPC 가 호출될 경로 자체가 없다(읽기 · 쓰기 모두).
//   ⚠ 화면은 운영 Arena 와 **같은 컴포넌트**(ArenaShell · ArenaGroupWall · ArenaKnockoutBoard)가 그린다.
//     Demo 전용으로 디자인을 복제하지 않는다. 차이는 머리말의 작은 DEMO 표식뿐이다.
//   ⚠ 모드 · 장면은 주소(?mode= · ?scene=)에 남긴다 — 새로고침해도 같은 화면이 뜬다.

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import ArenaShell, { ArenaControlButton } from '@/components/tournaments/arena/ArenaShell';
import ArenaGroupWall from '@/components/tournaments/arena/ArenaGroupWall';
import ArenaKnockoutBoard from '@/components/tournaments/arena/ArenaKnockoutBoard';
import {
  ARENA, arenaBoardHeight, arenaBoardWidth, arenaPrelimBoardHeight, arenaPrelimWallWidth,
} from '@/components/tournaments/arena/arenaTheme';
import {
  ARENA_DEMO_SCENES, ARENA_DEMO_TITLE, arenaDemoSceneOf, buildArenaDemoSnapshot,
} from '@/lib/tournaments/arenaDemoFixture';
import type { ArenaDemoScene } from '@/lib/tournaments/arenaDemoFixture';
import type { ArenaMode, ArenaState } from '@/lib/tournaments/arenaTypes';

const DEMO_PATH = '/tournaments/arena-demo';
const MODE_PARAM: Record<ArenaMode, string> = { preliminary: 'prelim', knockout: 'knockout' };
const modeFromParam = (v: string | null): ArenaMode =>
  v === 'knockout' ? 'knockout' : 'preliminary';

// ⚠ useSearchParams 는 Suspense 경계 안에서만 쓴다. 이 경로는 [slug] 같은 동적 구간이 없어
//   build 가 정적으로 미리 그리려 하기 때문이다(경계가 없으면 build 가 멈춘다).
export default function ArenaDemoPage() {
  return (
    <React.Suspense fallback={null}>
      <ArenaDemoView />
    </React.Suspense>
  );
}

function ArenaDemoView() {
  const search = useSearchParams();
  const router = useRouter();

  const mode = modeFromParam(search?.get('mode') ?? null);
  const scene = arenaDemoSceneOf(mode, search?.get('scene') ?? null);

  // 화면을 연 시각 — 머리말 시계 자리에 쓴다(가상 데이터라 '갱신'은 없다).
  const [openedAt] = React.useState(() => Date.now());

  const state = React.useMemo<ArenaState>(() => ({
    snapshot: buildArenaDemoSnapshot(mode, scene),
    loading: false, authorized: true, failed: false, stale: false, updatedAt: openedAt,
  }), [mode, scene, openedAt]);

  const go = React.useCallback((nextMode: ArenaMode, nextScene: ArenaDemoScene | null) => {
    const s = nextScene ?? ARENA_DEMO_SCENES[nextMode][0].id;
    router.replace(`${DEMO_PATH}?mode=${MODE_PARAM[nextMode]}&scene=${s}`);
  }, [router]);

  const sceneButtons = (
    <>
      <span aria-hidden style={{ width: 1, height: 22, background: ARENA.line, margin: '0 2px' }} />
      {ARENA_DEMO_SCENES[mode].map((s) => (
        <ArenaControlButton key={s.id} active={s.id === scene} onClick={() => go(mode, s.id)}>
          {s.label}
        </ArenaControlButton>
      ))}
    </>
  );

  const snapshot = state.snapshot!;
  return (
    <ArenaShell
      title={ARENA_DEMO_TITLE}
      mode={mode}
      onModeChange={(next) => go(next, null)}
      state={state}
      badge="DEMO"
      extraControls={sceneButtons}
    >
      {mode === 'preliminary' ? (
        <ArenaGroupWall
          groups={snapshot.groups}
          qualifyPerGroup={snapshot.qualifyPerGroup}
          width={arenaPrelimWallWidth()}
          height={arenaPrelimBoardHeight()}
        />
      ) : (
        <ArenaKnockoutBoard
          bracket={snapshot.bracket}
          width={arenaBoardWidth()}
          height={arenaBoardHeight()}
        />
      )}
    </ArenaShell>
  );
}
