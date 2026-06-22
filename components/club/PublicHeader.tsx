'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

/**
 * /club 공개 페이지 전용 상단 브랜드 헤더.
 * 회원용 GlobalHeader 와 분리 — CEO 배지 / 프로필 사진 / 로그인 상태 노출 금지.
 *
 * - backHref 가 있으면 좌측에 뒤로 가기 버튼 (예: 서브 라우트).
 * - 홈(/club) 에서는 backHref 미지정 → 브랜드 마크만.
 */

interface PublicHeaderProps {
    /** 뒤로 가기 링크. 미지정이면 버튼 미표시 (예: /club 홈). */
    backHref?: string;
    /** 헤더 우측에 표시할 보조 노드 (예: 회원용 앱으로 이동 버튼). */
    rightSlot?: React.ReactNode;
}

export default function PublicHeader({ backHref, rightSlot }: PublicHeaderProps) {
    return (
        <header
            style={{
                position: 'sticky', top: 0, zIndex: 50,
                width: '100%',
                backgroundColor: 'rgba(255,255,255,0.94)',
                backdropFilter: 'saturate(160%) blur(10px)',
                WebkitBackdropFilter: 'saturate(160%) blur(10px)',
                borderBottom: '1px solid rgba(15,23,42,0.06)',
            }}
        >
            <div
                style={{
                    width: '100%', maxWidth: 430, margin: '0 auto',
                    paddingTop: 10, paddingRight: 14, paddingBottom: 10, paddingLeft: 14,
                    display: 'flex', alignItems: 'center', gap: 10,
                    boxSizing: 'border-box',
                }}
            >
                {backHref ? (
                    <Link
                        href={backHref}
                        aria-label="뒤로"
                        style={{
                            width: 32, height: 32, borderRadius: '50%',
                            border: '1px solid rgba(15,23,42,0.10)',
                            backgroundColor: '#FFFFFF',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            color: '#475569',
                            textDecoration: 'none',
                            flexShrink: 0,
                            WebkitTapHighlightColor: 'transparent',
                        }}
                    >
                        <ChevronLeft size={16} strokeWidth={2.2} />
                    </Link>
                ) : (
                    <div style={{ width: 32, height: 32, flexShrink: 0 }}>
                        <Image
                            src="/logos/teyeon-logo-current.png"
                            alt="TEYEON"
                            width={32}
                            height={32}
                            priority
                            style={{ objectFit: 'contain' }}
                        />
                    </div>
                )}

                <Link
                    href="/club"
                    style={{
                        display: 'flex', flexDirection: 'column',
                        textDecoration: 'none', minWidth: 0,
                    }}
                >
                    <span
                        style={{
                            fontFamily: 'var(--font-rajdhani), sans-serif',
                            fontSize: 9, fontWeight: 800, letterSpacing: '0.26em',
                            textTransform: 'uppercase', color: '#0E7C76',
                            lineHeight: 1.2,
                        }}
                    >
                        TEYEON TENNIS CLUB
                    </span>
                    <span
                        style={{
                            fontSize: 13, fontWeight: 900, color: '#0F172A',
                            letterSpacing: '-0.01em', lineHeight: 1.2,
                        }}
                    >
                        둘러보기
                    </span>
                </Link>

                {rightSlot && (
                    <div style={{ marginLeft: 'auto' }}>{rightSlot}</div>
                )}
            </div>
        </header>
    );
}
