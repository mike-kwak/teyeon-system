'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

type Phase = 'idle' | 'in' | 'out' | 'done';

export default function SplashScreen() {
    const pathname = usePathname();
    const [phase, setPhase] = useState<Phase>('idle');

    useEffect(() => {
        if (pathname?.startsWith('/kdk/display')) return;

        try {
            if (sessionStorage.getItem('teyeon_splash_v1')) return;
            sessionStorage.setItem('teyeon_splash_v1', '1');
        } catch {
            return;
        }

        setPhase('in');

        const fadeOut = setTimeout(() => setPhase('out'), 1100);
        const done = setTimeout(() => setPhase('done'), 1500);

        return () => {
            clearTimeout(fadeOut);
            clearTimeout(done);
        };
    }, []);

    if (phase === 'idle' || phase === 'done') return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9998,
                backgroundColor: '#0D0D0B',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '28px',
                transition: 'opacity 420ms cubic-bezier(0.4,0,0.2,1)',
                opacity: phase === 'out' ? 0 : 1,
                pointerEvents: phase === 'out' ? 'none' : 'auto',
            }}
        >
            {/* Subtle radial glow behind logo */}
            <div
                style={{
                    position: 'absolute',
                    width: '320px',
                    height: '320px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(216,190,120,0.07) 0%, transparent 70%)',
                    pointerEvents: 'none',
                }}
            />

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '20px',
                    position: 'relative',
                    transition: 'opacity 420ms cubic-bezier(0.4,0,0.2,1), transform 420ms cubic-bezier(0.4,0,0.2,1)',
                    opacity: phase === 'out' ? 0 : 1,
                    transform: phase === 'out' ? 'scale(1.02) translateY(-2px)' : 'scale(1) translateY(0)',
                }}
            >
                <Image
                    src="/logos/teyeon-logo-current.png"
                    alt="TEYEON"
                    width={180}
                    height={90}
                    priority
                    style={{
                        objectFit: 'contain',
                        maxWidth: '64vw',
                        height: 'auto',
                        filter: 'drop-shadow(0 4px 24px rgba(216,190,120,0.18))',
                    }}
                />
                <span
                    style={{
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.32em',
                        textTransform: 'uppercase',
                        color: 'rgba(216,190,120,0.42)',
                    }}
                >
                    테니스로 이어진 인연
                </span>
            </div>
        </div>
    );
}
