'use client';

// 진행 중 경기의 경과 시간 글자 하나 (타이머 1단계 — Control Center · 경기 운영 · Signature Court Board 공용).
//
//   ⚠ 시각은 서버 값(playStartedAt)과 서버 시계 보정값(offset)에서만 나온다 — 기기 시계를 그대로 믿지 않는다.
//   ⚠ 이 글자만 다시 그린다(부모 화면을 매초 다시 그리지 않는다). 다음 '초' 경계에 맞춰 깬다.
//   ⚠ 탭이 가려졌다 돌아오면 브라우저가 타이머를 늦춰도, 깨는 순간 서버 기준으로 다시 계산하므로 밀리지 않는다.

import React from 'react';
import { formatElapsed, runningMs } from '@/lib/tournaments/matchTimer';

export default function MatchElapsedClock({ startMs, offsetMs, style, name }: {
  /** 서버 시작 시각(ms). */
  startMs: number;
  /** 서버 시각 − 기기 시각(ms). */
  offsetMs: number;
  style?: React.CSSProperties;
  /** data-match-elapsed 값(검증용 표식). */
  name?: string | number;
}) {
  const [, setTick] = React.useState(0);
  const ms = runningMs(startMs, Date.now(), offsetMs);

  React.useEffect(() => {
    // 다음 초 경계 + 약간 — 표시가 1초씩 고르게 넘어간다.
    const wait = 1000 - (ms % 1000) + 15;
    const t = window.setTimeout(() => setTick((n) => n + 1), wait);
    return () => window.clearTimeout(t);
  }, [ms]);

  return (
    <span data-match-elapsed={name ?? ''} data-elapsed-ms={Math.floor(ms / 1000) * 1000}
      style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {formatElapsed(ms)}
    </span>
  );
}
