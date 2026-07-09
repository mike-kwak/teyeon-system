'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getVisibleAdminNavSections } from './AdminNavConfig';

const NAVY = '#0F1B33';
const NAVY_SOFT = '#16264A';
const TEXT = '#C7D2E3';
const TEXT_DIM = '#7C8AA5';
const ACTIVE_BG = 'rgba(56,189,248,0.14)';
const ACTIVE_TEXT = '#7DD3FC';

export const ADMIN_SIDEBAR_WIDTH = 248;

function isActive(pathname: string | null, href: string): boolean {
    if (!pathname) return false;
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(href + '/');
}

export default function AdminSidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, role, signOut, canManageRanking } = useAuth();
    const adminName = (user?.user_metadata?.nickname as string) || user?.email?.split('@')[0] || '관리자';
    const initial = adminName.trim().charAt(0) || 'A';
    const handleLogout = async () => {
        try { await signOut(); } finally { router.replace('/'); }
    };
    return (
        <aside
            className="hidden lg:flex"
            style={{
                position: 'fixed', top: 0, left: 0, bottom: 0,
                width: ADMIN_SIDEBAR_WIDTH,
                backgroundColor: NAVY,
                borderRight: '1px solid rgba(255,255,255,0.06)',
                flexDirection: 'column',
                zIndex: 40,
            }}
        >
            {/* 브랜드 */}
            <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 10, fontWeight: 800, letterSpacing: '0.32em', color: '#38BDF8' }}>
                    TEYEON
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 17, fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                    ADMIN CONSOLE
                </p>
            </div>

            {/* 메뉴 */}
            <nav style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
                {getVisibleAdminNavSections(role, { canManageRanking }).map((section) => (
                    <div key={section.title} style={{ marginBottom: 18 }}>
                        <p style={{ margin: '0 0 8px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: TEXT_DIM }}>
                            {section.title}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {section.items.map((item) => {
                                const active = isActive(pathname, item.href);
                                const Icon = item.icon;
                                return (
                                    <Link
                                        key={item.id}
                                        href={item.href}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 11,
                                            padding: '9px 11px', borderRadius: 10,
                                            textDecoration: 'none',
                                            backgroundColor: active ? ACTIVE_BG : 'transparent',
                                            color: active ? ACTIVE_TEXT : TEXT,
                                            fontSize: 13, fontWeight: active ? 800 : 600,
                                        }}
                                    >
                                        <Icon size={17} style={{ flexShrink: 0, opacity: active ? 1 : 0.85 }} />
                                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.label}
                                        </span>
                                        {item.external && <ExternalLink size={12} style={{ opacity: 0.4, flexShrink: 0 }} />}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            {/* 관리자 프로필 + 보조 액션(일반 앱 이동 / 로그아웃) */}
            <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 10px' }}>
                    <span style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                        backgroundColor: NAVY_SOFT, color: ACTIVE_TEXT, border: '1px solid rgba(56,189,248,0.25)',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 900,
                    }}>
                        {initial}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: '#FFFFFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {adminName}
                        </p>
                        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: TEXT_DIM }}>
                            {role || 'ADMIN'} · 운영
                        </p>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4 }}>
                    <Link href="/" style={{ fontSize: 11.5, fontWeight: 700, color: TEXT, textDecoration: 'none' }}>
                        일반 앱으로 이동
                    </Link>
                    <span style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>
                    <button type="button" onClick={handleLogout} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: TEXT_DIM }}>
                        로그아웃
                    </button>
                </div>
            </div>
        </aside>
    );
}
