'use client';

import React from 'react';
import Image from 'next/image';
import './signatureServe.css';

/**
 * TEYEON Signature Serve — 방식 B (fade)
 *
 * 좌표 방식 (이중 wrapper):
 *   - `.tysig-ball-anchor`: 도착점(노란 공 중심)에 left/top + translate(-50%,-50%)로 고정.
 *   - `.tysig-ball`        : anchor 내부에서 translate3d만으로 이동. 도착 시 (0,0,0).
 *     → keyframe이 % 없이 px만 다루므로 GPU 합성 안정.
 *
 * 좌표 변수 (signatureServe.css 참고):
 *   --logo-size:        로고 한 변 (px)
 *   --ball-dx-ratio:    노란 공 중심 X 비율 (+우측)
 *   --ball-dy-ratio:    노란 공 중심 Y 비율 (-위쪽)
 *   --ball-size:        flyball 크기 (px). 이동 중 크기.
 *   --ball-end-scale:   도착 직전 축소 비율 (≈로고 속 공 크기로 합쳐짐)
 *
 * 색상 (형광 테니스공 톤):
 *   highlight: #FFFED8 → main: #E8FF52 → deeper: #C9B91A
 *   로고 내부 노란 공은 별도 변경 없음 (이미지 그대로).
 */

const LOGO_SRC      = '/logos/teyeon-logo-transparent.png';
const LOGO_FALLBACK = '/logos/teyeon-logo-current.png';

export default function SignatureServe() {
    const [logoSrc, setLogoSrc] = React.useState(LOGO_SRC);
    const imgRef = React.useRef<HTMLImageElement | null>(null);

    // 로고 이미지를 애니메이션 시작 전에 명시적으로 decode → 첫 프레임 jank 방지.
    // next/image의 priority만으로는 decode 시점이 보장되지 않음.
    React.useEffect(() => {
        const el = imgRef.current;
        if (!el) return;
        if (typeof el.decode === 'function') {
            el.decode().catch(() => { /* noop — 기본 paint로 폴백 */ });
        }
    }, [logoSrc]);

    return (
        <div
            className="tysig-root"
            style={{
                ['--logo-size' as any]: 'clamp(112px, 28vw, 128px)',
                ['--ball-dx-ratio' as any]: '0.18',
                ['--ball-dy-ratio' as any]: '-0.20',
                ['--ball-size' as any]: 'calc(var(--logo-size) * 0.20)',
                ['--ball-end-scale' as any]: '0.55',
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
                {/* trail — viewBox 100x100, ball 경로와 유사한 quadratic curve */}
                <svg
                    className="tysig-trail"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                >
                    <path d="M 100 100 Q 55 75 68 30" />
                </svg>

                {/* 노란 공 — 이중 wrapper.
                    anchor가 도착점에 고정, 내부 SVG가 translate3d로 이동. */}
                <div className="tysig-ball-anchor" aria-hidden>
                    <svg
                        className="tysig-ball"
                        viewBox="0 0 32 32"
                    >
                        <defs>
                            {/* 형광 테니스공 톤 — highlight → main yellow → deeper */}
                            <radialGradient id="tysig-ball-grad" cx="36%" cy="30%" r="72%">
                                <stop offset="0%"  stopColor="#FFFED8" />
                                <stop offset="55%" stopColor="#E8FF52" />
                                <stop offset="100%" stopColor="#C9B91A" />
                            </radialGradient>
                        </defs>
                        <circle cx="16" cy="16" r="15" fill="url(#tysig-ball-grad)" />
                        {/* seam 곡선 2개 — 흰색~크림색, 그대로 유지 */}
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
