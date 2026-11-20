'use client';

import React from 'react';
import { loadPenaltyHistory } from '@/lib/finance/kdkPenaltyHistoryService';
import type { PenaltyHistory } from '@/lib/finance/kdkPenaltyHistoryModel';

export type PenaltyHistoryState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; history: PenaltyHistory; loadedAt: number; refreshing: boolean };

/**
 * 누적 벌금 데이터 로드. enabled(=Finance 관리자)일 때만 조회한다.
 *   - 기간·탭·검색 변경은 이미 받은 데이터에서 계산 → 필터 변경 중 요청 경합이 없다.
 *   - 새로고침 중 이전 응답이 늦게 도착해도 최신 요청 결과만 반영(requestId).
 */
export function usePenaltyHistory(userId: string | null | undefined, enabled: boolean) {
    const [state, setState] = React.useState<PenaltyHistoryState>({ kind: 'idle' });
    const reqId = React.useRef(0);

    const load = React.useCallback(async (force = false) => {
        if (!enabled || !userId) return;
        const id = ++reqId.current;
        setState((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' }));
        try {
            const { history, loadedAt } = await loadPenaltyHistory({ force, userKey: userId });
            if (id !== reqId.current) return;
            setState({ kind: 'ready', history, loadedAt, refreshing: false });
        } catch (e) {
            if (id !== reqId.current) return;
            setState({ kind: 'error', message: (e instanceof Error && e.message) || '벌금 기록을 불러오지 못했습니다.' });
        }
    }, [enabled, userId]);

    React.useEffect(() => { load(false); }, [load]);

    return { state, reload: () => load(true) };
}

export function formatLoadedAt(ms: number): string {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())} 기준`;
}
