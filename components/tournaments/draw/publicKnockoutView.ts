'use client';

// 공개 본선 대진 — 데이터 로딩 · 갱신 (Batch 4D-4).
//
//   ⚠ Realtime(postgres_changes)을 공개 화면에 연결하지 않는다 — 기존 공개 DRAW 원칙 그대로.
//   ⚠ 갱신은 서버 응답만 믿는다. 낙관적 갱신(가짜 결과)을 만들지 않는다.
//   ⚠ 배경 갱신은 화면을 비우지 않는다. 실패하면 보고 있던 내용을 그대로 둔다.
//   ⚠ 본선이 끝나면 주기 갱신을 멈춘다(돌아올 때만 다시 확인).

import React from 'react';
import { fetchPublicKnockoutBracket } from '@/lib/tournaments/publicKnockoutService';
import { PUBLIC_KNOCKOUT_ENABLED } from '@/lib/tournaments/publicKnockoutFlags';
import type { PublicKnockoutBracket } from '@/lib/tournaments/publicKnockoutTypes';

/** 관람 중 결과가 바뀌는 속도를 감안한 주기. 너무 잦은 호출을 만들지 않는다. */
export const KNOCKOUT_POLL_MS = 45_000;

export interface PublicKnockoutState {
  bracket: PublicKnockoutBracket | null;
  /** 첫 조회 중(화면에 아무 것도 없을 때만 true). */
  loading: boolean;
  /** 첫 조회가 실패했는가. 배경 갱신 실패는 여기 오지 않는다. */
  failed: boolean;
  /** 마지막으로 성공한 시각(표시용). */
  updatedAt: number | null;
}

export function usePublicKnockoutBracket(slug: string): PublicKnockoutState {
  const [state, setState] = React.useState<PublicKnockoutState>({
    bracket: null, loading: true, failed: false, updatedAt: null,
  });

  const inFlight = React.useRef(false);
  const mounted = React.useRef(true);
  const hasData = React.useRef(false);
  /** 본선이 끝났는가 — 주기 갱신을 멈추는 기준. */
  const completed = React.useRef(false);

  const load = React.useCallback(async () => {
    if (!slug) return;
    if (inFlight.current) return;          // 겹친 요청을 만들지 않는다
    inFlight.current = true;
    try {
      const r = await fetchPublicKnockoutBracket(slug);
      if (!mounted.current) return;
      hasData.current = r.bracket !== null;
      completed.current = r.bracket?.bracketStatus === 'completed';
      setState({ bracket: r.bracket, loading: false, failed: false, updatedAt: Date.now() });
    } catch {
      if (!mounted.current) return;
      // 배경 갱신 실패 — 보고 있던 대진을 그대로 둔다.
      setState((prev) => (hasData.current
        ? { ...prev, loading: false }
        : { bracket: null, loading: false, failed: true, updatedAt: prev.updatedAt }));
    } finally {
      inFlight.current = false;
    }
  }, [slug]);

  React.useEffect(() => {
    mounted.current = true;
    void load();

    let timer: number | null = null;
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null; } };
    const start = () => {
      stop();
      // 공개 기능이 꺼져 있으면 조회할 것이 없다 — 빈 타이머를 돌리지 않는다.
      if (!PUBLIC_KNOCKOUT_ENABLED) return;
      timer = window.setInterval(() => {
        // 끝난 본선은 주기 갱신하지 않는다(돌아올 때 focus · visibility 로 한 번 더 확인한다).
        if (completed.current) return;
        void load();
      }, KNOCKOUT_POLL_MS);
    };

    // 화면에 보일 때만 주기 갱신한다. 숨겨지면 멈춘다.
    const onVisible = () => {
      if (document.visibilityState === 'visible') { void load(); start(); }
      else stop();
    };
    const onFocus = () => { void load(); };

    if (typeof document !== 'undefined' && document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      mounted.current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return state;
}
