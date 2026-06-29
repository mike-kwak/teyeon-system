'use client';

// 정모 상세를 웹/카카오 인앱 브라우저에서 열었을 때 "TEYEON 앱에서 열기"를 안내하는 작은 카드.
//   - PWA standalone(이미 앱으로 실행 중)이면 전체 숨김.
//   - SSR 안전: mount 이후에만 환경 판정(hydration mismatch 방지).
//   - 순수 설치형 PWA 특성상 "무조건 앱 전환"을 보장할 수 없다 → best-effort + 정직한 안내/복사 fallback.
//   - 같은 정모 URL 을 그대로 사용(쿼리 변형/딥링크/커스텀 scheme 없음). 실패해도 현재 웹 페이지 유지.

import React from 'react';
import { Smartphone, ExternalLink, Copy, Check, HelpCircle } from 'lucide-react';
import { copyTextSafe } from '@/lib/clubScheduleShare';

type Platform = 'ios' | 'android' | 'other';

export default function OpenInTeyeonAppBanner({ url }: { url: string }) {
    const [mounted, setMounted] = React.useState(false);
    const [standalone, setStandalone] = React.useState(false);
    const [isKakao, setIsKakao] = React.useState(false);
    const [platform, setPlatform] = React.useState<Platform>('other');
    const [showHelp, setShowHelp] = React.useState(false);
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        try {
            const sa =
                window.matchMedia('(display-mode: standalone)').matches ||
                (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
            setStandalone(sa);
            const ua = navigator.userAgent || '';
            setIsKakao(/KAKAOTALK/i.test(ua));
            if (/iPhone|iPad|iPod/i.test(ua)) setPlatform('ios');
            else if (/Android/i.test(ua)) setPlatform('android');
        } catch {
            /* 환경 판정 실패 시 보수적으로 일반 브라우저로 간주(배너 표시) */
        }
    }, []);

    // SSR/standalone 에서는 아무것도 렌더하지 않음(앱 내부에서는 숨김).
    if (!mounted || standalone) return null;

    // CTA — 사용자 클릭 시에만 동작(자동 실행 금지). 같은 https URL 로 best-effort 시도.
    //   설치된 PWA 가 링크 처리를 지원하는 환경(일부 Android)에서는 앱으로 열릴 수 있고,
    //   아니면 일반 탭으로 같은 정모 페이지가 열린다(빈/오류 페이지 아님). 어느 쪽이든 현재 화면은 유지.
    const handleOpen = () => {
        if (!isKakao) {
            try { window.open(url, '_blank', 'noopener'); } catch { /* 무시 */ }
        }
        setShowHelp(true); // 전환이 안 될 때를 대비한 안내를 항상 함께 노출.
    };

    const handleCopy = async () => {
        const ok = await copyTextSafe(url);
        if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
    };

    const installGuide =
        platform === 'ios'
            ? 'Safari 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택해 주세요.'
            : platform === 'android'
                ? '브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.'
                : '브라우저 메뉴에서 ‘홈 화면에 추가’를 선택해 주세요.';

    return (
        <div
            style={{
                margin: '0 0 12px', padding: '12px 13px', borderRadius: 14,
                backgroundColor: '#F6FBFA', border: '1px solid #CDEBE7',
                boxShadow: '0 1px 2px rgba(15,27,51,0.04)', overflow: 'hidden',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, backgroundColor: 'rgba(14,124,118,0.10)', color: '#0E7C76', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Smartphone size={17} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#0F1B33', wordBreak: 'keep-all' }}>
                        TEYEON 앱으로 더 편하게 확인하세요.
                    </p>
                    <p style={{ margin: '3px 0 0', fontSize: 11.5, fontWeight: 600, color: '#5B7772', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                        설치된 앱이 있다면 현재 정모 화면으로 이어서 열 수 있습니다.
                    </p>
                    {isKakao && (
                        <p style={{ margin: '6px 0 0', fontSize: 10.5, fontWeight: 700, color: '#B45309', lineHeight: 1.5, wordBreak: 'keep-all' }}>
                            카카오톡 안에서는 설치된 앱으로 바로 전환되지 않을 수 있습니다. 앱 전환이 되지 않으면 외부 브라우저에서 다시 열어주세요.
                        </p>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                        <button type="button" onClick={handleOpen}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 13px', borderRadius: 9, border: 'none', backgroundColor: '#0E7C76', color: '#FFFFFF', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            <ExternalLink size={13} /> TEYEON 앱에서 열기
                        </button>
                        <button type="button" onClick={handleCopy}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 11px', borderRadius: 9, border: '1px solid #CDEBE7', backgroundColor: '#FFFFFF', color: '#0E7C76', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? '복사됨' : '주소 복사'}
                        </button>
                        <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 34, padding: '0 10px', borderRadius: 9, border: '1px solid #E3E9F2', backgroundColor: '#FFFFFF', color: '#64748B', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            <HelpCircle size={13} /> 도움말
                        </button>
                    </div>

                    {showHelp && (
                        <div style={{ marginTop: 10, padding: '10px 11px', borderRadius: 10, backgroundColor: '#FFFFFF', border: '1px solid #E3E9F2' }}>
                            <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#475569', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                                앱이 설치되어 있지 않다면 {installGuide}
                            </p>
                            <p style={{ margin: '5px 0 0', fontSize: 11, fontWeight: 600, color: '#94A3B8', lineHeight: 1.6, wordBreak: 'keep-all' }}>
                                설치된 앱이 있다면 홈 화면의 TEYEON 아이콘으로 열거나, 복사한 주소를 앱에서 열어 주세요.
                                {isKakao && ' 카카오톡에서는 메뉴의 ‘다른 브라우저로 열기’를 이용해 주세요.'}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
