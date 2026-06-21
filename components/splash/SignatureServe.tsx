'use client';

import React from 'react';
import Image from 'next/image';
import './signatureServe.css';

/**
 * TEYEON Signature Serve — 방식 B (fade)
 *
 * 타임라인 (총 약 2.0s, SplashScreen이 1500ms에 fade-out 시작):
 *   0ms    공 진입 시작 (offset-distance 0%)
 *   120ms  로고 fade-in 시작 (opacity 0 → 1)
 *   ~880ms 공이 도착 직전 (offset-distance 80%)
 *   ~960ms 공 fade-out (86%~96% 구간)
 *   ~980ms 안착 glow 1회 시작 (peak 0.18 alpha)
 *   ~1100ms 로고 scale 1.02 → 1.00 안착
 *   1320ms tagline fade-in 시작
 *   ~1680ms tagline 안착 완료
 *
 * 좌표 변수 (signatureServe.css 참고):
 *   --logo-size:        로고 한 변 길이 (rem 단위 권장)
 *   --ball-dx-ratio:    노란 공 중심 X 비율 (로고 wrapper 중심 기준)
 *                       +0.18 = 우측, -0.18 = 좌측
 *   --ball-dy-ratio:    노란 공 중심 Y 비율
 *                       -0.20 = 위쪽(눈처럼 약간 우상단)
 *
 * 360 / 390 / 430px 폭 대응:
 *   --logo-size를 clamp(112px, 28vw, 128px)로 설정
 *   공 도착 좌표는 비율로 계산되므로 폭이 바뀌어도 항상 노란 공 중심에 정확.
 */

const LOGO_SRC      = '/logos/teyeon-logo-transparent.png';
const LOGO_FALLBACK = '/logos/teyeon-logo-current.png';

interface SignatureServeProps {
    /** 부모 컴포넌트가 visible/hidden 제어용 wrapper 처리하므로 별도 prop 없음 */
}

export default function SignatureServe(_props: SignatureServeProps) {
    const [logoSrc, setLogoSrc] = React.useState(LOGO_SRC);

    return (
        <div
            className="tysig-root"
            style={{
                // CSS 변수 — 추후 노란 공 위치 미세조정은 여기 두 ratio만 수정.
                ['--logo-size' as any]: 'clamp(112px, 28vw, 128px)',
                ['--ball-dx-ratio' as any]: '0.18',   // 우측으로 18%
                ['--ball-dy-ratio' as any]: '-0.20',  // 위쪽으로 20% (눈 위치)
            } as React.CSSProperties}
        >
            {/* 아주 옅은 cool 배경 bloom — 기존 SplashScreen 톤 유지 */}
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

            {/* Stage — 로고 + 공 + trail 모두 이 안에 들어감. 공 좌표 기준점. */}
            <div className="tysig-stage">
                {/* trail SVG — 우하단 → 노란 공 좌표(로고 중심 +18%,-20%)까지 부드러운 quadratic.
                    viewBox 100x100 기준, stage가 어떤 크기든 동일한 곡선 유지. */}
                <svg
                    className="tysig-trail"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                >
                    {/* M (시작: 우하단 외곽) Q (제어점: 좌하단 곡선) (도착: 노란 공) */}
                    <path d="M 95 95 Q 40 75 68 30" />
                </svg>

                {/* 노란 공 */}
                <span className="tysig-ball" aria-hidden />

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
