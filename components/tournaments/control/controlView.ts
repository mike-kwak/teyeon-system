'use client';

// Control Center 데이터 조회 (Batch 4F-1).
//
//   ⚠ 기존 운영 RPC 3개만 쓴다. Control Center 전용 API · 테이블 · 저장 집계를 만들지 않는다.
//   ⚠ 이번 단계는 읽기 전용이다 — 조작(호명 · 투입 · 점수)은 4F-3 에서 붙인다.
//   ⚠ 주기 갱신(polling)은 4F-4 다. 여기서는 진입 시 1회 + 수동 새로고침뿐이다.
//   ⚠ 새로고침이 실패해도 보던 화면을 지우지 않는다(현장에서 화면이 비는 것이 가장 나쁘다).

import React from 'react';
import { fetchMatchBoard } from '@/lib/tournaments/matchAdminService';
import { fetchPreliminaryStandings } from '@/lib/tournaments/standingsAdminService';
import { fetchAdminBracket } from '@/lib/tournaments/bracketAdminService';
import type { MatchBoard } from '@/lib/tournaments/matchTypes';
import type { PreliminaryStandings } from '@/lib/tournaments/standingsTypes';
import type { AdminBracket } from '@/lib/tournaments/bracketTypes';

export interface ControlSnapshot {
  board: MatchBoard | null;
  standings: PreliminaryStandings | null;
  bracket: AdminBracket | null;
}

export interface ControlState {
  snapshot: ControlSnapshot | null;
  /** 첫 조회 중(화면에 아무 것도 없을 때만 true). 수동 새로고침에서는 켜지지 않는다. */
  loading: boolean;
  /** 새로고침이 돌고 있는가(버튼 비활성·작은 표시용). */
  refreshing: boolean;
  /** 운영 권한으로 읽을 수 있는가. */
  authorized: boolean;
  /** 첫 조회가 실패했는가. */
  failed: boolean;
  /** 마지막 조회가 실패해 화면이 과거 값인가. */
  staleError: string;
  updatedAt: number | null;
  reload: () => void;
}

export function useControlData(slug: string): ControlState {
  const [snapshot, setSnapshot] = React.useState<ControlSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [authorized, setAuthorized] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [staleError, setStaleError] = React.useState('');
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);

  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  const hasData = React.useRef(false);

  const load = React.useCallback(async () => {
    if (!slug || inFlight.current) return;
    inFlight.current = true;
    if (hasData.current) setRefreshing(true);
    try {
      // 셋 다 같은 시점의 값을 보도록 함께 읽는다.
      //   예선·본선 자료는 아직 없을 수 있다(정상) → 조회 실패를 오류로 만들지 않는다.
      const [mb, st, br] = await Promise.all([
        fetchMatchBoard(slug),
        fetchPreliminaryStandings(slug).catch(() => ({ ready: false, standings: null })),
        fetchAdminBracket(slug).catch(() => ({ ready: false, data: null })),
      ]);
      if (!mounted.current) return;

      if (!mb.ready) {                       // 운영 권한이 없거나 대회를 못 찾음
        setAuthorized(false);
        if (!hasData.current) { setSnapshot(null); setFailed(false); }
        else setStaleError('운영 권한을 확인할 수 없습니다.');
        return;
      }

      setAuthorized(true);
      setFailed(false);
      setStaleError('');
      setSnapshot({
        board: mb.board,
        standings: st.ready ? st.standings : null,
        bracket: br.ready ? br.data : null,
      });
      hasData.current = true;
      setUpdatedAt(Date.now());
    } catch {
      if (!mounted.current) return;
      // ⚠ 이미 보여 주고 있던 내용은 지우지 않는다.
      if (hasData.current) setStaleError('최신 상태를 불러오지 못했습니다.');
      else { setFailed(true); setSnapshot(null); }
    } finally {
      inFlight.current = false;
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [slug]);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const reload = React.useCallback(() => { void load(); }, [load]);

  return { snapshot, loading, refreshing, authorized, failed, staleError, updatedAt, reload };
}
