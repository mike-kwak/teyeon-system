'use client';

// Control Center — 체크인 현황(표시 · 투입 경고 전용, 현장 운영 1단계).
//
//   ⚠ 기존 조회 큐(controlView · fetchCycle)에 넣지 않는다. 그 큐는 세 조회 중 하나만 실패해도
//     사이클 전체를 버린다 — 체크인 조회 실패 · 미적용이 관제 화면을 멈추게 하면 안 된다.
//   ⚠ 실패하면 마지막 값을 그대로 둔다. 처음부터 못 읽으면 lookup=null('모름') — 경고를 띄우지 않는다.
//   ⚠ 경기 운영 판정(투입 가능 여부)에 쓰지 않는다. 미체크인은 경고 후 운영자가 예외 허용할 수 있다.

import React from 'react';
import { useVisibilityResync } from '@/hooks/useRealtimeSync';
import { fetchTeamCheckins, isCheckinMissing } from '@/lib/tournaments/checkinService';
import { checkinLookup, type CheckinLookup } from '@/lib/tournaments/checkinModel';

const POLL_MS = 15_000;
/** 서버에 체크인 SQL 이 없을 때 — 자주 묻지 않는다. */
const MISSING_POLL_MS = 120_000;
/** 투입 직전 확인을 기다리는 최대 시간. 넘으면 마지막 값으로 판단한다(투입을 붙잡지 않는다). */
const FRESH_WAIT_MS = 2_500;

export interface ControlCheckins {
  /** 팀 번호 → 체크인 여부. 아직 못 읽었거나 쓸 수 없으면 null. */
  lookup: CheckinLookup | null;
  /** 최신 값을 한 번 읽어 돌려준다(최대 2.5초). 실패 · 지연이면 마지막 값. */
  fresh: () => Promise<CheckinLookup | null>;
}

export function useControlCheckins(slug: string): ControlCheckins {
  const [lookup, setLookup] = React.useState<CheckinLookup | null>(null);
  const latest = React.useRef<CheckinLookup | null>(null);
  const missing = React.useRef(false);
  const mounted = React.useRef(true);
  const inflight = React.useRef<Promise<CheckinLookup | null> | null>(null);

  const load = React.useCallback((): Promise<CheckinLookup | null> => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const r = await fetchTeamCheckins(slug);
        missing.current = false;
        if (r.ready && r.board) {
          const l = checkinLookup(r.board);
          latest.current = l;
          if (mounted.current) setLookup(l);
        }
      } catch (e) {
        if (isCheckinMissing(e)) missing.current = true;
        // 그 밖의 오류는 조용히 — 마지막 값을 유지한다.
      }
      return latest.current;
    })();
    inflight.current = p;
    void p.finally(() => { if (inflight.current === p) inflight.current = null; });
    return p;
  }, [slug]);

  React.useEffect(() => {
    mounted.current = true;
    if (!slug) return undefined;
    let timer: number | null = null;
    const loop = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await load();
        if (mounted.current) loop();
      }, missing.current ? MISSING_POLL_MS : POLL_MS);
    };
    void load().then(() => { if (mounted.current) loop(); });
    return () => {
      mounted.current = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [slug, load]);

  useVisibilityResync(() => { if (!missing.current) void load(); }, { enabled: !!slug });

  const fresh = React.useCallback(async (): Promise<CheckinLookup | null> => {
    if (missing.current) return latest.current;
    const wait = new Promise<CheckinLookup | null>((res) => {
      window.setTimeout(() => res(latest.current), FRESH_WAIT_MS);
    });
    return Promise.race([load(), wait]);
  }, [load]);

  return { lookup, fresh };
}
