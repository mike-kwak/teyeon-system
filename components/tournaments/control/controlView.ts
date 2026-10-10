'use client';

// Control Center 데이터 조회 (Batch 4F-1 · 조회 안전성 4F-4a).
//
//   ⚠ 기존 운영 RPC 3개만 쓴다. Control Center 전용 API · 테이블 · 저장 집계를 만들지 않는다.
//   ⚠ 주기 갱신(polling) · 복귀 재조회는 4F-4b 다. 여기서는 진입 시 1회 + 수동 새로고침 + 조작 후 재조회뿐이다.
//   ⚠ 새로고침이 실패해도 보던 화면을 지우지 않는다(현장에서 화면이 비는 것이 가장 나쁘다).
//
//   조회는 **한 번에 하나만** 돈다(single-flight). 돌고 있는 중에 재조회를 부르면
//   버리지 않고 '끝난 뒤 한 번 더' 로 예약한다 — 여러 번 불러도 후속 조회는 하나로 합친다.
//   reload() 가 돌려주는 Promise 는 **부른 뒤에 시작된 조회**가 끝나야 풀린다.
//   그래서 조작 직후 await reload() 를 하면 조작 결과가 반영된 화면을 보장받는다.

import React from 'react';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import { fetchPreliminaryStandings } from '@/lib/tournaments/standingsAdminService';
import { fetchAdminBracket } from '@/lib/tournaments/bracketAdminService';
import { controlCycleOutcome } from './controlModel';
import { createReloadQueue } from './controlReload';
import type { ReloadQueue } from './controlReload';
import type { ControlSnapshot } from './controlModel';

export type { ControlSnapshot };

export interface ControlReloadOptions {
  /**
   * 운영자가 [새로고침] 을 직접 눌렀는가.
   *   true 일 때만 refreshing 이 켜진다. 조작 후 재조회(그리고 4F-4b 의 주기 갱신)는 조용히 돈다.
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
  /** 마지막 조회가 실패해 화면이 과거 값인가. */
  staleError: string;
  updatedAt: number | null;
  /**
   * 전체 재조회.
   *   ⚠ 부른 **뒤에 시작된** 조회가 끝나야 풀린다(조회 중이면 후속 조회를 예약해 기다린다).
   *   ⚠ unmount 되면 기다리던 쪽은 모두 곧바로 풀린다 — 남는 Promise 가 없다.
   */
  reload: (opts?: ControlReloadOptions) => Promise<void>;
}

export function useControlData(slug: string): ControlState {
  const [snapshot, setSnapshot] = React.useState<ControlSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [authorized, setAuthorized] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [staleError, setStaleError] = React.useState('');
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);

  const mounted = React.useRef(true);
  const hasData = React.useRef(false);
  /** 조회 순서 관리(single-flight + 후속 예약). mount 마다 새로 만들고 unmount 때 정리한다. */
  const queue = React.useRef<ReloadQueue | null>(null);

  /** 한 번 조회해 반영한다. 절대 throw 하지 않는다. */
  const fetchOnce = React.useCallback(async () => {
    // 셋을 함께 읽는다. ⚠ 오류는 삼키지 않는다 — 판정은 controlCycleOutcome 이 사이클 단위로 한다.
    //   (예선·본선 자료가 '아직 없음' 인 것은 service 가 ready=false / bracket=null 로 따로 돌려준다.)
    const [mb, st, br] = await Promise.allSettled([
      fetchMatchBoard(slug),
      fetchPreliminaryStandings(slug),
      fetchAdminBracket(slug),
    ]);
    if (!mounted.current) return;

    const out = controlCycleOutcome(mb, st, br);

    if (out.kind === 'unauthorized') {        // 운영 권한이 없거나 대회를 못 찾음
      setAuthorized(false);
      if (!hasData.current) { setSnapshot(null); setFailed(false); }
      else setStaleError('운영 권한을 확인할 수 없습니다.');
    } else if (out.kind === 'error') {
      // ⚠ 이미 보여 주고 있던 내용은 지우지 않는다. 일부만 실패해도 사이클 전체를 버린다
      //   — 실패한 쪽을 '조편성 전 · 본선 없음' 으로 잘못 그리지 않기 위해서다.
      if (hasData.current) setStaleError('최신 상태를 불러오지 못했습니다.');
      else { setFailed(true); setSnapshot(null); }
    } else {
      setAuthorized(true);
      setFailed(false);
      setStaleError('');
      setSnapshot(out.snapshot);
      hasData.current = true;
      setUpdatedAt(Date.now());
    }
    setLoading(false);
  }, [slug]);

  React.useEffect(() => {
    mounted.current = true;
    if (!slug) { setLoading(false); return undefined; }
    const q = createReloadQueue(fetchOnce, (pending) => {
      if (mounted.current) setRefreshing(pending);
    });
    queue.current = q;
    void q.request();
    return () => {
      mounted.current = false;
      // 기다리던 쪽을 모두 푼다 — unmount 뒤에 남는 Promise · 새 조회를 만들지 않는다.
      q.dispose();
      if (queue.current === q) queue.current = null;
    };
  }, [slug, fetchOnce]);

  const reload = React.useCallback((opts?: ControlReloadOptions): Promise<void> => {
    const q = queue.current;
    if (!q || !mounted.current) return Promise.resolve();
    return q.request(opts?.manual === true);
  }, []);

  return { snapshot, loading, refreshing, authorized, failed, staleError, updatedAt, reload };
}
