import type { Metadata } from 'next';

/**
 * /club — TEYEON 공개 둘러보기 레이아웃.
 *
 * 외부 방문자(비로그인) 대상 — 회원용 chrome(GlobalHeader / BottomNav / SplashScreen) 은
 * 각 컴포넌트의 pathname 가드(/club*)로 자동 숨김. 이 레이아웃은 외부 검색 노출을 허용
 * (공식 소개 페이지). 다만 /club/kdk/[sessionId] 같은 세션 상세는 자체 layout 에서
 * noindex 로 잠근다.
 */
export const metadata: Metadata = {
    title: 'TEYEON · 둘러보기',
    description: 'TEYEON 테니스 클럽의 일정·경기·멤버를 둘러보세요.',
    robots: {
        index: true,
        follow: true,
    },
};

export default function ClubLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
