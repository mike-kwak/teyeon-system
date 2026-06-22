'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getTeyeonInstagramUrl } from '@/lib/publicClubService';

/**
 * Guest Pass 카드 하단 공개 CTA.
 * Preview / token 페이지에서 동일하게 노출.
 *
 * - 'TEYEON 앱 둘러보기' → /club (공개 둘러보기 홈)
 * - '공식 인스타그램' → instagram (새 창, noopener noreferrer)
 *   URL 이 없으면 인스타 버튼 숨김.
 */
export default function GuestPassFooterCta() {
    const igUrl = getTeyeonInstagramUrl();
    return (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link
                href="/club"
                style={ctaButton(false)}
            >
                TEYEON 앱 둘러보기
                <ArrowUpRight size={14} strokeWidth={2} style={{ color: '#0E7C76' }} />
            </Link>
            {igUrl && (
                <a
                    href={igUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={ctaButton(true)}
                >
                    <InstagramGlyph size={15} color="#0F172A" />
                    공식 인스타그램
                    <ArrowUpRight size={13} strokeWidth={2} style={{ color: '#94A3B8' }} />
                </a>
            )}
        </div>
    );
}

const InstagramGlyph = ({ size, color }: { size: number; color: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill={color} stroke="none" />
    </svg>
);

const ctaButton = (extraGap: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: extraGap ? 8 : 6,
    width: '100%', height: 48,
    borderRadius: 12,
    border: '1px solid rgba(15,23,42,0.10)',
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 13, fontWeight: 800, letterSpacing: '-0.01em',
    textDecoration: 'none',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
});
