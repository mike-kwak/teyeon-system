'use client';

// Admin Console shell — PC: 좌측 Sidebar + 우측 콘텐츠 / 모바일: Header + BottomNav + 메뉴 시트.
//   접근 제어: 서버(middleware)가 1차 차단(CEO/ADMIN). 여기 클라이언트 가드는 2차(플래시 방지 + UX).
//   실제 데이터 보호는 각 테이블 RLS.

import React from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { X, ArrowLeft, ExternalLink } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AdminSidebar, { ADMIN_SIDEBAR_WIDTH } from '@/components/admin/AdminSidebar';
import AdminHeader from '@/components/admin/AdminHeader';
import AdminBottomNav from '@/components/admin/AdminBottomNav';
import { ADMIN_NAV_SECTIONS } from '@/components/admin/AdminNavConfig';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const { user, role, isLoading, signOut } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [menuOpen, setMenuOpen] = React.useState(false);

    const isAdminUser = role === 'CEO' || role === 'ADMIN';

    React.useEffect(() => {
        // auth 로딩/role 미확정 중에는 redirect 하지 않는다(새로고침 직후 CEO 가 튕기는 문제 방지).
        if (isLoading) return;
        // 로딩 완료 + (미로그인 또는 비관리자)일 때만 차단. 실제 차단은 서버(middleware)가 1차.
        if (!user || !isAdminUser) router.replace('/');
    }, [isLoading, user, isAdminUser, router]);

    // 라우트 이동 시 시트 닫기.
    React.useEffect(() => { setMenuOpen(false); }, [pathname]);

    if (isLoading) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2F7' }}>
                <div style={{ width: 36, height: 36, border: '3px solid #2563EB', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
        );
    }
    if (!isAdminUser) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2F7', padding: 24, textAlign: 'center' }}>
                <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0F172A' }}>관리자 전용 화면입니다.</p>
                    <Link href="/" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#2563EB' }}>← 일반 앱으로</Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100dvh', backgroundColor: '#EEF2F7' }}>
            <AdminSidebar />

            <div className="admin-content" style={{ minHeight: '100dvh' }}>
                <AdminHeader role={role} onMenu={() => setMenuOpen(true)} />
                <main className="admin-main">
                    {children}
                </main>
            </div>

            <AdminBottomNav onMenu={() => setMenuOpen(true)} />

            {/* 모바일 전체 메뉴 시트 */}
            {menuOpen && (
                <div
                    onClick={() => setMenuOpen(false)}
                    style={{ position: 'fixed', inset: 0, zIndex: 60, backgroundColor: 'rgba(15,27,51,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end' }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '100%', backgroundColor: '#0F1B33',
                            borderTopLeftRadius: 18, borderTopRightRadius: 18,
                            maxHeight: '82dvh', overflowY: 'auto',
                            paddingBottom: 'calc(16px + env(safe-area-inset-bottom))',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 18px 6px' }}>
                            <p style={{ flex: 1, margin: 0, fontSize: 14, fontWeight: 900, color: '#FFFFFF' }}>전체 메뉴</p>
                            <button type="button" onClick={() => setMenuOpen(false)} aria-label="닫기" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent', color: '#C7D2E3', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                                <X size={16} />
                            </button>
                        </div>
                        <div style={{ padding: '6px 12px 12px' }}>
                            {ADMIN_NAV_SECTIONS.map((section) => (
                                <div key={section.title} style={{ marginBottom: 14 }}>
                                    <p style={{ margin: '0 0 6px 10px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: '#7C8AA5' }}>{section.title}</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                        {section.items.map((item) => {
                                            const Icon = item.icon;
                                            return (
                                                <Link key={item.id} href={item.href} onClick={() => setMenuOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 12px', borderRadius: 12, textDecoration: 'none', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#C7D2E3', fontSize: 12.5, fontWeight: 700 }}>
                                                    <Icon size={16} style={{ flexShrink: 0 }} />
                                                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
                                                    {item.external && <ExternalLink size={11} style={{ opacity: 0.4 }} />}
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                <Link href="/" onClick={() => setMenuOpen(false)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: 12, textDecoration: 'none', backgroundColor: '#16264A', color: '#C7D2E3', fontSize: 12.5, fontWeight: 700 }}>
                                    <ArrowLeft size={15} /> 일반 앱으로
                                </Link>
                                <button type="button" onClick={async () => { setMenuOpen(false); try { await signOut(); } finally { router.replace('/'); } }} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent', color: '#8C99B3', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                                    로그아웃
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .admin-main { padding: 16px; padding-bottom: 96px; }
                @media (min-width: 1024px) {
                    .admin-content { padding-left: ${ADMIN_SIDEBAR_WIDTH}px; }
                    .admin-main { padding: 28px 32px 40px; }
                }
            `}</style>
        </div>
    );
}
