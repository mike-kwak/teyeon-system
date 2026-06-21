'use client';

import React from 'react';
import Image from 'next/image';
import './guestPassIntro.css';

/**
 * TEYEON Guest Pass Intro — Signature Serve (방식 B 짧은 변형).
 *
 * 메인 SignatureServe(components/splash/SignatureServe.tsx) 의 시각 자산을 동일 기준으로 유지하되
 * Guest Pass에 맞춰 더 짧은 타이밍(약 1.45s) + 전용 tagline 만 다르게 적용한 최소 복제 컴포넌트.
 * 메인 Splash CSS와는 .gpi-* namespace로 격리.
 *
 * 타임라인:
 *   0~150ms    배경 fade-in, 로고 fade-in 시작
 *   150~800ms  공 Bezier 이동 (650ms)
 *   800~950ms  공 fade-out + scale 축소, 로고 약한 pop
 *   950~1200ms tagline "TEYEON 정모에 초대합니다" fade-in
 *   1200~1450ms overlay opacity 0
 *   ~1450ms    unmount (호출자가 처리)
 *
 * reduced-motion: 공/glow 생략, 로고/tagline 단순 fade로 ~700ms 이내 종료.
 *
 * sessionStorage 키와 표시 여부는 호출자(preview 페이지)가 결정.
 * 이 컴포넌트는 마운트되면 즉시 애니메이션 시작 + onDone 콜백을 unmount 시각에 호출.
 */

const LOGO_SRC      = '/logos/teyeon-logo-current.png';
const LOGO_FALLBACK = '/logos/teyeon-logo-transparent.png';

// 메인 SignatureServe와 동일한 Bezier 좌표/스케일 (브랜드 일관성).
const BALL_START = { x: 180, y: 180 };
const BALL_CTRL  = { x: 60,  y: -8 };
const BALL_END   = { x: 0,   y: 0 };
const SCALE_START = 0.92;
const SCALE_END   = 0.55;

// 타이밍 (메인 1100ms → Guest 950ms 단축. overlay fade 별도 250ms).
const MOVE_DURATION = 650;   // 150~800ms 구간 = 0.65s
const MOVE_DELAY    = 150;   // 배경/로고 등장 후 시작

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

interface GuestPassIntroProps {
    /** overlay가 완전히 unmount 되어야 할 시각에 호출 (호출자가 setState로 unmount). */
    onDone?: () => void;
    /** overlay fade-out 시작 ms (mount 기준). 기본 1200. */
    overlayFadeOutAt?: number;
    /** overlay unmount 시각 ms (mount 기준). 기본 1450. */
    overlayUnmountAt?: number;
}

export default function GuestPassIntro({
    onDone,
    overlayFadeOutAt = 1200,
    overlayUnmountAt = 1450,
}: GuestPassIntroProps) {
    const [logoSrc, setLogoSrc] = React.useState(LOGO_SRC);
    const [phase, setPhase] = React.useState<'in' | 'out'>('in');
    const imgRef  = React.useRef<HTMLImageElement | null>(null);
    const ballRef = React.useRef<SVGSVGElement | null>(null);

    // 로고 decode hint — 첫 프레임 jank 방지.
    React.useEffect(() => {
        const el = imgRef.current;
        if (!el) return;
        if (typeof el.decode === 'function') {
            el.decode().catch(() => { /* noop */ });
        }
    }, [logoSrc]);

    // overlay fade-out → unmount 타이머.
    React.useEffect(() => {
        const fadeT = window.setTimeout(() => setPhase('out'), overlayFadeOutAt);
        const doneT = window.setTimeout(() => { onDone?.(); }, overlayUnmountAt);
        return () => {
            window.clearTimeout(fadeT);
            window.clearTimeout(doneT);
        };
    }, [overlayFadeOutAt, overlayUnmountAt, onDone]);

    // rAF Bezier 모션 — reduced-motion이면 실행하지 않음.
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

            // MOVE_DELAY 이전: 시작 위치 유지
            if (elapsed < MOVE_DELAY) {
                ball.style.transform = `translate3d(${BALL_START.x}px, ${BALL_START.y}px, 0) scale(${SCALE_START})`;
                rafId = requestAnimationFrame(tick);
                return;
            }

            const moveElapsed = elapsed - MOVE_DELAY;
            const moveProgress = Math.min(1, moveElapsed / MOVE_DURATION);
            const eased = easeOutCubic(moveProgress);

            // Quadratic Bezier
            const u = 1 - eased;
            const uu = u * u;
            const tt = eased * eased;
            const u2t = 2 * u * eased;
            const x = uu * BALL_START.x + u2t * BALL_CTRL.x + tt * BALL_END.x;
            const y = uu * BALL_START.y + u2t * BALL_CTRL.y + tt * BALL_END.y;
            const scale = SCALE_START + (SCALE_END - SCALE_START) * eased;

            ball.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(3)})`;

            if (moveProgress < 1) {
                rafId = requestAnimationFrame(tick);
            } else {
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
            className="gpi-overlay"
            style={{
                opacity: phase === 'out' ? 0 : 1,
                pointerEvents: phase === 'out' ? 'none' : 'auto',
            }}
            aria-hidden
        >
            <div
                className="gpi-root"
                style={{
                    ['--gpi-logo-size' as any]: 'clamp(112px, 28vw, 128px)',
                    ['--gpi-ball-dx-ratio' as any]: '0.18',
                    ['--gpi-ball-dy-ratio' as any]: '-0.20',
                    ['--gpi-ball-size' as any]: 'calc(var(--gpi-logo-size) * 0.20)',
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

                <div className="gpi-stage">
                    <div className="gpi-ball-anchor" aria-hidden>
                        <svg
                            ref={ballRef}
                            className="gpi-ball"
                            viewBox="0 0 32 32"
                        >
                            <defs>
                                <radialGradient id="gpi-ball-grad" cx="36%" cy="30%" r="72%">
                                    <stop offset="0%"  stopColor="#FFFED8" />
                                    <stop offset="55%" stopColor="#E8FF52" />
                                    <stop offset="100%" stopColor="#C9B91A" />
                                </radialGradient>
                            </defs>
                            <circle cx="16" cy="16" r="15" fill="url(#gpi-ball-grad)" />
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

                    <Image
                        ref={imgRef as any}
                        className="gpi-logo"
                        src={logoSrc}
                        alt="TEYEON"
                        width={140}
                        height={140}
                        priority
                        onError={() => setLogoSrc(LOGO_FALLBACK)}
                    />
                </div>

                <span className="gpi-tagline">TEYEON 정모에 초대합니다</span>
            </div>
        </div>
    );
}
