'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { RotateCcw, ArrowRight } from 'lucide-react';
import { buildGuestPassDataForSchedule } from '@/lib/guestPassService';
import type { GuestPassData } from '@/lib/guestPassData';

// Instagram glyph (lucide-react에 미포함이라 inline SVG로 대체)
const InstagramIcon = ({ size = 15, strokeWidth = 1.9, color = 'currentColor' }: { size?: number; strokeWidth?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill={color} stroke="none" />
    </svg>
);
import GuestPassCard from '@/components/guest/GuestPassCard';
import GuestPassIntro from '@/components/guest/GuestPassIntro';
import { mockGuestPassData } from '@/lib/guestPassData';

/**
 * /guest/pass/preview — 개발 / 디자인 QA 전용.
 * - mock 데이터 사용. Supabase / token 연결 없음.
 * - 메인 메뉴에는 노출하지 않음 (직접 URL 진입만).
 * - 본문은 처음부터 렌더링하고, GuestPassIntro overlay가 그 위를 덮음.
 * - sessionStorage 키: teyeon_guest_pass_intro_preview (메인 Splash key와 분리).
 * - preview 한정 "인트로 다시 보기" 버튼 — 운영 라우트에서는 절대 노출하지 않음.
 * - 외부 공개 랜딩 — root layout의 max-width 450px 모바일 컨테이너 위에 fixed로 떠서
 *   viewport 전체를 차지. GlobalHeader / BottomNav / SplashScreen 은 pathname 가드로 숨김.
 */

const PREVIEW_SS_KEY = 'teyeon_guest_pass_intro_preview';

export default function GuestPassPreviewPage() {
    const searchParams = useSearchParams();
    const scheduleId = searchParams?.get('scheduleId') || '';
    const [introVisible, setIntroVisible] = React.useState<boolean>(false);
    const [mounted, setMounted] = React.useState(false);

    /**
     * ?scheduleId=xxx 가 있으면 실제 정모 데이터로 미리보기 (운영진 도구).
     * fetch 실패(권한 부재 / 데이터 없음)면 mock 으로 폴백.
     */
    const [scheduleData, setScheduleData] = React.useState<GuestPassData | null>(null);
    React.useEffect(() => {
        if (!scheduleId) { setScheduleData(null); return; }
        let cancelled = false;
        (async () => {
            try {
                const built = await buildGuestPassDataForSchedule(scheduleId);
                if (!cancelled) setScheduleData(built);
            } catch {
                if (!cancelled) setScheduleData(null);
            }
        })();
        return () => { cancelled = true; };
    }, [scheduleId]);

    React.useEffect(() => {
        setMounted(true);
        try {
            if (!sessionStorage.getItem(PREVIEW_SS_KEY)) {
                sessionStorage.setItem(PREVIEW_SS_KEY, '1');
                setIntroVisible(true);
            }
        } catch {
            // sessionStorage 차단 환경 — 인트로 그냥 노출
            setIntroVisible(true);
        }
    }, []);

    const handleReplayIntro = () => {
        try {
            sessionStorage.removeItem(PREVIEW_SS_KEY);
        } catch { /* noop */ }
        // 즉시 인트로 다시 마운트
        setIntroVisible(false);
        window.setTimeout(() => {
            try { sessionStorage.setItem(PREVIEW_SS_KEY, '1'); } catch { /* noop */ }
            setIntroVisible(true);
        }, 40);
    };

    // 실 데이터 미리보기 시 라벨 변경 — 운영진이 mock 인지 실 데이터인지 즉시 인지.
    const usingRealData = !!scheduleData;
    const previewBadge = (
        <div
            style={{
                alignSelf: 'flex-start',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                paddingTop: 4, paddingRight: 10, paddingBottom: 4, paddingLeft: 10,
                borderRadius: 999,
                backgroundColor: usingRealData ? 'rgba(15,159,152,0.10)' : 'rgba(245,158,11,0.10)',
                border: `1px solid ${usingRealData ? 'rgba(15,159,152,0.28)' : 'rgba(245,158,11,0.24)'}`,
                color: usingRealData ? '#0E7C76' : '#92400E',
                fontFamily: 'var(--font-rajdhani), sans-serif',
                fontSize: 9.5, fontWeight: 800, letterSpacing: '0.16em',
                textTransform: 'uppercase',
                marginBottom: 2,
            }}
        >
            {usingRealData ? 'ADMIN PREVIEW · LIVE DATA' : 'DEV PREVIEW · MOCK DATA'}
        </div>
    );

    // 공개 CTA — 로그인 화면이나 회원 전용 페이지로 이동시키지 않음.
    // /club 공개 소개 페이지는 아직 없어 임의 연결 금지 → disabled 상태로 구조만 준비.
    const publicFooterCta = (
        <div
            style={{
                marginTop: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
            }}
        >
            <button
                type="button"
                disabled
                aria-disabled
                title="준비 중"
                style={{
                    width: '100%',
                    height: 48,
                    borderRadius: 12,
                    border: '1px solid rgba(15,23,42,0.08)',
                    backgroundColor: '#FFFFFF',
                    color: '#475569',
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: '-0.01em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'not-allowed',
                    opacity: 0.85,
                    WebkitTapHighlightColor: 'transparent',
                }}
            >
                TEYEON 클럽 둘러보기
                <ArrowRight size={14} strokeWidth={2} style={{ color: '#94A3B8' }} />
                <span style={{
                    marginLeft: 6, paddingTop: 2, paddingBottom: 2, paddingLeft: 7, paddingRight: 7,
                    borderRadius: 999,
                    backgroundColor: 'rgba(100,116,139,0.10)',
                    color: '#64748B',
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                }}>
                    준비 중
                </span>
            </button>
            <button
                type="button"
                disabled
                aria-disabled
                title="준비 중"
                style={{
                    width: '100%',
                    height: 48,
                    borderRadius: 12,
                    border: '1px solid rgba(15,23,42,0.08)',
                    backgroundColor: '#FFFFFF',
                    color: '#475569',
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: '-0.01em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'not-allowed',
                    opacity: 0.85,
                    WebkitTapHighlightColor: 'transparent',
                }}
            >
                <InstagramIcon size={15} strokeWidth={1.9} color="#94A3B8" />
                공식 인스타그램
                <span style={{
                    marginLeft: 6, paddingTop: 2, paddingBottom: 2, paddingLeft: 7, paddingRight: 7,
                    borderRadius: 999,
                    backgroundColor: 'rgba(100,116,139,0.10)',
                    color: '#64748B',
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                }}>
                    준비 중
                </span>
            </button>
        </div>
    );

    return (
        <>
            {/*
              외부 공개 랜딩 — root layout 의 max-width 450 컨테이너 위에 fixed로 떠서
              뷰포트 전체를 차지. chrome(GlobalHeader/BottomNav/SplashScreen)은
              pathname 가드로 숨겨짐.
              세로 스크롤은 이 fixed 컨테이너 단독.
            */}
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 100,
                    backgroundColor: '#F2F4F7',
                    overflowY: 'auto',
                    WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'],
                }}
            >
                <GuestPassCard
                    data={scheduleData ?? mockGuestPassData}
                    previewBadge={previewBadge}
                    footerCta={publicFooterCta}
                />
            </div>

            {/* 인트로 overlay — sessionStorage 1회 + reduced-motion 대응 */}
            {mounted && introVisible && (
                <GuestPassIntro onDone={() => setIntroVisible(false)} />
            )}

            {/* preview 전용 "인트로 다시 보기" — 운영 라우트에는 없음 */}
            {mounted && !introVisible && (
                <button
                    type="button"
                    onClick={handleReplayIntro}
                    aria-label="인트로 다시 보기 (preview only)"
                    style={{
                        position: 'fixed',
                        right: 'calc(env(safe-area-inset-right) + 14px)',
                        bottom: 'calc(env(safe-area-inset-bottom) + 18px)',
                        zIndex: 9000,
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        height: 36,
                        paddingLeft: 12, paddingRight: 12,
                        borderRadius: 999,
                        backgroundColor: '#0F172A',
                        color: '#FFFFFF',
                        border: '1px solid rgba(255,255,255,0.08)',
                        boxShadow: '0 6px 18px rgba(15,23,42,0.32)',
                        fontFamily: 'var(--font-rajdhani), sans-serif',
                        fontSize: 11, fontWeight: 800, letterSpacing: '0.10em',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                    }}
                >
                    <RotateCcw size={13} strokeWidth={2} />
                    Intro Replay
                </button>
            )}
        </>
    );
}
