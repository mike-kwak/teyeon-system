'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
    Swords, CalendarDays, Layout, Users,
    ChevronRight, ArrowUpRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import PublicHeader from '@/components/club/PublicHeader';
import { getTeyeonInstagramUrl } from '@/lib/publicClubService';

/**
 * /club — TEYEON 공개 둘러보기 홈.
 * 비로그인 / 게스트 / 회원 누구나 동일 화면. 로그인 회원에게는 우상단에
 * '회원용 앱' 보조 버튼만 추가 노출 (로그인 강요 X).
 */

interface MenuItem {
    label: string;
    description: string;
    icon: React.ReactNode;
    href: string;
    accent: 'teal' | 'aqua' | 'gold';
    badge?: string;
}

const ACCENT = {
    teal: {
        icon: '#0F9F98', iconBg: 'rgba(15,159,152,0.10)', line: 'rgba(15,159,152,0.30)',
        badgeBg: 'rgba(15,159,152,0.09)', badgeFg: '#0E8079', badgeBd: 'rgba(15,159,152,0.22)',
    },
    aqua: {
        icon: '#4B9DB6', iconBg: 'rgba(75,157,182,0.10)', line: 'rgba(75,157,182,0.32)',
        badgeBg: 'rgba(75,157,182,0.09)', badgeFg: '#386F82', badgeBd: 'rgba(75,157,182,0.24)',
    },
    gold: {
        icon: '#C79A32', iconBg: 'rgba(199,154,50,0.10)', line: 'rgba(199,154,50,0.32)',
        badgeBg: 'rgba(199,154,50,0.10)', badgeFg: '#8E6B17', badgeBd: 'rgba(199,154,50,0.24)',
    },
} as const;

const MENU: MenuItem[] = [
    {
        label: 'KDK 경기',
        description: '대진과 경기 결과를 둘러볼 수 있습니다.',
        icon: <Swords size={21} strokeWidth={1.7} />,
        href: '/club/kdk',
        accent: 'teal',
        badge: 'KDK',
    },
    {
        label: 'TEYEON 일정',
        description: '정모와 클럽 일정을 한곳에서 확인합니다.',
        icon: <CalendarDays size={21} strokeWidth={1.7} />,
        href: '/club/schedule',
        accent: 'aqua',
        badge: 'SCHEDULE',
    },
    {
        label: '스페셜 매치',
        description: '특별 매치 운영 결과를 보여드립니다.',
        icon: <Layout size={21} strokeWidth={1.7} />,
        href: '/club/special',
        accent: 'teal',
    },
    {
        label: '멤버 프로필',
        description: '클럽 멤버를 둘러보세요.',
        icon: <Users size={21} strokeWidth={1.7} />,
        href: '/club/members',
        accent: 'aqua',
    },
];

export default function ClubPublicHomePage() {
    const { user, isLoading } = useAuth();

    return (
        <main style={pageStyle}>
            <PublicHeader
                rightSlot={user && !isLoading ? (
                    <Link
                        href="/"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            height: 30, paddingLeft: 10, paddingRight: 10,
                            borderRadius: 999,
                            border: '1px solid rgba(15,23,42,0.10)',
                            backgroundColor: '#FFFFFF',
                            color: '#0F172A',
                            fontSize: 11, fontWeight: 800,
                            textDecoration: 'none',
                            WebkitTapHighlightColor: 'transparent',
                        }}
                    >
                        회원용 앱 <ArrowUpRight size={12} />
                    </Link>
                ) : null}
            />

            <div style={containerStyle}>
                {/* ── Hero ─────────────────────────────────────────────────── */}
                <section
                    style={{
                        position: 'relative',
                        borderRadius: 18,
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, #0E5A55 0%, #117268 55%, #1B8A7F 100%)',
                        boxShadow: '0 6px 20px rgba(14, 90, 85, 0.20)',
                        paddingTop: 24, paddingRight: 20, paddingBottom: 22, paddingLeft: 20,
                        color: '#FFFFFF',
                    }}
                >
                    <svg
                        aria-hidden
                        viewBox="0 0 120 120"
                        style={{
                            position: 'absolute',
                            right: -32, top: -32,
                            width: 200, height: 200,
                            opacity: 0.06,
                            pointerEvents: 'none',
                        }}
                    >
                        <circle cx="60" cy="60" r="48" fill="#FFFFFF" />
                        <path d="M 18 50 Q 60 18 102 50" fill="none" stroke="#FFFFFF" strokeWidth="2" />
                        <path d="M 18 70 Q 60 102 102 70" fill="none" stroke="#FFFFFF" strokeWidth="2" />
                    </svg>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                        <div
                            style={{
                                width: 52, height: 52, borderRadius: 13, flexShrink: 0,
                                backgroundColor: 'rgba(255,255,255,0.10)',
                                border: '1px solid rgba(255,255,255,0.18)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <Image
                                src="/logos/teyeon-logo-current.png"
                                alt="TEYEON"
                                width={40}
                                height={40}
                                priority
                                style={{ objectFit: 'contain' }}
                            />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <p style={{
                                margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif',
                                fontSize: 9.5, fontWeight: 800, letterSpacing: '0.26em',
                                textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)',
                            }}>
                                TEYEON TENNIS CLUB
                            </p>
                            <p style={{
                                margin: '4px 0 0', fontSize: 13.5, fontWeight: 700, color: '#FFFFFF',
                                letterSpacing: '-0.01em', lineHeight: 1.25,
                            }}>
                                테니스로 이어진 인연.
                            </p>
                        </div>
                    </div>
                    <p style={{
                        margin: 0, fontSize: 14.5, fontWeight: 800, color: '#FFFFFF',
                        letterSpacing: '-0.01em', lineHeight: 1.45,
                        wordBreak: 'keep-all',
                    }}>
                        TEYEON의 일정과 경기를 둘러보세요.
                    </p>
                </section>

                {/* ── Menu cards ───────────────────────────────────────────── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {MENU.map((m) => {
                        const c = ACCENT[m.accent];
                        return (
                            <Link
                                key={m.href}
                                href={m.href}
                                style={{
                                    position: 'relative',
                                    display: 'flex', alignItems: 'center', gap: 14,
                                    borderRadius: 14,
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    boxShadow: '0 1px 5px rgba(0,0,0,0.05)',
                                    paddingTop: 13, paddingRight: 14, paddingBottom: 13, paddingLeft: 14,
                                    textDecoration: 'none',
                                    overflow: 'hidden',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                {/* 좌측 accent 라인 */}
                                <span
                                    aria-hidden
                                    style={{
                                        position: 'absolute', left: 0, top: 12, bottom: 12,
                                        width: 3, borderRadius: 3,
                                        backgroundColor: c.line,
                                    }}
                                />
                                <span
                                    style={{
                                        width: 38, height: 38, flexShrink: 0,
                                        borderRadius: 10,
                                        backgroundColor: c.iconBg,
                                        color: c.icon,
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                >
                                    {m.icon}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: 14, fontWeight: 900, color: '#0F172A',
                                            letterSpacing: '-0.01em',
                                        }}>
                                            {m.label}
                                        </span>
                                        {m.badge && (
                                            <span style={{
                                                fontSize: 8.5, fontWeight: 800, letterSpacing: '0.08em',
                                                paddingTop: 1, paddingBottom: 1, paddingLeft: 6, paddingRight: 6,
                                                borderRadius: 4,
                                                backgroundColor: c.badgeBg,
                                                color: c.badgeFg,
                                                border: `1px solid ${c.badgeBd}`,
                                            }}>
                                                {m.badge}
                                            </span>
                                        )}
                                    </div>
                                    <p style={{
                                        margin: '3px 0 0',
                                        fontSize: 11.5, fontWeight: 600, color: '#64748B',
                                        lineHeight: 1.4, wordBreak: 'keep-all',
                                    }}>
                                        {m.description}
                                    </p>
                                </div>
                                <ChevronRight size={16} strokeWidth={2} style={{ color: '#CBD5E1', flexShrink: 0 }} />
                            </Link>
                        );
                    })}
                </div>

                {/* ── 공식 인스타그램 ───────────────────────────────────────── */}
                <a
                    href={getTeyeonInstagramUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        height: 44, borderRadius: 12,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid rgba(15,23,42,0.10)',
                        color: '#0F172A',
                        fontSize: 12.5, fontWeight: 800,
                        letterSpacing: '-0.01em',
                        textDecoration: 'none',
                        WebkitTapHighlightColor: 'transparent',
                    }}
                >
                    <InstagramGlyph />
                    공식 인스타그램
                    <ArrowUpRight size={13} strokeWidth={2} style={{ color: '#94A3B8' }} />
                </a>

                {/* ── 푸터 brand mark ──────────────────────────────────────── */}
                <p
                    style={{
                        margin: '4px 0 0',
                        textAlign: 'center',
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.32em',
                        textTransform: 'uppercase', color: '#CBD5E1',
                    }}
                >
                    TEYEON TENNIS CLUB
                </p>
            </div>
        </main>
    );
}

const InstagramGlyph = ({ size = 15, color = 'currentColor' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill={color} stroke="none" />
    </svg>
);

const pageStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '100dvh',
    backgroundColor: '#F2F4F7',
    paddingBottom: 'calc(36px + env(safe-area-inset-bottom))',
};

const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 430,
    margin: '0 auto',
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    boxSizing: 'border-box',
};
