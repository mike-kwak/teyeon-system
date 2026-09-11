import type { Metadata } from 'next';

/**
 * /tournaments/[slug] — TEYEON 주최 공개 대회 Hub 레이아웃.
 *
 * ⚠️ 복수형 /tournaments 는 "외부 참가자용 공개 대회" 도메인이다.
 *    단수형 /tournament(내부 KDK·스페셜매치) 및 /tournament-calendar(회원 출전 대회 캘린더)와 무관하며
 *    서로 코드·테이블을 공유하지 않는다.
 *
 * - QR 진입점이자 공식 대회 사이트이므로 검색 색인을 허용한다.
 * - 접수 현황이 실시간으로 바뀌므로 캐시하지 않는다(page 는 'use client' 라 여기서 세그먼트 설정).
 * - 회원용 chrome(GlobalHeader / BottomNav / SplashScreen)은 각 컴포넌트의 pathname 가드로 숨겨진다.
 * - 개인정보성 하위 경로(/register, /register/complete)는 각자의 layout 에서 noindex 로 잠근다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: '2026 TEYEON OPEN · 비랭킹 복식 테니스 대회',
    description:
        '2026 TEYEON OPEN — 2026.10.25(일) 09:00, 아산시 강변 테니스장. 비랭킹 복식 테니스 대회 참가 신청 및 대회 요강 안내.',
    robots: {
        index: true,
        follow: true,
    },
};

export default function TournamentPublicLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
