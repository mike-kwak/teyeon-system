import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/live-test — LIVE 송출 PoC 전용 페이지.
 *
 * - 참가자에게 공개하는 화면이 아니다. Hub 네비게이션의 LIVE 탭은 계속 'pending' 이며
 *   이 경로는 어디에서도 링크하지 않는다(직접 URL 로만 접근).
 * - 따라서 검색 색인을 차단한다(Hub 는 index 허용, 여기서 덮어쓴다).
 * - LIVE 상태가 즉시 반영되어야 하므로 캐시하지 않는다.
 * - page 는 'use client' 라 Route Segment Config 를 여기(server layout)에서 설정한다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: 'LIVE TEST · 2026 TEYEON OPEN',
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function TournamentLiveTestLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
