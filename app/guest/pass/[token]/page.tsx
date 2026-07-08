'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useParams } from 'next/navigation';
import GuestPassCard from '@/components/guest/GuestPassCard';
import GuestPassIntro from '@/components/guest/GuestPassIntro';
import GuestPassFooterCta from '@/components/guest/GuestPassFooterCta';
import type { GuestPassData, GuestPassMatchStatus } from '@/lib/guestPassData';
import { buildGuestPassDataFromToken } from '@/lib/guestPassService';
import { fetchGuestPassKdkState, type PublicKdkSessionDetail } from '@/lib/publicClubService';

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

/**
 * KDK 세션 상태에 따라 Guest Pass 카드의 'KDK 경기 안내' match 블록을 자동 전환.
 *
 * - preparing → '대진표 준비 중' (KDK 세션이 연결된 경우 상태 문구 통일).
 * - ready / in_progress → '대진표·현재 경기 보기' 액션.
 * - settling → '경기 결과 확인' 액션 (확정 전 — 순위/정산은 확정 후 표시 안내).
 * - finished → '최종 순위·정산 결과 보기' 액션.
 *
 * 공개 KDK 상세 라우트(/club/kdk/[sessionId]) 로 연결 — 점수 입력 / 관리 버튼 없음.
 * href 에 gp=<token> 을 실어 공개 화면에서 같은 일정의 Guest Pass 로 복귀할 수 있게 한다
 * (내부 경로 복원 전용 — 임의 URL returnTo 미허용).
 */
function mergeMatchWithKdkState(
    base: GuestPassMatchStatus,
    kdk: PublicKdkSessionDetail,
    token: string,
): GuestPassMatchStatus {
    const href = `/club/kdk/${encodeURIComponent(kdk.sessionId)}?gp=${encodeURIComponent(token)}`;
    switch (kdk.state) {
        case 'preparing':
            return {
                ...base,
                state: 'preparing',
                headline: '대진표 준비 중',
                body: '대진표는 경기 당일 운영진이 편성한 뒤 이 영역에 등록됩니다. 경기 시작 전 이 링크를 다시 열어 확인해주세요.',
            };
        case 'ready':
            return {
                ...base,
                state: 'bracket_ready',
                headline: '대진표가 준비되었습니다',
                body: '대진표와 실시간 경기 진행 상황을 확인할 수 있습니다.',
                actions: [{ label: '대진표·현재 경기 보기', href }],
            };
        case 'in_progress':
            return {
                ...base,
                state: 'in_progress',
                headline: '현재 KDK 경기가 진행 중입니다',
                body: '대진표와 실시간 경기 진행 상황을 확인할 수 있습니다.',
                actions: [{ label: '대진표·현재 경기 보기', href }],
            };
        case 'settling':
            return {
                ...base,
                state: 'in_progress',
                headline: '경기 결과 정리 중입니다',
                body: '최종 순위와 정산 내용은 운영진 확정 후 표시됩니다.',
                actions: [{ label: '경기 결과 확인', href }],
            };
        case 'finished':
            return {
                ...base,
                state: 'finished',
                headline: '공식 경기 결과가 등록되었습니다',
                body: '최종 순위, 게스트비, 벌금 정산 내용을 확인할 수 있습니다.',
                actions: [{ label: '최종 순위·정산 결과 보기', href }],
            };
        default:
            return base;
    }
}

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
                // 1) Guest Pass 본체 RPC.
                const built = await buildGuestPassDataFromToken(token);
                if (cancelled) return;
                if (!built) {
                    setLoadStatus('not_found');
                    return;
                }
                // 2) 연결된 KDK 세션 상태 RPC — 있으면 match 블록 자동 전환.
                //    실패해도 base 데이터는 그대로 표시 (안전 폴백).
                let kdk: PublicKdkSessionDetail | null = null;
                try {
                    kdk = await fetchGuestPassKdkState(token);
                } catch {
                    kdk = null;
                }
                if (cancelled) return;
                if (kdk) {
                    built.match = mergeMatchWithKdkState(built.match, kdk, token);
                }
                setData(built);
                setLoadStatus('ok');
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
            <GuestPassCard data={data} footerCta={<GuestPassFooterCta />} />
            {mounted && introVisible && (
                <GuestPassIntro onDone={() => setIntroVisible(false)} />
            )}
        </>
    );
}
