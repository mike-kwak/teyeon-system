import type { Metadata } from 'next';

/**
 * /tournaments/[slug]/staff — 현장 운영자 화면(로그인 · 본부 승인 필요).
 *
 * - 운영 화면이므로 검색 색인을 차단한다(Hub 는 index 허용, 여기서 덮어쓴다).
 * - 권한 판정은 서버 RPC 가 한다(승인 + 만료 전 + 대회 진행 중). 이 경로 자체는 누구나 열 수 있지만
 *   승인되지 않은 사용자에게는 경기 정보를 돌려주지 않는다.
 * - page 는 'use client' 라 Route Segment Config 를 여기(server layout)에서 설정한다.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
    title: '현장 운영 · 2026 TEYEON OPEN',
    robots: {
        index: false,
        follow: false,
        nocache: true,
    },
};

export default function TournamentStaffLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
