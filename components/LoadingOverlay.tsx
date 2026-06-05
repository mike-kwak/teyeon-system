'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLoading } from '@/context/LoadingContext';

const LOGO_SRC = '/logos/teyeon-logo-transparent.png';

export default function LoadingOverlay() {
    const pathname = usePathname();
    const { isLoading } = useLoading();
    const [mounted, setMounted] = useState(false);
    const [visible, setVisible] = useState(false);
    const showRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (isLoading) {
            if (hideRef.current) clearTimeout(hideRef.current);
            setMounted(true);
            // 100ms 지연 — 짧은 로딩은 overlay 표시 안 함
            showRef.current = setTimeout(() => setVisible(true), 100);
        } else {
            if (showRef.current) clearTimeout(showRef.current);
            setVisible(false);
            // fade-out 완료(200ms) 후 DOM에서 제거
            hideRef.current = setTimeout(() => setMounted(false), 220);
        }
        return () => {
            if (showRef.current) clearTimeout(showRef.current);
            if (hideRef.current) clearTimeout(hideRef.current);
        };
    }, [isLoading]);

    if (pathname?.startsWith('/kdk/display')) return null;
    if (!mounted) return null;

    return (
        <>
            <style>{`@keyframes loading-spin{to{transform:rotate(360deg)}}`}</style>
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9000,
                    backgroundColor: '#F2F4F7',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '14px',
                    transition: 'opacity 200ms cubic-bezier(0.4,0,0.2,1)',
                    opacity: visible ? 1 : 0,
                    pointerEvents: visible ? 'auto' : 'none',
                }}
                aria-hidden={!visible}
            >
                <Image
                    src={LOGO_SRC}
                    alt="TEYEON"
                    width={120}
                    height={120}
                    priority
                    style={{
                        objectFit: 'contain',
                        width: 'clamp(112px, 28vw, 128px)',
                        height: 'clamp(112px, 28vw, 128px)',
                        filter: 'drop-shadow(0 2px 8px rgba(60,70,120,0.10))',
                    }}
                />
                <span
                    style={{
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.3em',
                        textTransform: 'uppercase',
                        color: 'rgba(55,65,95,0.45)',
                    }}
                >
                    TEYEON 준비 중...
                </span>
                <div
                    style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        border: '1.5px solid rgba(55,65,95,0.12)',
                        borderTopColor: 'rgba(55,65,95,0.42)',
                        animation: 'loading-spin 0.75s linear infinite',
                    }}
                />
            </div>
        </>
    );
}
