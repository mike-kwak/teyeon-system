'use client';

import { useEffect, useRef } from 'react';

/**
 * KDK 운영 화면 / 전광판 공통 Realtime 안정화 유틸.
 *
 * 배경: Supabase Realtime 이벤트는 (1) 백그라운드/화면 잠금/탭 전환 (2) 네트워크 끊김
 *       (3) 채널 오류·타임아웃 구간에서 누락될 수 있다. 이 경우 화면이 과거 상태로 남는다.
 *       → "복귀 신호(visible/focus/online)"를 받으면 전체 재조회(full refresh)로 자동 복구한다.
 *
 * 설계 원칙(작업 지시 B/E/D 준수):
 *   - 이벤트 payload 로 state 를 부분 수정하지 않는다. 신호로만 쓰고 full refresh 를 호출한다.
 *   - visible/focus/online 이 겹쳐도 minInterval 안에서는 1회만 실행(중복 fetch 폭주 방지).
 *   - unmount 시 타이머 정리.
 */

/** 재구독 backoff(ms): 1s → 2s → 5s → 10s → 15s(cap). 성공 시 attempt 를 0 으로 reset 한다. */
export function realtimeBackoffMs(attempt: number): number {
  const steps = [1000, 2000, 5000, 10000, 15000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)];
}

/** Supabase channel.subscribe status 중 "연결이 끊긴" 상태(재구독 대상)인지. */
export function isRealtimeErrorStatus(status: string): boolean {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
}

/**
 * 화면 복귀(visibilitychange→visible / window focus / network online) 시 onResync 를 호출한다.
 *   - 최근 minIntervalMs 안에 이미 실행됐으면 남은 시간만큼 뒤로 미뤄 1회만(trailing) 실행.
 *   - onResync 는 매 렌더의 최신 클로저를 ref 로 참조하므로 deps 에 넣지 않아도 최신 state 를 읽는다.
 *
 * @param onResync 전체 재조회 진입점(현재 session 기준 full refresh).
 * @param opts.enabled false 면 리스너를 붙이지 않는다(예: session 미선택).
 * @param opts.minIntervalMs 복귀 이벤트 병합 간격(기본 800ms).
 */
export function useVisibilityResync(
  onResync: () => void,
  opts: { enabled?: boolean; minIntervalMs?: number } = {},
): void {
  const { enabled = true, minIntervalMs = 800 } = opts;
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync; // 매 렌더 최신 클로저 유지

  const lastRunRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const run = () => {
      lastRunRef.current = Date.now();
      timerRef.current = null;
      try {
        onResyncRef.current();
      } catch (err) {
        console.warn('[Realtime/resync] onResync threw:', err);
      }
    };

    const schedule = () => {
      const since = Date.now() - lastRunRef.current;
      if (since >= minIntervalMs) {
        run();
      } else if (!timerRef.current) {
        // 최근 실행 직후 → 남은 시간만큼 미뤄 1회만 실행(trailing edge). 이미 예약돼 있으면 무시.
        timerRef.current = setTimeout(run, minIntervalMs - since);
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    const onFocus = () => schedule();
    const onOnline = () => schedule();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, minIntervalMs]);
}
