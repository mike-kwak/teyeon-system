'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useParams } from 'next/navigation';
import GuestPassCard from '@/components/guest/GuestPassCard';
import GuestPassIntro from '@/components/guest/GuestPassIntro';
import type { GuestPassData } from '@/lib/guestPassData';
import { buildGuestPassDataFromToken } from '@/lib/guestPassService';

/**
 * /guest/pass/[token] — 공개 Guest Pass 페이지 (비로그인 가능, 읽기 전용).
 *
 * 흐름:
 *   1) URL token → Supabase fetch (is_active=true 인 row 만 RLS 통과)
 *   2) defaults + club_schedules + perMeet 병합 → GuestPassData
 *   3) GuestPassCard 재사용 렌더
 *   4) 토큰 미스매치 / 비활성 / 만료 → '현재 사용할 수 없는 게스트 안내 링크입니다' 안내
 *
 * 첫 방문에는 GuestPassIntro overlay 표시 (preview 와 동일 패턴, token 별 분리).
 * GlobalHeader / BottomNav / SplashScreen 은 /guest/pass* pathname 가드로 자동 숨김.
 */

const SS_KEY_PREFIX = 'teyeon_guest_pass_intro_token_';

export default function GuestPassTokenPage() {
    const params = useParams<{ token: string }>();
    const token = params?.token || '';

    const [data, setData] = React.useState<GuestPassData | null>(null);
    const [loadStatus, setLoadStatus] = React.useState<'loading' | 'ok' | 'not_found'>('loading');
    const [introVisible, setIntroVisible] = React.useState(false);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        try {
            const key = SS_KEY_PREFIX + token;
            if (token && !sessionStorage.getItem(key)) {
                sessionStorage.setItem(key, '1');
                setIntroVisible(true);
            }
        } catch {
            setIntroVisible(true);
        }
    }, [token]);

    React.useEffect(() => {
        if (!token) {
            setLoadStatus('not_found');
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const built = await buildGuestPassDataFromToken(token);
                if (cancelled) return;
                if (!built) {
                    setLoadStatus('not_found');
                } else {
                    setData(built);
                    setLoadStatus('ok');
                }
            } catch (err) {
                if (cancelled) return;
                console.warn('[GuestPass/[token]] fetch failed:', err);
                setLoadStatus('not_found');
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    // ── 무효 / 만료 / 비활성 토큰 안내 ─────────────────────────────────────
    if (loadStatus === 'not_found') {
        return (
            <main
                style={{
                    width: '100%', minHeight: '100dvh',
                    backgroundColor: '#F2F4F7',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    paddingLeft: 20, paddingRight: 20,
                    paddingTop: 'env(safe-area-inset-top)',
                    paddingBottom: 'calc(40px + env(safe-area-inset-bottom))',
                }}
            >
                <div
                    style={{
                        width: '100%', maxWidth: 420,
                        backgroundColor: '#FFFFFF',
                        borderRadius: 16,
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
                        paddingTop: 28, paddingBottom: 28,
                        paddingLeft: 22, paddingRight: 22,
                        textAlign: 'center',
                    }}
                >
                    <p
                        style={{
                            margin: 0,
                            fontFamily: 'var(--font-rajdhani), sans-serif',
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.26em',
                            textTransform: 'uppercase', color: '#94A3B8',
                        }}
                    >
                        TEYEON GUEST PASS
                    </p>
                    <h1
                        style={{
                            margin: '14px 0 8px',
                            fontSize: 17, fontWeight: 900, color: '#0F172A',
                            letterSpacing: '-0.02em', lineHeight: 1.35,
                            wordBreak: 'keep-all',
                        }}
                    >
                        현재 사용할 수 없는 게스트 안내 링크입니다
                    </h1>
                    <p
                        style={{
                            margin: 0,
                            fontSize: 12.5, fontWeight: 600, color: '#64748B',
                            lineHeight: 1.6, wordBreak: 'keep-all',
                        }}
                    >
                        초대한 회원 또는 TEYEON 운영진에게 최신 링크를 요청해 주세요.
                    </p>
                </div>
            </main>
        );
    }

    // ── 로딩 ───────────────────────────────────────────────────────────────
    if (loadStatus === 'loading' || !data) {
        return (
            <main
                style={{
                    width: '100%', minHeight: '100dvh',
                    backgroundColor: '#F2F4F7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                <p
                    style={{
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: 11, fontWeight: 800, letterSpacing: '0.20em',
                        textTransform: 'uppercase', color: '#94A3B8',
                    }}
                >
                    LOADING...
                </p>
            </main>
        );
    }

    // ── 정상 렌더 ───────────────────────────────────────────────────────────
    return (
        <>
            <GuestPassCard data={data} />
            {mounted && introVisible && (
                <GuestPassIntro onDone={() => setIntroVisible(false)} />
            )}
        </>
    );
}
