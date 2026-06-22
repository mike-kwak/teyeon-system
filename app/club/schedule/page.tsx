'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { Calendar, Clock, MapPin } from 'lucide-react';
import PublicHeader from '@/components/club/PublicHeader';
import {
    fetchPublicClubSchedules,
    type PublicClubSchedule,
} from '@/lib/publicClubService';

const TYPE_STYLE: Record<string, { bg: string; color: string; border: string }> = {
    '정모':      { bg: 'rgba(99,102,241,0.09)',  color: '#3730A3', border: 'rgba(99,102,241,0.28)' },
    '번개':      { bg: 'rgba(245,158,11,0.09)',  color: '#92400E', border: 'rgba(245,158,11,0.24)' },
    '단체전 연습': { bg: 'rgba(16,185,129,0.09)', color: '#065F46', border: 'rgba(16,185,129,0.24)' },
    '회식':      { bg: 'rgba(239,68,68,0.09)',   color: '#991B1B', border: 'rgba(239,68,68,0.22)' },
    '기타':      { bg: 'rgba(100,116,139,0.09)', color: '#334155', border: 'rgba(100,116,139,0.20)' },
};

function formatDateKo(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y) return date;
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${m}월 ${d}일 (${days[dt.getDay()]})`;
}

function formatTimeRange(start: string | null, end: string | null): string {
    if (start && end) return `${start} ~ ${end}`;
    if (start) return `${start} 시작`;
    if (end) return `~ ${end}`;
    return '';
}

export default function ClubScheduleListPage() {
    const [items, setItems] = React.useState<PublicClubSchedule[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const rows = await fetchPublicClubSchedules({ pastDays: 14, futureDays: 60 });
            if (!cancelled) {
                setItems(rows);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // 정렬: 예정 일정이 위, 완료(isPast=true) 아래.
    const sorted = React.useMemo(() => {
        return [...items].sort((a, b) => {
            if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
            const ak = `${a.date}T${a.startTime || ''}`;
            const bk = `${b.date}T${b.startTime || ''}`;
            return a.isPast ? bk.localeCompare(ak) : ak.localeCompare(bk);
        });
    }, [items]);

    return (
        <main style={pageStyle}>
            <PublicHeader backHref="/club" />
            <div style={containerStyle}>
                <SectionTitle title="TEYEON 일정" subtitle="정모·번개·연습 일정" />

                {loading && <Empty>일정을 불러오는 중...</Empty>}
                {!loading && sorted.length === 0 && <Empty>표시할 일정이 없습니다.</Empty>}

                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {sorted.map((it) => {
                        const ts = TYPE_STYLE[it.type] ?? TYPE_STYLE['기타'];
                        return (
                            <li
                                key={it.id}
                                style={{
                                    borderRadius: 14,
                                    backgroundColor: '#FFFFFF',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                                    padding: 14,
                                    opacity: it.isPast ? 0.72 : 1,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <span style={{
                                        fontSize: 9, fontWeight: 800,
                                        paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
                                        borderRadius: 4,
                                        backgroundColor: ts.bg, color: ts.color,
                                        border: `1px solid ${ts.border}`,
                                    }}>
                                        {it.type}
                                    </span>
                                    {it.isPast && (
                                        <span style={{
                                            fontSize: 9, fontWeight: 800,
                                            paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6,
                                            borderRadius: 4,
                                            backgroundColor: 'rgba(100,116,139,0.10)',
                                            color: '#475569',
                                            border: '1px solid rgba(100,116,139,0.22)',
                                        }}>
                                            완료
                                        </span>
                                    )}
                                </div>
                                <p style={{
                                    margin: 0, fontSize: 14, fontWeight: 800, color: '#0F172A',
                                    letterSpacing: '-0.01em', wordBreak: 'keep-all',
                                }}>
                                    {it.title}
                                </p>
                                <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <Info icon={<Calendar size={11} />}>{formatDateKo(it.date)}</Info>
                                    {(it.startTime || it.endTime) && (
                                        <Info icon={<Clock size={11} />}>{formatTimeRange(it.startTime, it.endTime)}</Info>
                                    )}
                                    {it.location && (
                                        <Info icon={<MapPin size={11} />}>
                                            {it.location}
                                            {it.courtCount ? ` · 코트 ${it.courtCount}면` : ''}
                                        </Info>
                                    )}
                                </ul>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </main>
    );
}

const SectionTitle = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em' }}>
            {title}
        </h1>
        <p style={{ margin: '2px 0 0', fontSize: 11.5, fontWeight: 600, color: '#64748B' }}>
            {subtitle}
        </p>
    </div>
);

const Info = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
    <li style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: '#475569' }}>
        <span style={{ color: '#94A3B8', flexShrink: 0 }}>{icon}</span>
        <span style={{ wordBreak: 'keep-all' }}>{children}</span>
    </li>
);

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
