'use client';

// Handbook 공통 영상 모듈 — Handoff §6 동작 + §7 상태 매트릭스.
//   1차: 실제 영상 미연결 — poster/준비 중/오류/reduced-motion 상태 중심.
//   MP4 연결 시(video_file 지정) 즉시 동작하도록 인터페이스·IO 제어를 완성해 둔다.
//   성능: preload="metadata", IntersectionObserver 로 화면 내에서만 재생, 한 화면 활성 1개.

import React from 'react';
import { HB, HB_SHADOW } from './handbookTokens';

// 한 화면 활성 영상 1개 보장 — 재생 시 다른 인스턴스 pause.
const activePausers = new Set<() => void>();

export interface GuideVideoPlayerProps {
  title: string;
  videoFile?: string;
  posterFile?: string;
  /** RECORDED 미만이면 "준비 중" 상태로 표시 */
  ready: boolean;
  /** 단계 dot 수(steps.length). 0이면 dot 미표시 */
  stepCount: number;
  activeStep: number;
  onSelectStep?: (index: number) => void;
  /** 'phone' = 데스크톱 폰 프레임 / 'card' = 모바일 4:5 카드 */
  variant: 'phone' | 'card';
  /** 향후 단계별 timestamp(초). 지정 시 단계 클릭 → 해당 구간 점프 */
  stepStarts?: number[];
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export default function GuideVideoPlayer({
  title, videoFile, posterFile, ready, stepCount, activeStep, onSelectStep, variant, stepStarts,
}: GuideVideoPlayerProps) {
  const reduced = usePrefersReducedMotion();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = React.useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle');

  const hasVideo = !!videoFile && ready;

  // IO + visibilitychange 재생 제어(영상 있을 때만).
  React.useEffect(() => {
    if (!hasVideo || reduced) return;
    const video = videoRef.current, frame = frameRef.current;
    if (!video || !frame) return;
    const pause = () => { video.pause(); setPhase('paused'); };
    const play = () => {
      activePausers.forEach((p) => { if (p !== pause) p(); }); // 한 화면 1개
      video.play().then(() => setPhase('playing')).catch(() => setPhase('paused'));
    };
    activePausers.add(pause);
    const io = new IntersectionObserver(
      (entries) => { entries.forEach((e) => (e.isIntersecting ? play() : pause())); },
      { threshold: 0.25 },
    );
    io.observe(frame);
    const onVis = () => { if (document.hidden) pause(); else if (frame.getBoundingClientRect().top < window.innerHeight) play(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis); activePausers.delete(pause); };
  }, [hasVideo, reduced]);

  const replay = () => {
    const v = videoRef.current;
    if (v) { v.currentTime = 0; v.play().catch(() => {}); setPhase('playing'); }
  };
  const jumpTo = (i: number) => {
    onSelectStep?.(i);
    const v = videoRef.current;
    if (v && stepStarts && Number.isFinite(stepStarts[i])) { v.currentTime = stepStarts[i]; v.play().catch(() => {}); }
  };

  // ── 프레임 스타일 ──
  const isPhone = variant === 'phone';
  const frameOuter: React.CSSProperties = isPhone
    ? { backgroundColor: HB.device, borderRadius: 40, padding: 7, boxShadow: HB_SHADOW.device, width: '100%', maxWidth: 312 }
    : { backgroundColor: HB.device, borderRadius: 24, padding: 5, boxShadow: HB_SHADOW.elevated, width: '100%' };
  const screen: React.CSSProperties = {
    position: 'relative', overflow: 'hidden',
    borderRadius: isPhone ? 33 : 20,
    aspectRatio: isPhone ? '9 / 19' : '4 / 5',
    backgroundColor: HB.darkCard,
  };

  const caption = (text: string, color: string = HB.textTertiary) => (
    <p style={{ margin: '10px 2px 0', fontSize: 12, fontWeight: 600, color, textAlign: 'center', wordBreak: 'keep-all' }}>{text}</p>
  );

  // ── 화면 내용(상태 매트릭스) ──
  let inner: React.ReactNode;
  let cap: React.ReactNode = null;

  if (!ready) {
    // 준비 중 — 그라데이션 wash + 문구(§7)
    inner = (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: 'linear-gradient(160deg, #13293F 0%, #0E4A44 100%)', padding: 20, textAlign: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.24em', color: HB.aqua }}>TEYEON HANDBOOK</span>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: 'rgba(255,255,255,.92)', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          이 기능의 사용 영상은 준비 중입니다.
        </p>
        <span style={{ padding: '4px 11px', borderRadius: 999, fontSize: 10.5, fontWeight: 800, backgroundColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.85)', whiteSpace: 'nowrap' }}>영상 준비 중</span>
      </div>
    );
    cap = caption('아래 단계 안내로 먼저 익혀보세요.');
  } else if (phase === 'error') {
    inner = (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#2A3644', padding: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.9)', lineHeight: 1.6, wordBreak: 'keep-all' }}>
          영상을 불러오지 못했습니다.<br />아래 단계 안내를 확인해주세요.
        </p>
        <button type="button" onClick={() => { setPhase('loading'); videoRef.current?.load(); }}
          style={{ height: 36, padding: '0 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,.3)', background: 'transparent', color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          다시 시도
        </button>
      </div>
    );
  } else if (reduced) {
    // reduced-motion — poster 정지 + 수동 탐색 안내(자동재생·애니메이션 없음)
    inner = posterFile
      ? <img src={posterFile} alt="" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      : <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(160deg,#13293F,#0E4A44)' }} />;
    cap = caption('자동재생이 꺼져 있어요 — 아래 단계로 직접 넘겨보세요.');
  } else {
    inner = (
      <video
        ref={videoRef}
        src={videoFile}
        poster={posterFile}
        muted loop playsInline autoPlay
        preload="metadata"
        aria-label={`${title} 사용 화면 녹화 영상. 내용은 단계 안내와 동일합니다.`}
        onLoadStart={() => setPhase('loading')}
        onPlaying={() => setPhase('playing')}
        onError={() => setPhase('error')}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
    cap = phase === 'playing'
      ? caption('무음 자동재생 중 · 무한 반복')
      : phase === 'paused'
        ? caption('일시정지 · 화면에 보이면 이어서 재생', '#B98A2F')
        : caption('무음 자동재생 preview');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div ref={frameRef} style={frameOuter}>
        <div style={screen}>{inner}</div>
      </div>
      {cap}
      {/* 컨트롤 행: 다시 보기(영상 있을 때) + 단계 dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {hasVideo && !reduced && (
          <button type="button" onClick={replay}
            style={{ height: 32, padding: '0 12px', borderRadius: 999, border: `1px solid ${HB.border}`, backgroundColor: HB.surface, color: HB.textSecondary, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            다시 보기
          </button>
        )}
        {stepCount > 0 && (
          <div role="group" aria-label="단계 이동" style={{ display: 'flex', gap: 6 }}>
            {Array.from({ length: stepCount }, (_, i) => (
              <button key={i} type="button" onClick={() => jumpTo(i)} aria-label={`${i + 1}단계로 이동`} aria-current={i === activeStep ? 'step' : undefined}
                style={{ width: 22, height: 22, borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 800, backgroundColor: i === activeStep ? HB.teal : HB.surfaceSub, color: i === activeStep ? '#fff' : HB.textTertiary }}>
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
