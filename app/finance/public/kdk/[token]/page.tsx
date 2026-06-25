'use client';

// 비활성화 즉시 반영(캐시 금지·동적 렌더)과 noindex 메타는 같은 세그먼트의 server layout.tsx 에서 설정.
import React from 'react';
import { useParams } from 'next/navigation';
import { fetchPublicKdkNotice, type PublicKdkNoticeView } from '@/lib/finance/kdkNoticesService';
import PublicKdkNotice from '@/components/finance/PublicKdkNotice';

/**
 * /finance/public/kdk/[token] — KDK 벌금·상금 현황 공개 페이지(로그인 불필요).
 *   token 으로 get_public_kdk_notice RPC 조회. 비활성/없음이면 안내만 노출.
 *   BottomNav 는 /finance/public 경로에서 숨김.
 */
export default function PublicKdkNoticePage() {
    const params = useParams<{ token: string }>();
    const token = typeof params?.token === 'string' ? params.token : Array.isArray(params?.token) ? params!.token[0] : '';

    const [state, setState] = React.useState<'loading' | 'ready' | 'unavailable'>('loading');
    const [notice, setNotice] = React.useState<PublicKdkNoticeView | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!token) { setState('unavailable'); return; }
            const data = await fetchPublicKdkNotice(token);
            if (cancelled) return;
            if (!data) { setState('unavailable'); return; }
            setNotice(data);
            setState('ready');
        })();
        return () => { cancelled = true; };
    }, [token]);

    if (state === 'loading') {
        return (
            <main style={CENTER_STYLE}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8' }}>불러오는 중...</p>
            </main>
        );
    }

    if (state === 'unavailable' || !notice) {
        return (
            <main style={CENTER_STYLE}>
                <div style={{ textAlign: 'center', maxWidth: 360, padding: 24 }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-rajdhani), sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#0E7C76' }}>
                        TEYEON · KDK
                    </p>
                    <p style={{ margin: '14px 0 0', fontSize: 14, fontWeight: 800, color: '#0F172A', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                        현재 공개되지 않은 KDK 정산 공지입니다.
                    </p>
                    <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                        링크가 만료되었거나 비활성화되었을 수 있습니다. TEYEON 운영진에게 문의해 주세요.
                    </p>
                </div>
            </main>
        );
    }

    return <PublicKdkNotice notice={notice} />;
}

const CENTER_STYLE: React.CSSProperties = {
    width: '100%', minHeight: '100dvh', backgroundColor: '#F4F7F6',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
};
