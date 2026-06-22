'use client';

import React from 'react';
import Image from 'next/image';
import './signatureServe.css';

/**
 * TEYEON Signature Serve — 방식 B (fade)
 *
 * 위치 모션: rAF 기반 단일 quadratic Bezier 곡선.
 *   - CSS keyframe으로 중간점을 찍으면 각 구간마다 easing이 재시작되어 중간 멈춤 발생.
 *   - 시작점 P0, 제어점 P1, 도착점 P2 = (0,0) 사이를 0→1 progress로 한 번에 보간.
 *   - 단일 ease-out 곡선 적용 → 감속 자연스러움.
 *   - 매 프레임 translate3d만 업데이트, scale도 같이 보간.
 *
 * Opacity 모션: CSS animation 분리 (위치와 독립).
 *
 * 좌표 변수 (signatureServe.css 참고):
 *   --logo-size / --ball-dx-ratio / --ball-dy-ratio / --ball-size / --ball-end-scale
 */

const LOGO_SRC      = '/logos/teyeon-logo-transparent.png';
const LOGO_FALLBACK = '/logos/teyeon-logo-current.png';

// Bezier 좌표 (anchor 기준 px offset). 도착점은 항상 (0,0).
const BALL_START = { x: 180, y: 180 };
const BALL_CTRL  = { x: 60,  y: -8 };   // 제어점: 좌상단 호로 휘어지는 자연스러운 포물선
const BALL_END   = { x: 0,   y: 0 };

// Scale: 이동 중 0.92 → 도착 직전 0.45 (--ball-end-scale와 일치시킬 것).
// 공 자체 크기가 0.36 으로 커진 만큼, 도착 직전 scale 을 조금 더 줄여 로고 속 노란 공과
// 자연스럽게 합쳐지는 인상을 유지. 너무 작아지지 않도록 0.42~0.48 범위 내 0.45 선택.
const SCALE_START = 0.92;
const SCALE_END   = 0.45;

// 타임라인 (CSS opacity keyframe과 동기화):
//   0    ~ 1034ms (94%): 위치 이동 + scale 보간
//   1034 ~ 1100ms (94~100%): 위치/scale 고정, opacity만 fade
const TOTAL_DURATION = 1100;
const MOVE_DURATION  = 1034;   // 94% of TOTAL

// 단일 ease-out cubic — 출발 시 빠르고 도착하며 자연스럽게 감속
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export default function SignatureServe() {
    const [logoSrc, setLogoSrc] = React.useState(LOGO_SRC);
    const imgRef  = React.useRef<HTMLImageElement | null>(null);
    const ballRef = React.useRef<SVGSVGElement | null>(null);

    // 로고 이미지를 애니메이션 시작 전에 decode hint — 첫 프레임 jank 방지.
    React.useEffect(() => {
        const el = imgRef.current;
        if (!el) return;
        if (typeof el.decode === 'function') {
            el.decode().catch(() => { /* noop — 기본 paint로 폴백 */ });
        }
    }, [logoSrc]);

    // rAF 단일 곡선 모션. reduced-motion이면 실행하지 않음 (CSS에서 ball 자체 display:none).
    React.useEffect(() => {
        const ball = ballRef.current;
        if (!ball) return;

        if (typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        let rafId = 0;
        let cancelled = false;
        let startTs = 0;

        const tick = (now: number) => {
            if (cancelled) return;
            if (!startTs) startTs = now;
            const elapsed = now - startTs;

            // moveProgress: 0~1 (94% 시점까지 위치 이동)
            const moveProgress = Math.min(1, elapsed / MOVE_DURATION);
            const eased = easeOutCubic(moveProgress);

            // Quadratic Bezier: B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
            const u = 1 - eased;
            const uu = u * u;
            const tt = eased * eased;
            const u2t = 2 * u * eased;
            const x = uu * BALL_START.x + u2t * BALL_CTRL.x + tt * BALL_END.x;
            const y = uu * BALL_START.y + u2t * BALL_CTRL.y + tt * BALL_END.y;

            // Scale 보간
            const scale = SCALE_START + (SCALE_END - SCALE_START) * eased;

            // transform만 업데이트 (opacity는 CSS animation이 담당)
            ball.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;

            if (moveProgress < 1) {
                rafId = requestAnimationFrame(tick);
            } else {
                // 94% 도착 후 100%까지는 위치 고정 — JS는 종료.
                ball.style.transform = `translate3d(0, 0, 0) scale(${SCALE_END})`;
            }
        };

        rafId = requestAnimationFrame(tick);

        return () => {
            cancelled = true;
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    return (
        <div
            className="tysig-root"
            style={{
                ['--logo-size' as any]: 'clamp(112px, 28vw, 128px)',
                // 도착 지점을 로고 외곽 근처가 아니라 로고 내부 노란 공 중심 쪽으로 더 깊게 이동.
                // 360/390/430px 모두 로고 size 112~128px 기준 X ~5–7px / Y ~3–5px 안쪽.
                ['--ball-dx-ratio' as any]: '0.12',
                ['--ball-dy-ratio' as any]: '-0.16',
                // 공 크기: 기존 0.20 → 0.36 (약 1.8x). 형광 테니스공 존재감을 살리되 로고 전체를 덮지 않는 범위.
                ['--ball-size' as any]: 'calc(var(--logo-size) * 0.36)',
                // 도착 직전 scale — JS SCALE_END 와 동일.
                ['--ball-end-scale' as any]: '0.45',
            } as React.CSSProperties}
        >
            {/* 옅은 cool 배경 bloom */}
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    width: 340,
                    height: 340,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(100,120,200,0.06) 0%, transparent 68%)',
                    pointerEvents: 'none',
                }}
            />

            <div className="tysig-stage">
                {/* trail — 단순화된 quadratic curve, opacity 분리 fade */}
                <svg
                    className="tysig-trail"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                >
                    <path d="M 100 100 Q 55 75 68 30" />
                </svg>

                {/* 노란 공 — 이중 wrapper. anchor 고정, 내부 SVG는 rAF가 transform 갱신. */}
                <div className="tysig-ball-anchor" aria-hidden>
                    <svg
                        ref={ballRef}
                        className="tysig-ball"
                        viewBox="0 0 32 32"
                    >
                        <defs>
                            {/* 형광 테니스공 톤 */}
                            <radialGradient id="tysig-ball-grad" cx="36%" cy="30%" r="72%">
                                <stop offset="0%"  stopColor="#FFFED8" />
                                <stop offset="55%" stopColor="#E8FF52" />
                                <stop offset="100%" stopColor="#C9B91A" />
                            </radialGradient>
                        </defs>
                        <circle cx="16" cy="16" r="15" fill="url(#tysig-ball-grad)" />
                        <path
                            d="M 3 13 Q 16 4 29 13"
                            fill="none"
                            stroke="rgba(255,253,232,0.88)"
                            strokeWidth="1.1"
                            strokeLinecap="round"
                        />
                        <path
                            d="M 3 19 Q 16 28 29 19"
                            fill="none"
                            stroke="rgba(255,253,232,0.88)"
                            strokeWidth="1.1"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>

                {/* 로고 */}
                <Image
                    ref={imgRef as any}
                    className="tysig-logo"
                    src={logoSrc}
                    alt="TEYEON"
                    width={140}
                    height={140}
                    priority
                    onError={() => setLogoSrc(LOGO_FALLBACK)}
                />
            </div>

            <span className="tysig-tagline">테니스로 이어진 인연.</span>
        </div>
    );
}
