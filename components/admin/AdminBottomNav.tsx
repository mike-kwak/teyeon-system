'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_BOTTOM_NAV } from './AdminNavConfig';

/** 모바일 전용 Admin BottomNav(데스크톱은 Sidebar). safe-area 적용. */
export default function AdminBottomNav({ onMenu }: { onMenu: () => void }) {
    const pathname = usePathname();
    return (
        <nav
            className="lg:hidden"
            style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
                display: 'flex',
                backgroundColor: '#0F1B33',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                paddingBottom: 'env(safe-area-inset-bottom)',
            }}
        >
            {ADMIN_BOTTOM_NAV.map((item) => {
                const Icon = item.icon;
                const active = item.href === '/admin' && pathname === '/admin';
                const content = (
                    <span style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                        paddingTop: 9, paddingBottom: 9,
                        color: active ? '#7DD3FC' : '#8C99B3',
                    }}>
                        <Icon size={20} />
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.02em' }}>{item.label}</span>
                    </span>
                );
                if (item.action === 'open-menu') {
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={onMenu}
                            style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                            {content}
                        </button>
                    );
                }
                return (
                    <Link key={item.id} href={item.href || '/admin'} style={{ flex: 1, textDecoration: 'none' }}>
                        {content}
                    </Link>
                );
            })}
        </nav>
    );
}
