'use client';

// MY MATCH 데이터 — 공개 예선 · 본선 RPC 를 함께 읽고, 화면이 보이는 동안만 주기 갱신한다.
//
//   · 남은 내 경기가 있으면 15초, 없으면 45초(기존 대진표와 같은 주기). 실패하면 30 → 60초로 늘린다.
//   · 화면이 숨겨지면(잠금 · 다른 앱 · 다른 탭) 멈추고, 돌아오면(visible · focus · pageshow · online) 즉시 다시 읽는다.
//   ⚠ 한쪽 조회가 실패하면 그쪽은 직전 값을 그대로 둔다 — 실패 때문에 경기가 사라졌다 다시 생기며 알림이 뜨는 일이 없다.
//   ⚠ null(비공개)은 실패가 아니다 — 그 단계를 '공개 전' 으로 본다.
//   ⚠ 화면 잠금 · 브라우저 종료 중에는 아무것도 하지 않는다(브라우저가 스크립트를 멈춘다). 푸시 알림이 아니다.

import React from 'react';
import { fetchPublicPreliminaryDraw } from '@/lib/tournaments/publicDrawService';
import { fetchPublicKnockoutBracket, placementNoMapFromDraw, withPublicGroupLabels } from '@/lib/tournaments/publicKnockoutService';
import { fetchPublicGroupSchedule, type PublicGroupSchedule } from '@/lib/tournaments/groupScheduleService';
import type { PublicPreliminaryDraw } from '@/lib/tournaments/publicDrawTypes';
import type { PublicKnockoutBracket } from '@/lib/tournaments/publicKnockoutTypes';

export const MY_FAST_MS = 15_000;
export const MY_SLOW_MS = 45_000;
const MY_MAX_BACKOFF_MS = 60_000;
/** 마지막 성공 후 이만큼 지나면 '연결 확인 중' 으로 알린다. */
export const MY_STALE_MS = 60_000;

export interface MyFeed {
  draw: PublicPreliminaryDraw | null;
  bracket: PublicKnockoutBracket | null;
  /** 운영진이 지정한 조별 순서 · 예정 코트 · 신고 안내(안내 전용 · 실패해도 직전 값 유지 · 연결 상태에 넣지 않음). */
  schedule: PublicGroupSchedule | null;
  /** 두 조회 중 하나라도 한 번은 응답을 받았다(비공개 응답 포함). */
  loaded: boolean;
  /** 이번(마지막) 조회가 실패했다. */
  failing: boolean;
  /** 마지막으로 두 조회가 모두 성공한 시각(ms). */
  lastOkAt: number | null;
  /** 새 데이터가 반영될 때마다 1씩 오른다 — 화면이 이 값으로 비교(diff)를 돌린다. */
  rev: number;
  /** 지금 다시 읽기(사용자 버튼). */
  refresh: () => void;
}

export function useMyMatchFeed(slug: string, fast: boolean): MyFeed {
  const [state, setState] = React.useState<Omit<MyFeed, 'refresh'>>({
    draw: null, bracket: null, schedule: null, loaded: false, failing: false, lastOkAt: null, rev: 0,
  });
  const inFlight = React.useRef(false);
  const fails = React.useRef(0);
  const timer = React.useRef<number | null>(null);
  const fastRef = React.useRef(fast);
  fastRef.current = fast;

  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };

  const loadRef = React.useRef<() => Promise<void>>(async () => {});
  const schedule = React.useCallback(() => {
    clear();
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const base = fastRef.current ? MY_FAST_MS : MY_SLOW_MS;
    const wait = fails.current > 0 ? Math.min(MY_MAX_BACKOFF_MS, Math.max(base, MY_FAST_MS * 2 ** fails.current)) : base;
    timer.current = window.setTimeout(() => { void loadRef.current(); }, wait);
  }, []);

  const load = React.useCallback(async () => {
    if (!slug || inFlight.current) return;
    inFlight.current = true;
    const [p, k, sc] = await Promise.allSettled([
      fetchPublicPreliminaryDraw(slug), fetchPublicKnockoutBracket(slug), fetchPublicGroupSchedule(slug),
    ]);
    const okAll = p.status === 'fulfilled' && k.status === 'fulfilled';
    fails.current = okAll ? 0 : fails.current + 1;
    setState((s) => ({
      draw: p.status === 'fulfilled' ? p.value.draw : s.draw,
      // 순위결정전 출처 라벨은 공개 조 번호로(내부 19조 1위 → 1조 1위) — 표시 전용
      bracket: k.status === 'fulfilled'
        ? withPublicGroupLabels(k.value.bracket, placementNoMapFromDraw(p.status === 'fulfilled' ? p.value.draw : s.draw))
        : s.bracket,
      schedule: sc.status === 'fulfilled' ? sc.value : s.schedule,
      loaded: s.loaded || p.status === 'fulfilled' || k.status === 'fulfilled',
      failing: !okAll,
      lastOkAt: okAll ? Date.now() : s.lastOkAt,
      rev: s.rev + 1,
    }));
    inFlight.current = false;
    schedule();
  }, [slug, schedule]);
  loadRef.current = load;

  React.useEffect(() => {
    void load();
    const wake = () => { if (document.visibilityState === 'visible') void load(); else clear(); };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) void load(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [load]);

  // 남은 경기 유무가 바뀌면 다음 갱신 간격을 다시 잡는다.
  React.useEffect(() => { if (!inFlight.current) schedule(); }, [fast, schedule]);

  return { ...state, refresh: () => { void load(); } };
}
