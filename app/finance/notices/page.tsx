'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { canManageFinance } from '@/lib/finance/getFinancePermissions';
import {
    listPublicNotices,
    deactivatePublicNotice,
    type FinancePublicNotice,
} from '@/lib/finance/noticesService';
import {
    FinancePageHeader,
    FINANCE_PAGE_STYLE,
    FINANCE_CONTAINER_STYLE,
    FINANCE_CARD_STYLE,
} from '@/components/finance/FinanceCommon';
import FinanceNoticeCard from '@/components/finance/FinanceNoticeCard';

/**
 * /finance/notices — 회원 공지(미납 현황 공개 링크) 관리 목록.
 *   생성은 /finance/payments 의 "회원 공지 만들기" 에서. 여기서는 목록/복사/비활성화.
 */
export default function FinanceNoticesPage() {
    const { role, isLoading } = useAuth();
    const isAdmin = canManageFinance(role);

    const [notices, setNotices] = React.useState<FinancePublicNotice[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [busyId, setBusyId] = React.useState<string | null>(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setNotices(await listPublicNotices());
        setLoading(false);
    }, []);

    React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

    const handleDeactivate = async (id: string) => {
        setBusyId(id);
        try {
            await deactivatePublicNotice(id);
            await load();
        } catch (e: any) {
            alert(e?.message || '비활성화에 실패했습니다.');
        } finally {
            setBusyId(null);
        }
    };

    if (!isLoading && !isAdmin) {
        return (
            <main style={FINANCE_PAGE_STYLE}>
                <div style={{ ...FINANCE_CONTAINER_STYLE, paddingTop: 80, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>운영자만 접근할 수 있는 페이지입니다.</p>
                    <Link href="/finance" style={{ display: 'inline-block', marginTop: 12, fontSize: 12, fontWeight: 700, color: '#0E7C76' }}>
                        ← TEYEON 재무
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main style={FINANCE_PAGE_STYLE}>
            <div style={FINANCE_CONTAINER_STYLE}>
                <FinancePageHeader
                    eyebrow="TEYEON · FINANCE"
                    title="회원 공지"
                    subtitle="미납 현황 공개 링크를 관리합니다."
                    backHref="/finance/payments"
                />

                <section style={{ ...FINANCE_CARD_STYLE, backgroundColor: '#F8FAFC' }}>
                    <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: '#64748B', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                        공지 링크는 <strong style={{ color: '#0F172A' }}>납부 현황</strong> 화면의 “회원 공지 만들기”에서 생성합니다.
                        생성 시점의 미납 현황이 스냅샷으로 고정되어, 이후 납부 데이터가 바뀌어도 링크 내용은 변하지 않습니다.
                    </p>
                </section>

                {loading && <p style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8' }}>불러오는 중...</p>}

                {!loading && notices.length === 0 && (
                    <p style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: '#94A3B8', padding: '24px 0' }}>
                        아직 생성된 공지가 없습니다.
                    </p>
                )}

                {!loading && notices.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {notices.map((n) => (
                            <FinanceNoticeCard
                                key={n.id}
                                notice={n}
                                busy={busyId === n.id}
                                onDeactivate={handleDeactivate}
                            />
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
