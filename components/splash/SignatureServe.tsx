'use client';

import React from 'react';
import Image from 'next/image';
import './signatureServe.css';

/**
 * TEYEON Signature Serve — 방식 B (fade)
 *
 * 좌표 방식 (재설계):
 *   - 공을 stage(=로고 wrapper) 안에 absolute로 배치하고
 *     도착점을 left/top으로 노란 공 중심에 직접 고정한다.
 *   - keyframe은 `translate(-50%, -50%)`를 baseline으로 두고,
 *     stage 우하단 offset(px)을 더해 시작/중간 위치를 표현한다.
 *   - offset-path는 사용하지 않는다 (브라우저별 anchor 차이로 좌표가 어긋나는 문제).
 *
 * 좌표 변수 (signatureServe.css 참고):
 *   --logo-size:        로고 한 변 (px, clamp으로 360/390/430 대응)
 *   --ball-dx-ratio:    노란 공 중심 X 비율 (stage 중심 기준, +우측)
 *   --ball-dy-ratio:    노란 공 중심 Y 비율 (stage 중심 기준, -위쪽)
 *   --ball-size:        flyball 크기 (px). 도착 전 이동 중 크기 ~ 로고의 18%.
 *   --ball-end-scale:   도착 직전 축소 비율 (≈로고 속 공 크기)
 *
 * 타임라인:
 *   0~10%   공 진입 (우하단 멀리서)
 *   60%     stage 중앙 위쪽으로 접근
 *   85%     노란 공 코앞
 *   94%     노란 공 중심 도달 + 축소 시작
 *   97%     opacity 0.8
 *   100%    opacity 0 (노란 공과 합쳐짐)
 */

const LOGO_SRC      = '/logos/teyeon-logo-transparent.png';
const LOGO_FALLBACK = '/logos/teyeon-logo-current.png';

export default function SignatureServe() {
    const [logoSrc, setLogoSrc] = React.useState(LOGO_SRC);

    return (
        <div
            className="tysig-root"
            style={{
                // CSS 변수 — 좌표 미세조정은 ratio 두 값만 수정하면 됨.
                ['--logo-size' as any]: 'clamp(112px, 28vw, 128px)',
                ['--ball-dx-ratio' as any]: '0.18',   // 노란 공 X (+우측 18%)
                ['--ball-dy-ratio' as any]: '-0.20',  // 노란 공 Y (-위쪽 20%)
                ['--ball-size' as any]: 'calc(var(--logo-size) * 0.20)',      // 이동 중 크기 (로고의 20%)
                ['--ball-end-scale' as any]: '0.55',                          // 도착 직전 축소 (실효 ~11%)
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

            {/* Stage — 로고와 ball 모두 이 안에 들어감. 좌표 원점. */}
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

                {/* 노란 공 (테니스공 SVG — 본체 + seam 2줄) */}
                <svg
                    className="tysig-ball"
                    viewBox="0 0 32 32"
                    aria-hidden
                >
                    <defs>
                        <radialGradient id="tysig-ball-grad" cx="38%" cy="32%" r="68%">
                            <stop offset="0%"  stopColor="#FFF8C2" />
                            <stop offset="55%" stopColor="#E9D04A" />
                            <stop offset="100%" stopColor="#B68A12" />
                        </radialGradient>
                    </defs>
                    <circle cx="16" cy="16" r="15" fill="url(#tysig-ball-grad)" />
                    {/* seam 곡선 2개 — 진짜 테니스공처럼 위/아래로 곡선이 흐름 */}
                    <path
                        d="M 3 13 Q 16 4 29 13"
                        fill="none"
                        stroke="rgba(255,253,232,0.82)"
                        strokeWidth="1.1"
                        strokeLinecap="round"
                    />
                    <path
                        d="M 3 19 Q 16 28 29 19"
                        fill="none"
                        stroke="rgba(255,253,232,0.82)"
                        strokeWidth="1.1"
                        strokeLinecap="round"
                    />
                </svg>

                {/* 로고 */}
                <Image
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
