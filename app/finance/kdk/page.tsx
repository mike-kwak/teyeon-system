'use client';

export const dynamic = 'force-dynamic';

// Finance → KDK 벌금 관리: 공식 KDK 세션 목록 → 세션별 정산(/finance/kdk/[sessionId]).
//   권한: 기존 Finance 관리자(canManageFinance)만. 일반 회원·게스트에게는 목록/수치를 조회하지도 노출하지도 않는다.
//   데이터: 공식 Archive 스냅샷만 읽는다(벌금 계산·납부 데이터 변경 없음).

import React from 'react';
import Link from 'next/link';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import { formatWon } from '@/lib/finance/formatFinanceAmount';
import { listOfficialKdkSessions, type KdkSessionListItem } from '@/lib/finance/kdkSessionListService';
import {
    FinancePageHeader,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';

const NAVY = '#0F172A';
const TEAL = '#0F9F98';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; items: KdkSessionListItem[] };

export default function FinanceKdkSessionsPage() {
    const { user, role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);
    const [state, setState] = React.useState<LoadState>({ kind: 'loading' });

    const load = React.useCallback(async () => {
        setState({ kind: 'loading' });
        try {
            const items = await listOfficialKdkSessions();
            setState({ kind: 'ready', items });
        } catch (e: any) {
            // 실패를 "공식 세션 0건"으로 보여주지 않는다.
            setState({ kind: 'error', message: e?.message || 'KDK 세션 목록을 불러오지 못했습니다.' });
        }
    }, []);

    React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

    if (isLoading) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>LOADING...</p>
                </div>
            </main>
        );
    }

    if (!user || !isAdmin) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: NAVY }}>
                        {!user ? '로그인이 필요합니다.' : '운영자만 접근할 수 있는 페이지입니다.'}
                    </p>
                    <Link href="/finance" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>← Finance</Link>
                </div>
            </main>
        );
    }

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="KDK 벌금 관리"
                    subtitle="공식 KDK 세션을 선택해 회원·게스트 벌금을 정산합니다."
                    backHref="/finance"
                />

                {/* 누적 조회(읽기 전용) 진입 — 세션별 정산은 아래 목록에서 그대로 진행. */}
                <Link
                    href="/finance/kdk/history"
                    style={{
                        ...FINANCE_CARD_STYLE,
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 12px 12px 14px', textDecoration: 'none', color: 'inherit', minWidth: 0,
                        borderColor: 'rgba(15,159,152,0.22)',
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 900, color: NAVY }}>누적 벌금 현황</p>
                        <p style={{ margin: '3px 0 0', fontSize: 11, fontWeight: 600, color: '#64748B', wordBreak: 'keep-all' }}>
                            회원·게스트별 KDK 벌금과 납부 내역을 확인합니다.
                        </p>
                    </div>
                    <span style={{
                        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 2,
                        height: 30, padding: '0 8px 0 10px', borderRadius: 9,
                        background: TEAL, color: '#FFFFFF', fontSize: 11.5, fontWeight: 900, whiteSpace: 'nowrap',
                    }}>
                        보기 <ChevronRight size={14} />
                    </span>
                </Link>

                {state.kind === 'loading' && (
                    <p style={{ margin: '24px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#94A3B8' }}>불러오는 중...</p>
                )}

                {state.kind === 'error' && (
                    <section style={{ ...FINANCE_CARD_STYLE, borderColor: 'rgba(185,28,28,0.18)', backgroundColor: '#FFF7F7' }} role="alert">
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 900, color: '#B91C1C' }}>세션 목록을 불러오지 못했습니다</p>
                        <p style={{ margin: '6px 0 0', fontSize: 11.5, fontWeight: 600, color: '#7F1D1D', wordBreak: 'break-word' }}>
                            {state.message}
                        </p>
                        <p style={{ margin: '6px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                            공식 세션이 없는 것이 아니라 조회에 실패한 상태입니다.
                        </p>
                        <button
                            type="button"
                            onClick={load}
                            style={{
                                marginTop: 10, height: 36, padding: '0 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                                background: TEAL, color: '#FFFFFF', fontSize: 12, fontWeight: 800,
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <RefreshCw size={13} /> 다시 시도
                        </button>
                    </section>
                )}

                {state.kind === 'ready' && (
                    <>
                        <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: '#64748B' }}>
                            공식 KDK 세션 <strong style={{ color: NAVY }}>{state.items.length}</strong>개 · 최신순 · 테스트·미확정 기록 제외
                        </p>
                        {state.items.length === 0 ? (
                            <section style={{ ...FINANCE_CARD_STYLE, textAlign: 'center' }}>
                                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>공식 확정된 KDK 세션이 없습니다.</p>
                            </section>
                        ) : (
                            <SessionList items={state.items} />
                        )}
                    </>
                )}
            </div>
        </main>
    );
}

function SessionList({ items }: { items: KdkSessionListItem[] }) {
    let lastYear = '';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((s) => {
                const year = (s.date || '').slice(0, 4);
                const showYear = year !== lastYear;
                lastYear = year;
                return (
                    <React.Fragment key={s.id}>
                        {showYear && (
                            <p style={{ margin: '6px 2px 0', fontSize: 11, fontWeight: 900, color: '#64748B', letterSpacing: '0.04em' }}>
                                {year || '날짜 미상'}
                            </p>
                        )}
                        <SessionRow s={s} />
                    </React.Fragment>
                );
            })}
        </div>
    );
}

function SessionRow({ s }: { s: KdkSessionListItem }) {
    const dateLabel = s.date ? s.date.replace(/-/g, '.') : '날짜 미상';
    const stats: string[] = [];
    if (s.participantCount != null) stats.push(`참가 ${s.participantCount}명`);
    if (s.penaltyTargetCount != null) {
        stats.push(`벌금 ${s.penaltyTargetCount}명${s.guestPenaltyCount ? `(게스트 ${s.guestPenaltyCount})` : ''}`);
    } else {
        stats.push('정산 스냅샷 없음');
    }
    return (
        <Link
            href={`/finance/kdk/${encodeURIComponent(s.id)}`}
            style={{
                ...FINANCE_CARD_STYLE,
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 12px 12px 14px', textDecoration: 'none', color: 'inherit',
                minWidth: 0,
            }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: NAVY, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{dateLabel}</span>
                    <span style={{
                        fontSize: 9.5, fontWeight: 900, color: '#0E7C76', background: 'rgba(15,159,152,0.10)',
                        padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap',
                    }}>공식</span>
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 11, fontWeight: 600, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                </p>
                <p style={{ margin: '5px 0 0', fontSize: 11, fontWeight: 700, color: '#475569', display: 'flex', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
                    {stats.map((t) => <span key={t} style={{ whiteSpace: 'nowrap' }}>{t}</span>)}
                    {s.penaltyTotal != null && s.penaltyTotal > 0 && (
                        <span style={{ whiteSpace: 'nowrap', color: NAVY, fontWeight: 900 }}>{formatWon(s.penaltyTotal)}</span>
                    )}
                </p>
            </div>
            <span style={{
                flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 2,
                height: 30, padding: '0 8px 0 10px', borderRadius: 9,
                background: 'rgba(15,159,152,0.10)', color: '#0E7C76', fontSize: 11.5, fontWeight: 900, whiteSpace: 'nowrap',
            }}>
                정산 <ChevronRight size={14} />
            </span>
        </Link>
    );
}
