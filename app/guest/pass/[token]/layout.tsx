import type { Metadata } from 'next';

/**
 * 공개 Guest Pass 페이지 (/guest/pass/[token]) 검색 차단.
 *
 * - 공개 링크 자체는 누구나 열람 가능하지만 검색엔진 인덱싱은 막아야 함.
 * - 카카오톡 등 외부 채널에서 공유된 사람만 접근하도록 'noindex, nofollow' 헤더 부여.
 * - 추가로 robots 태그를 모든 주요 봇에 적용.
 *
 * Page 자체는 'use client' 컴포넌트이므로 metadata 를 export 할 수 없음 → 별도 layout 으로 분리.
 * GlobalHeader / BottomNav / SplashScreen 은 pathname 가드(/guest/pass*)로 이미 숨겨짐.
 */

export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false,
        googleBot: {
            index: false,
            follow: false,
        },
    },
};

export default function GuestPassTokenLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
