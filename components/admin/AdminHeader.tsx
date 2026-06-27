'use client';

import React from 'react';
import { Menu as MenuIcon } from 'lucide-react';

/** 모바일 전용 Admin 상단 헤더(데스크톱은 Sidebar + 페이지 자체 헤더 사용). */
export default function AdminHeader({ role, onMenu }: { role: string | null; onMenu: () => void }) {
    return (
        <header
            className="flex lg:hidden"
            style={{
                position: 'sticky', top: 0, zIndex: 30,
                alignItems: 'center', gap: 10,
                paddingTop: 'calc(10px + env(safe-area-inset-top))',
                paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
                backgroundColor: '#0F1B33',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}
        >
            <button
                type="button"
                onClick={onMenu}
                aria-label="메뉴"
                style={{
                    width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)',
                    color: '#C7D2E3', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                }}
            >
                <MenuIcon size={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 9, fontWeight: 800, letterSpacing: '0.28em', color: '#38BDF8' }}>
                    TEYEON
                </p>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                    ADMIN
                </p>
            </div>
            {role && (
                <span style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
                    paddingTop: 4, paddingBottom: 4, paddingLeft: 9, paddingRight: 9, borderRadius: 999,
                    backgroundColor: 'rgba(56,189,248,0.14)', color: '#7DD3FC', border: '1px solid rgba(56,189,248,0.3)',
                }}>
                    {role}
                </span>
            )}
        </header>
    );
}
