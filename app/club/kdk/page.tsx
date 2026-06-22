'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { Swords, ChevronRight } from 'lucide-react';
import PublicHeader from '@/components/club/PublicHeader';
import {
    fetchPublicKdkSessions,
    type PublicKdkSessionListItem,
} from '@/lib/publicClubService';

/**
 * /club/kdk — TEYEON KDK 공식 기록 공개 목록.
 * 공식 확정 세션만 노출. 미확정/테스트 데이터 외부 공개 금지.
 */

function formatDateKo(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function ClubKdkPublicPage() {
    const [items, setItems] = React.useState<PublicKdkSessionListItem[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const rows = await fetchPublicKdkSessions(30);
            if (!cancelled) {
                setItems(rows);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    return (
        <main style={pageStyle}>
            <PublicHeader backHref="/club" />
            <div style={containerStyle}>
                <div style={{ marginBottom: 4 }}>
                    <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
                        KDK 경기
                    </h1>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
                        TEYEON 공식 KDK 기록입니다.
                    </p>
                </div>

                {loading && <Empty>불러오는 중...</Empty>}
                {!loading && items.length === 0 && (
                    <Empty>공개된 KDK 경기 기록이 아직 없습니다.</Empty>
                )}

                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {items.map((s) => (
                        <li key={s.sessionId}>
                            <Link
                                href={`/club/kdk/${encodeURIComponent(s.sessionId)}`}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    paddingTop: 14, paddingRight: 14, paddingBottom: 14, paddingLeft: 14,
                                    borderRadius: 14,
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                                    textDecoration: 'none',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                <span style={{
                                    width: 36, height: 36, flexShrink: 0,
                                    borderRadius: 10,
                                    backgroundColor: 'rgba(15,159,152,0.10)',
                                    color: '#0F9F98',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Swords size={18} strokeWidth={1.8} />
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: 13, fontWeight: 800, color: '#0F172A',
                                            letterSpacing: '-0.01em', wordBreak: 'keep-all',
                                        }}>
                                            {s.title}
                                        </span>
                                        <span style={{
                                            fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em',
                                            paddingTop: 1, paddingBottom: 1, paddingLeft: 5, paddingRight: 5,
                                            borderRadius: 4,
                                            backgroundColor: 'rgba(15,159,152,0.10)',
                                            color: '#0E7C76',
                                            border: '1px solid rgba(15,159,152,0.22)',
                                        }}>
                                            공식
                                        </span>
                                    </div>
                                    <p style={{
                                        margin: '3px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8',
                                    }}>
                                        {formatDateKo(s.createdAt)}
                                    </p>
                                </div>
                                <ChevronRight size={16} strokeWidth={2} style={{ color: '#CBD5E1' }} />
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </main>
    );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
        {children}
    </p>
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
    paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 16,
    display: 'flex', flexDirection: 'column', gap: 12,
    boxSizing: 'border-box',
};
