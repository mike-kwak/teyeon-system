'use client';

// PC 촬영용 커서 하이라이트 + 클릭 ripple overlay.
//   - pointer-events: none (클릭 방해 금지). aria-hidden. z-index 최상.
//   - mouse(pointerType==='mouse') 에서만 동작. touch/pen 무시. 모바일 비활성.
//   - prefers-reduced-motion 시 ripple 애니메이션 생략.

import React from 'react';

const SIZE_PX: Record<string, number> = { sm: 24, md: 30, lg: 38 };
const COLOR: Record<string, string> = { accent: '#0E7C76', red: '#DC2626' };

interface Ripple { id: number; x: number; y: number }

export default function RecordingCursorOverlay({ size, color, ripple }: { size: 'sm' | 'md' | 'lg'; color: 'accent' | 'red'; ripple: boolean }) {
    const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
    const [ripples, setRipples] = React.useState<Ripple[]>([]);
    const reduced = React.useRef(false);
    const seq = React.useRef(0);

    React.useEffect(() => {
        try { reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }

        const onMove = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            setPos({ x: e.clientX, y: e.clientY });
        };
        const onDown = (e: PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            if (!ripple || reduced.current) return;
            const id = ++seq.current;
            setRipples((r) => [...r, { id, x: e.clientX, y: e.clientY }]);
            window.setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 600);
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerdown', onDown, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerdown', onDown);
        };
    }, [ripple]);

    const d = SIZE_PX[size] || 30;
    const c = COLOR[color] || COLOR.accent;

    return (
        <div aria-hidden className="hidden lg:block" style={{ position: 'fixed', inset: 0, zIndex: 2147483601, pointerEvents: 'none', overflow: 'hidden' }}>
            {pos && (
                <div style={{
                    position: 'fixed', left: pos.x, top: pos.y, width: d, height: d,
                    transform: 'translate(-50%, -50%)', borderRadius: '50%',
                    border: `2px solid ${c}`, backgroundColor: `${c}22`, boxShadow: `0 0 0 1px rgba(255,255,255,0.55)`,
                }} />
            )}
            {ripples.map((r) => (
                <span key={r.id} style={{
                    position: 'fixed', left: r.x, top: r.y, width: d, height: d,
                    transform: 'translate(-50%, -50%)', borderRadius: '50%', border: `2px solid ${c}`,
                    animation: 'teyeon-rec-ripple 0.6s ease-out forwards',
                }} />
            ))}
            <style>{`
                @keyframes teyeon-rec-ripple {
                    0%   { opacity: 0.6; transform: translate(-50%, -50%) scale(0.6); }
                    100% { opacity: 0;   transform: translate(-50%, -50%) scale(2.6); }
                }
                @media (prefers-reduced-motion: reduce) {
                    span[style*="teyeon-rec-ripple"] { animation: none !important; }
                }
            `}</style>
        </div>
    );
}
