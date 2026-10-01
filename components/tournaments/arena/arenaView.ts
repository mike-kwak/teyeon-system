'use client';

// Arena TV — 데이터 조회 · 갱신 (Batch 4E-0).
//
//   ⚠ Control Center 와 **같은 운영 RPC** 만 쓴다. 공개 RPC 를 쓰지 않는다.
//     그래서 공개 DRAW · 공개 본선의 공개 여부와 무관하게 동작한다.
//   ⚠ 10초마다 다시 읽는다. 다만 **배경 갱신은 화면을 비우지 않는다** —
//     첫 조회만 loading 이고, 그 뒤로는 실패해도 보던 화면을 그대로 둔다(stale 로만 표시).
//   ⚠ Realtime 구독을 만들지 않는다(이번 단계 범위 밖). 복귀 신호는 기존 훅을 재사용한다.
//   ⚠ 아무 것도 추론하지 않는다 — 코트의 '다음 경기'를 만들지 않고, 순위를 계산하지 않는다.

import React from 'react';
import { useVisibilityResync } from '@/hooks/useRealtimeSync';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import { fetchPreliminaryStandings } from '@/lib/tournaments/standingsAdminService';
import { fetchAdminBracket } from '@/lib/tournaments/bracketAdminService';
import { normalizeArena } from '@/lib/tournaments/arenaNormalize';
import {
  ARENA_POLL_MS, INITIAL_ARENA_STATE, arenaStateAfter,
} from '@/lib/tournaments/arenaState';
import type { ArenaFetchOutcome } from '@/lib/tournaments/arenaState';
import type { ArenaMode, ArenaState } from '@/lib/tournaments/arenaTypes';

// 상태 전이 · 주기는 순수 모듈에 있다(단독 검증 대상). 여기서는 그대로 다시 내보낸다.
export { ARENA_POLL_MS, INITIAL_ARENA_STATE, arenaStateAfter };
export type { ArenaFetchOutcome };

/**
 * 한 번 조회한다.
 *   mode 에 따라 필요한 것만 읽는다 — 예선 화면에서 본선 대진을 읽지 않는다.
 *   코트 줄은 두 화면 모두 쓰므로 match board 는 항상 읽는다
 *   (match board 는 예선·본선 경기를 모두 돌려준다 — stage 로 구분된다).
 */
export async function fetchArenaSnapshot(slug: string, mode: ArenaMode): Promise<ArenaFetchOutcome> {
  try {
    const [board, standings, bracket] = await Promise.all([
      fetchMatchBoard(slug),
      mode === 'preliminary'
        ? fetchPreliminaryStandings(slug)
        : Promise.resolve({ ready: true, standings: null }),
      mode === 'knockout'
        ? fetchAdminBracket(slug)
        : Promise.resolve({ ready: true, data: null }),
    ]);

    // 운영 권한이 없으면 RPC 가 null 을 준다 → ready=false. '데이터 0건'과 구분한다.
    if (!board.ready) return { kind: 'unauthorized' };

    return {
      kind: 'ok',
      at: Date.now(),
      snapshot: normalizeArena({
        slug,
        mode,
        board: board.board,
        standings: standings.ready ? standings.standings : null,
        bracket: bracket.ready ? bracket.data : null,
      }),
    };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Arena 데이터.
 *   10초 주기 + 화면 복귀(visible · focus · online) 시 즉시 전체 재조회.
 *   ⚠ 복귀 재조회는 기존 KDK 전광판과 같은 훅(useVisibilityResync)을 그대로 쓴다.
 */
export function useArenaData(slug: string, mode: ArenaMode): ArenaState {
  const [state, setState] = React.useState<ArenaState>(INITIAL_ARENA_STATE);

  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);

  const load = React.useCallback(async () => {
    if (!slug) return;
    if (inFlight.current) return;        // 겹친 요청을 만들지 않는다
    inFlight.current = true;
    try {
      const outcome = await fetchArenaSnapshot(slug, mode);
      if (!mounted.current) return;
      setState((prev) => arenaStateAfter(prev, outcome));
    } finally {
      inFlight.current = false;
    }
  }, [slug, mode]);

  // 모드가 바뀌면 보여 줄 내용이 달라진다 — 그때만 첫 조회 상태로 되돌린다.
  React.useEffect(() => {
    setState(INITIAL_ARENA_STATE);
  }, [slug, mode]);

  React.useEffect(() => {
    mounted.current = true;
    void load();

    let timer: number | null = null;
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      timer = window.setInterval(() => { void load(); }, ARENA_POLL_MS);
    };

    // 화면이 보일 때만 주기 갱신한다(두 번째 모니터가 꺼져 있으면 멈춘다).
    const onVisible = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    if (typeof document !== 'undefined' && document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted.current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // 복귀 신호(visible · focus · online) → 권위 있는 전체 재조회.
  useVisibilityResync(() => { void load(); }, { enabled: !!slug });

  return state;
}
