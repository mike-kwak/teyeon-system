'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import PublicHeader from '@/components/club/PublicHeader';
import ProfileAvatar from '@/components/ProfileAvatar';
import { InitialAvatar } from '@/components/tournament/InitialAvatar';
import {
    fetchPublicMembers,
    type PublicMember,
} from '@/lib/publicClubService';

/**
 * /club/members — TEYEON 멤버 공개 디렉토리.
 * profiles.profile_visibility_level = 'public' 인 회원만 RPC 에서 반환.
 */

export default function ClubMembersPublicPage() {
    const [items, setItems] = React.useState<PublicMember[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const rows = await fetchPublicMembers();
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
                        멤버 프로필
                    </h1>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
                        공개 설정된 멤버만 표시됩니다.
                    </p>
                </div>

                {loading && (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        멤버를 불러오는 중...
                    </p>
                )}
                {!loading && items.length === 0 && (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>
                        공개된 멤버가 아직 없습니다.
                    </p>
                )}

                <ul
                    style={{
                        listStyle: 'none', padding: 0, margin: 0,
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9,
                    }}
                >
                    {items.map((m, idx) => (
                        <li
                            key={`${m.nickname}-${idx}`}
                            style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                paddingTop: 14, paddingRight: 12, paddingBottom: 14, paddingLeft: 12,
                                borderRadius: 14,
                                backgroundColor: '#FFFFFF',
                                border: '1px solid rgba(0,0,0,0.06)',
                                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                            }}
                        >
                            <div style={{ width: 56, height: 56 }}>
                                {m.avatarUrl ? (
                                    <ProfileAvatar
                                        src={m.avatarUrl}
                                        alt="프로필 이미지"
                                        size={56}
                                        className="rounded-full"
                                        fallbackIcon={<InitialAvatar name={m.nickname} size={56} />}
                                    />
                                ) : (
                                    <InitialAvatar name={m.nickname} size={56} />
                                )}
                            </div>
                            <p style={{
                                margin: '10px 0 0', fontSize: 13, fontWeight: 800, color: '#0F172A',
                                textAlign: 'center', wordBreak: 'keep-all',
                            }}>
                                {m.nickname}
                            </p>
                            {m.role && (m.role === 'CEO' || m.role === 'ADMIN') && (
                                <span style={{
                                    marginTop: 4,
                                    fontSize: 8.5, fontWeight: 800, letterSpacing: '0.06em',
                                    paddingTop: 1, paddingBottom: 1, paddingLeft: 5, paddingRight: 5,
                                    borderRadius: 4,
                                    backgroundColor: 'rgba(15,159,152,0.10)',
                                    color: '#0E7C76',
                                    border: '1px solid rgba(15,159,152,0.22)',
                                }}>
                                    {m.role}
                                </span>
                            )}
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
