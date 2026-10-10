'use client';

// Control Center 데이터 조회 (Batch 4F-1 · 조회 안전성 4F-4a · 자동 갱신 4F-4b).
//
//   ⚠ 기존 운영 RPC 3개만 쓴다. Control Center 전용 API · 테이블 · 저장 집계를 만들지 않는다.
//   ⚠ 새로고침이 실패해도 보던 화면을 지우지 않는다(현장에서 화면이 비는 것이 가장 나쁘다).
//
//   갱신 경로 — 전부 같은 큐(controlReload)를 지난다. 겹치지 않고, 조작 전 응답은 버린다.
//     · 진입 시 1회
//     · 화면이 보이는 동안 5초마다(연속 실패 시 10 → 20 → 30초, 성공하면 5초로 복귀)
//     · 복귀 신호(visible · focus · online) — 기존 공용 훅 useVisibilityResync 로 즉시
//     · 운영자의 [새로고침](이때만 버튼에 진행 표시)
//     · 조작 후 재조회(controlActions)
//   ⚠ 탭이 숨겨지면 주기 갱신을 멈춘다. 다시 보이면 즉시 한 번 읽고 주기를 이어 간다.
//   ⚠ 조작 RPC 가 도는 동안(hold ~ release)에는 조회를 시작하지 않는다. 그 사이 들어온
//     주기 갱신 · 복귀 신호는 조작 후 재조회 한 번으로 합쳐진다.

import React from 'react';
import { useVisibilityResync } from '@/hooks/useRealtimeSync';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import { fetchPreliminaryStandings } from '@/lib/tournaments/standingsAdminService';
import { fetchAdminBracket } from '@/lib/tournaments/bracketAdminService';
import type { MatchBoard } from '@/lib/tournaments/matchTypes';
import { CONTROL_STALE_MS, controlCycleOutcome, controlPollDelay } from './controlModel';
import type { ControlCycleOutcome, ControlSnapshot } from './controlModel';
import { createReloadQueue } from './controlReload';
import type { ReloadQueue } from './controlReload';

export type { ControlSnapshot };

export interface ControlReloadOptions {
  /**
   * 운영자가 [새로고침] 을 직접 눌렀는가.
   *   true 일 때만 refreshing 이 켜진다. 조작 후 재조회 · 주기 갱신 · 복귀 재조회는 조용히 돈다.
   */
  manual?: boolean;
}

export interface ControlState {
  snapshot: ControlSnapshot | null;
  /** 첫 조회 중(화면에 아무 것도 없을 때만 true). 재조회에서는 켜지지 않는다. */
  loading: boolean;
  /** 운영자가 직접 누른 새로고침이 돌고 있는가(버튼 표시용). 조용한 재조회에서는 켜지지 않는다. */
  refreshing: boolean;
  /** 운영 권한으로 읽을 수 있는가. */
  authorized: boolean;
  /** 첫 조회가 실패했는가. */
  failed: boolean;
  /** 마지막 조회가 실패해 화면이 과거 값일 때의 한 줄 안내('' 이면 없음). */
  staleError: string;
  /** 마지막 정상 갱신이 30초 넘게 지났는가. */
  stale: boolean;
  /** 마지막 정상 갱신 시각. 실패해도 바뀌지 않는다. */
  updatedAt: number | null;
  /**
   * 전체 재조회.
   *   ⚠ 부른 **뒤에 시작되어 반영된** 조회가 끝나야 풀린다(조회 중이면 후속 조회를 예약해 기다린다).
   *   ⚠ unmount 되면 기다리던 쪽은 모두 곧바로 풀린다 — 남는 Promise 가 없다.
   */
  reload: (opts?: ControlReloadOptions) => Promise<void>;
  /**
   * 조작 보호. 조작 RPC 를 보내기 직전 hold, 응답을 받은 직후 release.
   *   hold 이전에 시작한 조회의 응답은 반영되지 않는다(조작 전 화면이 되살아나지 않게).
   */
  hold: () => void;
  release: () => void;
  /** 가장 최근에 **반영에 성공한** board 와 그 시각 — 조작 결과 판정용. */
  latest: () => { board: MatchBoard | null; at: number | null };
}

/** 한 번 읽는다. 절대 throw 하지 않는다 — 결과는 사이클 판정으로 돌려준다. */
async function fetchCycle(slug: string): Promise<ControlCycleOutcome> {
  // ⚠ 오류는 삼키지 않는다 — 판정은 controlCycleOutcome 이 사이클 단위로 한다.
  //   (예선·본선 자료가 '아직 없음' 인 것은 service 가 ready=false / bracket=null 로 따로 돌려준다.)
  const [mb, st, br] = await Promise.allSettled([
    fetchMatchBoard(slug),
    fetchPreliminaryStandings(slug),
    fetchAdminBracket(slug),
  ]);
  return controlCycleOutcome(mb, st, br);
}

/** 이 시간 안에 정상 반영된 데이터가 있으면 복귀 신호로 다시 읽지 않는다. */
const RESYNC_DEDUPE_MS = 1_000;

const MSG = {
  network: '연결이 불안정합니다.',
  server: '최신 상태를 불러오지 못했습니다.',
  auth: '로그인이 만료되었을 수 있습니다. 다시 로그인해 주세요.',
  unauthorized: '운영 권한을 확인할 수 없습니다. 로그인이 만료되었다면 다시 로그인해 주세요.',
} as const;

export function useControlData(slug: string): ControlState {
  const [snapshot, setSnapshot] = React.useState<ControlSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [authorized, setAuthorized] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [staleError, setStaleError] = React.useState('');
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  // '30초 넘게 지났는가' 를 보기 위한 시계. 화면이 보일 때만 5초마다 움직인다.
  const [now, setNow] = React.useState(() => Date.now());

  const mounted = React.useRef(true);
  const hasData = React.useRef(false);
  /** 연속 실패 수(성공하면 0) — backoff 기준. */
  const failStreak = React.useRef(0);
  /** 연속 인증 실패 수 — 첫 회는 조용히 한 번 더 본다. */
  const authStreak = React.useRef(0);
  const latestRef = React.useRef<{ board: MatchBoard | null; at: number | null }>({ board: null, at: null });
  /** 조회 순서 관리(single-flight + 후속 예약 + epoch). mount 마다 새로 만들고 unmount 때 정리한다. */
  const queue = React.useRef<ReloadQueue | null>(null);
  const timer = React.useRef<number | null>(null);
  /** 다음 주기 갱신을 건다 — mount effect 안에서 만든다(반영 직후 부른다). */
  const scheduleRef = React.useRef<() => void>(() => {});
  /** 지금 곧바로 한 번 읽고 주기를 새로 건다 — 복귀 신호용. */
  const kickRef = React.useRef<() => void>(() => {});
  /** 마지막으로 **정상** 반영된 시각 — 복귀 신호 중복을 거르는 데 쓴다. */
  const lastOkAt = React.useRef(0);

  /** 조회 결과를 화면에 반영한다. 큐가 '조작 뒤에 시작한 조회' 일 때만 부른다. */
  const apply = React.useCallback((out: ControlCycleOutcome) => {
    if (!mounted.current) return;
    if (out.kind === 'ok') {
      failStreak.current = 0;
      authStreak.current = 0;
      setAuthorized(true);
      setFailed(false);
      setStaleError('');
      setSnapshot(out.snapshot);
      hasData.current = true;
      const at = Date.now();
      latestRef.current = { board: out.snapshot.board, at };
      lastOkAt.current = at;
      setUpdatedAt(at);
      setNow(at);
    } else if (out.kind === 'unauthorized' && !hasData.current) {
      // 처음부터 권한이 없다 — 만료가 아니라 권한 문제다(기존 안내 화면).
      failStreak.current += 1;
      setAuthorized(false);
      setSnapshot(null);
      setFailed(false);
    } else {
      // ⚠ 이미 보여 주고 있던 내용은 지우지 않는다. 일부만 실패해도 사이클 전체를 버린다
      //   — 실패한 쪽을 '조편성 전 · 본선 없음' 으로 잘못 그리지 않기 위해서다.
      failStreak.current += 1;
      const auth = out.kind === 'unauthorized' || out.cause === 'auth';
      authStreak.current = auth ? authStreak.current + 1 : 0;
      if (out.kind === 'unauthorized') setAuthorized(false);
      if (!hasData.current) {
        setFailed(true);
        setSnapshot(null);
      } else if (!(auth && authStreak.current === 1)) {
        // ⚠ 인증 오류 첫 회는 안내하지 않는다 — 복귀 직후 토큰 갱신과 겹친 것일 수 있어 조용히 한 번 더 본다.
        setStaleError(out.kind === 'unauthorized' ? MSG.unauthorized : MSG[out.cause]);
      }
    }
    setLoading(false);
    scheduleRef.current();
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    if (!slug) { setLoading(false); return undefined; }

    const q = createReloadQueue<ControlCycleOutcome>({
      fetch: () => fetchCycle(slug),
      apply,
      onManual: (pending) => { if (mounted.current) setRefreshing(pending); },
    });
    queue.current = q;

    const visible = () => document.visibilityState === 'visible';
    const clear = () => {
      if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    };
    const tick = () => {
      clear();
      // 반영되면 apply 가 다음 주기를 건다. 반영 없이 끝나면(정리 등) 여기서 다시 건다.
      void q.request().then(() => { if (timer.current === null) scheduleRef.current(); });
    };
    scheduleRef.current = () => {
      clear();
      if (!mounted.current || !visible()) return;      // 숨겨진 탭은 주기 갱신을 멈춘다
      timer.current = window.setTimeout(tick, controlPollDelay(failStreak.current, authStreak.current));
    };
    // 복귀 신호용 — 방금(1초 안) 정상 반영됐으면 다시 읽지 않는다. 공용 훅은 연속 신호를
    //   '즉시 1회 + 800ms 뒤 1회' 로 합치므로, 뒤따르는 1회를 여기서 거른다. 실패 중이면 거르지 않는다.
    kickRef.current = () => {
      if (failStreak.current === 0 && Date.now() - lastOkAt.current < RESYNC_DEDUPE_MS) {
        if (timer.current === null) scheduleRef.current();
        return;
      }
      tick();
    };

    // 숨겨지면 멈춘다. 다시 보일 때는 useVisibilityResync 가 즉시 재조회(kick)한다.
    const onVisibility = () => { if (!visible()) clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    const clock = window.setInterval(() => {
      if (visible() && mounted.current) setNow(Date.now());
    }, 5_000);

    void q.request();                                  // 진입 시 1회 → 반영되면 주기가 시작된다
    return () => {
      mounted.current = false;
      clear();
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisibility);
      // 기다리던 쪽을 모두 푼다 — unmount 뒤에 남는 Promise · 새 조회를 만들지 않는다.
      q.dispose();
      if (queue.current === q) queue.current = null;
      kickRef.current = () => {};
      scheduleRef.current = () => {};
    };
  }, [slug, apply]);

  // 복귀 신호(visible · focus · online) → 즉시 한 번 읽고 주기를 새로 건다(backoff 중이어도 바로 시도).
  //   ⚠ 기존 공용 훅을 그대로 쓴다 — 800ms 안의 연속 신호는 한 번으로 합쳐진다.
  useVisibilityResync(() => { kickRef.current(); }, { enabled: !!slug });

  const reload = React.useCallback((opts?: ControlReloadOptions): Promise<void> => {
    const q = queue.current;
    if (!q || !mounted.current) return Promise.resolve();
    return q.request(opts?.manual === true);
  }, []);
  const hold = React.useCallback(() => { queue.current?.hold(); }, []);
  const release = React.useCallback(() => { queue.current?.release(); }, []);
  const latest = React.useCallback(() => latestRef.current, []);

  const stale = updatedAt !== null && now - updatedAt > CONTROL_STALE_MS;

  return {
    snapshot, loading, refreshing, authorized, failed, staleError, stale, updatedAt,
    reload, hold, release, latest,
  };
}
