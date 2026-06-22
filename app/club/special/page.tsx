'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Layout } from 'lucide-react';
import PublicHeader from '@/components/club/PublicHeader';
import {
    fetchPublicSpecialSessions,
    type PublicSpecialSession,
} from '@/lib/publicClubService';

/**
 * /club/special — 스페셜 매치 공개 목록 (읽기 전용).
 * 세션 제목 + 마지막 업데이트만 노출 (관리 액션, 점수, 명단 미포함).
 */

function formatDateKo(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function ClubSpecialPublicPage() {
    const [items, setItems] = React.useState<PublicSpecialSession[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const rows = await fetchPublicSpecialSessions(20);
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
                        스페셜 매치
                    </h1>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
                        TEYEON 의 특별 매치 운영 기록입니다.
                    </p>
                </div>

                {loading && (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        불러오는 중...
                    </p>
                )}
                {!loading && items.length === 0 && (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        공개된 스페셜 매치가 아직 없습니다.
                    </p>
                )}

                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {items.map((s) => (
                        <li
                            key={s.sessionId}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                paddingTop: 14, paddingRight: 14, paddingBottom: 14, paddingLeft: 14,
                                borderRadius: 14,
                                backgroundColor: '#FFFFFF',
                                border: '1px solid rgba(0,0,0,0.06)',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                            }}
                        >
                            <span style={{
                                width: 36, height: 36, flexShrink: 0,
                                borderRadius: 10,
                                backgroundColor: 'rgba(15,159,152,0.10)',
                                color: '#0F9F98',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Layout size={18} strokeWidth={1.8} />
                            </span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{
                                    margin: 0, fontSize: 13, fontWeight: 800, color: '#0F172A',
                                    letterSpacing: '-0.01em', wordBreak: 'keep-all',
                                }}>
                                    {s.title}
                                </p>
                                <p style={{
                                    margin: '3px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8',
                                }}>
                                    {formatDateKo(s.updatedAt)}
                                </p>
                            </div>
                        </li>
                    ))}
                </ul>
            </div>
        </main>
    );
}

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
