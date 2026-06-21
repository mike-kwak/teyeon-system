'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import SignatureServe from './splash/SignatureServe';

type Phase = 'idle' | 'in' | 'out' | 'done';

/**
 * SplashScreen 컨테이너 — 등장/사라짐 + sessionStorage 1회 노출 + /kdk/display 제외.
 * 실제 모션은 SignatureServe(방식 B fade)가 담당.
 * 타임라인 (tagline 안착 ~1450ms 이후 overlay fade-out 시작):
 *   0ms     in 시작 (SignatureServe 자체 애니메이션 동시 시작)
 *   1700ms  out 시작 (overlay opacity 0, 450ms transition)
 *   2200ms  done — 컴포넌트 unmount
 *   체감 약 2.2초
 */
export default function SplashScreen() {
    const pathname = usePathname();
    const [phase, setPhase] = useState<Phase>('idle');

    useEffect(() => {
        if (pathname?.startsWith('/kdk/display')) return;
        // Guest Pass 공개 랜딩에서는 메인 앱 Splash 띄우지 않음 (GuestPassIntro가 별도 담당).
        if (pathname?.startsWith('/guest/pass')) return;

        try {
            if (sessionStorage.getItem('teyeon_splash_v1')) return;
            sessionStorage.setItem('teyeon_splash_v1', '1');
        } catch {
            return;
        }

        setPhase('in');

        const fadeOut = setTimeout(() => setPhase('out'), 1700);
        const done    = setTimeout(() => setPhase('done'), 2200);

        return () => {
            clearTimeout(fadeOut);
            clearTimeout(done);
        };
    }, [pathname]);

    if (phase === 'idle' || phase === 'done') return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9998,
                backgroundColor: '#F2F4F7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 450ms cubic-bezier(0.4,0,0.2,1)',
                opacity: phase === 'out' ? 0 : 1,
                pointerEvents: phase === 'out' ? 'none' : 'auto',
            }}
        >
            <SignatureServe />
        </div>
    );
}
