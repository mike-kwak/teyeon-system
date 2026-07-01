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
        // TEYEON 공개 둘러보기(/club)는 외부 방문자 대상이라 회원용 Splash 미노출.
        if (pathname === '/club' || pathname?.startsWith('/club/')) return;

        try {
            // 6시간 이내 재진입(LIVE COURT 복귀 등)은 Splash 생략. PWA/앱 종료로 sessionStorage 가
            // 지워져도 localStorage 타임스탬프로 스킵되며, 6시간 경과(대개 다음 날 첫 진입) 시에만
            // Signature Serve 를 다시 재생한다. (Splash 구조·애니메이션은 변경하지 않음)
            const SPLASH_KEY = 'teyeon_splash_last_shown';
            const SPLASH_WINDOW_MS = 6 * 60 * 60 * 1000;
            const last = Number(window.localStorage.getItem(SPLASH_KEY) || 0);
            if (Number.isFinite(last) && last > 0 && Date.now() - last < SPLASH_WINDOW_MS) return;
            window.localStorage.setItem(SPLASH_KEY, String(Date.now()));
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
