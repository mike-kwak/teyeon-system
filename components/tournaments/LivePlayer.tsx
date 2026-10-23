'use client';

// LIVE 영상 재생 영역.
//
//   ⚠ Phase 1 은 custom player 를 만들지 않는다. Cloudflare Stream 공식 iframe embed 를 쓴다.
//     iPhone Safari / Android Chrome / PC Chrome·Edge 에서 가장 검증된 경로이기 때문이다.
//   ⚠ 모바일 자동재생 정책: 소리가 있는 자동재생은 차단된다.
//     그래서 muted=true 로 시작하고, 소리는 시청자가 플레이어에서 직접 켠다.
//   ⚠ 재생할 수 없는 상태에서도 이 영역만 fallback 으로 바뀐다.
//     아래쪽 Tournament 정보는 계속 보여야 한다(페이지 전체를 막지 않는다).

import React from 'react';
import { Radio, VideoOff } from 'lucide-react';
import { TT } from './tournamentTheme';
import type { LiveVideoState } from '@/lib/tournaments/liveTypes';

interface Props {
  /** iframe 재생 URL. null 이면 재생 불가 → fallback. */
  playbackUrl: string | null;
  state: LiveVideoState;
  /** fallback 에 보여줄 한 줄 안내. */
  note: string;
  /** 다시보기 재생 중이면 true(자동재생을 켜지 않는다). */
  replay?: boolean;
  /**
   * 다시보기 시작 위치(초). Cloudflare 플레이어의 startTime 파라미터로 넘긴다.
   *   ⚠ 끝 위치 지정은 Cloudflare 플레이어가 지원하지 않는다 — 구간 끝에서 멈추지 않는다.
   */
  startSec?: number | null;
}

/** 16:9 고정 — 세로 흔들림 없이 레이아웃이 먼저 자리를 잡게 한다. */
const frame: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16 / 9',
  borderRadius: 12,
  overflow: 'hidden',
  backgroundColor: TT.navy,
};

export default function LivePlayer({ playbackUrl, state, note, replay = false, startSec = null }: Props) {
  const playable = !!playbackUrl && (replay || state === 'live' || state === 'recovering');

  if (!playable) {
    return (
      <div style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center', maxWidth: 280 }}>
          <VideoOff size={26} strokeWidth={1.9} color={TT.tealOnNavy} style={{ opacity: 0.85 }} />
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 13,
              fontWeight: 700,
              color: '#E2E8F0',
              lineHeight: 1.7,
              wordBreak: 'keep-all',
            }}
          >
            {note}
          </p>
        </div>
      </div>
    );
  }

  // autoplay 는 muted 와 함께여야 모바일에서 실제로 동작한다.
  const start = replay && startSec !== null && Number.isFinite(startSec) && startSec > 0 ? Math.floor(startSec) : null;
  const src = replay
    ? `${playbackUrl}?preload=auto${start !== null ? `&startTime=${start}` : ''}`
    : `${playbackUrl}?autoplay=true&muted=true&preload=auto`;

  return (
    <div style={frame}>
      <iframe
        // src 가 바뀌면 플레이어를 새로 붙인다(다시보기 ↔ LIVE 전환 시 잔상 방지).
        key={src}
        src={src}
        title={replay ? 'TEYEON OPEN 다시보기' : 'TEYEON OPEN LIVE'}
        loading="lazy"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
      />
      {state === 'recovering' && !replay && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 9px',
            borderRadius: 999,
            backgroundColor: 'rgba(16, 42, 61, 0.86)',
            color: '#FDE68A',
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          <Radio size={11} strokeWidth={2.6} />
          연결 복구 중
        </div>
      )}
    </div>
  );
}
