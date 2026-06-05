'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

type Phase = 'idle' | 'in' | 'out' | 'done';

const LOGO_SRC      = '/logos/teyeon-logo-transparent.png';
const LOGO_FALLBACK = '/logos/teyeon-logo-current.png';

export default function SplashScreen() {
    const pathname = usePathname();
    const [phase, setPhase] = useState<Phase>('idle');
    const [logoSrc, setLogoSrc] = useState(LOGO_SRC);

    useEffect(() => {
        if (pathname?.startsWith('/kdk/display')) return;

        try {
            if (sessionStorage.getItem('teyeon_splash_v1')) return;
            sessionStorage.setItem('teyeon_splash_v1', '1');
        } catch {
            return;
        }

        setPhase('in');

        const fadeOut = setTimeout(() => setPhase('out'), 1500);
        const done    = setTimeout(() => setPhase('done'), 1960);

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
                backgroundColor: '#F2F4F7',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '28px',
                transition: 'opacity 450ms cubic-bezier(0.4,0,0.2,1)',
                opacity: phase === 'out' ? 0 : 1,
                pointerEvents: phase === 'out' ? 'none' : 'auto',
            }}
        >
            {/* Subtle cool radial bloom — barely visible on light bg */}
            <div
                style={{
                    position: 'absolute',
                    width: '340px',
                    height: '340px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(100,120,200,0.06) 0%, transparent 68%)',
                    pointerEvents: 'none',
                }}
            />

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '18px',
                    position: 'relative',
                    transition: 'opacity 450ms cubic-bezier(0.4,0,0.2,1), transform 450ms cubic-bezier(0.4,0,0.2,1)',
                    opacity: phase === 'out' ? 0 : 1,
                    transform: phase === 'out' ? 'scale(1.02) translateY(-2px)' : 'scale(1) translateY(0)',
                }}
            >
                <Image
                    src={logoSrc}
                    alt="TEYEON"
                    width={140}
                    height={140}
                    priority
                    onError={() => setLogoSrc(LOGO_FALLBACK)}
                    style={{
                        objectFit: 'contain',
                        width: 'clamp(100px, 30vw, 140px)',
                        height: 'clamp(100px, 30vw, 140px)',
                        filter: 'drop-shadow(0 2px 8px rgba(60,70,120,0.10))',
                    }}
                />
                <span
                    style={{
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.32em',
                        textTransform: 'uppercase',
                        color: 'rgba(55,65,95,0.45)',
                    }}
                >
                    테니스로 이어진 인연
                </span>
            </div>
        </div>
    );
}
