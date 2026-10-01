// Arena 화면 상태 전이 (Batch 4E-0) — **순수 함수만** 둔다.
//
//   깜빡임 정책을 이 한 곳에만 둔다. React · DOM · 서버 의존이 없어 단독으로 검증할 수 있다.
//
//   정책
//     · 첫 조회만 loading 이다. 주기 갱신은 절대 loading 으로 되돌아가지 않는다.
//     · 배경 갱신이 실패하면 보던 내용을 그대로 두고 stale 만 켠다(화면을 비우지 않는다).
//     · '운영 권한 없음'과 '오류'는 다른 상태다 — 화면 문구가 달라야 한다.

import type { ArenaSnapshot, ArenaState } from './arenaTypes';

/** 현장 운영 화면 기준 갱신 주기. 더 짧게 하면 긴 대회 동안 호출량만 늘어난다. */
export const ARENA_POLL_MS = 10_000;

export const INITIAL_ARENA_STATE: ArenaState = {
  snapshot: null, loading: true, authorized: true, failed: false, stale: false, updatedAt: null,
};

/** 한 번의 조회 결과. 'unauthorized' 는 운영 권한이 없어 RPC 가 null 을 준 경우다. */
export type ArenaFetchOutcome =
  | { kind: 'ok'; snapshot: ArenaSnapshot; at: number }
  | { kind: 'unauthorized' }
  | { kind: 'error' };

/** 성공한 조회를 반영한다. 성공은 언제나 stale · failed 를 지운다. */
export function arenaStateAfterSuccess(
  _prev: ArenaState, snapshot: ArenaSnapshot, at: number,
): ArenaState {
  return { snapshot, loading: false, authorized: true, failed: false, stale: false, updatedAt: at };
}

/**
 * 실패한 조회를 반영한다.
 *   · 보여 줄 데이터가 이미 있으면 → 유지. stale 만 켠다(배경 갱신 실패).
 *   · 아직 없으면(첫 조회) → failed 또는 '권한 없음'.
 */
export function arenaStateAfterFailure(
  prev: ArenaState, kind: 'unauthorized' | 'error',
): ArenaState {
  if (prev.snapshot !== null) {
    return {
      ...prev,
      loading: false,
      stale: true,
      authorized: kind === 'unauthorized' ? false : prev.authorized,
    };
  }
  return {
    snapshot: null,
    loading: false,
    authorized: kind !== 'unauthorized',
    failed: kind === 'error',
    stale: false,
    updatedAt: prev.updatedAt,
  };
}

/** 조회 결과를 상태 전이로 옮기는 단일 진입점. */
export function arenaStateAfter(prev: ArenaState, outcome: ArenaFetchOutcome): ArenaState {
  return outcome.kind === 'ok'
    ? arenaStateAfterSuccess(prev, outcome.snapshot, outcome.at)
    : arenaStateAfterFailure(prev, outcome.kind);
}
